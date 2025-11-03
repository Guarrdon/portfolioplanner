# Position Status and Signature Behavior

**Last Updated**: November 3, 2025  
**Related Docs**: [STRATEGY_GROUPS_FIX.md](./STRATEGY_GROUPS_FIX.md), [STRATEGY_LOCKING_DESIGN.md](./STRATEGY_LOCKING_DESIGN.md)

---

## 📋 Overview

This document explains how position status management and signature-based matching work in the Portfolio Planner system, particularly for positions synced from Schwab.

---

## 🔢 Position Status Values

### Available Status Values

| Status | Source | Meaning |
|--------|--------|---------|
| `active` | System | Position currently exists in Schwab account |
| `closed` | System | Position no longer found in Schwab (closed in brokerage) |
| `planned` | User | Trade idea not yet executed |
| `executed` | User | Trade idea that was executed |
| `cancelled` | User | Trade idea that was cancelled |

### Important Notes

1. **Status is NOT from Schwab API** - The Schwab API does not provide a "status" field. We determine status based on sync logic.

2. **"CLS" in Schwab** - If you see "CLS" in your Schwab account, it means "Close" or "Closing transaction" but this is NOT directly mapped to our status field.

3. **Status Updates** - For `actual` positions, status is automatically managed during sync:
   - Present in Schwab data → `active`
   - Missing from Schwab data → `closed`

---

## 🔄 Sync Logic and Status Management

### How Syncing Works

```python
# Simplified sync logic:

1. Fetch current positions from Schwab API
2. Generate signatures for each position
3. Match against existing positions in database:
   - Match by signature (for locked positions)
   - Match by (symbol, account, strategy) for unlocked
4. Update matched positions → status = "active"
5. Mark unmatched positions → status = "closed"
```

### Why Positions Become "Closed"

A position is marked as `closed` when:

1. **Actually closed in Schwab** - You sold, closed, or the option expired
2. **Signature mismatch** (BUG - now fixed) - Old signature algorithm caused false closes
3. **Account changed** - Position moved to different account
4. **Strategy changed** - For unlocked positions, if auto-detection changes significantly

---

## 🔐 Position Signatures

### What is a Position Signature?

A **cryptographic hash** that uniquely identifies a position based on its structural characteristics.

### Purpose

- **Reliably match positions** across syncs
- **Support multiple positions** of the same symbol
- **Enable strategy locking** (manual assignments persist)

### Signature Algorithm (Current - STABLE)

**Included in signature:**
- ✅ Symbol (underlying)
- ✅ Account hash
- ✅ Option strikes (if option)
- ✅ Option expirations (if option)
- ✅ Option types (put/call)
- ✅ Stock quantity RANGE (tiny/small/medium/large) - not exact quantity

**NOT included in signature:**
- ❌ Exact quantities (changes constantly)
- ❌ Prices (average price, current price)
- ❌ Market values
- ❌ P&L values
- ❌ Strategy type (can be manually changed)

### Example Signature Generation

```python
# For a covered call on AAPL:
position_data = {
    "symbol": "AAPL",
    "account": "abc123...",
    "legs": [
        {"asset_type": "stock", "symbol": "AAPL", "quantity": 100},  # Medium range
        {"asset_type": "option", "symbol": "AAPL250117C00195000", 
         "option_type": "call", "strike": 195.0, "expiration": "2025-01-17"}
    ]
}

# Signature includes:
# - symbol:AAPL
# - account:abc123...
# - leg:stock:AAPL:qty_range:medium
# - leg:option:AAPL250117C00195000:call:195.0:2025-01-17

# Hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
```

---

## 🐛 The Signature Bug (FIXED)

### What Was Wrong

**Old Algorithm (BAD):**
```python
# Included in signature:
- quantity (exact value)  # ❌ Changes constantly!
- average_price           # ❌ Changes constantly!
```

**Problem:**
1. User locks position to "unallocated"
2. Signature generated: `abc123...` (based on qty=4.0, price=$75.00)
3. Market moves, Schwab updates data
4. Next sync: New signature `def456...` (based on qty=4.0001, price=$75.10)
5. **Signatures don't match!**
6. System thinks position was closed
7. Position marked as `status="closed"` ❌

