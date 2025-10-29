# Schwab API Integration Guide

## Overview

This document details the integration with Charles Schwab's API for retrieving account and position data. The integration uses OAuth 2.0 for authentication and the `schwab-py` Python library for API interactions.

## Authentication Flow

### OAuth 2.0 Setup

The Schwab API uses OAuth 2.0 authorization code flow with PKCE (Proof Key for Code Exchange) for security.

#### Prerequisites
1. Schwab Developer Account
2. Registered Application with Schwab
3. Approved API access
4. Consumer Key and App Secret

#### Initial Authentication

```python
# User initiates connection in app settings
# Backend generates authorization URL
auth_url = f"https://api.schwabapi.com/v1/oauth/authorize"
params = {
    "client_id": SCHWAB_CLIENT_ID,
    "redirect_uri": CALLBACK_URL,
    "scope": "AccountsTrading ReadOnly",
    "response_type": "code"
}

# User is redirected to Schwab
# User authorizes application
# Schwab redirects back with authorization code

# Backend exchanges code for tokens
token_response = requests.post(
    "https://api.schwabapi.com/v1/oauth/token",
    data={
        "grant_type": "authorization_code",
        "code": auth_code,
        "redirect_uri": CALLBACK_URL,
        "client_id": SCHWAB_CLIENT_ID,
        "client_secret": SCHWAB_APP_SECRET
    }
)

# Response contains:
{
    "access_token": "...",      # 30-minute lifespan
    "refresh_token": "...",     # 7-day lifespan
    "token_type": "Bearer",
    "expires_in": 1800,
    "scope": "AccountsTrading ReadOnly"
}
```

### Token Storage

```python
# Database schema
CREATE TABLE user_schwab_credentials (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    access_token TEXT NOT NULL,           -- Encrypted
    refresh_token TEXT NOT NULL,          -- Encrypted
    token_created_at TIMESTAMP NOT NULL,
    token_expires_at TIMESTAMP NOT NULL,
    last_refreshed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (user_id)
);
```

### Token Refresh

```python
# Automatic refresh before expiration
def get_valid_token(user_id):
    creds = get_user_schwab_credentials(user_id)
    
    if creds.token_expires_at - datetime.now() < timedelta(minutes=5):
        # Token expires soon, refresh it
        token_response = requests.post(
            "https://api.schwabapi.com/v1/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": decrypt(creds.refresh_token),
                "client_id": SCHWAB_CLIENT_ID,
                "client_secret": SCHWAB_APP_SECRET
            }
        )
        
        # Update stored tokens
        update_tokens(user_id, token_response.json())
    
    return decrypt(creds.access_token)
```

## Schwab API Integration

### Using schwab-py Library

```python
import schwab
from schwab.auth import client_from_token_file

# Initialize client (handled by our TokenManager)
client = get_schwab_client(user_id)

# Get account numbers
accounts_response = client.get_account_numbers()
accounts = accounts_response.json()

# Get account details with positions
account_hash = accounts[0]['hashValue']
details_response = client.get_account(
    account_hash,
    fields=schwab.client.Client.Account.Fields.POSITIONS
)
account_data = details_response.json()
```

### API Endpoints Used

#### 1. Get Account Numbers
```
GET /accounts/accountNumbers
Returns: List of account hashes and numbers
```

**Response Example**:
```json
[
    {
        "accountNumber": "12345678",
        "hashValue": "E5B3F..."
    }
]
```

#### 2. Get Account Details
```
GET /accounts/{accountHash}?fields=positions
Returns: Account balances, positions, and holdings
```

**Response Example**:
```json
{
    "securitiesAccount": {
        "accountNumber": "12345678",
        "type": "MARGIN",
        "currentBalances": {
            "liquidationValue": 125430.50,
            "equity": 125430.50,
            "cashBalance": 5430.50
        },
        "positions": [
            {
                "instrument": {
                    "assetType": "OPTION",
                    "symbol": "AAPL  250221C00185000",
                    "underlyingSymbol": "AAPL",
                    "putCall": "CALL",
                    "optionExpirationDate": "2025-02-21",
                    "optionMultiplier": 100.0
                },
                "longQuantity": 0.0,
                "shortQuantity": 1.0,
                "averagePrice": 2.50,
                "currentValue": -250.00,
                "marketValue": -250.00
            },
            {
                "instrument": {
                    "assetType": "EQUITY",
                    "symbol": "AAPL"
                },
                "longQuantity": 100.0,
                "averagePrice": 175.50,
                "currentValue": 18500.00,
                "marketValue": 18500.00
            }
        ]
    }
}
```

