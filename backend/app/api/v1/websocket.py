"""WebSocket endpoints for real-time collaboration"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
import logging

from app.services.websocket_manager import manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websocket"])


@router.websocket("/collaborate")
async def websocket_collaborate(
    websocket: WebSocket,
    user_id: str = Query(..., description="User ID for this connection")
):
    """
    WebSocket endpoint for real-time collaboration
    
    Clients connect with their user_id and receive real-time updates for:
    - Position changes (if they own or have access to the position)
    - New comments on positions they have access to
    - Share notifications
    
    Example connection from JavaScript:
        const ws = new WebSocket('ws://localhost:8000/api/v1/ws/collaborate?user_id=<uuid>');
    """
    await manager.connect(websocket, user_id)
    
    try:
        # Send initial connection confirmation
        await websocket.send_json({
            "event": "connected",
            "data": {
                "user_id": user_id,
                "message": "WebSocket connection established"
            }
        })
        
        # Keep connection alive and handle incoming messages
        while True:
            # Receive messages from client (for heartbeat, etc.)
            data = await websocket.receive_text()
            
            # Handle ping/pong for keep-alive
            if data == "ping":
                await websocket.send_text("pong")
            
            # Log any other messages for debugging
            else:
                logger.debug(f"Received message from user {user_id}: {data}")
    
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected normally: user_id={user_id}")
        manager.disconnect(websocket)
    
    except Exception as e:
        logger.error(f"WebSocket error for user {user_id}: {e}")
        manager.disconnect(websocket)

