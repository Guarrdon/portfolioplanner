#!/bin/bash
# Portfolio Planner - Startup Script
# Starts both backend and frontend in development mode

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[Portfolio Planner]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if running from project root
if [ ! -f "start.sh" ]; then
    print_error "Please run this script from the project root directory"
    exit 1
fi

print_status "Starting Portfolio Planner..."
echo ""

# Check dependencies
print_status "Checking dependencies..."

# Check Python
if ! command -v python3 &> /dev/null; then
    print_error "Python 3 is not installed. Please install Python 3.11+"
    exit 1
fi
PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
print_status "✓ Python $PYTHON_VERSION"

# Check Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18+"
    exit 1
fi
NODE_VERSION=$(node --version)
print_status "✓ Node.js $NODE_VERSION"

# Check database (optional info)
if command -v psql &> /dev/null; then
    print_status "✓ PostgreSQL found (can use PostgreSQL)"
else
    print_status "ℹ Using SQLite (no external database needed)"
fi

echo ""

# Backend setup
print_status "Setting up backend..."

cd backend

# Check if venv exists
if [ ! -d "venv" ]; then
    print_status "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate venv
print_status "Activating virtual environment..."
source venv/bin/activate

# Check if requirements are installed
if [ ! -f "venv/.installed" ]; then
    print_status "Installing Python dependencies..."
    pip install -r requirements.txt > /dev/null
    touch venv/.installed
    print_status "✓ Dependencies installed"
else
    print_status "✓ Dependencies already installed"
fi

# Check for .env file
if [ ! -f ".env" ]; then
    print_warning ".env file not found in backend/"
    
    if [ -f ".env.template" ]; then
        print_status "Creating .env from .env.template..."
        cp .env.template .env
        
        # Generate SECRET_KEY
        if command -v openssl &> /dev/null; then
            SECRET_KEY=$(openssl rand -hex 32)
            sed -i.bak "s/your-secret-key-here-generate-with-openssl-rand-hex-32/$SECRET_KEY/" .env
            rm .env.bak 2>/dev/null || true
            print_status "✓ Generated SECRET_KEY"
        else
            print_warning "openssl not found - please manually set SECRET_KEY in backend/.env"
        fi
        
        # Generate ENCRYPTION_KEY (simple fallback)
        ENCRYPTION_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>/dev/null || echo "your-fernet-key-here")
        if [ "$ENCRYPTION_KEY" != "your-fernet-key-here" ]; then
            sed -i.bak "s|your-fernet-key-here|$ENCRYPTION_KEY|" .env
            rm .env.bak 2>/dev/null || true
            print_status "✓ Generated ENCRYPTION_KEY"
        else
            print_warning "Please manually set ENCRYPTION_KEY in backend/.env"
        fi
        
        print_status "✓ Created .env with SQLite database (no external database needed)"
    else
        print_error ".env.template not found"
        exit 1
    fi
else
    print_status "✓ .env file found"
fi

cd ..

# Frontend setup
print_status "Setting up frontend..."

cd frontend

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    print_status "Installing Node.js dependencies..."
    npm install > /dev/null 2>&1
    print_status "✓ Dependencies installed"
else
    print_status "✓ Dependencies already installed"
fi

# Check for .env.local
if [ ! -f ".env.local" ]; then
    print_warning ".env.local not found. Creating with defaults..."
    echo "REACT_APP_API_URL=http://localhost:8000/api/v1" > .env.local
    print_status "✓ Created .env.local with default API URL"
fi

cd ..

echo ""
print_status "Starting services..."
echo ""

# Check and free up ports if needed
print_status "Checking if ports are available..."

# Check port 8000 (backend)
if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    print_warning "Port 8000 is in use. Stopping existing process..."
    lsof -ti:8000 | xargs kill -9 2>/dev/null
    sleep 1
    print_status "✓ Port 8000 freed"
else
    print_status "✓ Port 8000 is available"
fi

# Check port 3000 (frontend)
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    print_warning "Port 3000 is in use. Stopping existing process..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null
    sleep 1
    print_status "✓ Port 3000 freed"
else
    print_status "✓ Port 3000 is available"
fi

echo ""

# Function to cleanup background processes on exit
cleanup() {
    echo ""
    print_status "Shutting down services..."
    
    # Kill backend
    if [ ! -z "$BACKEND_PID" ] && ps -p $BACKEND_PID > /dev/null 2>&1; then
        kill $BACKEND_PID 2>/dev/null
    fi
    
    # Kill frontend
    if [ ! -z "$FRONTEND_PID" ] && ps -p $FRONTEND_PID > /dev/null 2>&1; then
        kill $FRONTEND_PID 2>/dev/null
    fi
    
    # Cleanup any remaining processes on these ports
    lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    
    exit
}

trap cleanup EXIT INT TERM

# Start backend
print_status "Starting backend on http://localhost:8000..."
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000 > ../backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# Wait a moment for backend to start
sleep 2

# Check if backend started successfully
if ! ps -p $BACKEND_PID > /dev/null; then
    print_error "Backend failed to start. Check backend.log for details"
    cat backend.log
    exit 1
fi

print_status "✓ Backend started (PID: $BACKEND_PID)"

# Start frontend
print_status "Starting frontend on http://localhost:3000..."
cd frontend
BROWSER=none npm start > ../frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..

# Wait a moment for frontend to start
sleep 3

# Check if frontend started successfully
if ! ps -p $FRONTEND_PID > /dev/null; then
    print_error "Frontend failed to start. Check frontend.log for details"
    cat frontend.log
    exit 1
fi

print_status "✓ Frontend started (PID: $FRONTEND_PID)"

echo ""
print_status "${GREEN}================================${NC}"
print_status "${GREEN}Portfolio Planner is running!${NC}"
print_status "${GREEN}================================${NC}"
echo ""
print_status "Frontend:  ${BLUE}http://localhost:3000${NC}"
print_status "Backend:   ${BLUE}http://localhost:8000${NC}"
print_status "API Docs:  ${BLUE}http://localhost:8000/docs${NC}"
echo ""
print_status "Logs:"
print_status "  Backend:  tail -f backend.log"
print_status "  Frontend: tail -f frontend.log"
echo ""
print_status "Press Ctrl+C to stop all services"
echo ""

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID

