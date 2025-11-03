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

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Function to kill process on a specific port
kill_port() {
    local port=$1
    local pids=$(lsof -ti:$port 2>/dev/null)
    if [ ! -z "$pids" ]; then
        echo -e "${YELLOW}  Killing process on port $port (PIDs: $pids)${NC}"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
}

# Function to wait for a service to be ready
wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=30
    local attempt=0
    
    echo -e "${YELLOW}  Waiting for $name to be ready...${NC}"
    
    while [ $attempt -lt $max_attempts ]; do
        if curl -s "$url" > /dev/null 2>&1; then
            echo -e "${GREEN}  ✓ $name is ready${NC}"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 1
    done
    
    echo -e "${RED}  ✗ $name failed to start (timeout after ${max_attempts}s)${NC}"
    return 1
}

# Function to verify service is still running
verify_process() {
    local pid=$1
    local name=$2
    
    if ps -p $pid > /dev/null 2>&1; then
        echo -e "${GREEN}  ✓ $name is running (PID: $pid)${NC}"
        return 0
    else
        echo -e "${RED}  ✗ $name crashed or failed to start${NC}"
        return 1
    fi
}

# Function to kill background processes on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down all services...${NC}"
    
    # Kill by port to ensure cleanup even if PIDs are stale
    kill_port 9000  # Collaboration Service
    kill_port 8000  # Backend A
    kill_port 8001  # Backend B
    kill_port 3000  # Frontend A
    kill_port 3001  # Frontend B
    
    # Also kill any remaining background jobs
    jobs -p | xargs kill 2>/dev/null || true
    
    echo -e "${GREEN}All services stopped${NC}"
    exit 0
}

trap cleanup EXIT INT TERM

# PRE-FLIGHT CHECKS
echo -e "${YELLOW}Running pre-flight checks...${NC}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi
echo -e "${GREEN}  ✓ Node.js installed: $(node --version)${NC}"

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 is not installed${NC}"
    echo "Please install Python 3.11+ from https://www.python.org/"
    exit 1
fi
echo -e "${GREEN}  ✓ Python installed: $(python3 --version)${NC}"

# Check for port conflicts
echo -e "${YELLOW}Checking for port conflicts...${NC}"
PORTS_IN_USE=()

for port in 9000 8000 8001 3000 3001; do
    if check_port $port; then
        PORTS_IN_USE+=($port)
    fi
done

