# Manual Strategy Assignment - User Guide

## Overview

You can now manually override automatic strategy detection and assign positions to YOUR preferred strategy categories.

## How to Use (Frontend UI)

### 1. View Your Positions

Navigate to the Schwab Positions screen. You'll see all your synced positions grouped by strategy.

### 2. Change a Position's Strategy

**Two ways to access the editor:**

**Option A: Hover & Click (Easiest)**
1. Hover over any strategy cell in the table
2. A small edit icon (✏️) appears
3. Click the edit icon
4. A dropdown appears with all strategy types
5. Select your desired strategy
6. Position automatically updates and re-groups

**Option B: Direct Click**
1. Click on the strategy cell
2. Dropdown appears
3. Select strategy
4. Auto-saves

### 3. Available Strategy Types

| Strategy Type | When to Use |
|--------------|-------------|
| **Covered Call** | Stock + short call |
| **Vertical Spread** | Bull/bear spreads |
| **Box Spread** | 4-leg arbitrage |
| **Long Stock** | Long equity position |
| **Short Stock** | Short equity position |
| **Big Option** | Large option positions (10+ contracts or $5K+) |
| **Single Option** | Small option positions |
| **Unallocated** | Doesn't fit a pattern yet - assign manually later |

### 4. Your Custom Grouping Strategy

Since you mentioned you have "a particular way" you manage groupings, here's how to implement it:

1. **First Sync**: Let automatic grouping do its best
2. **Review**: Check the Schwab Positions screen
3. **Adjust**: Use the inline editor to reassign positions to YOUR strategy categories
4. **Persist**: Your manual assignments survive re-syncs

**Pro Tip**: For positions that don't fit standard patterns:
- Assign them to "Unallocated" initially
- Later, you can bulk-reassign them to your custom strategies

## Testing with Mock Data

### Managing Mock vs. Real Data

**Edit the config file:**
```bash
nano backend/.env.instance_a
```

**Change this line:**
```bash
# For testing with mock data:
USE_MOCK_SCHWAB_DATA=true

# For real Schwab API:
USE_MOCK_SCHWAB_DATA=false
```

**Restart:**
```bash
pkill -9 -f "node server.js|uvicorn|react-scripts"
bash start-distributed.sh
```

### Clear Data for Fresh Testing

**Run the cleanup script:**
```bash
bash clear-schwab-data.sh
```

**Interactive menu:**
```
Which instance's data do you want to clear?
  1) Instance A (portfolio_user_a.db)
  2) Instance B (portfolio_user_b.db)
  3) Both
  4) Cancel
```

**What it does:**
- ✅ Removes all Schwab accounts
- ✅ Removes all actual positions
- ✅ Preserves trade ideas
- ✅ Preserves shared positions

**After clearing:**
```bash
# Trigger a fresh sync
curl -X POST http://localhost:8000/api/v1/positions/sync

# Or use the UI Sync button
```

## Troubleshooting Missing Positions

If positions (like your NVDA 100 shares) are missing:

### 1. Check the Logs

```bash
# Trigger sync
curl -X POST http://localhost:8000/api/v1/positions/sync

# Check grouping logs
tail -100 logs/backend-a.log | grep -E "GROUPING|Input:|Output:|MISMATCH"
```

### 2. Look for Issues

**Is NVDA in the input?**
```
Input: NVDA | stock | qty=100 | acct=0458
```
If NO → Schwab API filter issue

**Is NVDA in the output?**
```
Output: NVDA | long_stock | legs=1
```
If input but NO output → Grouping bug

**Verification:**
```
✅ All 12 positions accounted for
```
or
```
❌ POSITION MISMATCH: Input=12, Output legs=11
```

### 3. Manual Fix

If a position is grouped incorrectly:
1. Find it in the UI
2. Hover over strategy → click edit
3. Select correct strategy type
4. Done!

## API Usage (Advanced)

### Update Strategy via API

```bash
# Get position ID from UI or API
POSITION_ID="your-position-id-here"

# Update strategy
curl -X PATCH \
  "http://localhost:8000/api/v1/positions/actual/${POSITION_ID}/strategy?strategy_type=covered_call"

# Verify
curl "http://localhost:8000/api/v1/positions/actual" | jq ".positions[] | select(.id==\"${POSITION_ID}\")"
```

### Available via Query Parameter

```
?strategy_type=covered_call
?strategy_type=vertical_spread
?strategy_type=box_spread
?strategy_type=long_stock
?strategy_type=short_stock
?strategy_type=big_option
?strategy_type=single_option
?strategy_type=unallocated
```

## Next Steps

### For Your Specific Workflow

1. **Define Your Strategy Categories**
   - What groupings do YOU want to see?
   - Write them down

2. **Initial Sync**
   - Let automatic grouping run
   - See what it produces

3. **Manual Adjustment**
   - Use the UI editor to reassign positions
   - Build your preferred grouping structure

4. **Iterate**
   - Automatic grouping will improve over time
   - But you always have manual override

### Future Enhancements (If Needed)

1. **Custom Strategy Types**
   - Add your own strategy categories to the dropdown
   - Edit `SchwabPositionsView.jsx` dropdown options

2. **Bulk Reassignment**
   - Select multiple positions
   - Assign to strategy all at once

3. **Strategy Templates**
   - Save common grouping patterns
   - Apply templates to new syncs

## Files Modified

- `backend/app/api/v1/positions.py` - PATCH /actual/{id}/strategy endpoint
- `frontend/src/services/schwab.js` - updatePositionStrategy() function
- `frontend/src/components/schwab/SchwabPositionsView.jsx` - Inline strategy editor
- `backend/app/services/schwab_service.py` - Enhanced logging
- `start-distributed.sh` - Removed hardcoded templates
- `clear-schwab-data.sh` - NEW: Testing utility

## Documentation

- `POSITION_GROUPING_FIXES.md` - Technical details on grouping fixes
- `CONFIGURATION_MANAGEMENT.md` - How to manage settings
- `MANUAL_STRATEGY_ASSIGNMENT.md` - This file (user guide)

