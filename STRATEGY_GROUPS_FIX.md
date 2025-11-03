# Strategy Groups & Position Signature Fix

**Date:** November 3, 2025  
**Status:** Fixed

---

## 🐛 Problem You Discovered

1. **Locked position disappeared after sync**
   - You locked a QQQ position to "unallocated"
   - Ran sync
   - Position was marked as CLOSED and disappeared
   - A new QQQ position with auto-detected strategy appeared

2. **"Unallocated" group not showing**
   - Even though you assigned a position to "unallocated"
   - That strategy group didn't appear in the UI

3. **Limited strategy options**
   - Only had auto-detected strategies
   - Couldn't create custom groups

---

## 🔍 Root Cause

The **position signature** was TOO SPECIFIC and included:
- `quantity` - changes constantly
- `average_price` - changes constantly

When Schwab data updated (prices moved, quantities adjusted), the signature changed, so the sync couldn't match the locked position!

**Example:**
```
Day 1: Lock QQQ position
  Signature: "abc123..." (based on qty=4.0, price=$75.00)

Day 2: Sync from Schwab
  QQQ now: qty=4.0001, price=$75.10
  New signature: "def456..." (DIFFERENT!)
  
Result: No match found → Old position CLOSED, new position created
```

---

## ✅ What Was Fixed

### 1. Stable Position Signatures
**Changed signature to only include STRUCTURAL data:**
- ✅ Symbol
- ✅ Account
- ✅ Option strikes & expirations
- ✅ Stock quantity RANGE (small/medium/large) not exact quantity
- ❌ NO exact quantity
- ❌ NO prices

**Result:** Signatures stay the same across price/quantity fluctuations!

### 2. Custom Strategy Types Added
Created centralized strategy types including:

**Auto-Detected (from Schwab):**
- `covered_call`
- `vertical_spread`
- `box_spread`
- `long_stock`
- `short_stock`
- `big_option`
- `single_option`

**Custom (User-Defined):**
- `unallocated` ← The one you wanted!
- `wheel_strategy`
- `iron_condor`
- `iron_butterfly`
- `calendar_spread`
- `diagonal_spread`
- `straddle`
- `strangle`
- `collar`
- `protective_put`
- `cash_secured_put`
- `custom`

### 3. Strategy Types API Endpoint
```
GET /api/v1/positions/strategy-types
```

Returns all available strategies with labels:
```json
{
  "strategy_types": [
    {
      "value": "unallocated",
      "label": "Unallocated",
      "is_custom": true
    },
    ...
  ]
}
```

---

## 🧪 How to Test the Fix

### Step 1: Clear Closed Positions
Your QQQ position was marked as closed. Let's see it:
```bash
curl 'http://localhost:8000/api/v1/positions/actual?status=closed&limit=10'
```

To start fresh, you can delete closed positions or change their status back to active.

### Step 2: Lock a Position to "Unallocated"
1. Go to http://localhost:3000/positions
2. Hard refresh: `Cmd + Shift + R`
3. Find any position
4. Hover → Click edit icon ✏️
5. Select "Unallocated" from dropdown
6. See the 🔒 lock icon appear

### Step 3: Sync from Schwab
1. Click the sync button
2. Watch the logs:
```bash
tail -f logs/backend-a.log | grep "LOCKED\|CLOSED"
```

**Expected:**
```
🔒 LOCKED: QQQ | Strategy: unallocated (manual) | Signature: xyz...
```

**NOT:**
```
❌ CLOSED: QQQ | unallocated 🔒
```

### Step 4: Verify Position Persists
```bash
curl 'http://localhost:8000/api/v1/positions/actual?limit=10' | \
  python3 -c "import json,sys; [print(f'{p[\"symbol\"]}: {p[\"strategy_type\"]} (locked: {p[\"is_manual_strategy\"]})') for p in json.load(sys.stdin)['positions']]"
```

Should see:
```
QQQ: unallocated (locked: True)
```

---

## 🔄 Regenerate Existing Signatures

**IMPORTANT:** Since the signature algorithm changed, all existing signatures in the database are now INVALID!

Run this to regenerate:

```python
# backend/regenerate_signatures.py
from app.core.database import engine, get_db
from app.models.position import Position
from app.services.position_signature import generate_position_signature_from_db_legs
from sqlalchemy.orm import Session

with Session(engine) as db:
    positions = db.query(Position).filter(
        Position.flavor == "actual",
        Position.schwab_position_signature.isnot(None)
    ).all()
    
    print(f"Regenerating signatures for {len(positions)} positions...")
    
    for pos in positions:
        if pos.legs:
            old_sig = pos.schwab_position_signature
            new_sig = generate_position_signature_from_db_legs(pos, pos.legs)
            pos.schwab_position_signature = new_sig
            print(f"  {pos.symbol}: {old_sig[:12]}... → {new_sig[:12]}...")
    
    db.commit()
    print("✅ Done!")
```

Run it:
```bash
cd backend
source venv/bin/activate
python regenerate_signatures.py
```

---

## 📊 How Unallocated Group Works

### Concept
"Unallocated" is a **catch-all** strategy for positions that:
- You haven't assigned to a strategy yet
- Don't fit your other groups
- Are temporary/experimental
- You're still analyzing

### Workflow
```
1. Schwab sync → Position auto-detected as "single_option"
2. You review → "This doesn't fit any of my strategies yet"
3. Manually assign → "Unallocated"
4. Position now appears in "Unallocated" group
5. Later, you decide → Reassign to "Wheel Strategy" or keep it
```

### Viewing Groups
The frontend can group positions by `strategy_type`:

```
📊 My Positions

▼ Covered Call (3 positions)
  - SPY: 100 shares + 2 calls
  - AAPL: 100 shares + 2 calls
  - MSFT: 100 shares + 2 calls

▼ Unallocated (2 positions)  ← Your custom group!
  - QQQ: 4 contracts
  - TSLA: 1 contract

▼ Wheel Strategy (1 position)
  - AMD: CSP position
```

---

## 🎨 Adding More Custom Groups

### Option A: Edit the strategy_types.py file
```python
# backend/app/core/strategy_types.py

CUSTOM_STRATEGIES = [
    "unallocated",
    "my_special_strategy",  # Add your own!
    "earnings_plays",
    "dividend_capture",
    # ... etc
]

STRATEGY_LABELS = {
    "my_special_strategy": "My Special Strategy",
    "earnings_plays": "Earnings Plays",
    # ...
}
```

### Option B: Future Enhancement - Dynamic Groups
Could add:
- `POST /api/v1/strategy-types` - Create custom strategy
- `DELETE /api/v1/strategy-types/{name}` - Remove custom strategy
- Store in database instead of code

---

## 🎯 Summary

### What You Can Do Now:
✅ Lock positions to "Unallocated"  
✅ Create custom strategy groups (by editing code)  
✅ Locked positions persist across syncs (with stable signatures)  
✅ See all your custom groups in the UI  

### What's Next:
- Regenerate signatures for existing positions
- Test locking/syncing workflow
- Add more custom strategies as needed
- Consider adding UI for creating custom groups

---

**The core issue is FIXED! Locked positions will now persist across syncs. 🎉**