## Data Transformation

### Position Mapping

The Schwab API returns raw position data that needs transformation to our internal format.

```python
def transform_schwab_position(schwab_position, account_info):
    """
    Transform Schwab API position to our internal format
    """
    instrument = schwab_position.get('instrument', {})
    asset_type = instrument.get('assetType')
    
    if asset_type == 'OPTION':
        return transform_option_position(schwab_position, account_info)
    elif asset_type in ['EQUITY', 'ETF']:
        return transform_equity_position(schwab_position, account_info)
    else:
        # Handle other asset types
        return None

def transform_option_position(schwab_position, account_info):
    instrument = schwab_position['instrument']
    
    # Parse OCC symbol for option details
    symbol = instrument.get('symbol', '').strip()
    underlying = instrument.get('underlyingSymbol')
    put_call = instrument.get('putCall', '').lower()
    expiration = instrument.get('optionExpirationDate')
    strike = extract_strike_from_symbol(symbol)
    
    quantity = (schwab_position.get('longQuantity', 0.0) - 
                schwab_position.get('shortQuantity', 0.0))
    
    market_value = schwab_position.get('marketValue', 0.0)
    average_price = schwab_position.get('averagePrice', 0.0)
    
    return {
        'flavor': 'actual',
        'account_id': account_info['hashValue'],
        'account_number': mask_account_number(account_info['accountNumber']),
        'symbol': symbol,
        'underlying': underlying,
        'asset_type': 'option',
        'option_type': put_call,
        'strike': strike,
        'expiration': expiration,
        'quantity': quantity,
        'cost_basis': abs(quantity) * average_price * 100,
        'current_value': market_value,
        'unrealized_pnl': market_value - (abs(quantity) * average_price * 100),
        'read_only': True,
        'last_synced': datetime.now()
    }
```

### Strategy Detection

When syncing positions, the system attempts to detect option strategies by analyzing position legs.

```python
def detect_strategy(positions_for_underlying):
    """
    Analyze positions for an underlying to detect strategies
    """
    # Group by expiration
    by_expiration = group_by_expiration(positions_for_underlying)
    
    for expiration, positions in by_expiration.items():
        calls = [p for p in positions if p['option_type'] == 'call']
        puts = [p for p in positions if p['option_type'] == 'put']
        stocks = [p for p in positions if p['asset_type'] == 'stock']
        
        # Detect covered call: long stock + short call
        if stocks and calls:
            long_stock = next((s for s in stocks if s['quantity'] > 0), None)
            short_call = next((c for c in calls if c['quantity'] < 0), None)
            
            if long_stock and short_call:
                if abs(short_call['quantity']) * 100 <= long_stock['quantity']:
                    return create_covered_call_position(long_stock, short_call)
        
        # Detect put spread: short put + long put at lower strike
        if len(puts) == 2:
            sorted_puts = sorted(puts, key=lambda p: p['strike'], reverse=True)
            if sorted_puts[0]['quantity'] < 0 and sorted_puts[1]['quantity'] > 0:
                return create_put_spread_position(sorted_puts)
        
        # Detect call spread: short call + long call at higher strike
        if len(calls) == 2:
            sorted_calls = sorted(calls, key=lambda p: p['strike'])
            if sorted_calls[0]['quantity'] < 0 and sorted_calls[1]['quantity'] > 0:
                return create_call_spread_position(sorted_calls)
    
    # No strategy detected, return individual positions
    return positions_for_underlying
```

## Mock Data Implementation

During development (before Schwab API access is granted), the system uses mock data that simulates realistic Schwab API responses.