if [ ${#PORTS_IN_USE[@]} -gt 0 ]; then
    echo -e "${YELLOW}Ports in use: ${PORTS_IN_USE[*]}${NC}"
    echo -e "${YELLOW}Cleaning up existing processes...${NC}"
    for port in "${PORTS_IN_USE[@]}"; do
        kill_port $port
    done
    sleep 2
fi

# Verify ports are now free
for port in 9000 8000 8001 3000 3001; do
    if check_port $port; then
        echo -e "${RED}Error: Port $port is still in use after cleanup${NC}"
        echo "Please manually stop the process using: lsof -ti:$port | xargs kill"
        exit 1
    fi
done
echo -e "${GREEN}  ✓ All ports are available${NC}"

# Check for required configuration files
echo -e "${YELLOW}Checking configuration files...${NC}"
if [ ! -f "backend/.env.instance_a" ]; then
    echo -e "${RED}Error: backend/.env.instance_a not found${NC}"
    echo "Please create it from backend/.env.instance_a.template"
    exit 1
fi
echo -e "${GREEN}  ✓ backend/.env.instance_a found${NC}"

if [ ! -f "backend/.env.instance_b" ]; then
    echo -e "${RED}Error: backend/.env.instance_b not found${NC}"
    echo "Please create it from backend/.env.instance_b.template"
    exit 1
fi
echo -e "${GREEN}  ✓ backend/.env.instance_b found${NC}"

# Check database migrations
echo -e "${YELLOW}Checking database migrations...${NC}"
cd backend
source venv/bin/activate 2>/dev/null || python3 -m venv venv && source venv/bin/activate

# Quick check if the new columns exist
if python3 -c "import sqlite3; conn = sqlite3.connect('portfolio_user_a.db'); cursor = conn.cursor(); cursor.execute('PRAGMA table_info(positions)'); cols = [row[1] for row in cursor.fetchall()]; exit(0 if 'is_manual_strategy' in cols else 1)" 2>/dev/null; then
    echo -e "${GREEN}  ✓ Database migrations applied${NC}"
else
    echo -e "${YELLOW}  ! Database migrations needed - running now...${NC}"
    python add_strategy_locking.py
fi
cd ..

echo -e "${GREEN}Pre-flight checks passed!${NC}"
echo ""

# Create log directory
mkdir -p logs

# START SERVICES
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

# Wait for collaboration service to be ready
if ! wait_for_service "http://localhost:9000/health" "Collaboration Service"; then
    echo -e "${RED}Check logs/collab-service.log for details${NC}"
    tail -20 logs/collab-service.log
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

echo -e "${YELLOW}[4/7] Starting Backend Instance A (port 8000)...${NC}"
cp .env.instance_a .env
PORT=8000 uvicorn app.main:app --host 0.0.0.0 --port 8000 > ../logs/backend-a.log 2>&1 &
BACKEND_A_PID=$!

# Wait for backend A to be ready
if ! wait_for_service "http://localhost:8000/docs" "Backend A"; then
    echo -e "${RED}Check logs/backend-a.log for details${NC}"
    tail -30 logs/backend-a.log
    exit 1
fi

cd ..

# Setup Instance B
echo -e "${YELLOW}[5/7] Starting Backend Instance B (User B)...${NC}"
cd backend

# Start Instance B with different database
cp .env.instance_b .env
PORT=8001 uvicorn app.main:app --host 0.0.0.0 --port 8001 > ../logs/backend-b.log 2>&1 &
BACKEND_B_PID=$!

# Wait for backend B to be ready
if ! wait_for_service "http://localhost:8001/docs" "Backend B"; then
    echo -e "${RED}Check logs/backend-b.log for details${NC}"
    tail -30 logs/backend-b.log
    exit 1
fi

cd ..

# Setup and start Frontend instances
echo -e "${YELLOW}[6/7] Installing Frontend dependencies...${NC}"
cd frontend
if [ ! -d "node_modules" ]; then
    npm install
fi

echo -e "${YELLOW}[7/7] Starting Frontend instances...${NC}"

# Remove .env.local to ensure runtime detection works
rm -f .env.local

# Start Frontend A (port 3000)
PORT=3000 BROWSER=none npm start > ../logs/frontend-a.log 2>&1 &
FRONTEND_A_PID=$!

# Start Frontend B (port 3001)
PORT=3001 BROWSER=none npm start > ../logs/frontend-b.log 2>&1 &
FRONTEND_B_PID=$!

cd ..

# Wait for frontends to compile and be ready
echo -e "${YELLOW}  Waiting for frontends to compile (this may take 30-60 seconds)...${NC}"
if ! wait_for_service "http://localhost:3000" "Frontend A"; then
    echo -e "${RED}Check logs/frontend-a.log for details${NC}"
    tail -30 logs/frontend-a.log
    exit 1
fi

if ! wait_for_service "http://localhost:3001" "Frontend B"; then
    echo -e "${RED}Check logs/frontend-b.log for details${NC}"
    tail -30 logs/frontend-b.log
    exit 1
fi

# FINAL VERIFICATION
echo ""
echo -e "${YELLOW}Final health check...${NC}"

ALL_HEALTHY=true

verify_process $COLLAB_PID "Collaboration Service" || ALL_HEALTHY=false
verify_process $BACKEND_A_PID "Backend A" || ALL_HEALTHY=false
verify_process $BACKEND_B_PID "Backend B" || ALL_HEALTHY=false
verify_process $FRONTEND_A_PID "Frontend A" || ALL_HEALTHY=false
verify_process $FRONTEND_B_PID "Frontend B" || ALL_HEALTHY=false

if [ "$ALL_HEALTHY" = false ]; then
    echo -e "${RED}Some services failed - check logs/ directory${NC}"
    exit 1
fi

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
echo -e "${BLUE}Process IDs:${NC}"
echo -e "  Collaboration Service: ${COLLAB_PID}"
echo -e "  Backend A: ${BACKEND_A_PID}"
echo -e "  Backend B: ${BACKEND_B_PID}"
echo -e "  Frontend A: ${FRONTEND_A_PID}"
echo -e "  Frontend B: ${FRONTEND_B_PID}"
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

# Monitor processes in a loop
echo -e "${BLUE}Monitoring services... (checking every 10 seconds)${NC}"
while true; do
    sleep 10
    
    # Check if any process has died
    DIED=false
    
    if ! ps -p $COLLAB_PID > /dev/null 2>&1; then
        echo -e "${RED}⚠️  Collaboration Service crashed!${NC}"
        tail -20 logs/collab-service.log
        DIED=true
    fi
    
    if ! ps -p $BACKEND_A_PID > /dev/null 2>&1; then
        echo -e "${RED}⚠️  Backend A crashed!${NC}"
        tail -20 logs/backend-a.log
        DIED=true
    fi
    
    if ! ps -p $BACKEND_B_PID > /dev/null 2>&1; then
        echo -e "${RED}⚠️  Backend B crashed!${NC}"
        tail -20 logs/backend-b.log
        DIED=true
    fi
    
    if ! ps -p $FRONTEND_A_PID > /dev/null 2>&1; then
        echo -e "${RED}⚠️  Frontend A crashed!${NC}"
        tail -20 logs/frontend-a.log
        DIED=true
    fi
    
    if ! ps -p $FRONTEND_B_PID > /dev/null 2>&1; then
        echo -e "${RED}⚠️  Frontend B crashed!${NC}"
        tail -20 logs/frontend-b.log
        DIED=true
    fi
    
    if [ "$DIED" = true ]; then
        echo -e "${RED}One or more services crashed - shutting down${NC}"
        exit 1
    fi
done
