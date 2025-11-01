# Sharing Debug Guide

## Quick Diagnostics

### 1. Check Friend Relationships

Open browser console on **both instances** and run:

```javascript
// Check if friends exist
const relationships = localStorage.getItem('user_00000000-0000-0000-0000-000000000001_relationships');
console.log('Friends:', JSON.parse(relationships || '[]'));

// Check current user
const users = localStorage.getItem('portfolio_users');
console.log('Users:', JSON.parse(users || '[]'));
```

### 2. Manually Add Friend Relationship

If no friends exist, add them manually:

**In Instance 1 (User 1's browser):**
```javascript
// Add User 2 as friend
const user1Id = '00000000-0000-0000-0000-000000000001';
const user2Id = '00000000-0000-0000-0000-000000000002';

const friendship = {
  userId: user2Id,
  createdAt: new Date().toISOString(),
  status: 'active',
  type: 'individual'
};

localStorage.setItem(
  `user_${user1Id}_relationships`,
  JSON.stringify([friendship])
);

// Refresh page
location.reload();
```

**In Instance 2 (User 2's browser):**
```javascript
// Add User 1 as friend (reciprocal)
const user1Id = '00000000-0000-0000-0000-000000000001';
const user2Id = '00000000-0000-0000-0000-000000000002';

const friendship = {
  userId: user1Id,
  createdAt: new Date().toISOString(),
  status: 'active',
  type: 'individual'
};

localStorage.setItem(
  `user_${user2Id}_relationships`,
  JSON.stringify([friendship])
);

// Refresh page
location.reload();
```

### 3. Test Sharing API Directly

```javascript
// Test the share API endpoint
const positionId = 'YOUR_POSITION_ID';  // Get from UI
const friendId = '00000000-0000-0000-0000-000000000002';

fetch('http://localhost:8000/api/v1/positions/ideas/' + positionId + '/share', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    friend_ids: [friendId],
    access_level: 'comment'
  })
})
.then(r => r.json())
.then(data => console.log('Share result:', data))
.catch(err => console.error('Share error:', err));
```

### 4. Check Backend Logs

Watch backend console for errors:
```bash
# In backend terminal, look for errors when clicking "Update"
```

### 5. Check Network Tab

1. Open DevTools → Network tab
2. Click "Update" in share modal
3. Look for POST request to `/positions/ideas/{id}/share`
4. Check:
   - Status code (should be 200)
   - Request payload
   - Response body
   - Any CORS errors

## Common Issues

### Issue: "No friends available"

**Cause:** No friendships in localStorage

**Fix:** Use Step 2 above to manually add friendships

### Issue: Share API returns 400

**Cause:** Invalid friend ID format

**Fix:** Ensure friend IDs are valid UUIDs

### Issue: Share API returns 404

**Cause:** Position doesn't exist or wrong position ID

**Fix:** Verify position ID in URL

### Issue: Nothing happens when clicking "Update"

**Cause:** JavaScript error or mutation not firing

**Fix:** 
1. Check browser console for errors
2. Add console.log in handleShare:
```javascript
// In TradeIdeaCard.jsx line 151
const handleShare = () => {
  const friendIds = Array.from(selectedFriends);
  console.log('🔍 Updating shares - friend IDs:', friendIds);
  console.log('🔍 Selected friends set:', selectedFriends);
  console.log('🔍 Position ID:', position.id);
  shareMutation.mutate(friendIds);
};
```