**New Algorithm (FIXED):**
```python
# Included in signature:
- option strike/expiration  # ✅ Never changes
- stock quantity RANGE      # ✅ Stable (100 shares = "medium")
# NOT included:
- exact quantity            # ❌ Removed
- prices                    # ❌ Removed
```

### Migration

All existing signatures were regenerated on November 3, 2025:
- **431 signatures** regenerated in main database
- **17 signatures** regenerated in distributed databases

Script: `backend/regenerate_all_signatures.py`

---

## 🔒 Strategy Locking and Status

### How Locking Affects Status

When you manually lock a strategy:

1. **Position is marked as locked** (`is_manual_strategy = True`)
2. **Signature is stored/generated**
3. **On sync:**
   - System looks for matching signature
   - If found → Updates financial data, preserves strategy
   - If not found → Marks as `closed` (position truly gone from Schwab)

### Example: Locked Position Persisting

```
Day 1:
  User locks QQQ to "unallocated"
  → is_manual_strategy = True
  → schwab_position_signature = "e3b0c442..."
  → status = "active"

Day 2 (after market moves):
  Schwab sync fetches new data
  → QQQ position still exists
  → Generate signature: "e3b0c442..." (SAME!)
  → Match found!
  → Update prices/quantities
  → Keep strategy = "unallocated" 🔒
  → Keep status = "active" ✅
```

---

## 📊 Status Filtering in UI

### Default Behavior

Most UI views default to showing **active positions only**:

```javascript
// In frontend
const { data: positions } = useQuery(['positions', 'actual'], () =>
  api.get('/positions/actual?status=active')
);
```

### Viewing All Statuses

To see closed positions:

```bash
# API call
curl 'http://localhost:8000/api/v1/positions/actual?status=closed'

# Or omit status filter to see all
curl 'http://localhost:8000/api/v1/positions/actual'
```

### Status Breakdown

Check current status distribution:

```bash
curl -s 'http://localhost:8000/api/v1/positions/actual?limit=1000' | \
  python3 -c "
import json, sys
from collections import Counter
positions = json.load(sys.stdin)['positions']
statuses = Counter(p['status'] for p in positions)
print('Position Status Breakdown:')
for status, count in statuses.items():
    print(f'  {status}: {count} positions')
print(f'Total: {len(positions)} positions')
"
```

---

## 🧹 Managing Closed Positions

### Option 1: Ignore Them

Closed positions are historical records and can be useful for:
- Performance tracking
- Historical P&L
- Strategy analysis

**Recommendation:** Keep them, just filter them out in the UI.

### Option 2: Delete Them

If closed positions are cluttering your database:

```bash
cd backend
source venv/bin/activate
python << 'EOF'
from app.core.database import engine
from app.models.position import Position
from sqlalchemy.orm import Session

with Session(engine) as db:
    closed = db.query(Position).filter(
        Position.status == "closed",
        Position.flavor == "actual"
    ).all()
    
    print(f"Found {len(closed)} closed positions")
    confirm = input("Delete them? (yes/no): ")
    
    if confirm.lower() == "yes":
        for pos in closed:
            db.delete(pos)
        db.commit()
        print("✅ Deleted all closed positions")
    else:
        print("❌ Cancelled")
EOF
```

### Option 3: Archive Them

Add an `archived` boolean field (future enhancement):
- Keep closed positions in database
- Mark as `archived = True`
- Exclude from default queries
- Still available for historical analysis

---

## 🔍 Debugging Status Issues

### Check if a Position is Truly Closed in Schwab

1. **Log into Schwab** - Verify the position status in your actual account
2. **Check backend logs** - Look for sync messages:
   ```bash
   tail -f logs/backend-a.log | grep "CLOSED\|LOCKED"
   ```
3. **Verify signature** - Check if the signature is being matched:
   ```bash
   curl -s 'http://localhost:8000/api/v1/positions/actual?limit=1000' | \
     python3 -c "import json,sys; [print(f'{p[\"symbol\"]}: {p.get(\"schwab_position_signature\", \"None\")[:16]}...') for p in json.load(sys.stdin)['positions']]"
   ```

