# Distributed Collaboration Testing Guide

## Overview

This guide explains how to test the **distributed multi-instance architecture** where completely independent Portfolio Planner instances (each with their own frontend + backend + database) collaborate through a central Collaboration Service.

## Architecture

```
┌────────────────────┐              ┌────────────────────┐
│   User A Instance  │              │   User B Instance  │
│                    │              │                    │
│  Frontend (3000)   │              │  Frontend (3001)   │
│       ↕            │              │       ↕            │
│  Backend (8000)    │              │  Backend (8001)    │
│  DB: user_a.db     │              │  DB: user_b.db     │
└─────────┬──────────┘              └─────────┬──────────┘
          │                                   │
          │         WebSocket/HTTP            │
          └──────────────┬────────────────────┘
                         │
                ┌────────▼─────────┐
                │  Collaboration   │
                │  Service         │
                │  (Port 9000)     │
                │                  │
                │  • User Registry │
                │  • Event Router  │
                │  • No Data       │
                └──────────────────┘
```

## Quick Start

### Option 1: Automated Startup (Recommended)

```bash
./start-distributed.sh
```

This script will:
1. ✅ Start Collaboration Service (port 9000)
2. ✅ Start Backend A with separate database (port 8000)
3. ✅ Start Backend B with separate database (port 8001)
4. ✅ Start Frontend A (port 3000)
5. ✅ Start Frontend B (port 3001)

All logs will be saved to `logs/` directory.

To stop all services: Press `Ctrl+C`

### Option 2: Manual Startup (Step-by-Step)

#### Step 1: Start Collaboration Service

```bash
cd collaboration-service
npm install
npm start
```

Verify it's running:
```bash
curl http://localhost:9000/health
```

Should return:
```json
{
  "status": "healthy",
  "uptime": 5,
  "active_users": 0,
  "total_connections": 0,
  "total_events_routed": 0
}
```

#### Step 2: Start Backend Instance A (User A)

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt

# Create .env for User A
cat > .env << EOF
DATABASE_URL=sqlite:///./portfolio_user_a.db
SECRET_KEY=dev-secret-key-user-a
ENCRYPTION_KEY=dev-encryption-key-user-a
CORS_ORIGINS=http://localhost:3000
USE_MOCK_SCHWAB_DATA=true
LOG_LEVEL=INFO
ENABLE_COLLABORATION=true
COLLABORATION_SERVICE_URL=http://localhost:9000
BACKEND_USER_ID=00000000-0000-0000-0000-000000000001
BACKEND_URL=http://localhost:8000
BACKEND_DISPLAY_NAME=User A
EOF

# Start backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

#### Step 3: Start Backend Instance B (User B)

Open a new terminal:

```bash
cd backend
source venv/bin/activate

# Create .env for User B
cat > .env << EOF
DATABASE_URL=sqlite:///./portfolio_user_b.db
SECRET_KEY=dev-secret-key-user-b
ENCRYPTION_KEY=dev-encryption-key-user-b
CORS_ORIGINS=http://localhost:3001
USE_MOCK_SCHWAB_DATA=true
LOG_LEVEL=INFO
ENABLE_COLLABORATION=true
COLLABORATION_SERVICE_URL=http://localhost:9000
BACKEND_USER_ID=00000000-0000-0000-0000-000000000002
BACKEND_URL=http://localhost:8001
BACKEND_DISPLAY_NAME=User B
EOF

# Start backend on different port
PORT=8001 uvicorn app.main:app --host 0.0.0.0 --port 8001
```

#### Step 4: Start Frontend Instance A

Open a new terminal:

```bash
cd frontend
npm install

# Create .env.local for User A
echo "REACT_APP_API_URL=http://localhost:8000/api/v1" > .env.local

# Start frontend
PORT=3000 npm start
```

#### Step 5: Start Frontend Instance B

Open a new terminal:

```bash
cd frontend

# Create .env.local for User B
echo "REACT_APP_API_URL=http://localhost:8001/api/v1" > .env.local

# Start frontend on different port
PORT=3001 npm start
```

## Verification Checklist

Before testing collaboration features, verify all services are running:

### 1. Check Collaboration Service

```bash
curl http://localhost:9000/health
```

Expected: `"status": "healthy"`

```bash
curl http://localhost:9000/api/users/online
```

Expected: List of 2 connected users (User A and User B)

### 2. Check Backend A

```bash
curl http://localhost:8000/health
```

Expected: `"status": "healthy"`

Open: http://localhost:8000/docs

### 3. Check Backend B

```bash
curl http://localhost:8001/health
```

Expected: `"status": "healthy"`

Open: http://localhost:8001/docs

### 4. Check Frontends

- Open http://localhost:3000 → Should show User A's dashboard
- Open http://localhost:3001 → Should show User B's dashboard (use incognito/different browser)

## Testing Collaboration Features

### Test 1: Position Sharing

**Goal:** Verify User A can share a trade idea with User B

