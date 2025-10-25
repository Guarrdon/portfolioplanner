# Portfolio Planner - Architecture Overview

## System Purpose

The Portfolio Planner is a collaborative platform for tracking, planning, and sharing stock and option trading strategies. It integrates with the Schwab API to import real positions while supporting trade idea planning and collaboration features.

## Core Concepts

### Position Flavors

The system manages three distinct types of positions:

1. **Actual Positions** (from Schwab API)
   - Read-only positions synced from user's Schwab brokerage accounts
   - Cannot be edited or modified by users
   - Serve as the foundation for trade planning and collaboration
   - Users select which Schwab accounts to sync

2. **Trade Ideas** (manually created)
   - Prospective positions created by users for planning
   - Fully editable by the creator
   - Can be shared with friends for collaboration
   - Support comments, tags, and rich metadata

3. **Shared Positions** (received from friends)
   - Trade ideas shared by other users
   - Can be viewed and commented on
   - Include synchronization features for updates

### User Model

- **Individual Accounts**: Each user has their own account with authentication
- **Schwab Credentials**: Stored securely per user (OAuth tokens)
- **Multiple Brokerage Accounts**: Users may have multiple Schwab accounts
- **Friend Network**: Users can connect with friends to share trade ideas
- **Privacy First**: API credentials are never shared between users

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     React Frontend                       │
│  - Dashboard (landing page)                             │
│  - Schwab Positions View (read-only)                    │
│  - Trade Ideas Management (full CRUD)                   │
│  - Shared Positions (view + comment)                    │
│  - Account Settings (Schwab integration)                │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP/REST
                     │
┌────────────────────▼────────────────────────────────────┐
│                  Python Backend (FastAPI)                │
│  - Authentication & User Management                      │
│  - Position API (actual/ideas/shared)                   │
│  - Schwab Integration Layer                             │
│  - Account Selection & Sync Configuration               │
│  - Comments & Tags Management                           │
└────────────────────┬────────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
┌─────────▼────────┐  ┌────────▼─────────┐
│   PostgreSQL     │  │   Schwab API     │
│   - User Data    │  │   - Positions    │
│   - Positions    │  │   - Account Data │
│   - Comments     │  │   - Market Data  │
└──────────────────┘  └──────────────────┘
```

## Technology Stack

### Frontend
- **React 18**: Component-based UI framework
- **React Router**: Client-side routing
- **React Query (@tanstack/react-query)**: Server state management
- **Axios**: HTTP client
- **Tailwind CSS**: Utility-first styling
- **Lucide React**: Icon library
- **Context API**: Local state management (user, app settings)

### Backend
- **Python 3.11+**: Core language
- **FastAPI**: Modern async web framework
- **SQLAlchemy**: ORM for database interactions
- **Alembic**: Database migrations
- **Pydantic**: Data validation
- **schwab-py**: Schwab API client library
- **python-jose**: JWT token handling
- **passlib**: Password hashing

### Database
- **PostgreSQL**: Primary data store
- **Redis** (future): Caching layer for Schwab data

### Infrastructure
- **Development**: Local development with hot reload
- **Production** (future): AWS deployment with CI/CD

## Data Flow

### Schwab Position Sync

1. User navigates to "Schwab Positions" view
2. User clicks "Sync Now" button (or first-time auto-sync)
3. Frontend calls `POST /api/positions/sync`
4. Backend:
   - Validates user's Schwab OAuth token
   - Fetches position data from selected accounts
   - Transforms Schwab data to internal format
   - Stores positions with `flavor='actual'` and `read_only=true`
   - Returns position list to frontend
5. Frontend displays positions with read-only badge

### Trade Idea Creation

1. User creates new position via form
2. Frontend calls `POST /api/positions/ideas`
3. Backend:
   - Validates position data
   - Creates position with `flavor='idea'` and `read_only=false`
   - Links to user account
   - Returns created position
4. Frontend updates local state via React Query

### Position Sharing

1. User selects "Share" on a trade idea
2. Frontend shows friend selector modal
3. Frontend calls `POST /api/positions/{id}/share`
4. Backend:
   - Creates shared position record for friend
   - Sets `flavor='shared'` for recipient
   - Notifies friend (future feature)
5. Friend sees position in their "Shared Positions" view

## Security Architecture

### Authentication
- JWT-based authentication for API requests
- HTTP-only cookies for token storage (XSS protection)
- Refresh token rotation
- Session management

### Authorization
- Users can only access their own positions and shared positions
- Schwab credentials stored encrypted in database
- OAuth tokens refreshed automatically before expiration
- RBAC for future admin features

### Data Protection
- Passwords hashed with bcrypt
- Schwab tokens encrypted at rest
- HTTPS only in production
- CORS configured for frontend domain only

## Configuration Management

### Backend Configuration
```
config/
├── settings.py          # Application settings (Pydantic BaseSettings)
├── database.py          # Database connection configuration
├── schwab.py            # Schwab API configuration
└── security.py          # JWT and encryption settings
```

### Environment Variables
```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/portfolio

