# Strategy Locking Design: Managing Manual Strategy Assignments

**Date:** November 3, 2025  
**Status:** Design Proposal

---

## 📋 Problem Statement

### Current Behavior (Problematic)
1. User syncs positions from Schwab → Auto-grouped into strategies
2. User manually changes strategy assignment (e.g., "Vertical Spread" → "Box Spread")
3. User syncs again from Schwab → **Manual assignment is LOST**
4. Auto-grouping runs again and reassigns the original strategy

### Why This Happens
Looking at `backend/app/services/position_service.py` line 332:

```python
position_key = (underlying, account_hash, strategy_type)
```

The sync process **matches positions by** `(symbol, account, strategy)`. When a user changes the strategy:
- Old position has key: `("SPY", "abc123", "vertical_spread")`
- After manual change: `("SPY", "abc123", "box_spread")`
- Next sync looks for `("SPY", "abc123", "vertical_spread")` (auto-detected)
- **No match found** → Creates NEW position with auto-detected strategy
- Old position (with manual strategy) is marked as "closed"
- User's manual assignment is lost ❌

---

## 🎯 Solution: Strategy Locking

### Concept
Add a `is_manual_strategy` flag to track when a user has intentionally overridden the auto-detected strategy. During sync, **preserve manual assignments** for positions that still exist in Schwab.

---

## 🏗️ Implementation Plan

### 1. Database Schema Changes

#### Add Field to Position Model
```python
# backend/app/models/position.py

class Position(Base):
    # ... existing fields ...
    
    # Strategy management
    strategy_type = Column(String(50), nullable=False)
    is_manual_strategy = Column(Boolean, default=False)  # NEW FIELD
    
    # ... rest of the model ...
```

#### Migration
```sql
ALTER TABLE positions ADD COLUMN is_manual_strategy BOOLEAN DEFAULT FALSE;
```

---

### 2. Backend Logic Changes

#### A. Update Manual Strategy Assignment Endpoint

**File:** `backend/app/api/v1/positions.py`

```python
@router.patch("/actual/{position_id}/strategy", response_model=PositionResponse)
def update_position_strategy(
    position_id: UUID,
    strategy_type: str = Query(..., description="New strategy type"),
    user_id: Optional[str] = Query(None, description="User ID (for testing without auth)"),
    db: Session = Depends(get_db)
):
    """Manually update the strategy type for a position."""
    test_user_id = user_id or "00000000-0000-0000-0000-000000000001"
    
    position = db.query(models.Position).filter(
        models.Position.id == position_id,
        models.Position.user_id == test_user_id,
        models.Position.flavor == "actual"
    ).first()
    
    if not position:
        raise HTTPException(status_code=404, detail="Position not found")
    
    old_strategy = position.strategy_type
    position.strategy_type = strategy_type
    position.is_manual_strategy = True  # 🔒 LOCK IT
    
    db.commit()
    db.refresh(position)
    
    logger.info(f"Manual strategy lock: {position.symbol} | {old_strategy} → {strategy_type} | LOCKED")
    
    return position
```

#### B. Add Unlock Endpoint (Optional)

```python
@router.patch("/actual/{position_id}/strategy/unlock", response_model=PositionResponse)
def unlock_position_strategy(
    position_id: UUID,
    user_id: Optional[str] = Query(None, description="User ID (for testing without auth)"),
    db: Session = Depends(get_db)
):
    """
    Unlock a position's strategy assignment.
    
    The next sync will re-apply automatic strategy detection.
    """
    test_user_id = user_id or "00000000-0000-0000-0000-000000000001"
    
    position = db.query(models.Position).filter(
        models.Position.id == position_id,
        models.Position.user_id == test_user_id,
        models.Position.flavor == "actual"
    ).first()
    
    if not position:
        raise HTTPException(status_code=404, detail="Position not found")
    
    position.is_manual_strategy = False  # 🔓 UNLOCK IT
    
    db.commit()
    db.refresh(position)
    
    logger.info(f"Strategy unlocked: {position.symbol} | Will auto-detect on next sync")
    
    return position
```

