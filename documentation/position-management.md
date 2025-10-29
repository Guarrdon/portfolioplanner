# Position Management System

## Overview

The Position Management System is the core of the Portfolio Planner, handling three distinct types of positions with different lifecycles, permissions, and data sources.

## Position Types

### 1. Actual Positions (Schwab-Synced)

**Source**: Schwab API via user's brokerage account

**Characteristics**:
- Read-only (cannot be edited or deleted by users)
- Refreshed on-demand or scheduled sync
- Multiple accounts per user supported
- Real-time market values from Schwab

**Data Fields**:
```python
{
    "id": "uuid",
    "flavor": "actual",
    "account_id": "schwab_account_hash",
    "account_number": "1234",  # masked for display
    "symbol": "AAPL",
    "underlying": "AAPL",
    "strategy_type": "covered_call",  # derived from position legs
    "quantity": 100,
    "entry_date": "2025-01-15",
    "cost_basis": 15000.00,
    "current_value": 15500.00,
    "unrealized_pnl": 500.00,
    "legs": [  # for options
        {
            "symbol": "AAPL250221C00185000",
            "type": "call",
            "strike": 185.00,
            "expiration": "2025-02-21",
            "quantity": -1,
            "premium": 250.00
        }
    ],
    "last_synced": "2025-10-25T14:30:00Z",
    "read_only": true,
    "created_at": "2025-10-25T14:30:00Z",
    "updated_at": "2025-10-25T14:30:00Z"
}
```

### 2. Trade Idea Positions

**Source**: User-created planning positions

**Characteristics**:
- Full CRUD operations allowed
- Can be shared with friends
- Supports comments and tags
- Can be converted to "actual" after execution (future)

**Data Fields**:
```python
{
    "id": "uuid",
    "flavor": "idea",
    "user_id": "uuid",
    "account_id": null,  # or linked to planned account
    "symbol": "TSLA",
    "underlying": "TSLA",
    "strategy_type": "put_spread",
    "planned_entry_date": "2025-11-01",
    "target_quantity": 10,
    "target_entry_price": 250.00,
    "max_profit": 500.00,
    "max_loss": 1500.00,
    "notes": "Bullish on earnings",
    "tags": ["earnings-play", "high-conviction"],
    "status": "planned",  # planned, watching, executed, cancelled
    "legs": [
        {
            "symbol": "TSLA251107P00245000",
            "type": "put",
            "strike": 245.00,
            "expiration": "2025-11-07",
            "quantity": -10,
            "target_premium": 1.50
        },
        {
            "symbol": "TSLA251107P00240000",
            "type": "put",
            "strike": 240.00,
            "expiration": "2025-11-07",
            "quantity": 10,
            "target_premium": 0.80
        }
    ],
    "read_only": false,
    "shared_with": ["user_id_1", "user_id_2"],
    "comments": [
        {
            "id": "uuid",
            "user_id": "uuid",
            "text": "I like this setup",
            "created_at": "2025-10-25T10:00:00Z"
        }
    ],
    "created_at": "2025-10-25T09:00:00Z",
    "updated_at": "2025-10-25T10:00:00Z"
}
```

### 3. Shared Positions

**Source**: Trade ideas shared by friends

**Characteristics**:
- Read-only for recipients
- Can add comments
- Receives updates when owner modifies
- Can be "cloned" to create own trade idea

**Data Fields**:
Same as Trade Idea, but with additional fields:
```python
{
    "flavor": "shared",
    "original_position_id": "uuid",
    "owner_id": "uuid",
    "shared_by": "friend_name",
    "shared_at": "2025-10-25T12:00:00Z",
    "read_only": true,
    "can_comment": true
}
```

## Strategy Types

The system supports multiple options strategies with specific validation rules:

1. **Covered Call**
   - Long 100 shares + short 1 call
   - Legs: stock + call

2. **Put Spread (Bull Put)**
   - Short put at higher strike + long put at lower strike
   - Legs: 2 puts, same expiration

3. **Call Spread (Bear Call)**
   - Short call at lower strike + long call at higher strike
   - Legs: 2 calls, same expiration

4. **Box Spread**
   - Combination of call spread and put spread
   - Legs: 4 options (2 calls, 2 puts)

5. **Big Option**
   - Single long or short option position
   - Legs: 1 option

6. **Dividend Position**
   - Stock position held for dividend
   - Legs: stock only

7. **Miscellaneous**
   - Any other position type
   - Flexible leg configuration

## Position State Management

### Position Lifecycle

```
Trade Idea:
  PLANNED → WATCHING → EXECUTED → CLOSED
     ↓         ↓
  CANCELLED  CANCELLED

Actual Position:
  ACTIVE → CLOSED (via Schwab sync)

Shared Position:
  ACTIVE → EXPIRED (when owner deletes)
```