# Security
SECRET_KEY=<random-secret>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# Schwab API (per user in database)
# Users authenticate via OAuth flow in app
```

### Frontend Configuration
```javascript
// .env or .env.local
REACT_APP_API_URL=http://localhost:8000
```

## Deployment Strategy (Future)

### Development
- Frontend: `npm start` (port 3000)
- Backend: `uvicorn main:app --reload` (port 8000)
- Database: Docker PostgreSQL container

### Production
- Frontend: Static files served via CloudFront CDN
- Backend: ECS Fargate with auto-scaling
- Database: RDS PostgreSQL with automated backups
- Secrets: AWS Secrets Manager
- Monitoring: CloudWatch + custom dashboards

## Schwab Integration Details

### OAuth Flow
1. User clicks "Connect Schwab Account" in settings
2. Backend initiates OAuth flow, redirects to Schwab
3. User authorizes application
4. Schwab redirects to callback with auth code
5. Backend exchanges code for access + refresh tokens
6. Tokens stored encrypted in user's profile

### Token Management
- **Access tokens**: 30-minute lifespan, stored in memory
- **Refresh tokens**: 7-day lifespan, stored encrypted in database
- **Auto-refresh**: Backend automatically refreshes before expiration
- **Token validation**: Check on every Schwab API call

### Account Selection
- Users can have multiple Schwab accounts
- Settings page allows users to:
  - View all linked accounts
  - Select which accounts to sync
  - Configure sync frequency (future)

### Mock Data (Development Phase)
- Mock Schwab API responses for development
- Realistic test data for all position types
- Simulate different account scenarios
- No real API calls until credentials configured

## Phased Implementation

### Phase 1: Foundation (Current)
- ✅ Frontend UI for portfolio management
- ✅ Local storage persistence
- ✅ Trade idea management
- ⏳ Backend setup with database
- ⏳ User authentication
- ⏳ Mock Schwab data integration

### Phase 2: Schwab Integration
- OAuth integration with Schwab
- Real-time position sync
- Account selection functionality
- Error handling and retry logic

### Phase 3: Enhanced Collaboration
- Real-time notifications
- Enhanced sharing features
- Activity feeds
- Performance analytics

### Phase 4: Advanced Features
- Automated trade tracking
- P&L calculations
- Risk analysis
- Portfolio optimization suggestions

## Development Workflow

1. **Feature Branch**: Create branch from `main`
2. **Backend First**: Implement API endpoints with tests
3. **Frontend Integration**: Build UI components
4. **Documentation**: Update relevant docs
5. **Testing**: Manual + automated tests
6. **PR Review**: Code review and approval
7. **Merge**: Squash and merge to `main`
8. **Deploy**: Automatic deployment to staging/production

## Testing Strategy

### Backend
- Unit tests: pytest for business logic
- Integration tests: Test database interactions
- API tests: Test endpoints with TestClient
- Schwab mock: Mock schwab-py library responses

### Frontend
- Component tests: React Testing Library
- Integration tests: Test user flows
- E2E tests (future): Cypress or Playwright

## Performance Considerations

### Caching Strategy
- Cache Schwab position data (5-minute TTL)
- Cache market data (1-minute TTL)
- Redis for distributed caching in production

### Database Optimization
- Indexes on frequently queried fields
- Separate tables for positions, comments, tags
- Soft deletes for audit trail
- Regular vacuum and analyze

### API Rate Limiting
- Schwab API: Respect rate limits (120 calls/minute)
- Internal API: Rate limit per user (future)
- Exponential backoff for retries

## Monitoring & Observability

### Metrics (Future)
- API response times
- Schwab sync success/failure rates
- User activity patterns
- Error rates and types

### Logging
- Structured JSON logging
- Log levels: DEBUG, INFO, WARNING, ERROR
- Sensitive data redaction
- Centralized log aggregation (future)

### Alerts (Future)
- Schwab API failures
- Database connection issues
- High error rates
- Token expiration warnings

## Migration from Local Storage

### Data Migration Tool
- Export current local storage data
- Transform to database schema
- Import via API endpoints
- Validation and error reporting

### Backward Compatibility
- Continue supporting local storage as fallback
- Gradual migration with user consent
- Data sync mechanism during transition

---

**Last Updated**: 2025-10-25
**Document Owner**: Architecture Team
**Review Schedule**: Quarterly or with major changes