### Mock Data Generator

```python
# backend/app/services/mock_schwab_data.py

def generate_mock_accounts():
    """Generate mock Schwab account data"""
    return [
        {
            "accountNumber": "12345678",
            "hashValue": "E5B3F89A2C1D4E6F"
        },
        {
            "accountNumber": "87654321",
            "hashValue": "F9C2A8D5E4B6F1A3"
        }
    ]

def generate_mock_positions(account_hash):
    """Generate mock positions for an account"""
    mock_positions = [
        # Covered Call example
        {
            "instrument": {
                "assetType": "EQUITY",
                "symbol": "AAPL"
            },
            "longQuantity": 100.0,
            "shortQuantity": 0.0,
            "averagePrice": 175.50,
            "marketValue": 18500.00
        },
        {
            "instrument": {
                "assetType": "OPTION",
                "symbol": "AAPL  250221C00185000",
                "underlyingSymbol": "AAPL",
                "putCall": "CALL",
                "optionExpirationDate": "2025-02-21",
                "optionMultiplier": 100.0
            },
            "longQuantity": 0.0,
            "shortQuantity": 1.0,
            "averagePrice": 2.50,
            "marketValue": -250.00
        },
        # Put Spread example
        {
            "instrument": {
                "assetType": "OPTION",
                "symbol": "SPY   251114P00570000",
                "underlyingSymbol": "SPY",
                "putCall": "PUT",
                "optionExpirationDate": "2025-11-14",
                "optionMultiplier": 100.0
            },
            "longQuantity": 0.0,
            "shortQuantity": 10.0,
            "averagePrice": 3.50,
            "marketValue": -3500.00
        },
        {
            "instrument": {
                "assetType": "OPTION",
                "symbol": "SPY   251114P00565000",
                "underlyingSymbol": "SPY",
                "putCall": "PUT",
                "optionExpirationDate": "2025-11-14",
                "optionMultiplier": 100.0
            },
            "longQuantity": 10.0,
            "shortQuantity": 0.0,
            "averagePrice": 2.20,
            "marketValue": 2200.00
        }
    ]
    
    return {
        "securitiesAccount": {
            "accountNumber": account_hash[:8],
            "type": "MARGIN",
            "currentBalances": {
                "liquidationValue": 125430.50,
                "equity": 125430.50,
                "cashBalance": 5430.50
            },
            "positions": mock_positions
        }
    }

# Use environment variable to enable mock mode
USE_MOCK_SCHWAB_DATA = os.getenv('USE_MOCK_SCHWAB_DATA', 'true').lower() == 'true'

def get_schwab_client(user_id):
    if USE_MOCK_SCHWAB_DATA:
        return MockSchwabClient()
    else:
        # Return real schwab-py client
        return create_real_schwab_client(user_id)
```

## Account Selection

Users can have multiple Schwab accounts but may only want to sync specific ones.

### Account Configuration

```python
# Database schema
CREATE TABLE user_schwab_accounts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    account_hash VARCHAR(255) NOT NULL,
    account_number VARCHAR(50),
    account_type VARCHAR(50),  # MARGIN, CASH, IRA, etc.
    sync_enabled BOOLEAN DEFAULT true,
    last_synced TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (user_id, account_hash)
);
```

### Settings UI Flow

1. User navigates to Settings > Schwab Integration
2. System displays all linked accounts
3. User toggles sync on/off for each account
4. When sync triggered, only enabled accounts are queried

## Error Handling

### Common Errors

#### 1. Token Expired
```python
class TokenExpiredError(Exception):
    pass

def handle_token_expired(user_id):
    # Attempt refresh
    try:
        refresh_token(user_id)
        return retry_request()
    except RefreshTokenExpired:
        # Refresh token also expired, need re-authentication
        notify_user_reauth_required(user_id)
        raise
```

#### 2. Rate Limiting
```python
# Schwab API limit: 120 requests per minute per account
class RateLimitExceeded(Exception):
    pass

def handle_rate_limit():
    # Implement exponential backoff
    wait_time = min(60, 2 ** attempt_count)
    time.sleep(wait_time)
    return retry_request()
```

