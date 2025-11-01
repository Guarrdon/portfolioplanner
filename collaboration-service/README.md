# Collaboration Service

Central message broker for Portfolio Planner distributed architecture.

## Purpose

This service enables multiple independent Portfolio Planner instances (each with their own frontend + backend) to collaborate by routing events between them.

## Architecture

```
User A Instance              Collaboration Service              User B Instance
├─ Frontend (3000)           ┌─────────────────────┐           ├─ Frontend (3001)
└─ Backend (8000) ←──────────┤   WebSocket Router  ├──────────→└─ Backend (8001)
                             │   (Port 9000)       │
                             │                     │
                             │ • User Registry     │
                             │ • Event Routing     │
                             │ • No Data Storage   │
                             └─────────────────────┘
```

## Features

- **WebSocket Server**: Accepts connections from backend instances
- **User Registry**: Tracks which users are online and their backend URLs
- **Event Routing**: Routes collaboration events to correct recipients
- **Health Monitoring**: `/health` endpoint for monitoring
- **User Discovery**: `/api/users/online` endpoint to see who's online
- **Auto-Reconnection**: Handles disconnections gracefully

## Installation

```bash
npm install
```

## Running

### Development Mode (with auto-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

The service will start on port 9000 (configurable via PORT environment variable).

## API Endpoints

### Health Check
```
GET /health

Response:
{
  "status": "healthy",
  "uptime": 3600,
  "active_users": 5,
  "total_connections": 42,
  "total_events_routed": 1250
}
```

### Online Users
```
GET /api/users/online

Response:
{
  "users": [
    {
      "user_id": "uuid",
      "display_name": "John Doe",
      "backend_url": "http://localhost:8000",
      "connected_at": "2025-11-01T10:00:00Z",
      "status": "online"
    }
  ],
  "count": 1
}
```

### Register Backend (Optional)
```
POST /api/register

Body:
{
  "user_id": "uuid",
  "backend_url": "http://localhost:8000",
  "display_name": "John Doe"
}

Response:
{
  "success": true,
  "collab_ws_url": "ws://localhost:9000",
  "message": "Connect via WebSocket..."
}
```

## WebSocket Protocol

### Connection

Backends connect with query parameters:

```
ws://localhost:9000?user_id=<uuid>&backend_url=<url>&display_name=<name>
```

### Events

#### Client → Server (from backend)

**collab_event**: Send collaboration event to other users
```json
{
  "type": "position_shared" | "comment_added" | "position_updated" | "share_revoked",
  "from_user": "user_a_id",
  "to_users": ["user_b_id", "user_c_id"],
  "data": {
    // Event-specific data
  }
}
```

**ping**: Heartbeat to keep connection alive
```json
{}
```

#### Server → Client (to backend)

**connected**: Connection established
```json
{
  "user_id": "uuid",
  "message": "Connected to collaboration service",
  "active_users": 5
}
```

**collab_event**: Incoming event from another user
```json
{
  "type": "position_shared",
  "from_user": "user_a_id",
  "to_users": ["user_b_id"],
  "data": {
    "position_id": "uuid",
    "share_url": "http://backend-a:8000/api/v1/positions/ideas/uuid"
  }
}
```

**event_ack**: Acknowledgment that event was routed
```json
{
  "event_type": "position_shared",
  "delivered_to": 2,
  "total_recipients": 2
}
```

**user_online**: Another user came online
```json
{
  "user_id": "uuid",
  "display_name": "Jane Doe"
}
```

**user_offline**: A user went offline
```json
{
  "user_id": "uuid"
}
```

**pong**: Response to ping
```json
{
  "timestamp": 1698765432000
}
```

**error**: Error occurred
```json
{
  "message": "Error description",
  "error": "Details..."
}
```

## Event Types

### position_shared
Sent when a position is shared with users.

```json
{
  "type": "position_shared",
  "from_user": "user_a_id",
  "to_users": ["user_b_id"],
  "data": {
    "position_id": "uuid",
    "share_url": "http://localhost:8000/api/v1/positions/ideas/uuid",
    "shared_at": "2025-11-01T10:00:00Z"
  }
}
```

