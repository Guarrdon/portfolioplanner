# Collaborative Tagging Feature

## ✅ Feature Implemented

Recipients can now **add and remove tags** on shared trade ideas, just like commenting!

## 🎯 What Changed

### Backend Changes

#### 1. New Service Function (`backend/app/services/position_service.py`)
```python
def update_position_tags(
    db: Session,
    position_id: UUID,
    user_id: UUID,
    tags: List[str]
) -> Optional[Position]:
    """
    Update tags on a position
    
    Allows both owners AND recipients (via shares) to update tags
    """
```

**Authorization Logic:**
- ✅ **Owner** can update tags (owns the position)
- ✅ **Recipient** can update tags (position is shared with them)
- ❌ **Other users** cannot update tags

#### 2. New API Endpoint (`backend/app/api/v1/positions.py`)
```
PATCH /api/v1/positions/ideas/{position_id}/tags
```

**Request Body:** Array of tag strings
```json
["risk:high", "strategy:covered-call", "timing:q4"]
```

**Response:** Updated position with new tags

**Real-time:** Broadcasts `position_updated` event to all users with access (owner + recipients)

### Frontend Changes

#### 1. New Service Function (`frontend/src/services/collaboration.js`)
```javascript
export const updateTradeIdeaTags = async (positionId, tags)
```

- Uses `PATCH` instead of `PUT` (semantic HTTP method)
- Passes current user ID for authorization
- Sends entire tag array (replaces all tags)

#### 2. Updated TradeIdeaCard Component (`frontend/src/components/collaboration/TradeIdeaCard.jsx`)

**Changes:**
1. Added `tagMutation` - separate mutation for tag updates
2. Updated `handleAddTag()` to use `tagMutation`
3. Updated `handleRemoveTag()` to use `tagMutation`
4. **Removed `isOwner` check** from tag removal button
5. Invalidates both `'positions/ideas'` and `'positions/shared'` queries on success

**UI Behavior:**
- Tag removal button (X) is now visible to **everyone** with access
- Shows on hover (same as before)
- Works for both owner and recipients

## 🎨 User Experience

### Owner's View (Instance 1 - Matt)
```
My Trade Ideas > NVDA Trade Idea
Tags: [risk:high] [covered-call]
       ↑ hover to see X      ↑ hover to see X
[Add tag input] → "timing:q4" → [Add]
✅ Can add new tags
✅ Can remove any tag
✅ Sees real-time updates from recipients
```

### Recipient's View (Instance 2 - Jason)
```
Shared With Me > NVDA Trade Idea (by Matt Lyons)
Tags: [risk:high] [covered-call] [timing:q4]
       ↑ hover to see X      ↑ hover to see X      ↑ hover to see X
[Add tag input] → "action:review" → [Add]
✅ Can add new tags
✅ Can remove any tag (even ones added by owner!)
✅ Sees real-time updates from owner
```

## 🔄 Real-Time Collaboration

When **Jason** adds a tag:
1. Jason adds tag "action:review"
2. Backend broadcasts `position_updated` event
3. **Matt sees the tag appear immediately** in his view (if WebSocket connected)
4. Both users' QueryClient caches invalidate and refetch

When **Matt** removes a tag:
1. Matt removes tag "risk:high"
2. Backend broadcasts `position_updated` event
3. **Jason sees the tag disappear immediately** in his view
4. Both users stay in sync

## 🧪 Testing Instructions

### Test 1: Recipient Can Add Tags

**Instance 1 (Matt):**
1. Go to "My Trade Ideas"
2. Expand a trade idea (or create one if empty)
3. Share it with Jason

**Instance 2 (Jason):**
1. Refresh the page (Cmd+R / Ctrl+R)
2. Go to "Shared With Me"
3. Expand Matt's shared trade idea
4. Scroll to the tags section
5. Type a new tag (e.g., "review-requested")
6. Click "Add" or press Enter
7. ✅ **Verify:** Tag appears

**Instance 1 (Matt):**
1. Check the same trade idea
2. ✅ **Verify:** Jason's tag appears (real-time or after refresh)

### Test 2: Recipient Can Remove Tags

**Instance 2 (Jason):**
1. In the shared trade idea, hover over an existing tag
2. ✅ **Verify:** X button appears
3. Click the X button
4. ✅ **Verify:** Tag disappears

**Instance 1 (Matt):**
1. Check the same trade idea
2. ✅ **Verify:** Tag is removed

### Test 3: Both Users Can Collaborate on Tags

**Scenario:** Build a tag set together

**Instance 1 (Matt):**
1. Add tag: "strategy:vertical-spread"
2. Add tag: "risk:medium"

**Instance 2 (Jason):**
1. See Matt's tags appear (real-time or refresh)
2. Add tag: "timing:before-earnings"
3. Remove tag: "risk:medium"
4. Add tag: "risk:low"

**Instance 1 (Matt):**
1. See Jason's changes appear
2. Final tags: "strategy:vertical-spread", "timing:before-earnings", "risk:low"
3. ✅ **Verify:** Both users see the same tag set

### Test 4: Tags Persist Across Sessions

**Instance 2 (Jason):**
1. Add several tags to a shared position
2. Close the browser
3. Reopen `http://localhost:3001`
4. Go to "Shared With Me"
5. ✅ **Verify:** Tags are still there

## 🔐 Security & Authorization

### Backend Validation
```python
# Check if user is owner OR recipient
is_owner = position.user_id == user_id
is_recipient = False

if not is_owner:
    # Check if position is shared with user
    share = db.query(PositionShare).filter(
        PositionShare.position_id == position_id,
        PositionShare.recipient_id == user_id,
        PositionShare.is_active == True
    ).first()
    is_recipient = share is not None

# Only allow if owner or recipient
if not (is_owner or is_recipient):
    return None
```

**Protection:**
- ❌ Random users cannot update tags
- ✅ Only owner and active recipients can update
- ✅ When share is revoked (`is_active=False`), recipient loses tag update access

## 📊 API Comparison

### Before (Only Owner)
```
PUT /api/v1/positions/ideas/{id}
Body: { "tags": ["new", "tags"] }
Authorization: Owner only
```

### After (Owner + Recipients)
```
PATCH /api/v1/positions/ideas/{id}/tags
Body: ["new", "tags"]  (array directly)
Authorization: Owner OR Recipient
```

**Why PATCH?**
- Semantic HTTP method for partial updates
- Specific endpoint for tag operations
- Keeps permissions separate from full position updates

## 🚀 Benefits

1. **Collaborative Tagging**: Teams can organize trade ideas together
2. **Better Categorization**: Multiple perspectives on risk, timing, strategy
3. **Shared Context**: Tags help everyone understand the trade idea
4. **Real-time Updates**: Changes appear immediately for all users
5. **Equal Access**: Recipients have same tagging power as owners

## 🔮 Future Enhancements

1. **Tag Autocomplete**: Suggest existing tags as user types
2. **Tag Categories**: Organize tags by type (risk, strategy, timing, etc.)
3. **Tag Colors**: Visual color coding for different categories
4. **Tag History**: Track who added/removed which tags and when
5. **Tag Search**: Filter trade ideas by tags
6. **Tag Analytics**: Most used tags, tag trends, etc.

## 📝 Notes

- Tags are stored as a simple array of strings in the database
- No built-in tag validation (any string is accepted)
- Tags are case-sensitive
- Duplicate tags are prevented in frontend (before sending to backend)
- Empty tags are rejected in frontend
- Tag changes trigger position cache invalidation for both "ideas" and "shared" queries

