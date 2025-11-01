"""
WebSocket Manager for real-time collaboration

Manages WebSocket connections and broadcasts events to connected clients.
"""
from typing import Dict, Set, Any
from fastapi import WebSocket
from uuid import UUID
import json
import logging

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Manages WebSocket connections for real-time collaboration
    
    Tracks active connections by user_id and provides methods to broadcast
    events to specific users or all connected clients.
    """
    
    def __init__(self):
        # Maps user_id (as string) to set of active WebSocket connections
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # Maps WebSocket to user_id for reverse lookup
        self.connection_to_user: Dict[WebSocket, str] = {}
    
    async def connect(self, websocket: WebSocket, user_id: str):
        """
        Accept and register a new WebSocket connection
        
        Args:
            websocket: The WebSocket connection
            user_id: User ID associated with this connection
        """
        await websocket.accept()
        
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        
        self.active_connections[user_id].add(websocket)
        self.connection_to_user[websocket] = user_id
        
        logger.info(f"WebSocket connected: user_id={user_id}, total_connections={len(self.connection_to_user)}")
    
    def disconnect(self, websocket: WebSocket):
        """
        Unregister a WebSocket connection
        
        Args:
            websocket: The WebSocket connection to remove
        """
        user_id = self.connection_to_user.get(websocket)
        if user_id:
            if user_id in self.active_connections:
                self.active_connections[user_id].discard(websocket)
                
                # Clean up empty sets
                if not self.active_connections[user_id]:
                    del self.active_connections[user_id]
            
            del self.connection_to_user[websocket]
            
            logger.info(f"WebSocket disconnected: user_id={user_id}, remaining_connections={len(self.connection_to_user)}")
    
    async def send_personal_message(self, message: Dict[str, Any], user_id: str):
        """
        Send a message to all connections for a specific user
        
        Args:
            message: Message data to send
            user_id: Target user ID
        """
        if user_id not in self.active_connections:
            logger.debug(f"No active connections for user {user_id}")
            return
        
        message_json = json.dumps(message)
        dead_connections = set()
        
        for websocket in self.active_connections[user_id]:
            try:
                await websocket.send_text(message_json)
            except Exception as e:
                logger.error(f"Error sending message to user {user_id}: {e}")
                dead_connections.add(websocket)
        
        # Clean up dead connections
        for websocket in dead_connections:
            self.disconnect(websocket)
    
    async def broadcast_to_users(self, message: Dict[str, Any], user_ids: Set[str]):
        """
        Broadcast a message to multiple users
        
        Args:
            message: Message data to send
            user_ids: Set of user IDs to send to
        """
        for user_id in user_ids:
            await self.send_personal_message(message, user_id)
    
    async def broadcast_all(self, message: Dict[str, Any]):
        """
        Broadcast a message to all connected clients
        
        Args:
            message: Message data to send
        """
        message_json = json.dumps(message)
        dead_connections = set()
        
        for websocket in self.connection_to_user.keys():
            try:
                await websocket.send_text(message_json)
            except Exception as e:
                logger.error(f"Error broadcasting message: {e}")
                dead_connections.add(websocket)
        
        # Clean up dead connections
        for websocket in dead_connections:
            self.disconnect(websocket)
    
    def get_active_user_ids(self) -> Set[str]:
        """
        Get set of all user IDs with active connections
        
        Returns:
            Set of user IDs
        """
        return set(self.active_connections.keys())


# Global connection manager instance
manager = ConnectionManager()


# Event broadcasting utilities
async def broadcast_position_update(position_id: str, position_data: Dict[str, Any], owner_id: str, shared_with: list):
    """
    Broadcast position update to owner and all users it's shared with
    
    Args:
        position_id: Position ID
        position_data: Updated position data
        owner_id: Owner user ID
        shared_with: List of user IDs position is shared with
    """
    message = {
        "event": "position_updated",
        "data": {
            "position_id": position_id,
            "position": position_data
        }
    }
    
    # Send to owner
    await manager.send_personal_message(message, owner_id)
    
    # Send to all shared recipients
    for recipient_id in shared_with:
        await manager.send_personal_message(message, str(recipient_id))


async def broadcast_comment_added(position_id: str, comment_data: Dict[str, Any], owner_id: str, shared_with: list):
    """
    Broadcast new comment to owner and all users position is shared with
    
    Args:
        position_id: Position ID
        comment_data: Comment data
        owner_id: Position owner user ID
        shared_with: List of user IDs position is shared with
    """
    message = {
        "event": "comment_added",
        "data": {
            "position_id": position_id,
            "comment": comment_data
        }
    }
    
    # Send to owner
    await manager.send_personal_message(message, owner_id)
    
    # Send to all shared recipients
    for recipient_id in shared_with:
        await manager.send_personal_message(message, str(recipient_id))


async def broadcast_position_shared(position_id: str, recipient_ids: list, owner_id: str):
    """
    Notify users when a position is shared with them
    
    Args:
        position_id: Position ID
        recipient_ids: List of recipient user IDs
        owner_id: Owner user ID
    """
    message = {
        "event": "position_shared",
        "data": {
            "position_id": position_id,
            "owner_id": owner_id
        }
    }
    
    # Send to all new recipients
    for recipient_id in recipient_ids:
        await manager.send_personal_message(message, str(recipient_id))


async def broadcast_share_revoked(position_id: str, recipient_ids: list):
    """
    Notify users when their access to a position is revoked
    
    Args:
        position_id: Position ID
        recipient_ids: List of recipient user IDs who lost access
    """
    message = {
        "event": "share_revoked",
        "data": {
            "position_id": position_id
        }
    }
    
    # Send to all users who lost access
    for recipient_id in recipient_ids:
        await manager.send_personal_message(message, str(recipient_id))

