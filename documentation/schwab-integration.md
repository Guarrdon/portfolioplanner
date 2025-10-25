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

---

**Last Updated**: 2025-10-25
**Related Documents**: architecture-overview.md, position-management.md
**Schwab API Docs**: https://developer.schwab.com/

