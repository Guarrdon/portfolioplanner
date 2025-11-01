"""
Collaboration Client for Portfolio Planner Backend

Connects to the central Collaboration Service to enable
distributed collaboration between independent instances.
"""

import asyncio
import json
import logging
from typing import Optional, Dict, Any, List, Callable
from datetime import datetime
import socketio
import httpx

logger = logging.getLogger(__name__)


class CollaborationClient:
    """
    Client that connects backend to Collaboration Service.
    
    Responsibilities:
    - Connect to collaboration service via Socket.io
    - Send collaboration events (position_shared, comment_added, etc.)
    - Receive events from other backends
    - Fetch shared positions from remote backends
    - Handle auto-reconnection
    """
    
    def __init__(
        self,
        user_id: str,
        backend_url: str,
        collab_service_url: str,
        display_name: Optional[str] = None
    ):
        """
        Initialize collaboration client.
        
        Args:
            user_id: ID of the user this backend represents
            backend_url: Public URL of this backend (for others to fetch data)
            collab_service_url: URL of collaboration service (ws://host:port)
            display_name: Display name for this user
        """
        self.user_id = user_id
        self.backend_url = backend_url
        self.collab_service_url = collab_service_url
        self.display_name = display_name or f"User {user_id[:8]}"
        
        # Socket.io client
        self.sio = socketio.AsyncClient(
            reconnection=True,
            reconnection_attempts=5,
            reconnection_delay=2,
            logger=False,
            engineio_logger=False
        )
        
        # Connection state
        self.connected = False
        self._event_handlers: Dict[str, List[Callable]] = {}
        
        # HTTP client for fetching from other backends
        self.http_client = httpx.AsyncClient(timeout=30.0)
        
        # Setup event handlers
        self._setup_handlers()
        
        logger.info(
            f"Collaboration client initialized for user {user_id}",
            extra={
                "user_id": user_id,
                "backend_url": backend_url,
                "collab_service_url": collab_service_url
            }
        )
    
    def _setup_handlers(self):
        """Setup Socket.io event handlers"""
        
        @self.sio.event
        async def connect():
            self.connected = True
            logger.info(
                f"Connected to collaboration service",
                extra={"user_id": self.user_id}
            )
        
        @self.sio.event
        async def connected(data):
            logger.info(
                f"Connection confirmed by collaboration service",
                extra={"data": data}
            )
        
        @self.sio.event
        async def disconnect():
            self.connected = False
            logger.warning(
                f"Disconnected from collaboration service",
                extra={"user_id": self.user_id}
            )
        
        @self.sio.event
        async def collab_event(event):
            """Handle incoming collaboration events"""
            try:
                await self._handle_collaboration_event(event)
            except Exception as e:
                logger.error(
                    f"Error handling collaboration event",
                    extra={"error": str(e), "event": event},
                    exc_info=True
                )
        
        @self.sio.event
        async def event_ack(ack):
            """Handle event acknowledgment"""
            logger.debug(
                f"Event acknowledged",
                extra={"ack": ack}
            )
        
        @self.sio.event
        async def user_online(data):
            """Handle user coming online"""
            logger.info(
                f"User came online",
                extra={"user_data": data}
            )
        
        @self.sio.event
        async def user_offline(data):
            """Handle user going offline"""
            logger.info(
                f"User went offline",
                extra={"user_data": data}
            )
        
        @self.sio.event
        async def error(data):
            """Handle error from collaboration service"""
            logger.error(
                f"Error from collaboration service",
                extra={"error": data}
            )
        
        @self.sio.event
        async def service_shutdown(data):
            """Handle collaboration service shutdown"""
            logger.warning(
                f"Collaboration service shutting down",
                extra={"data": data}
            )
    
    async def connect(self):
        """Connect to collaboration service"""
        try:
            # Build query parameters
            query = {
                'user_id': self.user_id,
                'backend_url': self.backend_url,
                'display_name': self.display_name
            }
            
            logger.info(
                f"Connecting to collaboration service",
                extra={
                    "url": self.collab_service_url,
                    "user_id": self.user_id
                }
            )
            
            await self.sio.connect(
                self.collab_service_url,
                transports=['websocket'],
                wait_timeout=10,
                socketio_path='/socket.io/',
                auth=query
            )
            
            # Alternative: pass as query params if auth doesn't work
            # url = f"{self.collab_service_url}?{urlencode(query)}"
            # await self.sio.connect(url, transports=['websocket'])
            
        except Exception as e:
            logger.error(
                f"Failed to connect to collaboration service",
                extra={"error": str(e)},
                exc_info=True
            )
            raise
    
    async def disconnect(self):
        """Disconnect from collaboration service"""
        try:
            if self.connected:
                await self.sio.disconnect()
            await self.http_client.aclose()
            logger.info(
                f"Disconnected from collaboration service",
                extra={"user_id": self.user_id}
            )
        except Exception as e:
            logger.error(
                f"Error during disconnect",
                extra={"error": str(e)}
            )
    
    def is_connected(self) -> bool:
        """Check if connected to collaboration service"""
        return self.connected
    
    async def send_event(
        self,
        event_type: str,
        to_users: List[str],
        data: Dict[str, Any]
    ):
        """
        Send collaboration event to other users.
        
        Args:
            event_type: Type of event (position_shared, comment_added, etc.)
            to_users: List of user IDs to send to
            data: Event-specific data
        """
        if not self.connected:
            logger.warning(
                f"Not connected to collaboration service, cannot send event",
                extra={"event_type": event_type}
            )
            return
        
        event = {
            'type': event_type,
            'from_user': self.user_id,
            'to_users': to_users,
            'data': data
        }
        
        logger.info(
            f"Sending collaboration event",
            extra={
                "type": event_type,
                "to_users": to_users,
                "data_keys": list(data.keys())
            }
        )
        
        try:
            await self.sio.emit('collab_event', event)
        except Exception as e:
            logger.error(
                f"Error sending event",
                extra={"error": str(e), "event": event},
                exc_info=True
            )
    
    async def _handle_collaboration_event(self, event: Dict[str, Any]):
        """
        Handle incoming collaboration event.
        
        Routes to appropriate handler based on event type.
        """
        event_type = event.get('type')
        from_user = event.get('from_user')
        data = event.get('data', {})
        
        logger.info(
            f"Received collaboration event",
            extra={
                "type": event_type,
                "from_user": from_user,
                "data_keys": list(data.keys())
            }
        )
        
        # Call registered handlers
        handlers = self._event_handlers.get(event_type, [])
        for handler in handlers:
            try:
                await handler(event)
            except Exception as e:
                logger.error(
                    f"Error in event handler",
                    extra={
                        "event_type": event_type,
                        "handler": handler.__name__,
                        "error": str(e)
                    },
                    exc_info=True
                )
    
    def on(self, event_type: str, handler: Callable):
        """
        Register event handler.
        
        Args:
            event_type: Type of event to handle
            handler: Async function to call when event received
        """
        if event_type not in self._event_handlers:
            self._event_handlers[event_type] = []
        self._event_handlers[event_type].append(handler)
        
        logger.debug(
            f"Registered handler for event type",
            extra={"event_type": event_type, "handler": handler.__name__}
        )
    
    async def fetch_shared_position(
        self,
        share_url: str,
        auth_token: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Fetch shared position data from remote backend.
        
        Args:
            share_url: Full URL to position endpoint on remote backend
            auth_token: Optional auth token for the request
            
        Returns:
            Position data dict or None if failed
        """
        try:
            headers = {}
            if auth_token:
                headers['Authorization'] = f'Bearer {auth_token}'
            
            logger.info(
                f"Fetching shared position from remote backend",
                extra={"url": share_url}
            )
            
            response = await self.http_client.get(share_url, headers=headers)
            response.raise_for_status()
            
            position_data = response.json()
            
            logger.info(
                f"Successfully fetched shared position",
                extra={
                    "url": share_url,
                    "position_id": position_data.get('id')
                }
            )
            
            return position_data
            
        except httpx.HTTPStatusError as e:
            logger.error(
                f"HTTP error fetching shared position",
                extra={
                    "url": share_url,
                    "status": e.response.status_code,
                    "error": str(e)
                }
            )
            return None
            
        except Exception as e:
            logger.error(
                f"Error fetching shared position",
                extra={"url": share_url, "error": str(e)},
                exc_info=True
            )
            return None
    
    async def ping(self):
        """Send ping to keep connection alive"""
        if self.connected:
            await self.sio.emit('ping')


# Global collaboration client instance
_collaboration_client: Optional[CollaborationClient] = None


def get_collaboration_client() -> Optional[CollaborationClient]:
    """Get the global collaboration client instance"""
    return _collaboration_client


def set_collaboration_client(client: CollaborationClient):
    """Set the global collaboration client instance"""
    global _collaboration_client
    _collaboration_client = client


async def init_collaboration_client(
    user_id: str,
    backend_url: str,
    collab_service_url: str,
    display_name: Optional[str] = None
) -> CollaborationClient:
    """
    Initialize and connect collaboration client.
    
    This should be called during backend startup.
    """
    client = CollaborationClient(
        user_id=user_id,
        backend_url=backend_url,
        collab_service_url=collab_service_url,
        display_name=display_name
    )
    
    await client.connect()
    set_collaboration_client(client)
    
    return client


async def shutdown_collaboration_client():
    """
    Disconnect collaboration client.
    
    This should be called during backend shutdown.
    """
    client = get_collaboration_client()
    if client:
        await client.disconnect()

