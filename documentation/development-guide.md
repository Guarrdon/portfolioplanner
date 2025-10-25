# Development Guide

## Getting Started

### Prerequisites

- **Python 3.11+**: Backend runtime
- **Node.js 18+**: Frontend development
- **PostgreSQL 14+**: Database
- **Git**: Version control

### Initial Setup

#### 1. Clone and Navigate

```bash
git clone <repository-url>
cd portfolioplanner
```

#### 2. Backend Setup

```bash
# Navigate to backend
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
# venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# Set database URL, secret key, etc.
```

#### 3. Database Setup

```bash
# Start PostgreSQL (if using Docker)
docker run --name portfolio-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:14

# Run migrations
alembic upgrade head

# Optional: Load seed data
python scripts/seed_data.py
```

#### 4. Frontend Setup

```bash
# Navigate to frontend
cd frontend

# Install dependencies
npm install

# Copy environment template (if exists)
cp .env.example .env.local

# Edit .env.local with your configuration
```

### Running the Application

#### Development Mode

```bash
# Terminal 1 - Backend
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend
npm start
```

Access the application:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Documentation: http://localhost:8000/docs

## Project Structure

```
portfolioplanner/
├── backend/
│   ├── app/
│   │   ├── api/              # API endpoints
│   │   │   ├── v1/
│   │   │   │   ├── auth.py
│   │   │   │   ├── positions.py
│   │   │   │   ├── users.py
│   │   │   │   └── schwab.py
│   │   ├── core/             # Core configuration
│   │   │   ├── config.py
│   │   │   ├── security.py
│   │   │   └── database.py
│   │   ├── models/           # SQLAlchemy models
│   │   │   ├── user.py
│   │   │   ├── position.py
│   │   │   └── comment.py
│   │   ├── schemas/          # Pydantic schemas
│   │   │   ├── position.py
│   │   │   ├── user.py
│   │   │   └── auth.py
│   │   ├── services/         # Business logic
│   │   │   ├── schwab.py
│   │   │   ├── position.py
│   │   │   └── auth.py
│   │   ├── utils/            # Utilities
│   │   │   ├── encryption.py
│   │   │   ├── validators.py
│   │   │   └── helpers.py
│   │   └── main.py           # FastAPI application
│   ├── alembic/              # Database migrations
│   ├── tests/                # Backend tests
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── components/       # React components (existing)
│   │   ├── contexts/         # React contexts (existing)
│   │   ├── hooks/            # Custom hooks
│   │   ├── services/         # API client services
│   │   │   ├── api.js        # Axios configuration
│   │   │   ├── positions.js
│   │   │   ├── auth.js
│   │   │   └── schwab.js
│   │   ├── utils/            # Utilities (existing)
│   │   └── App1.jsx
│   ├── public/
│   └── package.json
├── documentation/            # Project documentation
└── ref/                      # Reference implementations (archived)
```

## Backend Development

### Creating a New API Endpoint

1. **Define Pydantic Schema** (`app/schemas/`)

```python
# app/schemas/position.py
from pydantic import BaseModel
from typing import Optional
from datetime import date

class PositionCreate(BaseModel):
    symbol: str
    strategy_type: str
    quantity: Optional[float]
    notes: Optional[str]
```

2. **Create Service Function** (`app/services/`)

```python
# app/services/position.py
from sqlalchemy.orm import Session
from app.models.position import Position
from app.schemas.position import PositionCreate

def create_position(db: Session, position: PositionCreate, user_id: str):
    db_position = Position(
        **position.dict(),
        user_id=user_id,
        flavor='idea'
    )
    db.add(db_position)
    db.commit()
    db.refresh(db_position)
    return db_position
```

3. **Create API Endpoint** (`app/api/v1/`)

```python
# app/api/v1/positions.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import get_current_user
from app.schemas.position import PositionCreate, PositionResponse
from app.services import position as position_service

router = APIRouter(prefix="/positions", tags=["positions"])

@router.post("/ideas", response_model=PositionResponse)
def create_trade_idea(
    position: PositionCreate,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    return position_service.create_position(db, position, current_user.id)
```

