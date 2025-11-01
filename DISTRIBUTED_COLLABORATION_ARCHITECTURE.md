# Distributed Collaboration Architecture

**Problem:** Current architecture assumes single backend, but you need **multiple independent backend+frontend instances** (one per user) that can collaborate.

**Solution:** Central Collaboration Service acting as message broker.

---

## Current vs Proposed Architecture

### ❌ Current (Won't Work for You)

```
User A                       User B
Frontend ─┐               Frontend
          │                  │
          ├── WebSocket ─────┤
          │                  │
     Single Backend
```

**Problem:** Both users must connect to same backend - impossible if each has their own instance.

---

### ✅ Proposed (Multi-Tenant Distributed)

```
┌────────────────┐                                   ┌────────────────┐
│   User A       │                                   │   User B       │
│                │                                   │                │
│  Frontend      │                                   │  Frontend      │
│    ↕︎           │                                   │    ↕︎           │
│  Backend A     │                                   │  Backend B     │
│  (Port 8000)   │                                   │  (Port 8001)   │
│                │                                   │                │
│  - Schwab API  │                                   │  - Schwab API  │
│  - User A Data │                                   │  - User B Data │
│  - Strategies  │                                   │  - Strategies  │
└────────┬───────┘                                   └────────┬───────┘
         │                                                     │
         │                WebSocket                           │
         └────────────────────┬─────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Collaboration      │
                    │  Service            │
                    │  (Port 9000)        │
                    │                     │
                    │  - WebSocket Relay  │
                    │  - User Directory   │
                    │  - Event Routing    │
                    │  - No Data Storage  │
                    └─────────────────────┘
```

---

## Collaboration Service Responsibilities

### What It Does ✅

1. **WebSocket Relay:** Routes messages between user backends
2. **User Directory:** Tracks which users are online and their endpoints
3. **Event Broadcasting:** Forwards collaboration events to correct recipients
4. **Authentication:** Validates user tokens
5. **Presence:** Tracks who's online/offline

### What It Does NOT Do ❌

- ❌ Store position data
- ❌ Store user data
- ❌ Connect to Schwab
- ❌ Process strategies
- ❌ Store comments/shares (backends do this)

---

## Data Flow

### Example: User A Shares Position with User B

```
Step 1: User A clicks "Share" in their frontend
   ↓
Step 2: Frontend sends to Backend A
   POST http://localhost:8000/api/v1/positions/ideas/{id}/share
   Body: { friend_ids: [user_b_id] }
   ↓
Step 3: Backend A stores share in its own database
   ↓
Step 4: Backend A sends event to Collaboration Service
   WebSocket → ws://collab-service:9000
   Event: { 
     type: "position_shared",
     from: user_a_id,
     to: [user_b_id],
     position_id: xyz,
     share_url: "http://backend-a:8000/api/v1/positions/ideas/xyz"
   }
   ↓
Step 5: Collaboration Service looks up User B
   Finds: User B is online, Backend B = http://localhost:8001
   ↓
Step 6: Collaboration Service forwards event to Backend B
   WebSocket → Backend B
   ↓
Step 7: Backend B receives event and fetches position data
   GET http://localhost:8000/api/v1/positions/ideas/xyz
   (Backend B calls Backend A's API)
   ↓
Step 8: Backend B stores shared position in its database
   Creates local copy with read-only flag
   ↓
Step 9: Backend B notifies User B's frontend via WebSocket
   ↓
Step 10: User B's frontend displays notification & updates UI
```

---

## Collaboration Service Implementation

### Technology Stack

**Recommended:** Node.js + Socket.io (simplest)

**Alternative:** Python + FastAPI WebSockets (consistent with your stack)

**Why Lightweight Service:**
- No database needed (in-memory state)
- Only routes messages
- Horizontally scalable
- Can restart without data loss (users reconnect)

---

### Collaboration Service API

#### 1. Register User Instance

```javascript
POST /api/register
{
  "user_id": "uuid",
  "backend_url": "http://localhost:8000",
  "websocket_endpoint": "ws://localhost:8000/ws/collab",
  "auth_token": "jwt_token"
}

Response: {
  "success": true,
  "collab_ws_url": "ws://collab-service:9000/ws/{user_id}"
}
```

#### 2. WebSocket Connection (Backend → Collab Service)

```javascript
// Each backend connects to Collaboration Service
const ws = new WebSocket('ws://collab-service:9000/ws/{user_id}?token=jwt');

// Events sent TO Collaboration Service
ws.send({
  type: 'position_shared',
  to: ['user_b_id'],
  data: {
    position_id: 'xyz',
    share_url: 'http://backend-a:8000/api/v1/positions/ideas/xyz'
  }
});

// Events received FROM Collaboration Service
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'position_shared':
      // Fetch position from remote backend
      fetchAndStoreSharedPosition(message.data);
      break;
    
    case 'comment_added':
      // Notify local users
      broadcastToLocalUsers(message);
      break;
  }
};
```

#### 3. User Discovery

```javascript
GET /api/users/online
Response: [
  {
    "user_id": "uuid",
    "display_name": "John Doe",
    "status": "online",
    "last_seen": "2025-10-30T10:00:00Z"
  }
]
```

---

## Event Types

### 1. position_shared
```json
{
  "type": "position_shared",
  "from_user": "user_a_id",
  "to_users": ["user_b_id"],
  "data": {
    "position_id": "uuid",
    "share_url": "http://backend-a:8000/api/v1/positions/ideas/{id}",
    "shared_at": "2025-10-30T10:00:00Z"
  }
}
```

### 2. comment_added
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
      "created_at": "2025-10-30T10:05:00Z"
    }
  }
}
```

### 3. position_updated
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

### 4. share_revoked
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

---

## Implementation Plan

### Phase 1: Collaboration Service (Core)

**File:** `/collaboration-service/server.js` (Node.js + Socket.io)

```javascript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// In-memory user registry
const activeUsers = new Map(); // userId → { socket, backendUrl }

// Backend instance connects
io.on('connection', (socket) => {
  const userId = socket.handshake.query.user_id;
  const backendUrl = socket.handshake.query.backend_url;
  
  console.log(`Backend registered: ${userId} at ${backendUrl}`);
  activeUsers.set(userId, { socket, backendUrl });
  
  // Handle events from backends
  socket.on('collab_event', (event) => {
    console.log('Routing event:', event.type, 'from', event.from_user, 'to', event.to_users);
    
    // Forward to recipient backends
    event.to_users.forEach(recipientId => {
      const recipient = activeUsers.get(recipientId);
      if (recipient) {
        recipient.socket.emit('collab_event', event);
      }
    });
  });
  
  socket.on('disconnect', () => {
    console.log(`Backend disconnected: ${userId}`);
    activeUsers.delete(userId);
  });
});

server.listen(9000, () => {
  console.log('Collaboration Service running on port 9000');
});
```

### Phase 2: Backend Integration

**Modify:** `backend/app/services/collaboration_client.py`

```python
import asyncio
import socketio
import json

class CollaborationClient:
    def __init__(self, user_id, backend_url, collab_service_url):
        self.user_id = user_id
        self.backend_url = backend_url
        self.sio = socketio.AsyncClient()
        self.collab_service_url = collab_service_url
    
    async def connect(self):
        await self.sio.connect(
            self.collab_service_url,
            transports=['websocket'],
            auth={'user_id': self.user_id, 'backend_url': self.backend_url}
        )
        
        @self.sio.on('collab_event')
        async def handle_event(data):
            await self.handle_collaboration_event(data)
    
    async def send_event(self, event_type, to_users, data):
        await self.sio.emit('collab_event', {
            'type': event_type,
            'from_user': self.user_id,
            'to_users': to_users,
            'data': data
        })
    
    async def handle_collaboration_event(self, event):
        # Process incoming collaboration events
        if event['type'] == 'position_shared':
            # Fetch position from remote backend
            await self.fetch_and_store_shared_position(event['data'])
        elif event['type'] == 'comment_added':
            # Broadcast to local WebSocket clients
            await self.broadcast_to_local_users(event)
