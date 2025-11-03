# Configuration Management - Best Practices

## The New Way: Persistent Configuration Files ✅

Configuration settings are now stored in **persistent files** that you edit directly.

### Configuration Files

- **`backend/.env.instance_a`** - Instance A settings (User A, port 8000)
- **`backend/.env.instance_b`** - Instance B settings (User B, port 8001)

### How It Works

1. **First Run**: Script creates files from templates if they don't exist
2. **Subsequent Runs**: Script uses existing files (preserves your edits!)
3. **You Edit Directly**: Change any setting, restart to apply

## Step-by-Step: Changing Settings

### To Switch Mock Data On/Off

1. **Edit the config file directly:**
   ```bash
   nano backend/.env.instance_a
   ```

2. **Find and change the USE_MOCK_SCHWAB_DATA line:**
   ```bash
   # For mock data:
   USE_MOCK_SCHWAB_DATA=true
   
   # For real Schwab API:
   USE_MOCK_SCHWAB_DATA=false
   ```

3. **Save and exit** (`Ctrl+X`, `Y`, `Enter`)

4. **Restart the distributed environment:**
   ```bash
   pkill -9 -f "node server.js|uvicorn|react-scripts"
   bash start-distributed.sh
   ```

5. **Verify the change:**
   ```bash
   curl http://localhost:8000/health
   # Should show: {"status":"healthy","mock_mode":true} or false
   ```

### To Change Any Other Setting

Same process - just edit the file, save, restart:

```bash
# Edit Instance A
nano backend/.env.instance_a

# Edit Instance B  
nano backend/.env.instance_b

# Restart to apply
pkill -9 -f "node server.js|uvicorn|react-scripts"
bash start-distributed.sh
```

## Available Settings

Each instance configuration file contains:

```bash
# Database
DATABASE_URL=sqlite:///./portfolio_user_a.db

# Security  
SECRET_KEY=dev-secret-key-change-in-production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
ENCRYPTION_KEY=not-used-currently

# CORS
CORS_ORIGINS=http://localhost:3000

# Schwab API
USE_MOCK_SCHWAB_DATA=true  # ← EDIT THIS

# Logging
LOG_LEVEL=INFO

# Collaboration
ENABLE_COLLABORATION=true
COLLABORATION_SERVICE_URL=http://localhost:9000
BACKEND_USER_ID=00000000-0000-0000-0000-000000000001
BACKEND_URL=http://localhost:8000
BACKEND_DISPLAY_NAME=User A
```

## Why This Approach?

### ✅ Benefits

1. **Settings Persist** - Your edits survive restarts
2. **No Script Editing** - Change configs, not code
3. **Scales Well** - Add 100 settings? No problem
4. **Version Control** - Can track config templates in git
5. **Clear Separation** - Config vs. code vs. scripts
6. **Standard Practice** - How most apps manage configuration

### ❌ Old Way (Bad)

The old approach used heredocs to recreate files:

```bash
cat > .env.instance_a << EOF
USE_MOCK_SCHWAB_DATA=false  # Hardcoded!
EOF
```

Problems:
- Had to edit start script to change settings
- Settings didn't persist
- Doesn't scale beyond ~10 settings
- Violates separation of concerns

## Quick Reference

| Task | Command |
|------|---------|
| **Edit Instance A config** | `nano backend/.env.instance_a` |
| **Edit Instance B config** | `nano backend/.env.instance_b` |
| **Restart everything** | `pkill -9 -f "node\|uvicorn\|react-scripts" && bash start-distributed.sh` |
| **Check mock mode** | `curl http://localhost:8000/health` |
| **View current config** | `cat backend/.env.instance_a` |

## Production Considerations

For production deployments:

1. **Never commit sensitive values** (API keys, passwords)
2. **Use environment variables** from hosting platform
3. **Use secret management** (AWS Secrets Manager, etc.)
4. **Template approach still works:**
   - Commit `.env.instance_a.template` 
   - Copy to `.env.instance_a` on deployment
   - Inject secrets from secure store

## Troubleshooting

### "My changes aren't taking effect!"

1. **Check you're editing the right file:**
   ```bash
   cat backend/.env.instance_a | grep USE_MOCK
   ```

2. **Verify the file was copied:**
   ```bash
   cat backend/.env | grep USE_MOCK
   ```

3. **Check the health endpoint:**
   ```bash
   curl http://localhost:8000/health
   ```

4. **Look at logs:**
   ```bash
   tail -50 logs/backend-a.log | grep -i mock
   ```

### "Script created a new file and overwrote mine!"

This should only happen if the file doesn't exist. If it's happening repeatedly:
- Check file permissions
- Make sure you're in the right directory
- Verify the script logic (look for `if [ ! -f ".env.instance_a" ]`)