### State Transitions

| Current State | Valid Transitions | Trigger |
|--------------|-------------------|---------|
| PLANNED | WATCHING, EXECUTED, CANCELLED | User action |
| WATCHING | EXECUTED, CANCELLED | User action |
| EXECUTED | CLOSED | Manual close |
| ACTIVE | CLOSED | Schwab sync |
| ACTIVE (shared) | EXPIRED | Owner deletion |

## Database Schema

### positions Table
```sql
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flavor VARCHAR(20) NOT NULL CHECK (flavor IN ('actual', 'idea', 'shared')),
    user_id UUID NOT NULL REFERENCES users(id),
    original_position_id UUID REFERENCES positions(id),  -- for shared positions
    
    -- Account info
    account_id VARCHAR(255),  -- Schwab account hash or user account ID
    account_number VARCHAR(50),  -- masked display
    
    -- Position details
    symbol VARCHAR(20) NOT NULL,
    underlying VARCHAR(20) NOT NULL,
    strategy_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    
    -- Quantities and values
    quantity DECIMAL(18, 4),
    cost_basis DECIMAL(18, 2),
    current_value DECIMAL(18, 2),
    unrealized_pnl DECIMAL(18, 2),
    
    -- Planning fields (for trade ideas)
    planned_entry_date DATE,
    target_quantity DECIMAL(18, 4),
    target_entry_price DECIMAL(18, 2),
    max_profit DECIMAL(18, 2),
    max_loss DECIMAL(18, 2),
    
    -- Metadata
    notes TEXT,
    tags TEXT[],  -- PostgreSQL array
    
    -- Timestamps
    entry_date DATE,
    last_synced TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Permissions
    read_only BOOLEAN DEFAULT false,
    
    INDEX idx_user_flavor (user_id, flavor),
    INDEX idx_symbol (symbol),
    INDEX idx_status (status)
);
```

### position_legs Table
```sql
CREATE TABLE position_legs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    
    -- Leg details
    symbol VARCHAR(50),  -- OCC symbol for options
    asset_type VARCHAR(20) NOT NULL,  -- 'stock', 'option'
    
    -- For options
    option_type VARCHAR(10),  -- 'call', 'put'
    strike DECIMAL(18, 2),
    expiration DATE,
    
    -- Quantities and prices
    quantity DECIMAL(18, 4) NOT NULL,
    premium DECIMAL(18, 2),
    current_price DECIMAL(18, 2),
    
    -- For trade ideas
    target_premium DECIMAL(18, 2),
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_position (position_id)
);
```

### position_shares Table
```sql
CREATE TABLE position_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id),
    recipient_id UUID NOT NULL REFERENCES users(id),
    
    shared_at TIMESTAMP DEFAULT NOW(),
    access_level VARCHAR(20) DEFAULT 'view',  -- 'view', 'comment'
    
    UNIQUE (position_id, recipient_id),
    INDEX idx_recipient (recipient_id)
);
```

### comments Table
```sql
CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    
    text TEXT NOT NULL,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_position (position_id),
    INDEX idx_user (user_id)
);
```

## API Endpoints

### Schwab Positions

```
GET    /api/positions/actual
       Get all actual positions for current user
       Query params: account_id, symbol, status

POST   /api/positions/sync
       Trigger sync from Schwab API
       Body: { account_ids?: string[] }  # Optional filter

GET    /api/positions/actual/{id}
       Get specific actual position with full details
```

### Trade Ideas

```
GET    /api/positions/ideas
       Get all trade ideas for current user
       Query params: status, symbol, strategy_type, tags

POST   /api/positions/ideas
       Create new trade idea
       Body: PositionCreate schema

GET    /api/positions/ideas/{id}
       Get specific trade idea

PUT    /api/positions/ideas/{id}
       Update trade idea

DELETE /api/positions/ideas/{id}
       Delete trade idea

POST   /api/positions/ideas/{id}/share
       Share trade idea with friends
       Body: { friend_ids: string[] }

POST   /api/positions/ideas/{id}/clone
       Clone position to create own trade idea
```

### Shared Positions

```
GET    /api/positions/shared
       Get all positions shared with current user
       Query params: owner_id, symbol, strategy_type

GET    /api/positions/shared/{id}
       Get specific shared position
```

### Comments

```
GET    /api/positions/{id}/comments
       Get all comments for a position

POST   /api/positions/{id}/comments
       Add comment to position
       Body: { text: string }

PUT    /api/comments/{id}
       Update comment (owner only)

DELETE /api/comments/{id}
       Delete comment (owner only)
```

## Business Rules

### Position Creation

1. **Actual Positions**:
   - Only created via Schwab sync
   - Cannot be manually created
   - Automatically marked as read_only

2. **Trade Ideas**:
   - Must have valid strategy type
   - Legs must match strategy requirements
   - All monetary fields optional
   - Can be created without execution date