#### 3. Network Errors
```python
def sync_with_retry(user_id, max_retries=3):
    for attempt in range(max_retries):
        try:
            return sync_schwab_positions(user_id)
        except NetworkError as e:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)
```

### Error Response Format

```json
{
    "error": "sync_failed",
    "message": "Failed to sync with Schwab API",
    "details": "Token expired. Please re-authenticate.",
    "action_required": "reauth",
    "retry_after": null
}
```

## Performance Considerations

### Caching Strategy

```python
# Cache account data for 5 minutes
@cache(ttl=300)
def get_account_positions(user_id, account_hash):
    client = get_schwab_client(user_id)
    response = client.get_account(account_hash, fields='positions')
    return transform_positions(response.json())
```

### Batch Processing

```python
# Sync multiple accounts in parallel
import asyncio

async def sync_all_accounts(user_id):
    accounts = get_user_enabled_accounts(user_id)
    
    tasks = [
        sync_account_async(user_id, account.account_hash)
        for account in accounts
    ]
    
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return process_sync_results(results)
```

### Rate Limiting

```python
from ratelimit import limits, sleep_and_retry

# Respect Schwab API limits
@sleep_and_retry
@limits(calls=120, period=60)  # 120 calls per minute
def call_schwab_api(endpoint, params):
    return make_request(endpoint, params)
```

## Security Considerations

### Token Encryption

```python
from cryptography.fernet import Fernet

# Use application secret key for encryption
cipher = Fernet(settings.ENCRYPTION_KEY)

def encrypt_token(token: str) -> str:
    return cipher.encrypt(token.encode()).decode()

def decrypt_token(encrypted_token: str) -> str:
    return cipher.decrypt(encrypted_token.encode()).decode()
```

### Secure Storage

- Tokens stored encrypted in database
- Encryption key stored in environment variable (AWS Secrets Manager in production)
- Access tokens never logged
- API responses sanitized before logging

### HTTPS Only

- All Schwab API calls over HTTPS
- Certificate validation enforced
- No token transmission over insecure channels

## Testing

### Mock Schwab Client

```python
class MockSchwabClient:
    def get_account_numbers(self):
        return MockResponse(200, generate_mock_accounts())
    
    def get_account(self, account_hash, fields=None):
        return MockResponse(200, generate_mock_positions(account_hash))

# Use in tests
def test_sync_positions(mock_db):
    with patch('app.services.schwab.get_schwab_client') as mock_client:
        mock_client.return_value = MockSchwabClient()
        
        positions = sync_positions(user_id='test-user')
        
        assert len(positions) > 0
        assert all(p.flavor == 'actual' for p in positions)
```

## Monitoring & Logging

### Key Metrics

- Sync success/failure rate
- API response times
- Token refresh frequency
- Rate limit hits
- Error types and frequency

### Logging

```python
import logging

logger = logging.getLogger('schwab_integration')

# Log sync operations
logger.info(f"Starting sync for user {user_id}, accounts: {account_ids}")
logger.info(f"Synced {len(positions)} positions in {elapsed_time}s")

# Log errors (without sensitive data)
logger.error(f"Sync failed for user {user_id}: {error_type}", exc_info=True)
```

## Schwab Positions User Interface

### Overview

The Schwab Positions screen provides a dense, trading-platform-style interface for viewing and analyzing live positions from Schwab accounts. Designed to handle 100-200+ positions with 1-15 legs each, the interface prioritizes information density while maintaining clarity through intelligent grouping and expansion controls.

### UI Architecture

#### Component Structure
```
SchwabPositionsView.jsx
├── Toolbar (Account selector dropdown, sync button, filters, expansion controls)
├── Loading/Error States
├── Account Summary Card (Top-level, detailed metrics for selected account)
└── Data Grid (Multi-level hierarchical table)
    ├── Strategy Headers (Collapsible, with inline summaries)
    │   ├── Position Rows (Expandable to show legs)
    │   │   └── Leg Detail Rows
    │   └── [More positions...]
    └── Overall Portfolio Summary (Bottom, aggregates all strategies)
```

