# Strategy Locking: Visual Flow Diagrams

---

## Flow 1: WITHOUT Strategy Locking (Current Problem)

```
┌──────────────────────────────────────────────────────────────────┐
│ DAY 1: Initial Sync                                              │
└──────────────────────────────────────────────────────────────────┘

Schwab API
    │
    │ [SPY 100 shares + 2 short calls]
    ▼
Auto-Grouping Logic
    │
    │ Detects: "Covered Call"
    ▼
Database
    Position: SPY | Strategy: "covered_call" | is_manual: false
    Key: ("SPY", "abc123", "covered_call")


┌──────────────────────────────────────────────────────────────────┐
│ DAY 2: User Corrects Strategy                                    │
└──────────────────────────────────────────────────────────────────┘

User Action: "This is actually part of my wheel strategy"
    │
    │ Manual Edit → "wheel_strategy"
    ▼
Database (WITHOUT LOCKING)
    Position: SPY | Strategy: "wheel_strategy" | is_manual: false ❌
    Key: ("SPY", "abc123", "wheel_strategy")


┌──────────────────────────────────────────────────────────────────┐
│ DAY 3: Next Sync (PROBLEM!)                                      │
└──────────────────────────────────────────────────────────────────┘

Schwab API
    │
    │ [SPY 100 shares + 2 short calls] (same data)
    ▼
Auto-Grouping Logic
    │
    │ Detects: "Covered Call" (same as Day 1)
    ▼
Sync Matching
    │
    │ Looks for key: ("SPY", "abc123", "covered_call")
    │
    │ ❌ NOT FOUND (exists as "wheel_strategy" now)
    │
    ▼
Database Actions
    1. CREATE new: SPY | Strategy: "covered_call"
    2. CLOSE old:  SPY | Strategy: "wheel_strategy"

Result:
    ✅ Position: SPY | "covered_call" (auto-detected)
    ❌ Position: SPY | "wheel_strategy" (CLOSED - user's choice lost!)
```

---

## Flow 2: WITH Strategy Locking (Solution)

```
┌──────────────────────────────────────────────────────────────────┐
│ DAY 1: Initial Sync                                              │
└──────────────────────────────────────────────────────────────────┘

Schwab API
    │
    │ [SPY 100 shares + 2 short calls]
    ▼
Auto-Grouping Logic
    │
    │ Detects: "Covered Call"
    ▼
Database
    Position: SPY | Strategy: "covered_call" | is_manual: false 🔓
    Auto-Managed Key: ("SPY", "abc123", "covered_call")


┌──────────────────────────────────────────────────────────────────┐
│ DAY 2: User Corrects Strategy                                    │
└──────────────────────────────────────────────────────────────────┘

User Action: "This is actually part of my wheel strategy"
    │
    │ Manual Edit → "wheel_strategy"
    ▼
Database (WITH LOCKING)
    Position: SPY | Strategy: "wheel_strategy" | is_manual: true 🔒
    Manual Lock Key: ("SPY", "abc123")  [no strategy in key!]


┌──────────────────────────────────────────────────────────────────┐
│ DAY 3: Next Sync (SOLUTION WORKS!)                               │
└──────────────────────────────────────────────────────────────────┘

Schwab API
    │
    │ [SPY 100 shares + 2 short calls] (same data)
    ▼
Auto-Grouping Logic
    │
    │ Detects: "Covered Call" (auto-detected)
    ▼
Sync Matching (NEW LOGIC)
    │
    │ Step 1: Check manual locks by ("SPY", "abc123")
    │   └──> ✅ FOUND! Position is locked to "wheel_strategy"
    │
    │ Step 2: UPDATE financial data, PRESERVE strategy
    ▼
Database Actions
    UPDATE: SPY | Strategy: "wheel_strategy" 🔒 (KEPT!)
            Financial data updated
            Legs updated
            Strategy UNCHANGED

Result:
    ✅ Position: SPY | "wheel_strategy" (user's choice preserved!)
    📊 Financial data: Current from Schwab
    🔒 Strategy: Manually assigned (locked)
```

---

## Flow 3: Unlocking a Position