### Common Scenarios

**Scenario 1: Position shows "closed" but it's still in Schwab**
- **Likely cause:** Signature mismatch (if before Nov 3, 2025 fix)
- **Solution:** Regenerate signatures using `regenerate_all_signatures.py`

**Scenario 2: Locked position becomes "closed" on sync**
- **Likely cause:** Position was actually closed in Schwab
- **Verify:** Check Schwab account
- **If wrong:** Check logs for signature matching

**Scenario 3: All positions show "closed" after sync**
- **Likely cause:** Sync failed or auth token expired
- **Solution:** Check logs for errors, refresh Schwab token

---

## 📝 Best Practices

### For Position Management

1. **Sync regularly** - But not too frequently (rate limits!)
2. **Lock important strategies** - Prevents auto-detection from changing them
3. **Monitor closed positions** - Verify they're actually closed in Schwab
4. **Filter by status** - Use `status=active` in UI for cleaner views

### For Development

1. **Always generate signatures** - When creating positions programmatically
2. **Test signature stability** - Verify signatures don't change with price updates
3. **Log signature matching** - Include in debug logs for troubleshooting
4. **Handle missing signatures** - Generate on-the-fly if not present

---

## 🧪 Testing Status Behavior

### Test Case 1: Lock and Sync

```bash
# 1. Lock a position
curl -X PATCH 'http://localhost:8000/api/v1/positions/actual/{id}/strategy?strategy_type=unallocated'

# 2. Note the signature
curl 'http://localhost:8000/api/v1/positions/actual/{id}' | grep schwab_position_signature

# 3. Sync from Schwab
curl -X POST 'http://localhost:8000/api/v1/positions/sync'

# 4. Verify position is still active and locked
curl 'http://localhost:8000/api/v1/positions/actual/{id}' | grep -E "status|is_manual_strategy|strategy_type"
```

**Expected:** Position remains `active`, `is_manual_strategy=true`, `strategy_type=unallocated`

### Test Case 2: Close Position in Schwab

```bash
# 1. Note a position ID
curl 'http://localhost:8000/api/v1/positions/actual?limit=1'

# 2. Close that position in Schwab (manually in brokerage)

# 3. Sync
curl -X POST 'http://localhost:8000/api/v1/positions/sync'

# 4. Check status
curl 'http://localhost:8000/api/v1/positions/actual/{id}'
```

**Expected:** Position status changes to `closed`, `exit_date` is set

---

## 🔮 Future Enhancements

### Planned Improvements

1. **Position History** - Track status changes over time
2. **Close Reasons** - Distinguish between expired, sold, assigned, etc.
3. **Status Notifications** - Alert when positions become closed
4. **Signature Validation** - Detect and auto-fix signature mismatches
5. **Archive System** - Formal archiving for closed positions

---

## 📚 Related Documentation

- **[STRATEGY_GROUPS_FIX.md](./STRATEGY_GROUPS_FIX.md)** - Fix for signature stability issue
- **[STRATEGY_LOCKING_DESIGN.md](./STRATEGY_LOCKING_DESIGN.md)** - Strategy locking architecture
- **[MANUAL_STRATEGY_ASSIGNMENT.md](./MANUAL_STRATEGY_ASSIGNMENT.md)** - User guide for strategy management
- **[position-management.md](./position-management.md)** - Core position system documentation

---

## ❓ FAQ

**Q: Does Schwab API provide position status?**  
A: No, we determine status based on whether a position appears in the sync.

**Q: Why do locked positions sometimes become "closed"?**  
A: Before Nov 3, 2025, signatures included prices/quantities which changed constantly. This has been fixed.

**Q: Can I manually set a position status?**  
A: For `actual` positions, no - status is managed by sync. For `trade ideas`, yes.

**Q: Should I delete closed positions?**  
A: Not necessary - they're filtered out by default and useful for historical analysis.

**Q: What happens if I unlock a closed position?**  
A: Nothing automatically - it stays closed until you manually change status or it reappears in Schwab.

---

**Document Version**: 1.0  
**Authors**: Development Team  
**Status**: Current and Active