#### C. Modify Sync Logic to Respect Locks

**File:** `backend/app/services/position_service.py`

```python
def sync_schwab_positions(
    db: Session,
    user_id: UUID,
    account_ids: Optional[List[str]] = None
) -> List[Position]:
    """Sync positions from Schwab API"""
    
    # Fetch data from Schwab
    schwab_data = fetch_account_data(user_id, db, account_ids)
    
    # Group positions into strategies (auto-detection)
    grouped_positions = group_positions_by_strategy(schwab_data["positions"])
    
    # ... update accounts ...
    
    # Get existing positions
    existing_positions = db.query(Position).filter(
        Position.user_id == user_id,
        Position.flavor == "actual"
    ).all()
    
    # Create TWO lookup dictionaries:
    # 1. For auto-managed positions (by full key including strategy)
    auto_managed = {
        (p.symbol, p.account_id, p.strategy_type): p
        for p in existing_positions
        if not p.is_manual_strategy  # 🔓 Only auto-managed
    }
    
    # 2. For manually-locked positions (by symbol + account only)
    manual_locked = {
        (p.symbol, p.account_id): p
        for p in existing_positions
        if p.is_manual_strategy  # 🔒 Only locked
    }
    
    synced_positions = []
    
    for grouped_pos in grouped_positions:
        strategy_type = grouped_pos["strategy_type"]
        underlying = grouped_pos["underlying"]
        legs = grouped_pos["legs"]
        
        if not legs:
            continue
        
        first_leg = legs[0]
        account_hash = first_leg["account_hash"]
        account_number = first_leg["account_number"]
        
        # Calculate aggregate values
        total_cost = sum(leg.get("cost_basis", 0) for leg in legs)
        total_value = sum(leg.get("current_value", 0) for leg in legs)
        total_pnl = total_value - total_cost
        total_quantity = sum(abs(leg.get("quantity", 0)) for leg in legs)
        total_maintenance = sum(leg.get("maintenance_requirement", 0) or 0 for leg in legs)
        total_day_pnl = sum(leg.get("current_day_pnl", 0) or 0 for leg in legs)
        total_day_pnl_pct = (total_day_pnl / total_cost * 100) if total_cost != 0 else None
        
        # Determine entry date
        entry_date = datetime.now().date() if any(leg.get("expiration") for leg in legs) else None
        
        # ========================================
        # 🎯 KEY CHANGE: Check manual locks first
        # ========================================
        
        # Check if this position is manually locked
        manual_key = (underlying, account_hash)
        locked_position = manual_locked.get(manual_key)
        
        if locked_position:
            # 🔒 LOCKED POSITION: Update data but PRESERVE strategy
            logger.info(f"Syncing LOCKED position: {underlying} | Strategy: {locked_position.strategy_type} (preserved)")
            
            # Update financial data only
            locked_position.quantity = total_quantity
            locked_position.cost_basis = total_cost
            locked_position.current_value = total_value
            locked_position.unrealized_pnl = total_pnl
            locked_position.maintenance_requirement = total_maintenance
            locked_position.current_day_pnl = total_day_pnl
            locked_position.current_day_pnl_percentage = total_day_pnl_pct
            locked_position.last_synced = datetime.utcnow()
            locked_position.status = "active"
            
            # Update legs
            for leg in locked_position.legs:
                db.delete(leg)
            
            for leg_data in legs:
                leg = PositionLeg(
                    position_id=locked_position.id,
                    symbol=leg_data.get("symbol"),
                    asset_type=leg_data.get("asset_type"),
                    option_type=leg_data.get("option_type"),
                    strike=leg_data.get("strike"),
                    expiration=leg_data.get("expiration"),
                    quantity=leg_data.get("quantity"),
                    premium=leg_data.get("average_price"),
                    current_price=leg_data.get("current_price")
                )
                db.add(leg)
            
            synced_positions.append(locked_position)
            del manual_locked[manual_key]  # Remove from tracking
            
        else:
            # 🔓 AUTO-MANAGED: Normal sync with auto-detected strategy
            auto_key = (underlying, account_hash, strategy_type)
            existing_pos = auto_managed.get(auto_key)
            
            if existing_pos:
                # Update existing auto-managed position
                logger.info(f"Syncing AUTO position: {underlying} | Strategy: {strategy_type} (auto-detected)")
                
                existing_pos.quantity = total_quantity
                existing_pos.cost_basis = total_cost
                existing_pos.current_value = total_value
                existing_pos.unrealized_pnl = total_pnl
                existing_pos.maintenance_requirement = total_maintenance
                existing_pos.current_day_pnl = total_day_pnl
                existing_pos.current_day_pnl_percentage = total_day_pnl_pct
                existing_pos.last_synced = datetime.utcnow()
                existing_pos.status = "active"
                
                # Update legs
                for leg in existing_pos.legs:
                    db.delete(leg)
                
                for leg_data in legs:
                    leg = PositionLeg(
                        position_id=existing_pos.id,
                        symbol=leg_data.get("symbol"),
                        asset_type=leg_data.get("asset_type"),
                        option_type=leg_data.get("option_type"),
                        strike=leg_data.get("strike"),
                        expiration=leg_data.get("expiration"),
                        quantity=leg_data.get("quantity"),
                        premium=leg_data.get("average_price"),
                        current_price=leg_data.get("current_price")
                    )
                    db.add(leg)
                
                synced_positions.append(existing_pos)
                del auto_managed[auto_key]
                
            else:
                # Create new position with auto-detected strategy
                logger.info(f"Creating NEW position: {underlying} | Strategy: {strategy_type} (auto-detected)")
                
                position = Position(
                    user_id=user_id,
                    flavor="actual",
                    account_id=account_hash,
                    account_number=account_number,
                    symbol=underlying,
                    underlying=underlying,
                    strategy_type=strategy_type,
                    is_manual_strategy=False,  # Auto-managed
                    status="active",
                    quantity=total_quantity,
                    cost_basis=total_cost,
                    current_value=total_value,
                    unrealized_pnl=total_pnl,
                    maintenance_requirement=total_maintenance,
                    current_day_pnl=total_day_pnl,
                    current_day_pnl_percentage=total_day_pnl_pct,
                    entry_date=entry_date,
                    last_synced=datetime.utcnow(),
                    read_only=True
                )
                
                db.add(position)
                db.flush()
                
                # Create legs
                for leg_data in legs:
                    leg = PositionLeg(
                        position_id=position.id,
                        symbol=leg_data.get("symbol"),
                        asset_type=leg_data.get("asset_type"),
                        option_type=leg_data.get("option_type"),
                        strike=leg_data.get("strike"),
                        expiration=leg_data.get("expiration"),
                        quantity=leg_data.get("quantity"),
                        premium=leg_data.get("average_price"),
                        current_price=leg_data.get("current_price")
                    )
                    db.add(leg)
                
                synced_positions.append(position)
    
    # Mark positions that no longer exist as closed
    for remaining_pos in list(auto_managed.values()) + list(manual_locked.values()):
        remaining_pos.status = "closed"
        remaining_pos.exit_date = datetime.now().date()
        logger.info(f"Closing position (no longer in Schwab): {remaining_pos.symbol}")
    
    db.commit()
    
    # Refresh all synced positions
    for pos in synced_positions:
        db.refresh(pos)
    
    return synced_positions
```

