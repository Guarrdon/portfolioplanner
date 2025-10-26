# Portfolio Planner Backend

Python FastAPI backend for the Portfolio Planner application.

## Quick Start

### 1. Setup Environment

```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
source venv/bin/activate  # On macOS/Linux
# or
venv\Scripts\activate  # On Windows

# Install dependencies
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Create a `.env` file in the backend directory:

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/portfolioplanner

# Security (generate with: openssl rand -hex 32)
SECRET_KEY=your-secret-key-here
ENCRYPTION_KEY=your-fernet-key-here

# Application
DEBUG=true
USE_MOCK_SCHWAB_DATA=true

# CORS
CORS_ORIGINS=http://localhost:3000
```

### 3. Setup Database

**Option A: SQLite (Recommended for Development)**

No setup needed! Just set in `.env`:
```bash
DATABASE_URL=sqlite:///./portfolio.db
```

The database file will be created automatically when you start the backend.

**Option B: PostgreSQL (Production/Advanced)**

```bash
# Start PostgreSQL (using Docker)
docker run --name portfolio-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=portfolioplanner \
  -p 5432:5432 \
  -d postgres:14

# Then set in .env:
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/portfolioplanner
```

### 4. Run Application

```bash
# Run with uvicorn
uvicorn app.main:app --reload --port 8000

# Or run directly
python -m app.main
```

The API will be available at:
- API: http://localhost:8000
- Interactive Docs: http://localhost:8000/docs
- Alternative Docs: http://localhost:8000/redoc

## API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login with credentials
- `POST /api/v1/auth/refresh` - Refresh access token

### Positions - Actual (Schwab)
- `GET /api/v1/positions/actual` - Get all Schwab positions
- `POST /api/v1/positions/sync` - Sync from Schwab API
- `GET /api/v1/positions/{id}` - Get specific position

### Positions - Trade Ideas
- `GET /api/v1/positions/ideas` - Get all trade ideas
- `POST /api/v1/positions/ideas` - Create trade idea
- `GET /api/v1/positions/ideas/{id}` - Get specific trade idea
- `PUT /api/v1/positions/ideas/{id}` - Update trade idea
- `DELETE /api/v1/positions/ideas/{id}` - Delete trade idea
- `POST /api/v1/positions/ideas/{id}/share` - Share with friends

### Positions - Shared
- `GET /api/v1/positions/shared` - Get positions shared with you

## Development

### Mock Mode

The backend starts in mock mode by default (`USE_MOCK_SCHWAB_DATA=true`). This allows development without actual Schwab API credentials.

Mock mode provides realistic test data for:
- Covered calls
- Put spreads
- Call spreads
- Long puts
- Dividend stocks

### Project Structure

```
backend/
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── auth.py           # Authentication endpoints
│   │       └── positions.py      # Position endpoints
│   ├── core/
│   │   ├── config.py             # Configuration
│   │   ├── database.py           # Database setup
│   │   └── security.py           # Security utilities
│   ├── models/
│   │   ├── user.py               # User models
│   │   ├── position.py           # Position models
│   │   └── comment.py            # Comment models
│   ├── schemas/
│   │   ├── auth.py               # Auth schemas
│   │   ├── position.py           # Position schemas
│   │   └── user.py               # User schemas
│   ├── services/
│   │   ├── mock_schwab_data.py   # Mock data generator
│   │   ├── schwab_service.py     # Schwab integration
│   │   └── position_service.py   # Position business logic
│   └── main.py                   # FastAPI application
├── requirements.txt
└── README.md
```

### Running Tests

```bash
# Install test dependencies (already in requirements.txt)
# pytest, pytest-asyncio, httpx

# Run tests
pytest

# Run with coverage
pytest --cov=app tests/
```

### Code Quality

```bash
# Format code
black app/

# Sort imports
isort app/

# Lint code
flake8 app/
```

## Database Migrations

```bash
# Initialize Alembic (if not already done)
alembic init alembic

# Create migration
alembic revision --autogenerate -m "Description"

# Apply migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| DATABASE_URL | PostgreSQL connection string | - | Yes |
| SECRET_KEY | JWT secret key | - | Yes |
| ENCRYPTION_KEY | Fernet encryption key | - | Yes |
| DEBUG | Enable debug mode | false | No |
| USE_MOCK_SCHWAB_DATA | Use mock Schwab data | true | No |
| CORS_ORIGINS | Allowed CORS origins | http://localhost:3000 | No |
| LOG_LEVEL | Logging level | INFO | No |

## Production Deployment

For production deployment:

1. Set `DEBUG=false`
2. Set `USE_MOCK_SCHWAB_DATA=false`
3. Configure proper DATABASE_URL
4. Use strong SECRET_KEY and ENCRYPTION_KEY
5. Set appropriate CORS_ORIGINS
6. Use a production WSGI server (gunicorn + uvicorn)

```bash
# Production command
gunicorn app.main:app \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000
```

## Troubleshooting

### Database Connection Error
- Verify PostgreSQL is running
- Check DATABASE_URL is correct
- Ensure database exists

### Import Errors
- Verify virtual environment is activated
- Run `pip install -r requirements.txt`

### Mock Data Not Appearing
- Check `USE_MOCK_SCHWAB_DATA=true` in .env
- Verify no real Schwab credentials configured

## Documentation

See `/documentation` directory for:
- Architecture Overview
- API Specification
- Schwab Integration Guide
- Development Guide

## Support

For issues or questions, refer to the main project documentation.

