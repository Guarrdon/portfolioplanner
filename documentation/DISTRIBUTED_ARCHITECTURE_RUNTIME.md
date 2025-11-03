# Runtime Port Detection for Distributed Architecture

## Problem Statement

In distributed mode, we need to run multiple independent frontend+backend pairs:
- Frontend A (port 3000) → Backend A (port 8000)
- Frontend B (port 3001) → Backend B (port 8001)
- Frontend C (port 3002) → Backend C (port 8002)
- etc.

**Challenge:** React bundles environment variables at build time, making it impossible to run multiple instances from the same build with different configurations.

## Naive Approaches (Don't Scale)

### ❌ Approach 1: Build-time Environment Variables
```bash
# Start Instance A
REACT_APP_API_URL=http://localhost:8000/api/v1 npm start

# Start Instance B  
REACT_APP_API_URL=http://localhost:8001/api/v1 npm start
```

**Problem:** Both instances share the same `node_modules/.cache`, causing race conditions. When one instance rebuilds, it affects the other. Requires delays/workarounds that don't scale to 3+ instances.

### ❌ Approach 2: Separate Frontend Directories
```bash
cp -r frontend frontend-a
cp -r frontend frontend-b
# Configure and start each separately
```

**Problem:** Duplicates code, wastes disk space, makes updates difficult, doesn't scale elegantly.

### ❌ Approach 3: Build Separate Bundles
```bash
REACT_APP_API_URL=http://localhost:8000/api/v1 npm run build -- -o build-a
REACT_APP_API_URL=http://localhost:8001/api/v1 npm run build -- -o build-b
```

**Problem:** Slow, requires a build step per instance, not suitable for development hot-reloading.

## ✅ Elegant Solution: Runtime Port Detection

Instead of configuring the backend URL at build time, **determine it at runtime** based on which port the frontend is running on.

### Implementation

**`frontend/src/services/api.js`:**
```javascript
function getApiBaseUrl() {
  // Check for explicit environment variable first (single-instance mode)
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
  }

  // Distributed mode: determine backend port from frontend port
  const frontendPort = window.location.port || '3000';
  
  // Map frontend port to backend port (3000→8000, 3001→8001, etc.)
  if (frontendPort.startsWith('300')) {
    const instanceNumber = frontendPort.slice(-1);
    const backendPort = `800${instanceNumber}`;
    return `http://localhost:${backendPort}/api/v1`;
  }
  
  // Default fallback
  return 'http://localhost:8000/api/v1';
}

const api = axios.create({
  baseURL: getApiBaseUrl(),  // Determined at runtime!
  // ...
});
```

**`frontend/src/services/websocket.js`:**
```javascript
connect(userId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  
  let host;
  if (process.env.REACT_APP_API_URL) {
    host = process.env.REACT_APP_API_URL;
  } else {
    // Determine backend port from frontend port
    const frontendPort = window.location.port || '3000';
    if (frontendPort.startsWith('300')) {
      const instanceNumber = frontendPort.slice(-1);
      const backendPort = `800${instanceNumber}`;
      host = `localhost:${backendPort}`;
    } else {
      host = 'localhost:8000';
    }
  }
  
  const cleanHost = host.replace(/^https?:\/\//, '').replace(/\/api\/v1\/?$/, '');
  const wsUrl = `${protocol}//${cleanHost}/api/v1/ws/collaborate?user_id=${userId}`;
  
  this.ws = new WebSocket(wsUrl);
}
```

### Simplified Start Script

**`start-distributed.sh`:**
```bash
# No .env.local juggling needed!
# Frontend determines backend URL at runtime based on its port

# Remove .env.local to ensure runtime detection works
rm -f .env.local

# Start Frontend A (port 3000) - will connect to backend 8000
PORT=3000 BROWSER=none npm start > logs/frontend-a.log 2>&1 &

# Start Frontend B (port 3001) - will connect to backend 8001
PORT=3001 BROWSER=none npm start > logs/frontend-b.log 2>&1 &

# Start Frontend C (port 3002) - will connect to backend 8002
PORT=3002 BROWSER=none npm start > logs/frontend-c.log 2>&1 &

# ... infinitely scalable!
```

## Benefits

### ✅ Scales to Any Number of Instances
No configuration changes needed. Just start on a new port:
```bash
PORT=3009 npm start  # Automatically connects to backend 8009
```

### ✅ No Build-Time Conflicts
All instances share the same webpack cache without conflicts because there's no build-time configuration to compete over.

### ✅ No Code Duplication
Single codebase, single `node_modules`, minimal disk usage.

### ✅ Hot-Reload Works Perfectly
Each instance gets live updates without affecting others.

### ✅ Works in Both Modes
- **Single-instance:** Set `REACT_APP_API_URL` explicitly
- **Distributed:** Omit `REACT_APP_API_URL`, automatic port mapping

### ✅ Simple Mental Model
Frontend port 300X → Backend port 800X. Easy to remember, predictable.

## Port Mapping

| Frontend Port | Backend Port | User      |
|--------------|-------------|-----------|
| 3000         | 8000        | User A    |
| 3001         | 8001        | User B    |
| 3002         | 8002        | User C    |
| 3003         | 8003        | User D    |
| ...          | ...         | ...       |
| 3009         | 8009        | User J    |

## Testing

Hard refresh your browser (`Cmd+Shift+R`) to clear any cached environment variables, then:

1. Open `http://localhost:3000` - should connect to backend 8000
2. Open `http://localhost:3001` - should connect to backend 8001  
3. Check browser console for "Connecting to WebSocket: ws://localhost:800X..."
4. Verify API calls go to the correct backend in Network tab

## Production Considerations

For production deployments:
1. Build separate bundles with explicit `REACT_APP_API_URL` for each instance
2. Or use a reverse proxy/API gateway to route all instances through a single domain
3. Or use dynamic configuration loaded from a config endpoint

The runtime detection is perfect for **development** where you need multiple instances running locally. For production, you have more deployment options.