---

### 3. Frontend UI Changes

#### A. Add Visual Lock Indicator

**File:** `frontend/src/components/schwab/SchwabPositionsView.jsx`

```jsx
<td className="px-2 py-1.5 text-gray-700">
    {editingStrategyId === position.id ? (
      <select
        className="text-xs py-0.5 px-1 border rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
        value={position.strategy_type}
        onChange={(e) => {
          e.stopPropagation();
          updateStrategyMutation.mutate({
            positionId: position.id,
            strategyType: e.target.value
          });
        }}
        onBlur={() => setEditingStrategyId(null)}
        onClick={(e) => e.stopPropagation()}
        autoFocus
      >
        <option value="covered_call">Covered Call</option>
        <option value="vertical_spread">Vertical Spread</option>
        <option value="box_spread">Box Spread</option>
        <option value="long_stock">Long Stock</option>
        <option value="short_stock">Short Stock</option>
        <option value="big_option">Big Option</option>
        <option value="single_option">Single Option</option>
        <option value="unallocated">Unallocated</option>
      </select>
    ) : (
      <div className="flex items-center gap-1 group">
        <span className="flex items-center gap-1">
          {getStrategyLabel(position.strategy_type)}
          
          {/* 🔒 Lock Indicator */}
          {position.is_manual_strategy && (
            <Lock className="w-3 h-3 text-blue-500" title="Manual assignment (locked)" />
          )}
        </span>
        
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Edit Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditingStrategyId(position.id);
            }}
            className="p-0.5 hover:bg-gray-100 rounded"
            title="Change strategy"
          >
            <Edit2 className="w-3 h-3 text-gray-400" />
          </button>
          
          {/* Unlock Button (only show if locked) */}
          {position.is_manual_strategy && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm('Reset to automatic strategy detection?')) {
                  unlockStrategyMutation.mutate(position.id);
                }
              }}
              className="p-0.5 hover:bg-gray-100 rounded"
              title="Unlock - use auto-detection on next sync"
            >
              <Unlock className="w-3 h-3 text-gray-400" />
            </button>
          )}
        </div>
      </div>
    )}
</td>
```