```
┌──────────────────────────────────────────────────────────────────┐
│ User Decides to Use Auto-Detection Again                         │
└──────────────────────────────────────────────────────────────────┘

Current State
    Position: SPY | Strategy: "wheel_strategy" | is_manual: true 🔒

User Action: Clicks unlock button 🔓
    │
    ▼
Database Update
    Position: SPY | Strategy: "wheel_strategy" | is_manual: false 🔓
    (Strategy still "wheel_strategy" but now unlocked)

Next Sync
    │
    │ Step 1: Check manual locks by ("SPY", "abc123")
    │   └──> ❌ NOT FOUND (unlocked)
    │
    │ Step 2: Check auto-managed by ("SPY", "abc123", "covered_call")
    │   └──> ❌ NOT FOUND (different strategy)
    │
    │ Step 3: CREATE new position with auto-detected strategy
    │
    │ Step 4: CLOSE old position (wrong strategy, unlocked)
    ▼
Result
    ✅ Position: SPY | "covered_call" (auto-detected, unlocked)
    ❌ Position: SPY | "wheel_strategy" (closed)
```

---

## Matching Logic Comparison

### Old Logic (WITHOUT Locking)
```python
existing_by_key = {
    (p.symbol, p.account_id, p.strategy_type): p
    for p in existing_positions
}

# Single lookup
position_key = (underlying, account_hash, strategy_type)
existing_pos = existing_by_key.get(position_key)

# ❌ Problem: If user changed strategy, key won't match
```

### New Logic (WITH Locking)
```python
# Two separate lookups
auto_managed = {
    (p.symbol, p.account_id, p.strategy_type): p
    for p in existing_positions
    if not p.is_manual_strategy  # Unlocked positions
}

manual_locked = {
    (p.symbol, p.account_id): p  # NO strategy in key!
    for p in existing_positions
    if p.is_manual_strategy  # Locked positions
}

# Check manual locks FIRST (by symbol + account only)
manual_key = (underlying, account_hash)
locked_position = manual_locked.get(manual_key)

if locked_position:
    # ✅ Update data, preserve strategy
else:
    # Check auto-managed (by symbol + account + strategy)
    auto_key = (underlying, account_hash, strategy_type)
    existing_pos = auto_managed.get(auto_key)
```

---

## Decision Tree: How Sync Handles a Position

```
                        Schwab Position
                              │
                              ▼
                  ┌───────────────────────┐
                  │ Check Manual Locks    │
                  │ by (symbol, account)  │
                  └───────────┬───────────┘
                              │
                ┌─────────────┴─────────────┐
                │                           │
                ▼                           ▼
        🔒 FOUND LOCKED              🔓 NOT LOCKED
                │                           │
                │                           ▼
                │               ┌───────────────────────────┐
                │               │ Check Auto-Managed        │
                │               │ by (symbol, account,      │
                │               │     auto-strategy)        │
                │               └───────────┬───────────────┘
                │                           │
                │               ┌───────────┴───────────┐
                │               │                       │
                │               ▼                       ▼
                │         ✅ FOUND MATCH         ❌ NO MATCH
                │               │                       │
                ▼               ▼                       ▼
        ┌─────────────┐  ┌─────────────┐      ┌─────────────┐
        │   UPDATE    │  │   UPDATE    │      │   CREATE    │
        │  Financial  │  │  Financial  │      │     NEW     │
        │    Data     │  │    Data     │      │  Position   │
        │             │  │             │      │             │
        │  PRESERVE   │  │  KEEP AUTO  │      │  AUTO STRAT │
        │   MANUAL    │  │  STRATEGY   │      │             │
        │  STRATEGY   │  │             │      │             │
        └─────────────┘  └─────────────┘      └─────────────┘
             🔒                🔓                    🔓
```

---

## Multi-Position Example

```
Before Sync:
┌────────────────────────────────────────────────────────────────┐
│ User's Positions in Database                                   │
├────────────────────────────────────────────────────────────────┤
│ 1. SPY  | covered_call    | is_manual: false 🔓               │
│ 2. AAPL | wheel_strategy  | is_manual: true  🔒 (user edited) │
│ 3. TSLA | vertical_spread | is_manual: false 🔓               │
└────────────────────────────────────────────────────────────────┘

Schwab API Returns:
┌────────────────────────────────────────────────────────────────┐
│ Current Positions from Schwab                                  │
├────────────────────────────────────────────────────────────────┤
│ 1. SPY  → Auto-detects as: covered_call                       │
│ 2. AAPL → Auto-detects as: covered_call (not wheel!)          │
│ 3. MSFT → Auto-detects as: long_stock (NEW!)                  │
└────────────────────────────────────────────────────────────────┘
(Note: TSLA position was closed in Schwab)

After Sync:
┌────────────────────────────────────────────────────────────────┐
│ Updated Positions in Database                                  │
├────────────────────────────────────────────────────────────────┤
│ 1. SPY  | covered_call    | is_manual: false 🔓 [UPDATED]     │
│    └─> Matched by (SPY, account, covered_call) - no change    │
│                                                                │
│ 2. AAPL | wheel_strategy  | is_manual: true  🔒 [PRESERVED]   │
│    └─> Matched by (AAPL, account) - locked, kept strategy     │
│        Even though Schwab detected "covered_call"!             │
│                                                                │
│ 3. TSLA | vertical_spread | STATUS: closed [CLOSED]            │
│    └─> Not in Schwab anymore - marked closed                  │
│                                                                │
│ 4. MSFT | long_stock      | is_manual: false 🔓 [NEW]         │
│    └─> New position from Schwab - auto-strategy assigned      │
└────────────────────────────────────────────────────────────────┘
```

