# Collaboration Features Debug Plan

## Issues Identified
1. **Comments not displaying** after being added
2. **Share status not showing** on trade idea card
3. **Share status not persisting** when reopening share modal

## Root Cause Analysis

### Architecture Context
- **Distributed System**: Owner (NC) and Friend (FL) run independent frontend instances
- **Backend**: Single source of truth (centralized database)
- **Frontend**: React Query for client-side caching and server state management
- **Communication**: REST API calls with JWT auth (currently using test user)

### Expected Data Flow

#### Comments/Notes:
```
Owner adds comment
  → POST /positions/{id}/comments
  → Backend saves to comments table
  → Returns comment with user info
  → Frontend invalidates ['comments', position_id] query
  → React Query refetches comments
  → Discussion panel updates

Friend views position
  → GET /positions/{id}/comments
  → Backend returns all comments (owner + friend comments)
  → Discussion panel shows full thread
```

#### Share Status:
```
Owner shares with friend
  → POST /positions/ideas/{id}/share with friend_ids
  → Backend creates PositionShare records
  → Frontend invalidates ['positions', 'ideas'] query
  → React Query refetches trade ideas
  → Backend populates shared_with array in response
  → Frontend displays green badge with friend avatars

Friend logs in (distributed location)
  → GET /positions/shared
  → Backend returns positions shared with this user
  → Shows in "Shared With Me" tab
```

## Debug Strategy

### Step 1: Verify Backend Response (Comments)
- [ ] Check if POST /positions/{id}/comments returns correct data
- [ ] Check if GET /positions/{id}/comments returns comments
- [ ] Verify comment structure includes user info
- [ ] Test with browser DevTools Network tab

### Step 2: Verify Backend Response (Share Status)
- [ ] Check if shared_with array is populated in GET /positions/ideas
- [ ] Verify PositionShare records are created
- [ ] Check if shared_with persists after page refresh
- [ ] Test with browser DevTools Network tab

### Step 3: Frontend State Management
- [ ] Verify React Query cache keys match API calls
- [ ] Check query invalidation triggers
- [ ] Ensure mutations call onSuccess handlers
- [ ] Test refetch behavior

### Step 4: UI Component Issues
- [ ] Check if comments are rendering in TradeIdeaCard
- [ ] Verify shared_with field is read correctly
- [ ] Check conditional rendering logic
- [ ] Test with React DevTools

## Implementation Plan

### Fix 1: Comments Display
1. Add console logging to track data flow
2. Verify getPositionComments() query key matches endpoint
3. Ensure addCommentMutation invalidates correct query
4. Check comment rendering in UI

### Fix 2: Share Status Display
1. Log shared_with data from backend response
2. Verify frontend reads position.shared_with
3. Fix share modal to pre-select already-shared friends
4. Ensure query invalidation refreshes data

### Fix 3: Real-time Updates
1. Ensure proper query invalidation on mutations
2. Add background refetch for active queries
3. Consider polling for collaborative features (optional)
4. Test with multiple browser tabs (simulating distributed users)

## Testing Checklist

### Owner Perspective:
- [ ] Add comment → see it immediately
- [ ] Share with friend → see green badge
- [ ] Reopen share modal → friend is pre-selected
- [ ] Refresh page → share status persists
- [ ] View in "My Ideas" tab → all data visible

### Friend Perspective (simulate with different browser):
- [ ] View in "Shared With Me" tab
- [ ] See all comments (owner + friend)
- [ ] Add comment → owner can see it
- [ ] Cannot delete/modify original trade idea
- [ ] Can add tags/notes based on permissions

## Success Criteria
✅ Comments appear immediately after posting
✅ Share badge shows friend avatars
✅ Share modal remembers already-shared friends
✅ Data persists across page refreshes
✅ Both owner and friend see synchronized data
✅ No console errors or failed API calls
