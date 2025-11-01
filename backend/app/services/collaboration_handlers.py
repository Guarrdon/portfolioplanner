"""
Event handlers for collaboration service events.

These handlers process events received from the central collaboration service
and update the local backend state accordingly.
"""

import logging
from typing import Dict, Any
from app.core.database import SessionLocal
from app.models import position as models
from app.models.comment import Comment
from app.services.collaboration_client import get_collaboration_client
from app.services.websocket_manager import (
    broadcast_position_shared,
    broadcast_comment_added,
    broadcast_position_update,
    broadcast_share_revoked
)

logger = logging.getLogger(__name__)


async def handle_position_shared(event: Dict[str, Any]):
    """
    Handle position_shared event from collaboration service.
    
    When another user shares a position with this backend's user,
    we need to:
    1. Fetch the position data from the remote backend
    2. Store it locally as a shared position
    3. Notify the local frontend via WebSocket
    """
    try:
        from_user = event.get('from_user')
        data = event.get('data', {})
        position_id = data.get('position_id')
        share_url = data.get('share_url')
        
        logger.info(
            f"Received position_shared event",
            extra={
                "from_user": from_user,
                "position_id": position_id,
                "share_url": share_url
            }
        )
        
        if not share_url:
            logger.error("No share_url in position_shared event")
            return
        
        # Fetch position from remote backend
        collab_client = get_collaboration_client()
        if not collab_client:
            logger.error("Collaboration client not available")
            return
        
        position_data = await collab_client.fetch_shared_position(share_url)
        if not position_data:
            logger.error(f"Failed to fetch position from {share_url}")
            return
        
        # Store position locally
        # TODO: Implement storing shared position in local database
        # For now, just broadcast to local frontend
        
        logger.info(
            f"Successfully fetched shared position",
            extra={
                "position_id": position_id,
                "symbol": position_data.get('symbol')
            }
        )
        
        # Broadcast to local frontend
        # The frontend will refetch shared positions
        await broadcast_position_shared(
            position_id=position_id,
            recipient_ids=[],  # Local only
            owner_id=from_user
        )
        
    except Exception as e:
        logger.error(
            f"Error handling position_shared event",
            extra={"error": str(e)},
            exc_info=True
        )


async def handle_comment_added(event: Dict[str, Any]):
    """
    Handle comment_added event from collaboration service.
    
    When a comment is added to a shared position,
    notify the local frontend.
    """
    try:
        from_user = event.get('from_user')
        data = event.get('data', {})
        position_id = data.get('position_id')
        comment_data = data.get('comment', {})
        
        logger.info(
            f"Received comment_added event",
            extra={
                "from_user": from_user,
                "position_id": position_id,
                "comment_id": comment_data.get('id')
            }
        )
        
        # Broadcast to local frontend
        await broadcast_comment_added(
            position_id=position_id,
            comment_data=comment_data,
            owner_id='',  # Not used in local broadcast
            shared_with=[]  # Not used in local broadcast
        )
        
    except Exception as e:
        logger.error(
            f"Error handling comment_added event",
            extra={"error": str(e)},
            exc_info=True
        )


async def handle_position_updated(event: Dict[str, Any]):
    """
    Handle position_updated event from collaboration service.
    
    When a shared position is updated by the owner,
    notify the local frontend.
    """
    try:
        from_user = event.get('from_user')
        data = event.get('data', {})
        position_id = data.get('position_id')
        updates = data.get('updates', {})
        
        logger.info(
            f"Received position_updated event",
            extra={
                "from_user": from_user,
                "position_id": position_id,
                "update_keys": list(updates.keys())
            }
        )
        
        # Broadcast to local frontend
        await broadcast_position_update(
            position_id=position_id,
            position_data=updates,
            owner_id=from_user,
            shared_with=[]  # Not used in local broadcast
        )
        
    except Exception as e:
        logger.error(
            f"Error handling position_updated event",
            extra={"error": str(e)},
            exc_info=True
        )


async def handle_share_revoked(event: Dict[str, Any]):
    """
    Handle share_revoked event from collaboration service.
    
    When access to a shared position is revoked,
    remove it from local view and notify frontend.
    """
    try:
        from_user = event.get('from_user')
        data = event.get('data', {})
        position_id = data.get('position_id')
        
        logger.info(
            f"Received share_revoked event",
            extra={
                "from_user": from_user,
                "position_id": position_id
            }
        )
        
        # TODO: Remove position from local database if stored
        
        # Broadcast to local frontend
        await broadcast_share_revoked(
            position_id=position_id,
            recipient_ids=[]  # Local only
        )
        
    except Exception as e:
        logger.error(
            f"Error handling share_revoked event",
            extra={"error": str(e)},
            exc_info=True
        )