3. **Shared Positions**:
   - Created automatically when owner shares
   - Recipient must be in owner's friend list
   - Duplicate shares prevented (one share per recipient per position)

### Position Updates

1. **Actual Positions**:
   - Only updateable via sync
   - Manual updates rejected
   - Comments and tags allowed (stored separately)

2. **Trade Ideas**:
   - Only owner can update
   - Status transitions validated
   - Legs can be added/removed
   - Shared versions sync automatically

3. **Shared Positions**:
   - Cannot be updated by recipient
   - Comments allowed by recipient
   - Updates from owner propagate automatically

### Position Deletion

1. **Actual Positions**:
   - Soft delete only (marked as deleted)
   - Removed from sync but preserved in history
   - Cannot be hard deleted

2. **Trade Ideas**:
   - Owner can delete anytime
   - Shared versions remain but marked as "expired"
   - Comments preserved for audit

3. **Shared Positions**:
   - Recipient can "remove" from their view (soft delete)
   - Does not affect owner's position

### Sharing Rules

1. Can only share trade ideas (not actual or already-shared positions)
2. Can only share with confirmed friends
3. Owner controls who can access
4. Recipients automatically notified (future)
5. Owner can revoke access anytime

### Comment Rules

1. All position types support comments
2. Comments visible to position owner and all share recipients
3. Users can edit/delete only their own comments
4. Comments preserved when position deleted

## Sync Strategy

### Manual Sync

1. User clicks "Sync Now" button
2. Frontend shows loading indicator
3. Backend fetches from selected accounts
4. New positions created, existing positions updated
5. Positions no longer in Schwab marked as closed
6. Success/error notification shown

### Automatic Sync (Future)

1. Scheduled background job (every 15 minutes)
2. Syncs for users with auto-sync enabled
3. Silent updates with notification on changes
4. Rate limiting to respect Schwab API limits

### Sync Conflict Resolution

1. **Schwab data wins**: Always trust Schwab for actual positions
2. **No manual edits allowed**: Prevents conflicts
3. **Comments preserved**: Even if position changes
4. **Audit trail**: Track sync history

## Performance Optimization

### Caching

```python
# Cache structure
positions_cache = {
    f"user:{user_id}:actual": [...],  # 5 min TTL
    f"user:{user_id}:ideas": [...],   # 30 sec TTL
    f"user:{user_id}:shared": [...],  # 30 sec TTL
    f"position:{position_id}": {...}, # 1 min TTL
}
```

### Database Indexes

- User + flavor composite index for fast filtering
- Symbol index for search
- Status index for active position queries
- Position ID foreign keys for joins

### Query Optimization

- Eager load legs with positions (avoid N+1)
- Paginate large result sets
- Use database-level aggregations for analytics
- Cache frequently accessed positions

## Validation Rules

### Symbol Format
- Stock: 1-5 uppercase letters (e.g., "AAPL", "TSLA")
- Option: OCC format (e.g., "AAPL250221C00185000")

### Date Validation
- Expiration dates must be in future (for new positions)
- Entry dates cannot be in future (for actual positions)
- Planned entry dates unrestricted (for trade ideas)

### Quantity Validation
- Must be numeric
- Can be negative (short positions)
- Cannot be zero
- Decimals allowed (for fractional shares)

### Price Validation
- Must be numeric
- Must be positive
- Two decimal places standard
- Four decimal places for options premiums

### Strategy Validation
Each strategy type has specific leg requirements (see validation rules in code).

## Value Calculation for Different Strategies

### Spread Strategies (Vertical Spread, Box Spread)

For spread strategies, the display value calculation differs from simple positions:

**Backend Storage:**
- `cost_basis`: Net credit received (negative) or debit paid (positive)
- `current_value`: Current market value (typically negative for credit spreads as it represents liability)
- `unrealized_pnl`: `current_value - cost_basis`

**Frontend Display (in Create Trade Idea modal):**
- "Current Value" displays: `cost_basis - current_value`
- This represents the "captured value" or profit available if closing immediately
- For a credit spread where you received $1,595 and it now costs $1,345 to close:
  - Backend: `cost_basis = -1595`, `current_value = -1345`, `unrealized_pnl = 250`
  - Display: "Current Value" = `-1595 - (-1345) = 250` ✓

**Rationale:**
- Spread market values are typically negative (liabilities)
- Showing `cost - value` provides an intuitive representation of position worth
- This matches trader expectations: "What value have I captured from this spread?"

### Other Strategies

For non-spread strategies (stocks, single options, covered calls):
- "Current Value" displays `current_value` directly
- This represents the current market value of the position
- Standard accounting convention applies

---

**Last Updated**: 2025-10-29
**Related Documents**: architecture-overview.md, api-specification.md