#### B. Add Unlock Mutation

```javascript
import { Lock, Unlock, Edit2 } from 'lucide-react';

// ... existing mutations ...

const unlockStrategyMutation = useMutation({
  mutationFn: async (positionId) => {
    const response = await api.patch(
      `/positions/actual/${positionId}/strategy/unlock`,
      null,
      { params: { user_id: mockUserId } }
    );
    return response.data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['schwab-positions'] });
    toast.success('Strategy unlocked - will auto-detect on next sync');
  },
  onError: (error) => {
    toast.error('Failed to unlock strategy');
    console.error('Unlock error:', error);
  }
});
```

---

## 📊 Example Workflow

### Scenario: User Corrects Auto-Detection

1. **Initial Sync:**
   ```
   ✅ Position created: SPY | Strategy: "Vertical Spread" (auto-detected)
   is_manual_strategy: false
   ```

2. **User Manually Changes:**
   ```
   User clicks edit → selects "Box Spread"
   
   ✅ Position updated: SPY | Strategy: "Box Spread" 🔒
   is_manual_strategy: true
   ```

3. **Next Sync (Without Strategy Locking):**
   ```
   ❌ OLD BEHAVIOR:
   - Auto-grouping detects "Vertical Spread" again
   - No match found for ("SPY", "abc123", "vertical_spread")
   - Creates NEW position with "Vertical Spread"
   - Marks "Box Spread" position as closed
   - User's manual change is LOST
   ```

4. **Next Sync (With Strategy Locking):**
   ```
   ✅ NEW BEHAVIOR:
   - Auto-grouping detects "Vertical Spread"
   - Checks for locked position on ("SPY", "abc123")
   - FINDS locked position with "Box Spread" strategy
   - Updates financial data but PRESERVES "Box Spread" strategy
   - User's manual change is KEPT
   ```

5. **User Can Unlock Later:**
   ```
   User clicks unlock icon
   
   ✅ Position updated: SPY | Strategy: "Box Spread" 🔓
   is_manual_strategy: false
   
   Next sync will re-apply auto-detection
   ```

---

## 🎨 UI Mockup

