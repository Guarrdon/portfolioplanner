# Portfolio Planner

A collaborative platform for tracking, planning, and sharing stock and option trading strategies with Schwab API integration.

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- Database: SQLite (built-in) or PostgreSQL 14+ (optional)

### Installation & Startup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd portfolioplanner
   ```

2. **Run the startup script**
   ```bash
   ./start.sh
   ```

   The script will:
   - ✓ Check dependencies
   - ✓ Set up Python virtual environment
   - ✓ Install backend dependencies
   - ✓ Install frontend dependencies
   - ✓ Create configuration files
   - ✓ Start backend (port 8000)
   - ✓ Start frontend (port 3000)

3. **Configure environment (first time)**

   If the script prompts you to configure `.env`:
   
   ```bash
   # Edit backend/.env
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/portfolioplanner
   SECRET_KEY=<generate with: openssl rand -hex 32>
   ENCRYPTION_KEY=<generate with Python Fernet.generate_key()>
   USE_MOCK_SCHWAB_DATA=true
   ```

   Then run `./start.sh` again.

4. **Access the application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Documentation: http://localhost:8000/docs

## Features

### Position Management
- **Actual Positions**: Real positions synced from Schwab API (read-only)
- **Trade Ideas**: User-created planning positions (fully editable)
- **Shared Positions**: Trade ideas shared by friends (view + comment)

### Strategy Support
- Covered Calls
- Put/Call Spreads
- Box Spreads
- Big Options
- Dividend Positions
- Miscellaneous Positions

### Collaboration
- Share trade ideas with friends
- Comment on positions
- Track activity and changes
- Friend management

### Analytics
- Portfolio analytics dashboard
- Calendar view for events
- Concentration analysis
- Performance tracking

## Development

### Project Structure

```
portfolioplanner/
├── backend/           # Python FastAPI backend
│   ├── app/
│   │   ├── api/      # REST API endpoints
│   │   ├── models/   # Database models
│   │   ├── services/ # Business logic
│   │   └── core/     # Configuration
│   └── requirements.txt
├── frontend/          # React frontend
│   ├── src/
│   │   ├── components/
│   │   ├── services/
│   │   └── contexts/
│   └── package.json
└── documentation/     # Project documentation
```

### Manual Setup

If you prefer manual setup instead of using `start.sh`:

#### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your configuration
uvicorn app.main:app --reload
```

#### Frontend
```bash
cd frontend
npm install
echo "REACT_APP_API_URL=http://localhost:8000/api/v1" > .env.local
npm start
```

### Database Setup

**SQLite (Default - No Setup Needed)**

The database file is created automatically. Just use in `.env`:
```bash
DATABASE_URL=sqlite:///./portfolio.db
```

**PostgreSQL (Optional)**

Only needed if you want PostgreSQL features:
```bash
# Using Docker
docker run --name portfolio-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=portfolioplanner \
  -p 5432:5432 \
  -d postgres:14

# Update .env:
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/portfolioplanner
```

### Mock Data Mode

The application includes a mock data mode for development without real Schwab API access:

- Set `USE_MOCK_SCHWAB_DATA=true` in `backend/.env`
- Mock data includes realistic positions (covered calls, spreads, etc.)
- No Schwab credentials required
- Perfect for testing and development

## Documentation

Comprehensive documentation is available in the `/documentation` directory:

- **[README.md](documentation/README.md)** - Documentation index
- **[architecture-overview.md](documentation/architecture-overview.md)** - System architecture
- **[position-management.md](documentation/position-management.md)** - Position system design
- **[schwab-integration.md](documentation/schwab-integration.md)** - Schwab API integration
- **[development-guide.md](documentation/development-guide.md)** - Development workflows
- **[implementation-summary.md](documentation/implementation-summary.md)** - Current status

## Technology Stack

### Backend
- Python 3.11+
- FastAPI (async web framework)
- SQLAlchemy (ORM)
- PostgreSQL (database)
- JWT authentication
- schwab-py (API client)

### Frontend
- React 18
- React Router
- React Query
- Axios
- Tailwind CSS
- Lucide React (icons)

## Current Status

**Phase 1: Foundation** ✅ Complete
- Backend API with mock data
- Frontend integration
- Documentation
- Authentication and security

**Phase 2: Schwab Integration** 📋 Planned
- Real Schwab OAuth flow
- Live position syncing
- Token management

See [implementation-summary.md](documentation/implementation-summary.md) for detailed status.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Update documentation
6. Submit a pull request

## Support

- **Documentation**: See `/documentation` directory
- **Issues**: Use GitHub Issues
- **Questions**: Contact the development team

## License

[Your License Here]

---

**Quick Commands**

```bash
# Start everything
./start.sh

# Backend only
cd backend && source venv/bin/activate && uvicorn app.main:app --reload

# Frontend only
cd frontend && npm start

# View logs
tail -f backend.log
tail -f frontend.log

# Run tests
cd backend && pytest
cd frontend && npm test
```