**Note**: The UI displays **one account at a time** using a dropdown selector. This eliminates cross-account grouping and provides a focused view of each account's positions.

### Visual Hierarchy

The interface uses a multi-level hierarchy to organize positions within a single selected account:

1. **Account Selector** (Dropdown in toolbar)
   - Displays all available accounts
   - Shows account number (e.g., "Account: 10427628")
   - Uses `account_hash` for filtering (not masked account numbers)
   - Filters all data to show only selected account's positions

   2. **Account Summary Card** (White card with gray border, at top)
   - Appears immediately below toolbar, above data grid
   - Multi-column grid layout with labeled metrics
   - Displays: Cost Basis, Current Value, Unrealized P&L, P&L%, Today's P&L, BP Effect, Net Exposure, Net Liquid, Buying Power (smart display), Cash Sweep
   - **Intelligent BP Display**: Automatically shows "Stock BP" + "Options BP" for Reg-T accounts, or single "Buying Power" for Portfolio Margin
   - Position and strategy counts
   - All balance fields populated from live Schwab API data

3. **Strategy Level** (Light gray header, subtle styling)
   - Groups positions by strategy type (covered calls, spreads, etc.)
   - Displays inline summary: Cost, Value, P&L, P&L%
   - Uses non-bold, gray text to avoid visual competition with position data
   - Click to collapse/expand strategy group

4. **Position Rows** (White background, standard table cells)
   - Main data rows with key metrics
   - Click to expand and show legs
   - Displays: Symbol, Strategy, Qty, Cost, Value, P&L, P&L%, Day P&L, DTE, Status

5. **Leg Details** (Light gray background, nested table)
   - Individual option or stock legs
   - Shows: Option name (decoded), Quantity, Trade Price, Current Price, P&L
   - Color-coded badges for Call (blue) / Put (purple)

6. **Overall Portfolio Summary** (Blue gradient header, at bottom)
   - Final row showing total portfolio metrics for selected account
   - Visually distinct with gradient background

### Key Features

#### Multi-State Expansion Control
Button that cycles through 3 expansion states (account-level removed):
- **Collapsed**: Only strategy headers visible
- **Strategies Expanded**: Show positions (legs collapsed) - DEFAULT
- **Fully Expanded**: Show all legs

Icons update to reflect state:
- ChevronRight → ChevronDown → ChevronsDown

#### Account Filtering (Hash-Based)
For security, Schwab account numbers are masked in position data (`****7628`). To enable proper filtering:

**Backend Data Structure**:
- `accounts[]`: Contains full `account_number` and `account_hash` (unique identifier)
- `positions[]`: Contains masked `account_number` and `account_id` (matches `account_hash`)

**Frontend Filtering Logic**:
```javascript
// Account dropdown stores account_hash as value
<option value={account.account_hash}>
  Account: {account.account_number}  // Display full number
</option>

// Filter positions by matching hash to account_id
const filteredPositions = positions.filter(
  p => p.account_id === selectedAccount  // selectedAccount is account_hash
);
```

This approach:
- Displays readable account numbers to users
- Filters using secure hash identifiers
- Works with masked position data
- Maintains consistency across backend and frontend

#### Option Symbol Formatting
OCC symbols are decoded from Schwab format to human-readable format:

**Input**: `NVDA  251219P00170000`  
**Output**: `NVDA 19DEC25 170` (with purple "P" badge)

**Format**:
- Extracts ticker from variable-width OCC format
- Parses 6-digit date (YYMMDD) to `DDMMMYY`
- Extracts 8-digit strike as decimal
- Displays put/call as colored badge (not in text)

#### Signed Cost Basis Calculations

For accurate multi-leg strategy P&L:
```javascript
// Options
if (quantity < 0) {
  // Short: NEGATIVE cost (credit received)
  cost_basis = -(abs(quantity) * average_price * 100)
} else {
  // Long: POSITIVE cost (debit paid)
  cost_basis = abs(quantity) * average_price * 100
}

// Position-level rollup (algebraic sum)
total_cost = sum(leg.cost_basis)  // Preserves signs
total_pnl = total_value - total_cost
```

