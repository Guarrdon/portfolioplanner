# Startup Script Consistency & Robustness

**Date:** November 3, 2025  
**Status:** Enhanced with Full Health Checks

---

## 🎯 Problem Solved

The startup script now handles all consistency scenarios:

1. ✅ **Port conflicts** - Detects and cleans up stale processes
2. ✅ **Partial startup failures** - Verifies each service before proceeding
3. ✅ **Service crashes** - Monitors and detects crashes after startup
4. ✅ **Database migrations** - Checks and runs if needed
5. ✅ **Configuration validation** - Verifies required files exist
6. ✅ **Automatic cleanup** - Kills processes on Ctrl+C or error

---

## 🔍 Enhanced Startup Flow

### Phase 1: Pre-Flight Checks (Before Starting Anything)

```bash
1. Check Node.js installed
2. Check Python installed
3. Check for port conflicts (9000, 8000, 8001, 3000, 3001)
   - If ports in use → Kill existing processes
   - Verify ports are free after cleanup
4. Check configuration files exist
   - backend/.env.instance_a
   - backend/.env.instance_b
5. Check database migrations
   - Verify is_manual_strategy column exists
   - Run migrations if needed
```

**Result:** Either everything is ready, or script exits with clear error message

### Phase 2: Service Startup (With Health Checks)

```bash
For each service:
  1. Start the service
  2. Wait for it to be ready (up to 30 seconds)
     - Makes HTTP requests to health endpoint
     - Retries every second
  3. If timeout → Show log tail and exit
  4. If ready → Continue to next service
```

**Services started in order:**
1. Collaboration Service (9000) → Check `/health`
2. Backend A (8000) → Check `/docs`
3. Backend B (8001) → Check `/docs`
4. Frontend A (3000) → Check root `/`
5. Frontend B (3001) → Check root `/`

### Phase 3: Final Verification

```bash
1. Verify all PIDs are still alive
2. Report status of each service
3. If any failed → Exit with error
4. If all healthy → Enter monitoring loop
```

### Phase 4: Continuous Monitoring

```bash
Every 10 seconds:
  1. Check if each process is still running
  2. If any crashed:
     - Show last 20 lines of its log
     - Shut down all services
     - Exit with error
```

---

## 🛠️ Scenarios Handled

### Scenario 1: Clean Start (Nothing Running)
```
✓ Pre-flight checks pass
✓ All services start successfully
✓ All health checks pass
✓ Monitoring loop begins
```

### Scenario 2: Port Already in Use
```
⚠️  Port 8000 is in use
🔧 Killing process on port 8000 (PID: 12345)
✓ Port now available
✓ Continue with startup
```

### Scenario 3: Service Fails to Start
```
✗ Backend A failed to start (timeout after 30s)
📋 Showing last 30 lines of logs/backend-a.log:
    [error logs here]
❌ Exiting - fix the error and try again
```

### Scenario 4: Service Crashes After Startup
```
✓ All services running
[monitoring...]
⚠️  Backend A crashed!
📋 Showing last 20 lines of logs/backend-a.log:
    [crash logs here]
🛑 Shutting down all services
❌ Exiting
```

### Scenario 5: User Hits Ctrl+C
```
^C
🛑 Shutting down all services...
   Killing process on port 9000
   Killing process on port 8000
   Killing process on port 8001
   Killing process on port 3000
   Killing process on port 3001
✓ All services stopped
```

### Scenario 6: Database Migrations Needed
```
⚠️  Database migrations needed - running now...
📊 Migrating portfolio_user_a.db
   ✓ Added is_manual_strategy column
   ✓ Added schwab_position_signature column
📊 Migrating portfolio_user_b.db
   ✓ Added is_manual_strategy column
   ✓ Added schwab_position_signature column
✓ Database migrations applied
✓ Continue with startup
```

---

## 🔧 Key Functions

### `check_port(port)`
Returns 0 if port is in use, 1 if free

### `kill_port(port)`
Kills any process listening on the specified port
```bash
lsof -ti:$port | xargs kill -9
```

### `wait_for_service(url, name)`
Polls URL up to 30 times (30 seconds)
- Returns 0 if service responds
- Returns 1 if timeout
- Shows progress dots while waiting

### `verify_process(pid, name)`
Checks if process is still running
- Returns 0 if alive
- Returns 1 if dead

### `cleanup()`
Runs on EXIT, INT, or TERM signals
- Kills processes by port (handles stale PIDs)
- Kills background jobs
- Always runs, even on error

---

## 📊 Output Example

