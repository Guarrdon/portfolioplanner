# Distributed Collaboration - Quick Start

## TL;DR

```bash
# Start everything (collaboration service + 2 independent instances)
./start-distributed.sh

# Then open:
# - http://localhost:3000 (User A)
# - http://localhost:3001 (User B)
```

## What You Get

- **Collaboration Service** on port 9000 (message broker)
- **User A Instance:**
  - Backend: http://localhost:8000
  - Frontend: http://localhost:3000
  - Database: `portfolio_user_a.db`
  
- **User B Instance:**
  - Backend: http://localhost:8001
  - Frontend: http://localhost:3001
  - Database: `portfolio_user_b.db`

## Quick Test

1. **User A:** Create a trade idea
2. **User A:** Share it with User B
3. **User B:** See it in "Shared With Me" tab
4. **User B:** Add a comment
5. **User A:** See the comment in real-time

## Architecture

```
User A (3000/8000) ←→ Collaboration Service (9000) ←→ User B (3001/8001)
```

## Key Files

- **Start Script:** `./start-distributed.sh`
- **Testing Guide:** `DISTRIBUTED_TESTING_GUIDE.md`
- **Implementation Summary:** `DISTRIBUTED_IMPLEMENTATION_SUMMARY.md`
- **Architecture Doc:** `DISTRIBUTED_COLLABORATION_ARCHITECTURE.md`

## Logs

All logs are in `logs/` directory:
- `collab-service.log`
- `backend-a.log`
- `backend-b.log`
- `frontend-a.log`
- `frontend-b.log`

## Stop All Services

Press `Ctrl+C` in the terminal running `start-distributed.sh`

## Troubleshooting

### Port Already in Use

```bash
# Check what's using the port
lsof -i :9000  # or :8000, :8001, :3000, :3001

# Kill the process
kill -9 <PID>
```

### Services Won't Start

```bash
# Check logs
tail -f logs/*.log

# Manual health checks
curl http://localhost:9000/health  # Collaboration service
curl http://localhost:8000/health  # Backend A
curl http://localhost:8001/health  # Backend B
```

### Collaboration Not Working

1. Verify collaboration service is running:
   ```bash
   curl http://localhost:9000/api/users/online
   ```
   Should show 2 users.

2. Check backend logs for connection errors:
   ```bash
   grep -i "collaboration" logs/backend-*.log
   ```

## What's Different from Standard Mode?

| Feature | Standard Mode | Distributed Mode |
|---------|--------------|------------------|
| Backends | 1 | 2+ (independent) |
| Databases | 1 | 1 per instance |
| Ports | 8000, 3000 | 8000-8001, 3000-3001, 9000 |
| Collaboration | WebSocket only | Collaboration Service |
| Data Sharing | Same database | HTTP fetch + events |

## Production Readiness

⚠️ **Not production-ready** without:
- JWT authentication
- TLS/WSS encryption
- Rate limiting
- PostgreSQL (not SQLite)
- Redis for scaling
- Monitoring/alerting

See `DISTRIBUTED_IMPLEMENTATION_SUMMARY.md` for production requirements.

## Next Steps

1. **Test:** Follow `DISTRIBUTED_TESTING_GUIDE.md`
2. **Customize:** Modify `.env` files for your setup
3. **Scale:** Add more instances (User C, D, etc.)
4. **Deploy:** See deployment section in docs

---

**Need Help?**
- 📖 Full Testing Guide: `DISTRIBUTED_TESTING_GUIDE.md`
- 🏗️ Architecture: `DISTRIBUTED_COLLABORATION_ARCHITECTURE.md`
- 📝 Implementation: `DISTRIBUTED_IMPLEMENTATION_SUMMARY.md`