This ensures spreads show net debit/credit correctly.

#### Strategy Summary Styling

Strategy headers use subtle styling to minimize visual clutter:
- **Background**: `bg-gray-50` (very light)
- **Text**: `font-normal` (not bold), `text-gray-600` (muted)
- **P&L**: Gray color (not green/red) to avoid competing with position data
- **Purpose**: Provide context without overwhelming the actual position data

#### Account Summary Card

Appears at the **top of the view** (below toolbar, above data grid) with comprehensive metrics in a multi-line, bordered card format:

```
┌─────────────────────────────────────────────────────────────┐
│ 💼 Account Summary                                          │
│ 8 positions • 3 strategies                                  │
├─────────────────────────────────────────────────────────────┤
│ COST BASIS │ VALUE    │ P&L      │ P&L%   │ TODAY'S P&L │  │
│ $15,234    │ $16,890  │ +$1,656  │ +10.9% │ +$234       │  │
│ BP EFFECT  │ NET EXP  │ CASH BAL │ NET LIQ│ BP AVAIL    │  │
│ $8,450     │ $12,340  │ Coming   │ Coming │ Coming      │  │
└─────────────────────────────────────────────────────────────┘
```

**Metrics currently displayed**:
- **Cost Basis**: Total investment (absolute value shown)
- **Current Value**: Market value of all positions
- **Unrealized P&L**: Dollar gain/loss (colored)
- **P&L %**: Percentage return (colored)
- **Today's P&L**: Current day's change (blue/orange)
- **BP Effect**: Maintenance/buying power requirement
- **Net Exposure**: Total capital at risk
- **Position Count**: Number of positions in account
- **Strategy Count**: Number of unique strategies

**Account Balance Fields** ✅:
- **Net Liquid**: Total liquidation value (`liquidationValue`)
- **Buying Power**: Intelligent display based on account type
  - **Reg-T accounts**: Shows both "Stock BP" (`buyingPower`) and "Options BP" (`availableFunds`)
  - **Portfolio Margin accounts**: Shows single "Buying Power" (when both values are equal)
- **Cash Sweep**: Available cash in account (`cashBalance`)

**Implementation Details**:
- Backend extracts from Schwab API's `currentBalances` object during sync
- Captures both `buyingPower` (stock margin BP) and `availableFunds` (options cash BP)
- Stored in `UserSchwabAccount` table (`buying_power`, `buying_power_options` columns)
- Frontend automatically detects if values differ:
  - **Same values**: Displays single "Buying Power" field
  - **Different values**: Displays "Stock BP" and "Options BP" separately
- Real-time values updated on each sync operation

### Data Grid Columns

| Column | Width | Description | Color Logic |
|--------|-------|-------------|-------------|
| ↕ | 6 | Expand/collapse chevron | Gray |
| Symbol | 16 | Underlying ticker | Bold gray |
| Strategy | 32 | Strategy type (full name) | Gray |
| Qty | 14 | Total quantity/contracts | Gray |
| Cost | 20 | Cost basis (absolute value) | Gray |
| Value | 20 | Current market value | Bold gray |
| P&L | 20 | Unrealized profit/loss | **Green/Red** |
| P&L % | 14 | Percentage gain/loss | **Green/Red** |
| Day P&L | 18 | Today's change | **Blue/Orange** |
| Δ | 12 | Delta (placeholder) | Gray |
| Θ | 12 | Theta (placeholder) | Gray |
| BP Effect | 16 | Maintenance requirement | Gray |
| Status | 16 | Active/Closed badge | Green/Gray |
| DTE | 16 | Days to expiration | Orange/Gray |
| Legs | 10 | Leg count | Gray |

### Days to Expiration Logic

For positions with multiple expirations (calendar spreads):
```javascript
const getPositionDaysToExpiration = (position) => {
  const optionLegs = position.legs.filter(l => 
    l.asset_type === 'option' && l.expiration
  );
  
  if (optionLegs.length === 0) return null;
  
  // Show SHORTEST expiration (nearest date)
  const daysToExpArray = optionLegs.map(leg => 
    daysUntilExpiration(leg.expiration)
  );
  
  return Math.min(...daysToExpArray);
};
```

