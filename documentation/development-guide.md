# Portfolio Planner - Development Guide

## Quick Start

### Running the Application
```bash
cd /Users/mlyons/Development/Guarrdon/portfolioplanner
./start.sh
```

**Services**:
- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- API Docs: http://localhost:8000/docs

### Key Technologies
- **Frontend**: React 18, Tailwind CSS, React Router, React Query
- **Backend**: FastAPI (Python 3.11), SQLAlchemy, Pydantic
- **Database**: SQLite (dev), PostgreSQL-compatible (prod)
- **External API**: Schwab API via `schwab-py` library

## Current Architecture

### Frontend Structure
```
frontend/src/
├── components/
│   ├── schwab/
│   │   └── SchwabPositionsView.jsx    # Main Schwab positions UI
│   ├── portfolio/                     # Portfolio management
│   ├── strategies/                    # Strategy views
│   └── common/                        # Shared components
├── contexts/                          # React context providers
├── hooks/                             # Custom hooks
└── utils/                             # Helper functions
```

### Backend Structure
```
backend/app/
├── api/v1/
│   └── positions.py                   # Position endpoints
├── models/
│   ├── user.py                        # User & account models
│   └── position.py                    # Position models
├── services/
│   ├── schwab_service.py              # Schwab API integration
│   └── position_service.py            # Position business logic
└── schemas/
    └── position.py                    # API schemas (Pydantic)
```

## Schwab Integration

### Configuration
**File**: `backend/schwab_config.toml`
```toml
consumer_key = "YOUR_KEY"
app_secret = "YOUR_SECRET"
token_path = "schwab_tokens.json"
```

**Environment**: `backend/.env`
```bash
USE_MOCK_SCHWAB_DATA=false  # Set to 'true' for mock data
```

### Token Management
Generate tokens (one-time setup):
```bash
cd backend
python get_schwab_token.py
```

### Sync Process Flow
1. User clicks "Sync" button in UI
2. Frontend calls `POST /api/v1/positions/sync`
3. Backend calls `schwab_service.fetch_account_data()`
4. Schwab API returns account details + positions
5. Backend transforms data and stores in database
6. Frontend refreshes to display updated positions

### Key Data Structures

**Account Balances** (from Schwab API):
```python
current_balances = {
    "cashBalance": 1780.95,           # Cash sweep balance
    "liquidationValue": 6248.95,      # Net liquid value
    "buyingPower": 5936.77,           # Stock BP (with margin)
    "availableFunds": 1781.03,        # Options BP (cash-based)
    "dayTradingBuyingPower": 11119.0, # Day trading BP
    "equity": 5782.95,
    # ... many more fields available
}
```

**Position Data Flow**:
```
Schwab Position (raw)
  → transform_schwab_position()
    → group_positions_by_strategy()
      → Database: Position + PositionLeg
        → API Response
          → Frontend Display
```

## Key Features Implemented

### 1. Account Summary Card
**Location**: `SchwabPositionsView.jsx` (top of screen)

**Displays**:
- Position metrics (Cost, Value, P&L, P&L%)
- Risk metrics (BP Effect, Net Exposure)
- Account balances (Net Liquid, BP, Cash Sweep)

**Smart BP Display Logic**:
```javascript
const bpSame = Math.abs(stockBP - optionsBP) < 0.01;
if (bpSame) {
  // Show single "Buying Power" field
} else {
  // Show "Stock BP" and "Options BP" separately
}
```

### 2. Single-Account View
**Implementation**:
- Dropdown selector in toolbar: `selectedAccount` state
- Filters positions: `filteredPositions = positions.filter(p => p.account_id === selectedAccount)`
- Uses `account_hash` for filtering (security)
- Shows account summary even for empty accounts

### 3. Hash-Based Security
**Why**: Account numbers are masked in position data (`****7628`)

**Solution**:
- Accounts API returns: `account_number` (full) + `account_hash` (unique ID)
- Positions store: `account_number` (masked) + `account_id` (matches hash)
- Frontend filters by: `account_hash` → `account_id`

### 4. Strategy Auto-Detection
**Backend**: `schwab_service.group_positions_by_strategy()`

**Strategies Detected**:
- Covered Calls (long stock + short call)
- Vertical Spreads (bull/bear spreads)
- Box Spreads (4-leg arbitrage)
- Big Options (qty ≥ 10 or cost ≥ $5000)
- Long/Short Stock

### 5. Option Symbol Decoding
**Format**: OCC standard → Human-readable

**Example**:
```
NVDA  251219P00170000  →  NVDA 19DEC25 170 (with purple "P" badge)
```

**Implementation**: `formatOptionSymbol()` in SchwabPositionsView.jsx

## Database Schema

### Key Tables

**user_schwab_accounts**:
```sql
- id (UUID)
- user_id (UUID, FK)
- account_hash (STRING) - Unique identifier
- account_number (STRING) - Masked for display
- account_type (STRING) - MARGIN, CASH, IRA, etc.
- cash_balance (FLOAT)
- liquidation_value (FLOAT)
- buying_power (FLOAT) - Stock BP
- buying_power_options (FLOAT) - Options BP
- sync_enabled (BOOLEAN)
- last_synced (DATETIME)
```

