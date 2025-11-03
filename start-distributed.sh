#!/bin/bash

# Portfolio Planner - Distributed Multi-Instance Startup Script
# 
# This script starts:
# 1. Collaboration Service (port 9000)
# 2. Backend Instance A (port 8000) + Frontend (port 3000)
# 3. Backend Instance B (port 8001) + Frontend (port 3001)
#
# Each instance is completely independent with its own database.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Portfolio Planner - Distributed Mode${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 is not installed${NC}"
    echo "Please install Python 3.11+ from https://www.python.org/"
    exit 1
fi

# Function to kill background processes on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down all services...${NC}"
    jobs -p | xargs -r kill 2>/dev/null || true
    echo -e "${GREEN}All services stopped${NC}"
    exit 0
}

trap cleanup EXIT INT TERM

# Create log directory
mkdir -p logs

echo -e "${YELLOW}[1/7] Installing Collaboration Service dependencies...${NC}"
cd collaboration-service
if [ ! -d "node_modules" ]; then
    npm install
fi
cd ..

echo -e "${YELLOW}[2/7] Starting Collaboration Service (port 9000)...${NC}"
cd collaboration-service
node server.js > ../logs/collab-service.log 2>&1 &
COLLAB_PID=$!
cd ..
echo -e "${GREEN}✓ Collaboration Service started (PID: $COLLAB_PID)${NC}"
sleep 2

# Check if collaboration service is running
if ! curl -s http://localhost:9000/health > /dev/null; then
    echo -e "${RED}Error: Collaboration Service failed to start${NC}"
    echo "Check logs/collab-service.log for details"
    exit 1
fi

echo -e "${YELLOW}[3/7] Setting up Backend Instance A (User A)...${NC}"
cd backend

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
if [ ! -f "venv/.installed" ]; then
    pip install -q -r requirements.txt
    touch venv/.installed
fi

# Check if .env.instance_a exists, create from template if not
if [ ! -f ".env.instance_a" ]; then
    echo -e "${YELLOW}  Creating .env.instance_a from template...${NC}"
    cat > .env.instance_a << 'ENVEOF'
# Instance A Configuration - Edit this file directly to change settings
DATABASE_URL=sqlite:///./portfolio_user_a.db
SECRET_KEY=dev-secret-key-user-a-change-in-production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
ENCRYPTION_KEY=not-used-currently
CORS_ORIGINS=http://localhost:3000
USE_MOCK_SCHWAB_DATA=true
LOG_LEVEL=INFO
ENABLE_COLLABORATION=true
COLLABORATION_SERVICE_URL=http://localhost:9000
BACKEND_USER_ID=00000000-0000-0000-0000-000000000001
BACKEND_URL=http://localhost:8000
BACKEND_DISPLAY_NAME=User A
ENVEOF
else
    echo -e "${GREEN}  Using existing .env.instance_a${NC}"
fi

echo -e "${YELLOW}[4/7] Starting Backend Instance A (port 8000)...${NC}"
cp .env.instance_a .env
PORT=8000 uvicorn app.main:app --host 0.0.0.0 --port 8000 > ../logs/backend-a.log 2>&1 &
BACKEND_A_PID=$!
echo -e "${GREEN}✓ Backend A started (PID: $BACKEND_A_PID)${NC}"
sleep 3

cd ..

# Setup Instance B
echo -e "${YELLOW}[5/7] Setting up Backend Instance B (User B)...${NC}"
cd backend

# Check if .env.instance_b exists, create from template if not
if [ ! -f ".env.instance_b" ]; then
    echo -e "${YELLOW}  Creating .env.instance_b from template...${NC}"
    cat > .env.instance_b << 'ENVEOF'
# Instance B Configuration - Edit this file directly to change settings
DATABASE_URL=sqlite:///./portfolio_user_b.db
SECRET_KEY=dev-secret-key-user-b-change-in-production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
ENCRYPTION_KEY=not-used-currently
CORS_ORIGINS=http://localhost:3001
USE_MOCK_SCHWAB_DATA=true
LOG_LEVEL=INFO
ENABLE_COLLABORATION=true
COLLABORATION_SERVICE_URL=http://localhost:9000
BACKEND_USER_ID=00000000-0000-0000-0000-000000000002
BACKEND_URL=http://localhost:8001
BACKEND_DISPLAY_NAME=User B
ENVEOF
else
    echo -e "${GREEN}  Using existing .env.instance_b${NC}"
fi

# Start Instance B with different database
cp .env.instance_b .env
PORT=8001 uvicorn app.main:app --host 0.0.0.0 --port 8001 > ../logs/backend-b.log 2>&1 &
BACKEND_B_PID=$!
echo -e "${GREEN}✓ Backend B started (PID: $BACKEND_B_PID)${NC}"
sleep 3

cd ..

# Setup and start Frontend instances
echo -e "${YELLOW}[6/7] Installing Frontend dependencies...${NC}"
cd frontend
if [ ! -d "node_modules" ]; then
    npm install
fi

echo -e "${YELLOW}[7/7] Starting Frontend instances...${NC}"

# No .env.local needed! Frontend determines backend URL at runtime based on its port.
# This allows unlimited instances to run from the same codebase:
#   Frontend :3000 → Backend :8000
#   Frontend :3001 → Backend :8001
#   Frontend :3002 → Backend :8002
#   etc.

# Remove .env.local to ensure runtime detection works
rm -f .env.local

# Start Frontend A (port 3000)
PORT=3000 BROWSER=none npm start > ../logs/frontend-a.log 2>&1 &
FRONTEND_A_PID=$!
echo -e "${GREEN}✓ Frontend A started (PID: $FRONTEND_A_PID) - http://localhost:3000${NC}"

# Start Frontend B (port 3001)
PORT=3001 BROWSER=none npm start > ../logs/frontend-b.log 2>&1 &
FRONTEND_B_PID=$!
echo -e "${GREEN}✓ Frontend B started (PID: $FRONTEND_B_PID) - http://localhost:3001${NC}"

cd ..

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}All services started successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Services:${NC}"
echo -e "  Collaboration Service: ${GREEN}http://localhost:9000/health${NC}"
echo -e "  Backend A (User A):    ${GREEN}http://localhost:8000/docs${NC}"
echo -e "  Frontend A (User A):   ${GREEN}http://localhost:3000${NC}"
echo -e "  Backend B (User B):    ${GREEN}http://localhost:8001/docs${NC}"
echo -e "  Frontend B (User B):   ${GREEN}http://localhost:3001${NC}"
echo ""
echo -e "${BLUE}Testing Collaboration:${NC}"
echo "  1. Open http://localhost:3000 (User A)"
echo "  2. Open http://localhost:3001 (User B) in a different browser/incognito"
echo "  3. User A: Create a trade idea"
echo "  4. User A: Share it with User B"
echo "  5. User B: Should see it in 'Shared With Me' tab"
echo "  6. User B: Add a comment"
echo "  7. User A: Should see the comment in real-time"
echo ""
echo -e "${YELLOW}Logs are available in logs/ directory${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Wait for all background processes
wait