Color coding:
- **< 7 days**: Red (urgent)
- **7-30 days**: Orange (warning)
- **> 30 days**: Gray (normal)

### Leg Detail Formatting

When a position is expanded, legs show in a nested table:

```
┌─ NVDA 19DEC25 170 ─ [P] ─────────────────┐
│ Qty: +10    Trade: $4.50    Current: $5.20│
│ P&L: +$700                                 │
└────────────────────────────────────────────┘
```

**Badge Colors**:
- Call: Blue badge with "C"
- Put: Purple badge with "P"

**Trade Price vs Current Price**:
- Trade Price: Original entry price (`averagePrice` from Schwab)
- Current Price: Current market price (calculated from `marketValue / quantity`)

**Leg P&L Calculation**:
```javascript
const legPnL = (current_price - trade_price) 
             * quantity 
             * (asset_type === 'option' ? 100 : 1);
```

### Error Handling & Edge Cases

#### NaN Prevention
```javascript
// Format functions check for NaN/Infinity
const formatCurrency = (value) => {
  if (value === null || value === undefined || 
      isNaN(value) || !isFinite(value)) {
    return '-';
  }
  return formatter.format(value);
};

// Summary calculations validate inputs
const calculateSummary = (positions) => {
  const totals = positions.reduce((acc, pos) => {
    const value = parseFloat(pos.current_value) || 0;
    const cost = parseFloat(pos.cost_basis) || 0;
    const pnl = parseFloat(pos.unrealized_pnl) || 0;
    // ... safe accumulation
  });
};
```

#### Empty States
- **Empty Account**: Shows "📭 No positions in this account" message
- **No Accounts**: Shows loading spinner or "No accounts found"
- **Sync Error**: Displays error message with retry button

#### Timezone Handling
```javascript
// Always add time component to prevent timezone shifts
const expDate = new Date(expirationDate + 'T00:00:00');
```

### Performance Optimizations

#### Virtualization Ready
Structure supports future virtualization for large datasets:
- Fixed row heights
- Predictable structure
- Stateless rendering

#### Efficient State Management
```javascript
// Set-based expansion tracking (O(1) lookups)
const [expandedRows, setExpandedRows] = useState(new Set());
const [collapsedAccounts, setCollapsedAccounts] = useState(new Set());
const [collapsedStrategies, setCollapsedStrategies] = useState(new Set());
```

#### Memoization Candidates
Functions suitable for `useMemo`:
- `calculateSummary()`
- `groupedData` generation
- `formatOptionSymbol()` results

### Responsive Behavior

The interface is optimized for desktop trading environments (1920x1080+):
- Fixed column widths for data alignment
- Horizontal scroll for smaller screens
- Minimum practical width: ~1400px
- Full-screen mode recommended for many positions

### Future Enhancements

#### Immediate (Phase 2)
- ✅ Account selector dropdown implementation - **COMPLETE**
- ✅ Hash-based position filtering - **COMPLETE**
- ✅ **Account balance details from Schwab API** - **COMPLETE**
  - Net Liquid (liquidation value)
  - BP Available (buying power)
  - Cash Sweep (cash balance)
  - Backend extracts from `currentBalances` during sync
  - Stored in database and displayed in account summary card

#### Short-term
- **Greeks**: Delta, Gamma, Theta, Vega (requires Schwab API support or third-party data)
- **IV**: Implied volatility
- **Probability**: Probability of profit calculations
- **Risk/Reward**: Strategy-specific metrics
- **Position Sizing**: % of portfolio

#### Long-term
- **Multi-account comparison view**: Toggle back to see all accounts side-by-side
- **Watchlist integration**: Track symbols without positions
- **Custom grouping**: Group by DTE, P&L, or custom tags
- **Export functionality**: CSV/PDF reports
- **Alerts**: Price, P&L, or Greek-based notifications

## Recent Enhancements (October 2025)

