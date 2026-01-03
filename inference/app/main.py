import argparse
import logging
import sys
import asyncio
import grpc
from .config import ModelConfig
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
    parser.add_argument('--workers', type=int, default=8, help='Number of worker threads (unused for async server)')
    parser.add_argument('-c', '--model-config', type=str, default='models.yaml', help='Path to model config file')
    return parser.parse_args()

async def serve() -> None:
    args = parse_args()
    config = ModelConfig.from_yaml(args.model_config)
    try:
        model_manager = ModelManager(config=config)
        model_manager.load_models()
    except Exception as e:
        logger.critical(f"Failed to load models: {e}", exc_info=True)
        sys.exit(1)

    server = grpc.aio.server()
    service = InferenceService(model_manager, config)
    inference_pb2_grpc.add_InferenceServiceServicer_to_server(
        service, server
    )

    address = f'{args.host}:{args.port}'
    server.add_insecure_port(address)
    logger.info(f"Inference service starting on {address}...")

    await service.start()
    await server.start()

    try:
        await server.wait_for_termination()
    except (KeyboardInterrupt, asyncio.CancelledError):
        logger.info("Shutting down...")
    finally:
        await service.stop()
        await server.stop(0)

if __name__ == '__main__':
    asyncio.run(serve())
