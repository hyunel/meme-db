import argparse
import logging
import sys
from concurrent import futures
import grpc
from .manager import ModelManager
from .service import InferenceService
from .pb import inference_pb2_grpc

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MemeDB Inference Service")
    parser.add_argument('--host', type=str, default='[::]', help='Host to bind to')
    parser.add_argument('--port', type=int, default=50051, help='Port to bind to')
    parser.add_argument('--workers', type=int, default=8, help='Number of worker threads')
    parser.add_argument('-c', '--model-config', type=str, default='models.yaml', help='Path to model config file')
    return parser.parse_args()

def serve() -> None:
    args = parse_args()

    try:
        model_manager = ModelManager(config_path=args.model_config)
        model_manager.load_models()
    except Exception as e:
        logger.critical(f"Failed to load models: {e}", exc_info=True)
        sys.exit(1)

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=args.workers))
    inference_pb2_grpc.add_InferenceServiceServicer_to_server(
        InferenceService(model_manager), server
    )

    address = f'{args.host}:{args.port}'
    server.add_insecure_port(address)
    logger.info(f"Inference service starting on {address} with {args.workers} workers...")

    try:
        server.start()
        server.wait_for_termination()
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        server.stop(0)

if __name__ == '__main__':
    serve()