### Account Balance Integration
Successfully implemented comprehensive account balance display with intelligent handling of different account types:

**Backend Implementation**:
- Added `cash_balance`, `liquidation_value`, `buying_power`, `buying_power_options` to `UserSchwabAccount` model
- Extract balance data from Schwab API's `currentBalances` object during sync
- Database stores both stock BP (`buyingPower`) and options BP (`availableFunds`)
- Schema updates in `AccountInfo` Pydantic model to expose all balance fields via API

**Frontend Intelligence**:
- Automatic detection of account type (Reg-T vs Portfolio Margin)
- **Reg-T accounts**: Display separate "Stock BP" and "Options BP" when values differ
- **Portfolio Margin**: Display single "Buying Power" when values are equal (within 1 cent)
- No configuration required - fully automatic based on data

**Balance Fields Displayed**:
1. **Net Liquid**: Total liquidation value (`liquidationValue`)
2. **Stock BP**: Stock buying power with margin leverage (`buyingPower`) - Reg-T only
3. **Options BP**: Cash-based options buying power (`availableFunds`) - Reg-T only  
4. **Buying Power**: Combined display for Portfolio Margin accounts
5. **Cash Sweep**: Available cash balance (`cashBalance`)

### Single-Account View Architecture
Transitioned from multi-account display to focused single-account view:

**Changes**:
- Removed account-level grouping from data grid
- Added account selector dropdown in toolbar
- Account summary card moved to top (always visible)
- Hash-based filtering: `account_hash` → `account_id` matching for security
- Empty account support: Full summary visible even without positions

**Benefits**:
- Cleaner, more focused UI
- Reduced visual complexity
- Better performance with large datasets
- Consistent experience across account types

### Empty Account Handling
Account summary now displays for all accounts regardless of position count:

**Display Logic**:
- Changed condition from `filteredPositions.length > 0` to `selectedAccountInfo`
- Shows all account-level balances (Cash, Net Liquid, BP)
- Position metrics default to $0.00 when no positions exist
- Provides complete financial picture even for new/empty accounts

### Data Flow Architecture

**Sync Process**:
```
Schwab API 
  → Backend: fetch_account_data()
    → Extract currentBalances object
    → Transform to internal format
  → Database: UserSchwabAccount table
    → Store all balance fields
  → API: GET /api/v1/positions/actual
    → Include account balance fields
  → Frontend: SchwabPositionsView
    → Display with intelligent BP logic
```

**Key Files Modified**:
- `backend/app/models/user.py` - Added balance columns
- `backend/app/services/schwab_service.py` - Extract balance fields from API
- `backend/app/services/position_service.py` - Store balances during sync
- `backend/app/api/v1/positions.py` - Include balances in response
- `backend/app/schemas/position.py` - Add balance fields to AccountInfo schema
- `frontend/src/components/schwab/SchwabPositionsView.jsx` - Smart display logic

### Available Schwab Balance Fields
From `currentBalances` object (all captured, not all displayed):
- `cashBalance` ✅ - Displayed as "Cash Sweep"
- `liquidationValue` ✅ - Displayed as "Net Liquid"
- `buyingPower` ✅ - Displayed as "Stock BP" (Reg-T) or "Buying Power" (PM)
- `availableFunds` ✅ - Displayed as "Options BP" (Reg-T only)
- `dayTradingBuyingPower` - Available but not yet displayed
- `equity` - Captured but not displayed
- `maintenanceRequirement` - Aggregated from positions
- Other fields: `sma`, `marginBalance`, `longMarketValue`, `shortMarketValue`, etc.

---

**Last Updated**: 2025-10-29  
**Implementation Status**: Production-ready Schwab integration with full account details.
- ✅ Single-account view with dropdown selector
- ✅ Hash-based position filtering for security
- ✅ Complete account balance integration (Net Liquid, Cash Sweep, Smart BP display)
- ✅ Empty account handling (summary visible without positions)
- ✅ Intelligent Reg-T vs Portfolio Margin detection  
**Related Documents**: architecture-overview.md, position-management.md, project-capabilities.md  
**Schwab API Docs**: https://developer.schwab.com/