```

### Phase 3: Frontend Updates

**No changes needed!** Frontend still connects to its own backend WebSocket. Backend handles collaboration service internally.

---

## Security Considerations

1. **Authentication:** JWT tokens for backend-to-collab-service communication
2. **Authorization:** Collab service validates friendship before routing
3. **Rate Limiting:** Prevent event spam
4. **Encryption:** TLS for all WebSocket connections
5. **User Verification:** Backends verify position access before fetching

---

## Deployment

### Development (Single Machine)

```bash
# Terminal 1: Collaboration Service
cd collaboration-service
node server.js
# Runs on http://localhost:9000

# Terminal 2: User A Backend
cd backend
USER_ID=user_a PORT=8000 COLLAB_URL=ws://localhost:9000 uvicorn app.main:app

# Terminal 3: User A Frontend
cd frontend
PORT=3000 REACT_APP_API_URL=http://localhost:8000 npm start

# Terminal 4: User B Backend
cd backend
USER_ID=user_b PORT=8001 COLLAB_URL=ws://localhost:9000 uvicorn app.main:app

# Terminal 5: User B Frontend
cd frontend
PORT=3001 REACT_APP_API_URL=http://localhost:8001 npm start
```

### Production (Distributed)

```
User A:
  Backend: https://user-a.example.com:8000
  Frontend: https://user-a.example.com

User B:
  Backend: https://user-b.example.com:8000
  Frontend: https://user-b.example.com

Collaboration Service:
  Central: wss://collab.example.com
```

---

## Migration Path

### Step 1: Keep Current Implementation

Your current single-backend, dual-frontend setup **will still work** for testing.

### Step 2: Build Collaboration Service

Create minimal Node.js service (200 lines of code).

### Step 3: Add Collaboration Client to Backend

Each backend connects to collaboration service on startup.

### Step 4: Update Sharing Logic

When sharing, backend sends event to collaboration service instead of local WebSocket.

### Step 5: Test with 2 Independent Instances

Run complete independent stack for each user.

---

## Estimated Effort

- **Collaboration Service:** 4-6 hours (basic implementation)
- **Backend Integration:** 3-4 hours (collaboration client)
- **Testing:** 2-3 hours (2-instance testing)
- **Documentation:** 1-2 hours

**Total:** ~10-15 hours for complete multi-tenant collaboration

---

## Alternative: Simpler Approach

If you want to avoid a separate service initially:

### Option: Direct Backend-to-Backend Communication

```
User A Backend ←──── HTTP/WebSocket ────→ User B Backend
```

**Pros:**
- No separate service needed
- Direct communication
- Simpler deployment

**Cons:**
- Requires NAT traversal (if not on same network)
- Need discovery mechanism
- Less scalable (N² connections)

**Implementation:**
1. Each backend exposes `/api/collab/events` endpoint
2. Each backend maintains list of friend backends
3. When sharing, POST directly to friend's backend
4. Use reverse proxy or VPN for connectivity

---

## Recommendation

**For Your Use Case:** Go with **Collaboration Service** approach because:
- ✅ Cleaner separation of concerns
- ✅ Scales to many users
- ✅ Central point for user discovery
- ✅ Easier NAT traversal
- ✅ Can add features (presence, notifications) easily

---

## Next Steps

1. **Fix immediate sharing bug** (use SHARING_DEBUG_GUIDE.md)
2. **Decide on architecture** (Collaboration Service vs Backend-to-Backend)
3. **Build MVP Collaboration Service** (I can provide full implementation)
4. **Integrate with existing backends**
5. **Test with 2 independent instances**

Would you like me to:
1. Build the Collaboration Service implementation?
2. Focus on fixing the immediate sharing bug first?
3. Provide a simpler interim solution?