```
┌────────────────────────────────────────────────────────────┐
│  Symbol  │  Strategy           │  Quantity │  Value  │ P&L │
├────────────────────────────────────────────────────────────┤
│  SPY     │  Box Spread 🔒 [✏️][🔓]  │  -4      │  $1,200 │ +5% │
│  AAPL    │  Covered Call [✏️]      │  100     │  $8,500 │ -2% │
│  TSLA    │  Vertical Spread [✏️]   │  -10     │  $2,100 │ +8% │
└────────────────────────────────────────────────────────────┘

Legend:
🔒 = Manually assigned (locked)
✏️  = Edit strategy
🔓 = Unlock (reset to auto-detection)
```

---

## ⚠️ Edge Cases

### 1. Position Splits/Regroups
**Problem:** User has SPY vertical spread. After adding more legs, it becomes a box spread.

**Solution:** Locked positions match by `(symbol, account)` only, so legs update but strategy stays locked to user's choice.

### 2. Position Closes and Reopens
**Problem:** User locks strategy, closes position, reopens same position later.

**Solution:** Old position is marked "closed". New position from sync creates fresh entry with auto-detection. Lock doesn't carry over (correct behavior).

### 3. Bulk Unlock
**Future Enhancement:** Add ability to unlock multiple positions at once:
```
"Unlock All" button → Resets all positions to auto-detection
```

---

## 📝 Database Migration

```bash
# Generate migration
cd backend
source venv/bin/activate
alembic revision -m "add_strategy_locking"
```

Migration file:
```python
"""add_strategy_locking

Revision ID: xxx
Revises: yyy
Create Date: 2025-11-03

"""
from alembic import op
import sqlalchemy as sa


def upgrade():
    op.add_column('positions', sa.Column('is_manual_strategy', sa.Boolean(), default=False))
    
    # Set existing positions to False
    op.execute("UPDATE positions SET is_manual_strategy = FALSE WHERE is_manual_strategy IS NULL")


def downgrade():
    op.drop_column('positions', 'is_manual_strategy')
```

---

## ✅ Testing Checklist

- [ ] Manual strategy assignment sets `is_manual_strategy=True`
- [ ] Sync preserves locked strategies
- [ ] Sync updates financial data for locked positions
- [ ] Sync updates legs for locked positions
- [ ] Unlocking strategy sets `is_manual_strategy=False`
- [ ] Next sync after unlock applies auto-detection
- [ ] UI shows lock icon for manual strategies
- [ ] UI shows unlock button for locked strategies
- [ ] Closed positions remain closed even if locked

---

## 🚀 Implementation Order

1. **Phase 1: Backend Foundation**
   - Add `is_manual_strategy` column to Position model
   - Run migration
   - Update manual strategy assignment endpoint to set flag

2. **Phase 2: Sync Logic**
   - Modify `sync_schwab_positions()` to respect locks
   - Add comprehensive logging
   - Test with mock data

3. **Phase 3: Frontend**
   - Add lock indicator icon
   - Add unlock button and mutation
   - Add visual feedback

4. **Phase 4: Testing**
   - Test full workflow with real Schwab data
   - Verify locks persist across syncs
   - Verify unlock works correctly

---

## 💡 Alternative Approaches Considered

### Option A: Position Metadata Field
Store `{"manual_strategy": true}` in a JSON metadata field.

**Rejected:** Less explicit, harder to query, no database-level constraints.

### Option B: Separate Strategy Override Table
Create `position_strategy_overrides` table.

**Rejected:** Over-engineering for a simple boolean flag.

### Option C: Never Update Strategy
Once set, strategy never changes even from sync.

**Rejected:** No way to reset to auto-detection if user changes their mind.

---

## 📚 Documentation Updates Needed

- [ ] Update API documentation with lock/unlock endpoints
- [ ] Add user guide for manual strategy management
- [ ] Update MANUAL_STRATEGY_ASSIGNMENT.md with locking info

---

**Ready to implement?** This design ensures manual strategy assignments are preserved while still allowing auto-detection for new positions and unlocked positions.