---

## UI States

### State 1: Auto-Managed Position (Unlocked)
```
┌─────────────────────────────────────────┐
│ Strategy: Covered Call     [✏️]         │
│                                         │
│ On hover: Show edit icon                │
│ On click: Open dropdown                 │
└─────────────────────────────────────────┘
```

### State 2: Manually Locked Position
```
┌─────────────────────────────────────────┐
│ Strategy: Wheel Strategy 🔒  [✏️][🔓]   │
│                                         │
│ Lock icon always visible                │
│ On hover: Show edit + unlock icons      │
│ Unlock confirms before action           │
└─────────────────────────────────────────┘
```

### State 3: Editing
```
┌─────────────────────────────────────────┐
│ Strategy: [Dropdown ▼]                  │
│           - Covered Call                │
│           - Vertical Spread             │
│           - Box Spread                  │
│           - Wheel Strategy              │
│           - ...                         │
│                                         │
│ On select: Saves + locks automatically  │
│ On blur: Closes dropdown                │
└─────────────────────────────────────────┘
```

---

## Database Schema Evolution

### Before (No Locking)
```sql
CREATE TABLE positions (
    id UUID PRIMARY KEY,
    symbol VARCHAR(20),
    account_id VARCHAR(255),
    strategy_type VARCHAR(50),  -- ⚠️ Can be overwritten on sync
    ...
);
```

### After (With Locking)
```sql
CREATE TABLE positions (
    id UUID PRIMARY KEY,
    symbol VARCHAR(20),
    account_id VARCHAR(255),
    strategy_type VARCHAR(50),
    is_manual_strategy BOOLEAN DEFAULT FALSE,  -- ✅ NEW: Protects strategy
    ...
);
```

---

## Benefits Summary

### For Users
- ✅ Manual strategy assignments are **never lost**
- ✅ Can **override auto-detection** when it's wrong
- ✅ Can **reset to auto-detection** if they change their mind
- ✅ **Visual feedback** (lock icon) shows which strategies are locked
- ✅ Financial data always stays **up-to-date** even when locked

### For System
- ✅ **Backward compatible** (existing positions default to unlocked)
- ✅ **Simple implementation** (single boolean flag)
- ✅ **Clear separation** between auto-managed and user-managed
- ✅ **No data loss** during syncs
- ✅ **Audit trail** (know which strategies were manually set)

---

## Testing Scenarios

### ✅ Scenario 1: Basic Lock
1. Sync position (auto: "covered_call")
2. User changes to "wheel_strategy" (locked)
3. Sync again
4. **Expected:** Still "wheel_strategy" with updated financials

### ✅ Scenario 2: Unlock and Re-sync
1. Position is locked to "wheel_strategy"
2. User unlocks
3. Sync again
4. **Expected:** Switches to auto-detected "covered_call"

### ✅ Scenario 3: Position Closes and Reopens
1. Position locked to "wheel_strategy"
2. Position closes in Schwab (marked closed in DB)
3. Position reopens in Schwab (new trade)
4. **Expected:** Creates new position with auto-detection (old lock doesn't carry over)

### ✅ Scenario 4: Multiple Locks
1. Lock AAPL to "wheel"
2. Lock SPY to "box_spread"
3. Keep TSLA unlocked
4. Sync all
5. **Expected:** AAPL and SPY keep manual strategies, TSLA uses auto-detection

### ✅ Scenario 5: Edit Locked Strategy Again
1. Position locked to "wheel_strategy"
2. User edits again to "iron_condor"
3. **Expected:** Changes to "iron_condor", remains locked

---

**This design ensures manual strategy management works reliably across syncs!** 🎯

