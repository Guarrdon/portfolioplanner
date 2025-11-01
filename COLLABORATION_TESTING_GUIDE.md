# Collaboration Testing Guide

## Overview
This guide explains how to test the real-time collaboration features by running two independent instances of the Portfolio Planner application.

## Prerequisites
- Python 3.11+ and Node.js 18+ installed
- Two different user accounts in the database (or use the same test user with different browser sessions)
- Two separate browser profiles or browsers (to simulate different users)

---

## Setup Instructions

### 1. Backend Setup (Single Instance)

The backend only needs to run once and will handle WebSocket connections from multiple clients.

```bash
cd backend

# Activate virtual environment
source venv/bin/activate  # On Mac/Linux
# OR
.\venv\Scripts\activate   # On Windows

# Start the backend server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Verify backend is running:**
- Navigate to: http://localhost:8000/docs
- You should see the FastAPI Swagger documentation
- WebSocket endpoint should be available at: `ws://localhost:8000/api/v1/ws/collaborate`

---

### 2. Frontend Setup (Multiple Instances)

You'll need to run the frontend on two different ports to simulate two independent users.

#### **Instance 1: Port 3000 (User A)**

```bash
# Terminal 1
cd frontend
npm start
```

This will start the first instance on http://localhost:3000

#### **Instance 2: Port 3001 (User B)**

```bash
# Terminal 2
cd frontend
PORT=3001 npm start
```

This will start the second instance on http://localhost:3001

**Note:** You may need to modify the CORS settings if you encounter cross-origin issues.

---

### 3. Browser Setup

You have two options:

#### **Option A: Two Different Browsers**
- Open http://localhost:3000 in Chrome
- Open http://localhost:3001 in Firefox

#### **Option B: Browser Profiles (Recommended)**
- **Chrome:** Create two profiles (Chrome Menu → Profiles → Add)
- **Firefox:** Use private window for second instance
- Open both URLs in separate profiles

---

## Testing Scenarios

### Scenario 1: Real-Time Position Updates

**Goal:** Verify that position updates (tags, notes, status) are reflected instantly on both instances.

**Steps:**
1. **User A (Port 3000):** Navigate to Collaboration Dashboard
2. **User B (Port 3001):** Navigate to Collaboration Dashboard
3. **User A:** Create a new trade idea
4. **User A:** Share the trade idea with User B (if testing with different users)
5. **User A:** Add a tag (e.g., "bullish")
6. **Verify:** User B should see the tag appear instantly without refreshing
7. **User B:** Add another tag (e.g., "short-term")
8. **Verify:** User A should see the new tag instantly

**Expected Results:**
- ✅ Tags appear instantly on both instances
- ✅ Connection status shows "Live" (green)
- ✅ No page refresh required
- ✅ Updates are smooth and immediate

---

### Scenario 2: Real-Time Comments

**Goal:** Test the chat-style collaboration with instant comment delivery.

**Steps:**
1. **User A:** Expand a trade idea card
2. **User B:** Expand the same trade idea card
3. **User A:** Type a comment: "What do you think about this setup?"
4. **Verify:** Comment appears in User B's discussion panel instantly
5. **User B:** Reply: "Looks good, but watch the IV"
6. **Verify:** Reply appears in User A's discussion panel instantly
7. **User A:** Add another comment
8. **Verify:** Both users see all comments in real-time

**Expected Results:**
- ✅ Comments appear instantly (within 1 second)
- ✅ Correct user attribution (display names)
- ✅ Timestamps are accurate
- ✅ Comment count updates automatically

---

### Scenario 3: Share Notifications

**Goal:** Test that sharing and revoking access triggers real-time notifications.

**Steps:**
1. **User A:** Create a new trade idea
2. **User A:** Click the share button
3. **User A:** Select User B and click "Update"
4. **Verify:** User B receives a notification toast: "A new position was shared with you"
5. **Verify:** User B sees the new position appear in "Shared With Me" tab
6. **User A:** Open share modal again and deselect User B
7. **User A:** Click "Update" (or "Remove All Shares")
8. **Verify:** User B receives a notification: "Access to a position was revoked"
9. **Verify:** Position disappears from User B's "Shared With Me" tab

**Expected Results:**
- ✅ Share notification appears instantly
- ✅ Position appears in shared tab without refresh
- ✅ Revoke notification appears instantly
- ✅ Position is removed from shared tab without refresh

---

### Scenario 4: Connection Resilience

**Goal:** Test WebSocket reconnection and error handling.

**Steps:**
1. **Both Users:** Verify connection status shows "Live" (green)
2. **Backend:** Stop the backend server (Ctrl+C)
3. **Verify:** Both instances show "Offline" status (gray)
4. **Backend:** Restart the backend server
5. **Verify:** Both instances automatically reconnect and show "Live" status
6. **User A:** Make a change (add tag, comment)
7. **Verify:** User B receives the update instantly

**Expected Results:**
- ✅ Connection status accurately reflects server state
- ✅ Automatic reconnection within 2-5 seconds
- ✅ No data loss after reconnection
- ✅ Updates resume working after reconnection

---

### Scenario 5: Multi-User Concurrent Editing

**Goal:** Test simultaneous edits from multiple users.

**Steps:**
1. **User A & B:** Both expand the same trade idea
2. **User A:** Add tag "momentum" (without pressing Enter yet)
3. **User B:** Add tag "earnings" (press Enter)
4. **Verify:** User A sees "earnings" tag appear
5. **User A:** Press Enter to add "momentum"
6. **Verify:** User B sees "momentum" tag appear
7. **Both Users:** Add comments simultaneously
8. **Verify:** All comments appear for both users in correct order

