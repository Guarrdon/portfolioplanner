"""
Portfolio Planner Backend - Main FastAPI Application
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import Base, engine
from app.api.v1 import positions, auth, websocket
from app.services.collaboration_client import (
    init_collaboration_client,
    shutdown_collaboration_client
)

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Create database tables
Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events.
    """
    # Startup
    logger.info("Starting up Portfolio Planner backend")
    
    # Initialize collaboration client if enabled
    if settings.ENABLE_COLLABORATION:
        try:
            logger.info("Initializing collaboration client")
            collab_client = await init_collaboration_client(
                user_id=settings.BACKEND_USER_ID,
                backend_url=settings.BACKEND_URL,
                collab_service_url=settings.COLLABORATION_SERVICE_URL,
                display_name=settings.BACKEND_DISPLAY_NAME
            )
            
            # Register event handlers
            from app.services.collaboration_handlers import (
                handle_position_shared,
                handle_comment_added,
                handle_position_updated,
                handle_share_revoked
            )
            
            collab_client.on('position_shared', handle_position_shared)
            collab_client.on('comment_added', handle_comment_added)
            collab_client.on('position_updated', handle_position_updated)
            collab_client.on('share_revoked', handle_share_revoked)
            
            logger.info("Collaboration client connected successfully")
        except Exception as e:
            logger.error(f"Failed to initialize collaboration client: {e}", exc_info=True)
            logger.warning("Running without collaboration features")
    else:
        logger.info("Collaboration disabled (ENABLE_COLLABORATION=False)")
    
    yield
    
    # Shutdown
    logger.info("Shutting down Portfolio Planner backend")
    
    if settings.ENABLE_COLLABORATION:
        try:
            await shutdown_collaboration_client()
            logger.info("Collaboration client disconnected")
        except Exception as e:
            logger.error(f"Error shutting down collaboration client: {e}")

# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Portfolio Planner API for managing stock and option positions",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api/v1")
app.include_router(positions.router, prefix="/api/v1")
app.include_router(websocket.router, prefix="/api/v1")


@app.get("/")
def root():
    """Root endpoint"""
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
        "docs": "/docs"
    }


@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "mock_mode": settings.USE_MOCK_SCHWAB_DATA
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=settings.DEBUG)

