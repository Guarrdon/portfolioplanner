# Strategy Editor Testing Guide

## Quick Diagnostic Test

### 1. Open Browser Console
- Mac: Cmd + Option + J
- Windows: Ctrl + Shift + J

### 2. Run This Command in Console
```javascript
// Check if Edit2 icon is in the page
document.querySelectorAll('[class*="lucide"]').length > 0
```
**Expected:** `true` (icons are loaded)

### 3. Check for Edit Buttons
```javascript
// Count edit buttons (hidden until hover)
document.querySelectorAll('button[title="Change strategy"]').length
```
**Expected:** Number > 0 (one per position)

### 4. Force Show All Edit Icons
```javascript
// Make all edit icons visible (for testing)
document.querySelectorAll('.opacity-0').forEach(el => {
  el.style.opacity = '1';
});
```
**Result:** You should now see ALL edit icons (even without hover)

## Manual Testing Steps

### Test 1: Basic Hover
1. Go to http://localhost:3000/positions
2. Find the "Strategy" column (3rd column)
3. **Slowly move your mouse** over a strategy name (e.g., "Single Option")
4. Watch for a small pencil icon ✏️ to appear next to the text

### Test 2: Click to Edit
1. Once you see the pencil icon
2. Click it
3. The strategy name should change to a dropdown
4. You'll see options like:
   - Covered Call
   - Vertical Spread
   - Box Spread
   - Long Stock
   - etc.

### Test 3: Change Strategy
1. Select a different strategy from dropdown
2. It should auto-save
3. You should see a blue lock icon 🔒 appear
4. The dropdown closes

### Test 4: Unlock
1. Hover over a locked strategy (one with 🔒)
2. You should see both icons:
   - ✏️ Edit
   - 🔓 Unlock
3. Click unlock
4. Confirm the dialog
5. Lock icon disappears

## Troubleshooting

### Issue: No Edit Icon Appears
**Try:**
1. Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
2. Use incognito window
3. Run console command #4 above to force-show icons
4. Check browser console for errors (red text)

### Issue: Can See Icon But Can't Click
**Check:**
- Are you clicking the icon itself?
- Is there a JavaScript error in console?
- Try clicking the strategy text (might expand row instead)

### Issue: Dropdown Doesn't Appear
**Verify:**
1. Open DevTools (F12)
2. Go to Network tab
3. Refresh page
4. Look for `main.*.js` file
5. Check its size (should be > 1MB if includes all components)

### Issue: Changes Don't Save
**Debug:**
1. Open Network tab in DevTools
2. Click to change strategy
3. Look for PATCH request to `/api/v1/positions/actual/{id}/strategy`
4. Check if it returns 200 OK
5. If 404/500, check backend logs

## Visual Reference

```
Before Hover:
┌──────────────────────┐
│ Strategy: Covered Call │
└──────────────────────┘

On Hover:
┌────────────────────────────┐
│ Strategy: Covered Call [✏️] │ ← Icon appears
└────────────────────────────┘

After Click Edit:
┌─────────────────────────────┐
│ Strategy: [Dropdown ▼]      │
│           Covered Call       │
│           Vertical Spread    │
│           Box Spread         │
└─────────────────────────────┘

After Changing:
┌──────────────────────────────────┐
│ Strategy: Box Spread 🔒 [✏️][🔓] │
│                      ↑   ↑   ↑   │
│                Lock Edit Unlock  │
└──────────────────────────────────┘
```

## Expected Behavior Summary

1. **Default State:** Strategy name only, no icons visible
2. **On Hover:** Edit icon (✏️) fades in next to strategy name
3. **If Locked:** Edit icon + Lock icon (🔒) + Unlock icon (🔓)
4. **While Editing:** Dropdown menu replaces strategy name
5. **After Save:** Dropdown closes, lock icon appears

## API Verification

To verify the backend is working, run in terminal:
```bash
# Get a position ID
curl -s http://localhost:8000/api/v1/positions/actual?limit=1 | \
  python3 -c "import json,sys; print(json.load(sys.stdin)['positions'][0]['id'])"

# Test lock endpoint (use ID from above)
curl -X PATCH "http://localhost:8000/api/v1/positions/actual/PUT-ID-HERE/strategy?strategy_type=wheel_strategy"

# Verify it's locked
curl -s http://localhost:8000/api/v1/positions/actual?limit=1 | \
  python3 -c "import json,sys; p=json.load(sys.stdin)['positions'][0]; print(f'Strategy: {p[\"strategy_type\"]}, Locked: {p[\"is_manual_strategy\"]}')"
```