**Expected Results:**
- ✅ No race conditions or conflicts
- ✅ Tags from both users are preserved
- ✅ Comments appear in chronological order
- ✅ No duplicate or missing updates

---

## Troubleshooting

### WebSocket Connection Fails

**Symptom:** Status shows "Offline" or connection errors in console.

**Solutions:**
1. Verify backend is running on port 8000
2. Check browser console for WebSocket errors
3. Ensure CORS settings allow WebSocket connections
4. Try a different browser

**Console Command:**
```javascript
// In browser console, verify WebSocket
const ws = new WebSocket('ws://localhost:8000/api/v1/ws/collaborate?user_id=00000000-0000-0000-0000-000000000001');
ws.onopen = () => console.log('Connected!');
ws.onerror = (e) => console.error('Error:', e);
```

---

### Updates Not Appearing

**Symptom:** Changes made by User A don't appear for User B.

**Solutions:**
1. Check that both instances show "Live" status
2. Verify WebSocket connection in browser DevTools → Network → WS
3. Check backend logs for WebSocket errors
4. Ensure both users have access to the same position (shared correctly)

**Backend Logs:**
```bash
# Watch backend logs for WebSocket activity
tail -f backend.log
```

---

### Port Already in Use

**Symptom:** "Port 3001 is already in use" error.

**Solutions:**
```bash
# Mac/Linux
lsof -ti:3001 | xargs kill -9

# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F
```

---

## Performance Testing

### Latency Measurement

Open browser DevTools → Network → WS tab and observe:
- **Connection time:** < 500ms
- **Message latency:** < 100ms
- **Reconnection time:** < 2 seconds

### Load Testing

Test with multiple simultaneous users:
```bash
# Install wscat for WebSocket testing
npm install -g wscat

# Connect multiple clients
wscat -c ws://localhost:8000/api/v1/ws/collaborate?user_id=test-user-1
wscat -c ws://localhost:8000/api/v1/ws/collaborate?user_id=test-user-2
wscat -c ws://localhost:8000/api/v1/ws/collaborate?user_id=test-user-3
```

---

## Environment Variables

For testing with different API URLs:

**Frontend `.env` file:**
```env
REACT_APP_API_URL=http://localhost:8000
```

**For remote testing:**
```env
REACT_APP_API_URL=https://your-api-server.com
```

---

## Database Considerations

### Multiple Test Users

To properly test collaboration, create additional test users:

```sql
INSERT INTO users (id, username, email, full_name, hashed_password, is_active)
VALUES 
  ('00000000-0000-0000-0000-000000000002', 'testuser2', 'test2@example.com', 'Test User 2', 'fake_hash', true),
  ('00000000-0000-0000-0000-000000000003', 'testuser3', 'test3@example.com', 'Test User 3', 'fake_hash', true);
```

### Friendships

Create friendship relationships:

```sql
INSERT INTO friendships (id, user_id, friend_id, status)
VALUES 
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'accepted'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'accepted');
```

---

## Automated Testing Script

**Quick start script** (`test_collaboration.sh`):

```bash
#!/bin/bash

echo "Starting Portfolio Planner Collaboration Test..."

# Start backend
echo "Starting backend..."
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 3

# Start frontend instance 1
echo "Starting frontend instance 1 (port 3000)..."
cd frontend
npm start &
FRONTEND1_PID=$!
cd ..

# Wait a bit
sleep 2

# Start frontend instance 2
echo "Starting frontend instance 2 (port 3001)..."
cd frontend
PORT=3001 npm start &
FRONTEND2_PID=$!
cd ..

echo ""
echo "=========================================="
echo "✅ All instances started!"
echo "=========================================="
echo "Backend:     http://localhost:8000"
echo "Frontend 1:  http://localhost:3000"
echo "Frontend 2:  http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop all instances..."
echo ""

# Wait for user interrupt
trap "kill $BACKEND_PID $FRONTEND1_PID $FRONTEND2_PID; exit" INT
wait
```

Make it executable:
```bash
chmod +x test_collaboration.sh
./test_collaboration.sh
```

---

## Success Criteria

✅ **Connection Status:** Both instances show "Live" (green icon)  
✅ **Tag Updates:** Tags added by either user appear instantly  
✅ **Comments:** Messages appear in < 1 second  
✅ **Share Notifications:** Toast notifications appear immediately  
✅ **Reconnection:** Automatic reconnect within 5 seconds  
✅ **No Refresh Needed:** All updates visible without page reload  
✅ **No Data Loss:** No missing or duplicate updates  
✅ **Concurrent Edits:** Multiple users can edit simultaneously without conflicts  

---

## Known Limitations

1. **Single Backend:** Only one backend instance (no load balancing yet)
2. **User Authentication:** Currently using test user IDs
3. **Notification Persistence:** Notifications disappear after 5 seconds
4. **Message History:** New connections don't receive historical events
5. **Presence Indicators:** No "user is typing" or "user is online" indicators yet

---

## Next Steps

After successful testing, consider:
- [ ] Add presence indicators (who's viewing/editing)
- [ ] Implement typing indicators
- [ ] Add message reactions in real-time
- [ ] Scale to production with Redis pub/sub for multi-server support
- [ ] Add analytics for WebSocket connection metrics

---

## Support

If you encounter issues:
1. Check browser console for errors
2. Check backend logs: `tail -f backend.log`
3. Verify WebSocket connection in DevTools → Network → WS tab
4. Review the troubleshooting section above

---

**Last Updated:** October 30, 2025  
**Version:** 1.0  
**Status:** Ready for Testing ✅

