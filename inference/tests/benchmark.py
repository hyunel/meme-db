import argparse
import time
import grpc
import random
import string
import statistics
import concurrent.futures
import threading
from typing import List

from tqdm import tqdm
from PIL import Image
import io

from app.pb import inference_pb2
from app.pb import inference_pb2_grpc


def generate_random_text(min_len: int = 10, max_len: int = 50) -> str:
    length = random.randint(min_len, max_len)
    return ''.join(random.choices(string.ascii_letters + string.digits + " ", k=length))

def generate_random_image_bytes(size: int = 224) -> bytes:
    img = Image.new('RGB', (size, size), color=(random.randint(0, 255), random.randint(0, 255), random.randint(0, 255)))
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    return buf.getvalue()


class BenchmarkStats:
    def __init__(self):
        self.latencies: List[float] = [] # in milliseconds
        self.errors: int = 0
        self.successes: int = 0
        self.lock = threading.Lock()

    def record(self, latency_ms: float, is_error: bool = False):
        with self.lock:
            if is_error:
                self.errors += 1
            else:
                self.successes += 1
                self.latencies.append(latency_ms)

    def merge(self, other: 'BenchmarkStats'):
        with self.lock:
            self.latencies.extend(other.latencies)
            self.errors += other.errors
            self.successes += other.successes

def perform_request(stub, args, text, image, task_type):
    start = time.perf_counter()
    options = inference_pb2.TaskOptions(priority=0)
    try:
        if task_type == 'text':
            req = inference_pb2.TextEmbeddingRequest(
                options=options,
                task_description=args.task_desc,
                text=text
            )
            stub.TextEmbedding(req)
        elif task_type == 'clip-text':
            req = inference_pb2.ClipTextEmbeddingRequest(
                options=options,
                text=text
            )
            stub.ClipTextEmbedding(req)
        elif task_type == 'clip-image':
            req = inference_pb2.ClipImageEmbeddingRequest(
                options=options,
                image=image
            )
            stub.ClipImageEmbedding(req)
        elif task_type == 'rerank':
            req = inference_pb2.RerankRequest(
                options=options,
                task_description=args.task_desc,
                query=text,
                document=text
            )
            stub.Rerank(req)
        elif task_type == 'caption':
            req = inference_pb2.ImageCaptionRequest(
                options=options,
                prompt=args.prompt,
                image=image
            )
            stub.ImageCaption(req)
        else:
            raise ValueError(f"Unknown task type: {task_type}")

        return (time.perf_counter() - start) * 1000, False
    except Exception:
        return 0, True

def worker(args, server_address, tasks_per_worker, pbar=None):
    stats = BenchmarkStats()

    # A channel per worker, like separate clients
    channel = grpc.insecure_channel(server_address)
    stub = inference_pb2_grpc.InferenceServiceStub(channel)

    # A pregenerated pool keeps data generation out of the measurements
    pool_size = 100
    text_pool = [generate_random_text() for _ in range(pool_size)]
    image_pool = [inference_pb2.Image(data=generate_random_image_bytes(), file_format='jpeg') for _ in range(pool_size)]

    tasks_processed = 0

    image_required_types = {'clip-image', 'caption'}

    while tasks_processed < tasks_per_worker:
        task_type = random.choice(args.task_type)
        text = random.choice(text_pool)
        image = random.choice(image_pool) if task_type in image_required_types else None

        latency, error = perform_request(stub, args, text, image, task_type)
        stats.record(latency, error)
        tasks_processed += 1
        if pbar:
            pbar.update(1)

    channel.close()
    return stats

def run_benchmark(args):
    print(f"Benchmarking {', '.join(args.task_type)} on {args.host}")
    print(f'  Total Tasks: {args.total}')
    print(f"  Concurrency: {args.concurrency}")
    print()

    start_time = time.time()

    tasks_per_worker = args.total // args.concurrency
    extra_tasks = args.total % args.concurrency

    futures = []
    total_stats = BenchmarkStats()

    pbar = tqdm(total=args.total, unit="req")

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        for i in range(args.concurrency):
            worker_tasks = tasks_per_worker + (1 if i < extra_tasks else 0)
            if worker_tasks > 0:
                futures.append(executor.submit(worker, args, args.host, worker_tasks, pbar))

        for future in concurrent.futures.as_completed(futures):
            worker_stats = future.result()
            total_stats.merge(worker_stats)

    pbar.close()

    duration = time.time() - start_time

    print(f"\nCompleted in {duration:.2f}s")
    print(f"Requests: {total_stats.successes}/{total_stats.successes + total_stats.errors} succeeded")

    if total_stats.successes > 0:
        throughput = total_stats.successes / duration
        avg_lat = statistics.mean(total_stats.latencies)
        p50 = statistics.median(total_stats.latencies)
        p90 = statistics.quantiles(total_stats.latencies, n=10)[8] if len(total_stats.latencies) >= 10 else p50
        p99 = statistics.quantiles(total_stats.latencies, n=100)[98] if len(total_stats.latencies) >= 100 else max(total_stats.latencies)
        max_lat = max(total_stats.latencies)

        print("\nPerformance:")
        print(f"  Throughput: {throughput:.2f} tasks/s")
        print(f"  Latency (ms): avg={avg_lat:.2f}, p50={p50:.2f}, p90={p90:.2f}, p99={p99:.2f}, max={max_lat:.2f}")
    else:
        print("\nNo successful requests.")

def main():
    parser = argparse.ArgumentParser(description="gRPC Benchmark for Inference Service")
    parser.add_argument("--host", default="localhost:50051", help="Server address (host:port)")
    parser.add_argument("-t", "--task-type", required=True, action='append', choices=['text', 'clip-text', 'clip-image', 'rerank', 'caption'], help="Task type to benchmark")
    parser.add_argument("-c", "--concurrency", type=int, default=16, help="Number of concurrent workers")
    parser.add_argument("-n", "--total", type=int, default=100, help="Total number of tasks to process")
    parser.add_argument("--task-desc", default="Retrieval", help="Task description for text embedding/rerank")
    parser.add_argument("--prompt", default="Describe this image", help="Prompt for image captioning")

    args = parser.parse_args()

    run_benchmark(args)

if __name__ == "__main__":
    main()
