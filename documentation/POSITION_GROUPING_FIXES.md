# Position Grouping & Manual Strategy Assignment - Implementation Summary

## Issues Identified

1. **Missing Positions**: Some positions (like NVDA 100 shares in account 0458) weren't appearing
2. **Poor Automatic Grouping**: Automatic strategy detection was too aggressive
3. **No Manual Override**: No way to manually assign positions to preferred strategies

## Changes Implemented

### 1. Enhanced Logging (`schwab_service.py`)

Added comprehensive logging to track every position through the grouping process:

```python
# Input logging
logger.info(f"=== GROUPING POSITIONS: {len(positions)} input positions ===")
for pos in positions:
    logger.info(f"  Input: {pos['underlying']} | {pos['asset_type']} | qty={pos['quantity']}")

# Output logging  
logger.info(f"=== GROUPED OUTPUT: {len(result_positions)} grouped positions ===")

# Verification
if input_count != output_leg_count:
    logger.error(f"❌ POSITION MISMATCH: Input={input_count}, Output legs={output_leg_count}")
```

**Purpose**: See exactly which positions are being processed and detect if any are being dropped.

### 2. Account-Aware Grouping

Changed grouping logic to keep positions from different accounts separate:

```python
# OLD: Grouped only by underlying symbol
by_underlying = {}

# NEW: Groups by (underlying, account_hash)
by_underlying_account = {}
for pos in positions:
    key = (underlying, account_hash)
    by_underlying_account[key].append(pos)
```

**Purpose**: Prevents positions from different accounts from being incorrectly grouped together.

### 3. Manual Strategy Assignment API

Added new endpoint: `PATCH /api/v1/positions/actual/{position_id}/strategy`

```bash
# Example usage
curl -X PATCH "http://localhost:8000/api/v1/positions/actual/{id}/strategy?strategy_type=covered_call"
```

**Purpose**: Allows users to override automatic detection and manually assign strategies.

## Next Steps - TODO

### ✅ Completed
- Enhanced logging to track position flow
- Account-aware grouping 
- Manual strategy assignment API endpoint

### 🔄 Remaining Tasks

1. **Test with Mock Data**
   - Restart backend with `USE_MOCK_SCHWAB_DATA=true`
   - Trigger sync and check logs for the logging output
   - Verify NVDA position (and others) appear in output
   
2. **Add "Unallocated" Strategy Type**
   - For positions that don't match any known pattern
   - User can then manually assign from frontend
   
3. **Frontend UI for Manual Assignment**
   - Add dropdown/select in position card to change strategy
   - Call the new PATCH endpoint when user selects a strategy
   - Refresh position list after update

## Testing Instructions

### Check Logs for Position Flow

```bash
# Start with mock data
cd backend
# Edit .env: USE_MOCK_SCHWAB_DATA=true
uvicorn app.main:app --reload

# In another terminal, trigger sync
curl -X POST http://localhost:8000/api/v1/positions/sync

# Check logs
tail -100 backend.log | grep "GROUPING\|Input:\|Output:\|MISMATCH"
```

### Look for output like:
```
=== GROUPING POSITIONS: 12 input positions ===
  Input: NVDA | stock | qty=100 | acct=0458
  Input: AAPL | stock | qty=200 | acct=0458
  ...
=== GROUPED OUTPUT: 12 grouped positions ===
  Output: NVDA | long_stock | legs=1
  ...
✅ All 12 positions accounted for
```

### Test Manual Strategy Assignment

```bash
# Get position ID from /api/v1/positions/actual
curl http://localhost:8000/api/v1/positions/actual

# Update strategy
curl -X PATCH \
  "http://localhost:8000/api/v1/positions/actual/POSITION_ID_HERE/strategy?strategy_type=covered_call"

# Verify change
curl http://localhost:8000/api/v1/positions/actual | jq '.positions[] | select(.id=="POSITION_ID_HERE")'
```

## Strategy Types Available

Current strategy types recognized by the system:

- `covered_call` - Stock + short call
- `vertical_spread` - Call or put spread
- `box_spread` - 4-leg arbitrage
- `long_stock` - Long stock position
- `short_stock` - Short stock position
- `big_option` - Large option position (10+ contracts or $5K+)
- `single_option` - Small option position
- `unallocated` - (To be added) No automatic classification

Users can manually assign ANY strategy type through the API/UI.

## Known Issues to Investigate

1. Why are some positions missing? 
   - Check logs after sync to see if they're in input
   - If in input but not output → grouping bug
   - If not in input → Schwab API filter issue

2. Backend showing `mock_mode=false` despite .env change
   - Need to properly restart with updated .env file

## Files Modified

- `backend/app/services/schwab_service.py` - Enhanced grouping with logging
- `backend/app/api/v1/positions.py` - Added manual strategy assignment endpoint
- `backend/.env.instance_a` - Switched to mock data for testing