```
========================================
Portfolio Planner - Distributed Mode
========================================

Running pre-flight checks...
  ✓ Node.js installed: v18.17.0
  ✓ Python installed: Python 3.11.5
Checking for port conflicts...
  ✓ All ports are available
Checking configuration files...
  ✓ backend/.env.instance_a found
  ✓ backend/.env.instance_b found
Checking database migrations...
  ✓ Database migrations applied
Pre-flight checks passed!

[1/7] Installing Collaboration Service dependencies...
[2/7] Starting Collaboration Service (port 9000)...
  Waiting for Collaboration Service to be ready...
  ✓ Collaboration Service is ready
[3/7] Setting up Backend Instance A (User A)...
[4/7] Starting Backend Instance A (port 8000)...
  Waiting for Backend A to be ready...
  ✓ Backend A is ready
[5/7] Starting Backend Instance B (User B)...
  Waiting for Backend B to be ready...
  ✓ Backend B is ready
[6/7] Installing Frontend dependencies...
[7/7] Starting Frontend instances...
  Waiting for frontends to compile (this may take 30-60 seconds)...
  ✓ Frontend A is ready
  ✓ Frontend B is ready

Final health check...
  ✓ Collaboration Service is running (PID: 12345)
  ✓ Backend A is running (PID: 12346)
  ✓ Backend B is running (PID: 12347)
  ✓ Frontend A is running (PID: 12348)
  ✓ Frontend B is running (PID: 12349)

========================================
All services started successfully!
========================================

Services:
  Collaboration Service: http://localhost:9000/health
  Backend A (User A):    http://localhost:8000/docs
  Frontend A (User A):   http://localhost:3000
  Backend B (User B):    http://localhost:8001/docs
  Frontend B (User B):   http://localhost:3001/docs

Process IDs:
  Collaboration Service: 12345
  Backend A: 12346
  Backend B: 12347
  Frontend A: 12348
  Frontend B: 12349

Logs are available in logs/ directory
Press Ctrl+C to stop all services

Monitoring services... (checking every 10 seconds)
```

---

## 🚫 Common Errors & Solutions

### Error: "Port X is still in use after cleanup"
**Cause:** Another application is using that port  
**Solution:** 
```bash
# Find what's using the port
lsof -i :PORT

# Kill it manually
lsof -ti:PORT | xargs kill -9
```

### Error: "Backend A failed to start (timeout after 30s)"
**Cause:** Backend crashed during startup  
**Solution:** Check `logs/backend-a.log` for Python errors

### Error: "backend/.env.instance_a not found"
**Cause:** Configuration file missing  
**Solution:**
```bash
cd backend
cp .env.instance_a.template .env.instance_a
# Edit .env.instance_a with your settings
```

### Error: "Database migrations needed"
**Cause:** Database schema is out of date  
**Solution:** Script automatically runs migrations

---

## 🔄 Restart Procedure

### Safe Restart
```bash
# Kill current instance (script handles cleanup)
Ctrl+C

# Wait a moment
sleep 2

# Start again
./start-distributed.sh
```

### Force Restart (if stuck)
```bash
# Nuclear option - kill everything
pkill -9 -f "uvicorn|npm|node.*server"

# Wait for ports to free
sleep 3

# Start fresh
./start-distributed.sh
```

---

## 📈 Improvements Over Original

| Feature | Original | Enhanced |
|---------|----------|----------|
| Port conflict detection | ❌ None | ✅ Automatic cleanup |
| Health checks | 🟡 Collab only | ✅ All services |
| Service verification | ❌ None | ✅ Process monitoring |
| Database migrations | ❌ Manual | ✅ Automatic check |
| Error messages | 🟡 Generic | ✅ Specific + logs |
| Crash detection | ❌ None | ✅ Continuous monitoring |
| Cleanup on exit | 🟡 Basic | ✅ Comprehensive |

---

## 🎯 Best Practices

1. **Always use the script** - Don't start services manually
2. **Check logs if something fails** - Script shows relevant logs
3. **Use Ctrl+C to stop** - Ensures clean shutdown
4. **Wait for "All services started successfully"** - Don't assume it worked
5. **Monitor the monitoring loop** - It will alert you if something crashes

---

## 🔮 Future Enhancements

Potential improvements:
- [ ] Auto-restart crashed services
- [ ] Email/Slack notifications on failure
- [ ] Metrics collection (uptime, restart counts)
- [ ] Load balancing for multiple backends
- [ ] Blue-green deployments
- [ ] Health check dashboard

---

**The script is now production-grade and handles all consistency scenarios!** 🚀