4. **Register Router** (`app/main.py`)

```python
from app.api.v1 import positions

app.include_router(positions.router, prefix="/api/v1")
```

### Database Migrations

```bash
# Create new migration
alembic revision --autogenerate -m "Add new table"

# Review the generated migration file
# Edit if needed: alembic/versions/xxx_add_new_table.py

# Apply migration
alembic upgrade head

# Rollback if needed
alembic downgrade -1
```

### Running Tests

```bash
cd backend

# Run all tests
pytest

# Run specific test file
pytest tests/test_positions.py

# Run with coverage
pytest --cov=app tests/

# Run with output
pytest -v -s
```

## Frontend Development

### Creating a New Component

```jsx
// src/components/schwab/PositionList.jsx
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchActualPositions } from '../../services/schwab';

export const PositionList = () => {
  const { data: positions, isLoading, error } = useQuery({
    queryKey: ['positions', 'actual'],
    queryFn: fetchActualPositions
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div className="space-y-4">
      {positions.map(position => (
        <PositionCard key={position.id} position={position} />
      ))}
    </div>
  );
};
```

### API Service Functions

```javascript
// src/services/schwab.js
import api from './api';

export const fetchActualPositions = async () => {
  const response = await api.get('/positions/actual');
  return response.data;
};

export const syncSchwabPositions = async (accountIds = []) => {
  const response = await api.post('/positions/sync', { account_ids: accountIds });
  return response.data;
};

export const getAccountList = async () => {
  const response = await api.get('/schwab/accounts');
  return response.data;
};
```

### Using React Query

```jsx
// Fetching data
const { data, isLoading, error } = useQuery({
  queryKey: ['key'],
  queryFn: fetchFunction
});

// Mutations
const mutation = useMutation({
  mutationFn: createFunction,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['key'] });
  }
});

// Usage
mutation.mutate(data);
```

## Code Style Guidelines

### Backend (Python)

- Follow PEP 8 style guide
- Use type hints for all functions
- Maximum line length: 100 characters
- Use docstrings for all public functions

```python
def transform_position(raw_data: dict, user_id: str) -> Position:
    """
    Transform raw Schwab data to Position model.
    
    Args:
        raw_data: Raw position data from Schwab API
        user_id: ID of the user who owns the position
        
    Returns:
        Position object ready for database insertion
        
    Raises:
        ValidationError: If raw_data is invalid
    """
    pass
```

- Use black for code formatting: `black app/`
- Use isort for imports: `isort app/`
- Use flake8 for linting: `flake8 app/`

### Frontend (JavaScript/React)

- Use functional components with hooks
- Use arrow functions for callbacks
- Maximum line length: 100 characters
- Use JSDoc comments for complex functions

```javascript
/**
 * Sync positions from Schwab API
 * @param {string[]} accountIds - Optional array of account IDs to sync
 * @returns {Promise<Position[]>} Array of synced positions
 */
export const syncPositions = async (accountIds = []) => {
  // implementation
};
```

- Use Prettier for formatting (configured in package.json)
- Use ESLint for linting (configured in package.json)

### Component Structure

```jsx
// Imports
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

// Component
export const MyComponent = ({ prop1, prop2 }) => {
  // Hooks
  const [state, setState] = useState(null);
  const { data } = useQuery(...);
  
  // Event handlers
  const handleClick = () => {
    // logic
  };
  
  // Effects
  useEffect(() => {
    // side effects
  }, [dependencies]);
  
  // Render helpers (if needed)
  const renderItem = (item) => {
    return <div>{item.name}</div>;
  };
  
  // Return JSX
  return (
    <div className="container">
      {/* content */}
    </div>
  );
};
```

## Environment Configuration

### Backend (.env)

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/portfolio

# Security
SECRET_KEY=your-secret-key-here-generate-with-openssl-rand-hex-32
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# Encryption
ENCRYPTION_KEY=your-encryption-key-here-generate-with-cryptography-fernet

# Schwab API (for mock mode)
USE_MOCK_SCHWAB_DATA=true

# When real Schwab API is ready:
# USE_MOCK_SCHWAB_DATA=false
# SCHWAB_CALLBACK_URL=http://localhost:8000/api/v1/schwab/callback

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:3001

# Logging
LOG_LEVEL=INFO
```

### Frontend (.env.local)

```bash
REACT_APP_API_URL=http://localhost:8000/api/v1
REACT_APP_ENV=development
```

## Debugging

### Backend Debugging

1. **Using print statements**
```python
print(f"Debug: {variable}")
```

2. **Using logging**
```python
import logging
logger = logging.getLogger(__name__)
logger.debug(f"Processing position: {position.id}")
```

3. **Using debugger**
```python
import pdb; pdb.set_trace()
# Or with breakpoint() in Python 3.7+
breakpoint()
```

4. **VS Code debugging** - Add configuration to `.vscode/launch.json`

### Frontend Debugging

1. **Console logging**
```javascript
console.log('Debug:', data);
console.table(positions); // For arrays of objects
```

2. **React DevTools** - Install browser extension

3. **React Query DevTools** - Already configured, press Ctrl+Shift+D

4. **Network tab** - Check API calls in browser DevTools

## Common Tasks

### Adding a New Position Strategy Type

1. Update backend validation
2. Add database migration if needed
3. Update position service
4. Create frontend form component
5. Add to strategy selector
6. Update documentation

### Adding Schwab Data Field

1. Update position model
2. Create migration
3. Update transformation logic in schwab service
4. Update frontend display components
5. Update mock data generator

### Creating Database Seed Data

```python
# scripts/seed_data.py
from app.core.database import SessionLocal
from app.models.user import User

def seed_users():
    db = SessionLocal()
    
    user = User(
        email="test@example.com",
        username="testuser",
        hashed_password="hashed_password_here"
    )
    db.add(user)
    db.commit()
    
seed_users()
```

## Troubleshooting

### Backend won't start

1. Check Python version: `python --version` (should be 3.11+)
2. Check virtual environment is activated
3. Check database is running: `psql -U postgres -l`
4. Check environment variables are set
5. Check for port conflicts: `lsof -i :8000`

### Frontend won't start

1. Check Node version: `node --version` (should be 18+)
2. Delete node_modules and reinstall: `rm -rf node_modules && npm install`
3. Clear npm cache: `npm cache clean --force`
4. Check for port conflicts: `lsof -i :3000`

### Database connection errors

1. Verify PostgreSQL is running
2. Check DATABASE_URL in .env
3. Test connection: `psql $DATABASE_URL`
4. Check firewall rules

### CORS errors

1. Check CORS_ORIGINS in backend .env
2. Verify frontend URL matches
3. Check browser console for specific error
4. Try clearing browser cache

## Git Workflow

### Branch Naming

- Feature: `feature/position-sync`
- Bug fix: `bugfix/fix-auth-error`
- Hotfix: `hotfix/critical-fix`
- Documentation: `docs/update-readme`

### Commit Messages

```
type(scope): subject

body

footer
```

Types: feat, fix, docs, style, refactor, test, chore

Examples:
```
feat(positions): add Schwab position sync

- Implement sync endpoint
- Add mock data generator
- Update frontend to trigger sync

Closes #123
```

### Pull Request Process

1. Create feature branch from `main`
2. Make changes and commit
3. Push branch to remote
4. Create PR with description
5. Address review comments
6. Squash and merge when approved

## Resources

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [React Documentation](https://react.dev/)
- [React Query Documentation](https://tanstack.com/query/latest)
- [SQLAlchemy Documentation](https://docs.sqlalchemy.org/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Schwab API Documentation](https://developer.schwab.com/)

---

**Last Updated**: 2025-10-25
**Maintained By**: Development Team