1. **User A: Create Trade Idea**
   - Navigate to http://localhost:3000
   - Go to "Collaboration" tab
   - Click "Create New Idea"
   - Fill in position details:
     - Symbol: AAPL
     - Strategy: Covered Call
     - Status: Planned
   - Click "Create"
   - ✅ New trade idea should appear in "My Ideas" tab

2. **User A: Share with User B**
   - Expand the AAPL trade idea card
   - Click "Share" button
   - Select "User B" from friend list
   - Click "Share Position"
   - ✅ Should see confirmation: "Position shared with 1 friend"

3. **User B: Verify Receipt**
   - Navigate to http://localhost:3001
   - Go to "Collaboration" tab
   - Click "Shared With Me" tab
   - ✅ AAPL position should appear (may take 1-2 seconds)
   - ✅ Should be marked as read-only
   - ✅ Should show "Shared by User A"

**Backend Verification:**

```bash
# Check collaboration service logs
tail -f logs/collab-service.log

# Should show:
# - position_shared event routed
# - Delivered to User B
```

### Test 2: Real-Time Comments

**Goal:** Verify comments sync in real-time between users

1. **User B: Add Comment**
   - On http://localhost:3001
   - Open the shared AAPL position
   - Type a comment: "Great setup! I like this trade."
   - Press Enter or click Send
   - ✅ Comment should appear immediately

2. **User A: See Comment**
   - On http://localhost:3000
   - Open the AAPL position
   - ✅ User B's comment should appear within 1-2 seconds
   - ✅ Should show "User B" as author

3. **User A: Reply**
   - Type: "Thanks! Let me know if you have suggestions."
   - Send comment
   - ✅ Comment appears immediately

4. **User B: See Reply**
   - ✅ User A's reply should appear within 1-2 seconds

**Backend Verification:**

```bash
# Check backend logs
tail -f logs/backend-a.log
tail -f logs/backend-b.log

# Should show:
# - comment_added event sent/received
# - WebSocket broadcasts
```

### Test 3: Position Updates

**Goal:** Verify position updates sync in real-time

1. **User A: Update Tags**
   - On http://localhost:3000
   - Open AAPL position
   - Add tags: "bullish", "short-term"
   - ✅ Tags should update immediately

2. **User B: See Updates**
   - On http://localhost:3001
   - Open shared AAPL position
   - ✅ New tags should appear within 1-2 seconds

3. **User A: Update Status**
   - Change status from "Planned" to "Watching"
   - ✅ Status updates immediately

4. **User B: See Status Change**
   - ✅ Status should update to "Watching" within 1-2 seconds

### Test 4: Share Revocation

**Goal:** Verify removing access works correctly

1. **User A: Revoke Share**
   - On http://localhost:3000
   - Open AAPL position
   - Click "Share" button
   - Deselect "User B"
   - Click "Update Sharing"
   - ✅ Should see: "All shares removed"

2. **User B: Verify Removal**
   - On http://localhost:3001
   - Go to "Shared With Me" tab
   - ✅ AAPL position should disappear within 1-2 seconds
   - ✅ Should see notification: "Access to position was revoked"

### Test 5: Connection Resilience

**Goal:** Verify system handles disconnections gracefully

1. **Stop Collaboration Service**
   ```bash
   # In collaboration service terminal, press Ctrl+C
   ```

2. **Verify Frontends Handle Disconnect**
   - Both frontends should show connection status as "Offline"
   - Local features should still work (viewing positions, etc.)
   - ✅ No crashes or errors

3. **Restart Collaboration Service**
   ```bash
   cd collaboration-service
   npm start
   ```

4. **Verify Reconnection**
   - ✅ Both backends should reconnect automatically
   - ✅ Frontend status should change to "Live"
   - ✅ Collaboration features should work again

### Test 6: Multiple Simultaneous Edits

**Goal:** Verify conflict handling

1. **User A: Add Comment**
   - Type: "Comment 1 from User A"

2. **User B: Add Comment (simultaneously)**
   - Type: "Comment 2 from User B"

3. **Both: Send at the same time**
   - ✅ Both comments should appear
   - ✅ Correct ordering by timestamp
   - ✅ No data loss

## Monitoring

### View All Service Status

```bash
# Collaboration service health
curl http://localhost:9000/health | jq

# Online users
curl http://localhost:9000/api/users/online | jq

# Backend A health
curl http://localhost:8000/health | jq

# Backend B health
curl http://localhost:8001/health | jq
```

### View Logs

```bash
# Real-time log viewing
tail -f logs/collab-service.log
tail -f logs/backend-a.log
tail -f logs/backend-b.log
tail -f logs/frontend-a.log
tail -f logs/frontend-b.log

# Search for errors
grep -i error logs/*.log

# View collaboration events
grep "collab_event" logs/collab-service.log
```

## Troubleshooting

### Issue: Collaboration Service Won't Start

**Symptoms:** Error on port 9000

**Solutions:**
```bash
# Check if port is in use
lsof -i :9000

# Kill process if needed
kill -9 <PID>

# Verify Node.js version
node --version  # Should be 18+
```

### Issue: Backend Can't Connect to Collaboration Service

**Symptoms:** Backend logs show connection errors

**Solutions:**
1. Verify collaboration service is running:
   ```bash
   curl http://localhost:9000/health
   ```

2. Check `.env` has correct settings:
   ```bash
   ENABLE_COLLABORATION=true
   COLLABORATION_SERVICE_URL=http://localhost:9000
   ```

3. Check python-socketio is installed:
   ```bash
   pip list | grep socketio
   ```

### Issue: Position Not Appearing in Shared Tab

**Symptoms:** User B doesn't see shared position

**Debug Steps:**

1. **Check Collaboration Service Logs:**
   ```bash
   tail -f logs/collab-service.log
   ```
   Look for: "position_shared event routed"

2. **Check Backend B Logs:**
   ```bash
   tail -f logs/backend-b.log
   ```
   Look for: "Received position_shared event"

3. **Verify Friendship:**
   - User A and User B must be friends
   - Check via API:
     ```bash
     curl http://localhost:8000/api/v1/friends
     ```

4. **Verify Event Delivery:**
   ```bash
   curl http://localhost:9000/api/users/online
   ```
   Both users should be listed as online

### Issue: Comments Not Syncing

**Symptoms:** Comments don't appear in real-time

**Solutions:**

1. **Check WebSocket Connection:**
   - Open browser DevTools → Network → WS tab
   - Should see active WebSocket connection
   - Messages should flow when commenting

2. **Verify Both Backends Connected:**
   ```bash
   curl http://localhost:9000/api/users/online
   ```

3. **Check CORS Settings:**
   - Backend A: `CORS_ORIGINS=http://localhost:3000`
   - Backend B: `CORS_ORIGINS=http://localhost:3001`

### Issue: Database Conflicts

**Symptoms:** "Database locked" or UUID conflicts

**Solutions:**

1. **Ensure Separate Databases:**
   - Backend A: `portfolio_user_a.db`
   - Backend B: `portfolio_user_b.db`

2. **Reset Databases:**
   ```bash
   cd backend
   rm portfolio_user_a.db portfolio_user_b.db
   # Restart backends - tables will be recreated
   ```

## Performance Benchmarks

### Expected Latency

| Operation | Expected Time |
|-----------|--------------|
| WebSocket Connection | < 500ms |
| Event Routing (Collab Service) | < 100ms |
| Comment Sync | < 1-2 seconds |
| Position Share Notification | < 1-2 seconds |
| Auto-Reconnection | < 3 seconds |

### Resource Usage

| Service | Memory | CPU |
|---------|--------|-----|
| Collaboration Service | ~50 MB | < 1% |
| Backend (each) | ~150 MB | 2-5% |
| Frontend (each) | ~200 MB | 3-8% |

## Production Considerations

When deploying this architecture to production:

### Security

- [ ] Enable JWT authentication for collaboration service
- [ ] Use WSS (TLS) instead of WS for WebSocket
- [ ] Restrict CORS to known domains
- [ ] Implement rate limiting
- [ ] Add API authentication for position fetching
- [ ] Encrypt database files

### Scaling

- [ ] Use Redis for collaboration service user registry
- [ ] Implement Redis pub/sub for multi-instance collab service
- [ ] Add load balancer with sticky sessions
- [ ] Use PostgreSQL instead of SQLite
- [ ] Implement connection pooling

### Monitoring

- [ ] Add Prometheus metrics
- [ ] Set up Grafana dashboards
- [ ] Configure alerts for:
  - High error rates
  - Service disconnections
  - Slow event routing
  - High memory usage
- [ ] Implement distributed tracing

### Deployment

- [ ] Containerize all services (Docker)
- [ ] Use Kubernetes for orchestration
- [ ] Implement health checks
- [ ] Set up CI/CD pipeline
- [ ] Configure auto-scaling

## Success Criteria

The distributed architecture is working correctly when:

- [x] Collaboration service accepts connections from both backends
- [x] Both backends can see each other online
- [x] User A can share positions with User B
- [x] User B receives shared positions
- [x] Comments sync in real-time (<2 seconds)
- [x] Position updates sync in real-time
- [x] Share revocation removes access immediately
- [x] System handles disconnections gracefully
- [x] No data loss during normal operations
- [x] All events are logged properly

## Next Steps

After successful testing:

1. **Add More Users:**
   - Create Instance C, D, etc.
   - Test group collaboration (3+ users)

2. **Stress Testing:**
   - Test with 10+ concurrent users
   - Test with hundreds of positions
   - Test with large comment threads

3. **Feature Enhancements:**
   - Add typing indicators
   - Add online presence indicators
   - Add notification center
   - Add activity feed

4. **Documentation:**
   - Update API documentation
   - Create deployment guide
   - Write monitoring runbook

## Support

- **Architecture Documentation:** See `DISTRIBUTED_COLLABORATION_ARCHITECTURE.md`
- **API Documentation:** http://localhost:9000/ (Collaboration Service)
- **Backend A API Docs:** http://localhost:8000/docs
- **Backend B API Docs:** http://localhost:8001/docs

---

**Last Updated:** 2025-11-01  
**Version:** 1.0  
**Status:** ✅ Implementation Complete