**positions**:
```sql
- id (UUID)
- user_id (UUID, FK)
- account_id (STRING) - Matches account_hash
- account_number (STRING) - Masked
- symbol (STRING)
- underlying (STRING)
- strategy_type (STRING)
- flavor (STRING) - 'actual', 'idea', 'shared'
- quantity (DECIMAL)
- cost_basis (DECIMAL)
- current_value (DECIMAL)
- unrealized_pnl (DECIMAL)
- maintenance_requirement (DECIMAL)
- current_day_pnl (DECIMAL)
- read_only (BOOLEAN)
- ... many more fields
```

**position_legs**:
```sql
- id (UUID)
- position_id (UUID, FK)
- symbol (STRING)
- asset_type (STRING) - 'option', 'stock'
- option_type (STRING) - 'call', 'put'
- strike (DECIMAL)
- expiration (DATE)
- quantity (DECIMAL)
- premium (DECIMAL) - Trade price
- current_price (DECIMAL)
- delta, gamma, theta, vega (DECIMAL) - Greeks
```

## Common Development Tasks

### Adding a New Balance Field

1. **Backend Model** (`backend/app/models/user.py`):
```python
class UserSchwabAccount(Base):
    new_field = Column(Float, default=0.0)
```

2. **Extract from API** (`backend/app/services/schwab_service.py`):
```python
account_info = {
    "new_field": current_balances.get("newFieldName", 0.0)
}
```

3. **Store in DB** (`backend/app/services/position_service.py`):
```python
db_account.new_field = account.get("new_field", 0.0)
```

4. **Expose via API** (`backend/app/api/v1/positions.py`):
```python
accounts=[{
    "new_field": acc.new_field
}]
```

5. **Schema** (`backend/app/schemas/position.py`):
```python
class AccountInfo(BaseModel):
    new_field: Optional[float] = 0.0
```

6. **Database Migration**:
```python
cursor.execute("""
    ALTER TABLE user_schwab_accounts 
    ADD COLUMN new_field REAL DEFAULT 0.0
""")
```

7. **Display in Frontend** (`SchwabPositionsView.jsx`):
```javascript
const newField = selectedAccountInfo?.new_field || 0;
```

### Adding a New Position Metric

1. Extract from Schwab position object
2. Add to `transform_schwab_position()` or `transform_equity_position()`
3. Include in position dictionary
4. Display in UI

### Debugging Schwab API Issues

**View raw API response**:
```python
# In schwab_service.py, add:
print(f"DEBUG: Raw account data: {account_data}")
print(f"DEBUG: Current balances: {current_balances}")
```

**Check backend logs**:
```bash
tail -f backend.log
```

**Test API directly**:
```bash
curl http://localhost:8000/api/v1/positions/actual?status=active
```

## Testing

### Manual Testing Checklist
- [ ] Sync positions successfully
- [ ] Switch between accounts in dropdown
- [ ] Verify balance fields display correctly
- [ ] Check empty account shows summary
- [ ] Reg-T account shows two BP fields
- [ ] Portfolio Margin shows one BP field
- [ ] Expand/collapse positions
- [ ] Verify option symbols decode correctly
- [ ] Check P&L calculations
- [ ] Verify strategy auto-detection

### Mock Data Mode
Set `USE_MOCK_SCHWAB_DATA=true` in `.env` for development without API access.

## Known Limitations & Future Work

### Not Yet Implemented
- [ ] Greeks display (Delta, Theta, Vega)
- [ ] Day Trading Buying Power display
- [ ] OAuth flow in UI (currently uses token file)
- [ ] Automatic token refresh
- [ ] Real-time position updates
- [ ] Position history/tracking
- [ ] Multi-account comparison view
- [ ] Export to CSV/PDF

### Technical Debt
- Frontend could use more unit tests
- Strategy detection could be more sophisticated
- Consider adding position validation rules
- Improve error handling for API failures

## Troubleshooting

### Port Already in Use
The `start.sh` script automatically kills processes on ports 8000 and 3000.

### Database Locked
```bash
# If SQLite database is locked:
rm backend/portfolio.db-journal  # If exists
# Then restart
```

### Token Expired
```bash
cd backend
python get_schwab_token.py
# Follow prompts to generate new token
```

### Positions Not Syncing
1. Check backend logs: `tail -f backend.log`
2. Verify Schwab API credentials in `schwab_config.toml`
3. Ensure token file exists: `ls backend/schwab_tokens.json`
4. Check account sync is enabled in database

## Documentation Files

- **project-capabilities.md**: High-level feature overview
- **schwab-integration.md**: Detailed Schwab API integration docs
- **project-structure.md**: Directory structure and file organization
- **development-guide.md**: This file - practical development guide

## Getting Help

- **Schwab API Docs**: https://developer.schwab.com/
- **FastAPI Docs**: https://fastapi.tiangolo.com/
- **React Query Docs**: https://tanstack.com/query/latest
- **SQLAlchemy Docs**: https://www.sqlalchemy.org/

---

**Last Updated**: 2025-10-29  
**Maintainer**: Development Team