### comment_added
Sent when a comment is added to a shared position.

```json
{
  "type": "comment_added",
  "from_user": "user_b_id",
  "to_users": ["user_a_id"],
  "data": {
    "position_id": "uuid",
    "comment": {
      "id": "uuid",
      "text": "Great setup!",
      "user": {
        "id": "user_b_id",
        "display_name": "Jane"
      },
      "created_at": "2025-11-01T10:05:00Z"
    }
  }
}
```

### position_updated
Sent when a position is modified (tags, notes, status).

```json
{
  "type": "position_updated",
  "from_user": "user_a_id",
  "to_users": ["user_b_id"],
  "data": {
    "position_id": "uuid",
    "updates": {
      "tags": ["bullish", "momentum"],
      "notes": "Updated analysis"
    }
  }
}
```

### share_revoked
Sent when access to a position is removed.

```json
{
  "type": "share_revoked",
  "from_user": "user_a_id",
  "to_users": ["user_b_id"],
  "data": {
    "position_id": "uuid"
  }
}
```

## Monitoring

### Logs

All events are logged to:
- Console (stdout)
- `collaboration-service.log` file

Log format:
```
2025-11-01T10:00:00Z [INFO]: Backend connected {"user_id":"uuid","backend_url":"http://localhost:8000","total_active":1}
```

### Metrics

The service tracks:
- **total_connections**: Lifetime connection count
- **total_events_routed**: Total events routed
- **active_users**: Current online users

Access via `/health` endpoint.

## Security Considerations

### Current Implementation
- No authentication (development mode)
- CORS set to `*` (accepts all origins)
- No rate limiting

### Production Recommendations
- [ ] Add JWT authentication for backend connections
- [ ] Restrict CORS to known backend domains
- [ ] Implement rate limiting per user
- [ ] Enable TLS (wss:// instead of ws://)
- [ ] Add connection limits per user
- [ ] Implement event validation
- [ ] Add audit logging

## Deployment

### Development (Local)
```bash
# Terminal 1: Collaboration Service
cd collaboration-service
npm install
npm run dev

# Terminal 2: Backend A
cd backend
USER_ID=user_a PORT=8000 COLLAB_URL=ws://localhost:9000 uvicorn app.main:app

# Terminal 3: Backend B
cd backend
USER_ID=user_b PORT=8001 COLLAB_URL=ws://localhost:9000 uvicorn app.main:app
```

### Production
```bash
# Using PM2
pm2 start server.js --name collaboration-service

# Using systemd
# Create /etc/systemd/system/collaboration-service.service
```

## Scaling

### Single Instance
- Handles 100+ concurrent backends
- In-memory user registry
- Sufficient for small deployments

### Multi-Instance (Future)
For larger deployments:
- Use Redis for user registry (Redis pub/sub)
- Load balancer with sticky sessions
- Shared state across instances

## Troubleshooting

### Service won't start
```bash
# Check if port 9000 is already in use
lsof -i :9000

# Kill process if needed
kill -9 <PID>
```

### Backend can't connect
- Verify service is running: `curl http://localhost:9000/health`
- Check firewall settings
- Verify backend has correct COLLAB_URL

### Events not being routed
- Check both backends are connected: `curl http://localhost:9000/api/users/online`
- Review logs: `tail -f collaboration-service.log`
- Verify event format is correct

## Testing

### Manual Test
```javascript
// Test client (Node.js)
const io = require('socket.io-client');

const socket = io('ws://localhost:9000', {
  query: {
    user_id: 'test-user',
    backend_url: 'http://localhost:8000',
    display_name: 'Test User'
  }
});

socket.on('connected', (data) => {
  console.log('Connected:', data);
  
  // Send test event
  socket.emit('collab_event', {
    type: 'position_shared',
    from_user: 'test-user',
    to_users: ['other-user'],
    data: { position_id: '123' }
  });
});

socket.on('event_ack', (ack) => {
  console.log('Event acknowledged:', ack);
});
```

## License

MIT

