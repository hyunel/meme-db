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

# --- Data Generation ---

def generate_random_text(min_len: int = 10, max_len: int = 50) -> str:
    length = random.randint(min_len, max_len)
    return ''.join(random.choices(string.ascii_letters + string.digits + " ", k=length))

def generate_random_image_bytes(size: int = 224) -> bytes:
    img = Image.new('RGB', (size, size), color=(random.randint(0, 255), random.randint(0, 255), random.randint(0, 255)))
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    return buf.getvalue()

# --- Benchmark Logic ---

class BenchmarkStats:
    def __init__(self):
        self.latencies: List[float] = [] # in milliseconds
        self.errors: int = 0
        self.successes: int = 0
        self.total_tasks: int = 0  # Track actual number of tasks processed
        self.lock = threading.Lock()

    def record(self, latency_ms: float, is_error: bool = False, batch_size: int = 1):
        with self.lock:
            if is_error:
                self.errors += 1
            else:
                self.successes += 1
                self.total_tasks += batch_size  # Count actual tasks
                self.latencies.append(latency_ms)

    def merge(self, other: 'BenchmarkStats'):
        with self.lock:
            self.latencies.extend(other.latencies)
            self.errors += other.errors
            self.successes += other.successes
            self.total_tasks += other.total_tasks

def perform_request(stub, args, text_data, image_data):
    start = time.perf_counter()
    try:
        if args.task_type == 'text':
            req = inference_pb2.TextEmbeddingRequest(
                task_description=args.task_desc,
                texts=text_data
            )
            stub.TextEmbedding(req)
        elif args.task_type == 'clip-text':
            req = inference_pb2.ClipTextEmbeddingRequest(
                texts=text_data
            )
            stub.ClipTextEmbedding(req)
        elif args.task_type == 'clip-image':
            req = inference_pb2.ClipImageEmbeddingRequest(
                images=image_data
            )
            stub.ClipImageEmbedding(req)
        elif args.task_type == 'rerank':
            pairs = [inference_pb2.RerankPair(query=text, document=text) for text in text_data]
            req = inference_pb2.RerankRequest(
                task_description=args.task_desc,
                pairs=pairs
            )
            stub.Rerank(req)
        elif args.task_type == 'analyze-image':
            req = inference_pb2.AnalyzeImageRequest(
                inputs=[inference_pb2.AnalyzeImageInput(image=img) for img in image_data]
            )
            stub.AnalyzeImage(req)
        else:
            raise ValueError(f"Unknown task type: {args.task_type}")

        return (time.perf_counter() - start) * 1000, False
    except Exception as e:
        # print(f"Request failed: {e}") # Reduce noise in progress bar
        return 0, True

def worker(args, server_address, tasks_per_worker, pbar=None):
    stats = BenchmarkStats()

    # Each worker creates its own channel/stub to simulate real client isolation
    channel = grpc.insecure_channel(server_address)
    stub = inference_pb2_grpc.InferenceServiceStub(channel)

    # Pre-generate some data to avoid measuring generation time during loop
    # We generate a pool of data and cycle through it
    text_pool = [generate_random_text() for _ in range(args.batch_size * 10)]
    image_pool = [inference_pb2.Image(data=generate_random_image_bytes(), file_format='jpeg') for _ in range(args.batch_size * 10)]

    tasks_processed = 0

    while tasks_processed < tasks_per_worker:
        remaining = tasks_per_worker - tasks_processed
        current_batch = min(args.batch_size, remaining)

        batch_text = random.choices(text_pool, k=current_batch)
        batch_image = random.choices(image_pool, k=current_batch) if args.task_type in ['clip-image', 'analyze-image'] else []

        latency, error = perform_request(stub, args, batch_text, batch_image)
        stats.record(latency, error, current_batch)
        tasks_processed += current_batch
        if pbar:
            pbar.update(1)

    channel.close()
    return stats

def run_benchmark(args):
    print(f"Benchmarking {args.task_type} on {args.host}")
    print(f'  Total Tasks: {args.total}')
    print(f"  Concurrency: {args.concurrency}")
    print(f"  Batch Size: {args.batch_size}")
    if args.task_desc:
        print(f"  Task Desc: {args.task_desc}")
    print()

    start_time = time.time()

    base_requests = args.total // args.batch_size
    extra_tasks = args.total % args.batch_size

    requests_per_worker = base_requests // args.concurrency
    extra_requests = base_requests % args.concurrency

    futures = []
    total_stats = BenchmarkStats()

    total_requests = base_requests + (1 if extra_tasks > 0 else 0)
    pbar = tqdm(total=total_requests, unit="req")

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        for i in range(args.concurrency):
            num_requests = requests_per_worker + (1 if i < extra_requests else 0)
            tasks_for_worker = num_requests * args.batch_size
            if i == 0:
                tasks_for_worker += extra_tasks
            if tasks_for_worker > 0:
                futures.append(executor.submit(worker, args, args.host, tasks_for_worker, pbar))

        for future in concurrent.futures.as_completed(futures):
            worker_stats = future.result()
            total_stats.merge(worker_stats)

    pbar.close()

    duration = time.time() - start_time

    print(f"\nCompleted in {duration:.2f}s")
    print(f"Requests: {total_stats.successes}/{total_stats.successes + total_stats.errors} succeeded | Tasks: {total_stats.total_tasks}")

    if total_stats.successes > 0:
        throughput = total_stats.total_tasks / duration
        qps = total_stats.successes / duration
        avg_lat = statistics.mean(total_stats.latencies)
        p50 = statistics.median(total_stats.latencies)
        p90 = statistics.quantiles(total_stats.latencies, n=10)[8] if len(total_stats.latencies) >= 10 else p50
        p99 = statistics.quantiles(total_stats.latencies, n=100)[98] if len(total_stats.latencies) >= 100 else max(total_stats.latencies)
        max_lat = max(total_stats.latencies)

        print(f"\nPerformance:")
        print(f"  Throughput: {throughput:.2f} tasks/s | QPS: {qps:.2f} req/s")
        print(f"  Latency (ms): avg={avg_lat:.2f}, p50={p50:.2f}, p90={p90:.2f}, p99={p99:.2f}, max={max_lat:.2f}")
    else:
        print("\nNo successful requests.")

def main():
    parser = argparse.ArgumentParser(description="gRPC Benchmark for Inference Service")
    parser.add_argument("--host", default="localhost:50051", help="Server address (host:port)")
    parser.add_argument("-t", "--task-type", required=True, choices=['text', 'clip-text', 'clip-image', 'rerank', 'analyze-image'], help="Task type to benchmark")
    parser.add_argument("-c", "--concurrency", type=int, default=1, help="Number of concurrent workers")
    parser.add_argument("-n", "--total", type=int, default=100, help="Total number of tasks to process")
    parser.add_argument("-b", "--batch-size", type=int, default=8, help="Number of items per request")
    parser.add_argument("--task-desc", default="Retrieval", help="Task description for text embedding/rerank")

    args = parser.parse_args()

    run_benchmark(args)

if __name__ == "__main__":
    main()
