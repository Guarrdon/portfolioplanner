# Collaboration System Architecture

## Overview

The collaboration system enables users to share trading positions and ideas with friends, facilitating discussion and collaborative analysis. This document details the complete architecture, data flow, concurrency handling, and state management.

**Last Updated**: 2025-10-30

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Data Model](#data-model)
3. [Data Flow](#data-flow)
4. [State Management](#state-management)
5. [Concurrency & Synchronization](#concurrency--synchronization)
6. [Security Model](#security-model)
7. [API Contract](#api-contract)
8. [Frontend Components](#frontend-components)
9. [Edge Cases & Error Handling](#edge-cases--error-handling)

---

## System Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────┐
│                     User Browser (React)                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │ Schwab Positions│ ──>│ CollaborationModal           │   │
│  │ View            │    │ (Convert to Trade Idea)      │   │
│  └─────────────────┘    └──────────────────────────────┘   │
│                                    │                         │
│                                    ▼                         │
│  ┌────────────────────────────────────────────────────┐    │
│  │     Collaboration Dashboard                         │    │
│  │  ┌──────────────┐  ┌─────────────────────────┐    │    │
│  │  │ My Ideas Tab │  │ Shared With Me Tab      │    │    │
│  │  └──────────────┘  └─────────────────────────┘    │    │
│  │           │                    │                    │    │
│  │           ▼                    ▼                    │    │
│  │     TradeIdeaCard        TradeIdeaCard             │    │
│  │     (Editable)           (Read-Only)               │    │
│  └────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│           ┌──────────────────────────┐                     │
│           │  React Query Cache       │                     │
│           │  (positions, comments)   │                     │
│           └──────────────────────────┘                     │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼ HTTP/REST
┌─────────────────────────────────────────────────────────────┐
│                     Backend API (FastAPI)                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────┐    ┌─────────────────────────┐   │
│  │ Position Service     │    │ Comment Service         │   │
│  │ - CRUD operations    │    │ - Create comments       │   │
│  │ - Convert actual     │    │ - Fetch threads         │   │
│  │ - Share positions    │    │ - Access control        │   │
│  └──────────────────────┘    └─────────────────────────┘   │
│            │                              │                  │
│            ▼                              ▼                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Database (PostgreSQL/SQLite)            │   │
│  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐ │   │
│  │  │  positions  │ │position_legs │ │   comments   │ │   │
│  │  └─────────────┘ └──────────────┘ └──────────────┘ │   │
│  │  ┌─────────────┐ ┌──────────────┐                  │   │
│  │  │position_    │ │    users     │                  │   │
│  │  │  shares     │ │              │                  │   │
│  │  └─────────────┘ └──────────────┘                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Core Entities

#### Position

**Purpose**: Represents a trading position or idea

**Flavors**:
- `actual`: Schwab-synced positions (read-only)
- `idea`: User-created trade ideas (editable, shareable)
- `shared`: Trade ideas received from friends (read-only for recipient)

**Key Fields**:
```python
{
    id: UUID (PK)
    flavor: 'actual' | 'idea' | 'shared'
    user_id: UUID (FK to users)
    original_position_id: UUID (FK to positions, for shared)
    
    # Position details
    symbol: str
    underlying: str
    strategy_type: str
    status: 'planned' | 'watching' | 'active' | 'executed' | 'closed' | 'cancelled'
    
    # Financial data
    quantity: Decimal
    cost_basis: Decimal
    current_value: Decimal
    unrealized_pnl: Decimal
    
    # Planning data (for ideas)
    target_quantity: Decimal
    target_entry_price: Decimal
    max_profit: Decimal
    max_loss: Decimal
    
    # Metadata
    notes: Text
    tags: Array[String]
    read_only: Boolean
    
    # Timestamps
    created_at: DateTime
    updated_at: DateTime
}
```

**Relationships**:
- `legs`: One-to-Many with PositionLeg
- `comments`: One-to-Many with Comment
- `shares`: One-to-Many with PositionShare

---

#### PositionLeg

**Purpose**: Individual leg of a multi-leg position

**Key Fields**:
```python
{
    id: UUID (PK)
    position_id: UUID (FK)
    
    symbol: str  # OCC symbol for options
    asset_type: 'stock' | 'option'
    
    # Options-specific
    option_type: 'call' | 'put'  # ALWAYS LOWERCASE
    strike: Decimal
    expiration: Date
    
    # Quantities and pricing
    quantity: Decimal  # Negative for short positions
    premium: Decimal
    current_price: Decimal
    
    # Greeks (optional)
    delta: Decimal
    theta: Decimal
    vega: Decimal
    gamma: Decimal
}
```

**Important**: `option_type` is ALWAYS lowercase ('call' or 'put') throughout the entire system.

---

#### PositionShare

**Purpose**: Links positions to recipients for sharing

**Key Fields**:
```python
{
    id: UUID (PK)
    position_id: UUID (FK)
    owner_id: UUID (FK to users)
    recipient_id: UUID (FK to users)
    
    access_level: 'view' | 'comment'
    is_active: Boolean
    shared_at: DateTime
}
```

**Constraints**:
- Unique constraint on (position_id, recipient_id)
- Only `flavor='idea'` positions can be shared
- Recipient must be in owner's friend list

---

#### Comment

**Purpose**: Discussion messages on positions

**Key Fields**:
```python
{
    id: UUID (PK)
    position_id: UUID (FK)
    user_id: UUID (FK)
    
    text: Text
    created_at: DateTime
    updated_at: DateTime
}
```

**Access**:
- Position owner can see all comments
- All share recipients can see all comments
- Users can only edit/delete their own comments

---

## Data Flow

### 1. Converting Actual Position to Trade Idea

```
User clicks "Collab" button on Schwab position
           ↓
CollaborationModal opens, shows position details
           ↓
User clicks "Create Trade Idea"
           ↓
Frontend: POST /api/v1/positions/actual/{id}/convert-to-idea
           ↓
Backend: convert_actual_to_trade_idea()
    1. Fetch actual position (flavor='actual')
    2. Create new position (flavor='idea')
    3. Copy all fields (symbol, strategy, quantities)
    4. Copy all legs with proper mapping
    5. Set notes: "Converted from Schwab position on {date}"
    6. Set read_only=false
    7. Return new trade idea
           ↓
Frontend: Receives new trade idea
    1. Invalidates React Query cache
    2. Navigates to /collaboration?highlight={newId}
    3. Dashboard auto-expands the new card
```

**Key Points**:
- Original position remains unchanged
- New trade idea is completely independent
- All legs are deep-copied
- User_id is set to current user

---

### 2. Sharing a Trade Idea

```
User clicks "Share" on their trade idea
           ↓
ShareModal opens, fetches friend list
           ↓
User selects friends and clicks "Share"
           ↓
Frontend: POST /api/v1/positions/ideas/{id}/share
    Body: { friend_ids: [uuid, ...] }
           ↓
Backend: share_trade_idea()
    For each friend_id:
        1. Verify friendship exists
        2. Check if already shared
        3. Create PositionShare record
           ↓
Frontend: Receives confirmation
    1. Invalidates position query
    2. Updates share count in UI
           ↓
Friend's next page load/refresh:
    GET /api/v1/positions/shared
        Returns positions where recipient_id = friend's user_id
           ↓
    Friend sees position in "Shared With Me" tab
```

**Key Points**:
- Only `flavor='idea'` can be shared
- Shares are immediately active
- Recipient gets read-only access
- Owner can revoke by deleting PositionShare record

---

### 3. Commenting on a Position

```
User types message and presses Enter or clicks Send
           ↓
Frontend: POST /api/v1/positions/{id}/comments
    Body: { text: "message" }
           ↓
Backend: create_comment()
    1. Verify user has access to position:
        - Is owner, OR
        - Has active PositionShare
    2. Create Comment record
    3. Return comment with user info
           ↓
Frontend: Receives new comment
    1. Invalidates comments query
    2. New comment appears in thread
    3. Comment count updates
```

**Access Control**:
```python
def can_comment(user_id, position_id):
    position = get_position(position_id)
    
    # Owner can always comment
    if position.user_id == user_id:
        return True
    
    # Check if user has an active share
    share = PositionShare.query.filter_by(
        position_id=position_id,
        recipient_id=user_id,
        is_active=True,
        access_level='comment'  # or 'view'
    ).first()
    
    return share is not None
```

---

### 4. Updating a Trade Idea

```
Owner edits trade idea (tags, notes, status, etc.)
           ↓
Frontend: PUT /api/v1/positions/ideas/{id}
    Body: { tags: [...], status: "watching", ... }
           ↓
Backend: update_position()
    1. Verify user is owner
    2. Apply updates
    3. Set updated_at = now()
    4. Return updated position
           ↓
Frontend: Receives updated position
    1. Invalidates position queries
    2. UI updates immediately
    
IMPORTANT: Friend's view does NOT auto-update
    - Friend must refresh page to see changes
    - Future: WebSocket for real-time sync
```

---

## State Management

### Frontend State Architecture

The frontend uses **React Query** for server state management and **React Context** for user/friend state.

#### React Query Cache

```javascript
// Cache Keys
queryClient.setQueryData(['positions', 'ideas'], tradeIdeas)
queryClient.setQueryData(['positions', 'shared'], sharedPositions)
queryClient.setQueryData(['comments', positionId], comments)
queryClient.setQueryData(['friends'], friends)
```

**Benefits**:
- Automatic caching and invalidation
- Background refetching
- Optimistic updates
- Loading/error states

**Cache Invalidation Strategy**:
```javascript
// After creating position
queryClient.invalidateQueries({ queryKey: ['positions', 'ideas'] })

// After sharing
queryClient.invalidateQueries({ queryKey: ['positions', 'ideas', positionId] })

// After commenting
queryClient.invalidateQueries({ queryKey: ['comments', positionId] })
```

---

#### Component State

**Local State** (useState):
- UI state: expanded/collapsed cards
- Form inputs: new idea form, share modal
- Temporary state: loading indicators, highlights

**Context State**:
- `UserContext`: Current user info
- `FriendsContext`: Friend list, friend requests

---

### Backend State

**Database as Source of Truth**:
- All persistent state lives in PostgreSQL/SQLite
- No in-memory caches currently
- Each request reads fresh from database

**Future Enhancements**:
- Redis cache for frequently accessed positions
- WebSocket server for real-time updates
- Event sourcing for audit trail

---

## Concurrency & Synchronization

### Current Approach: Optimistic Locking

**Last-Write-Wins**:
- `updated_at` timestamp tracks last modification
- No explicit locking mechanism
- Race conditions possible but rare

**Example Race Condition**:
```
Time  | User A                    | User B
------|---------------------------|---------------------------
T1    | Fetch position v1         |
T2    |                           | Fetch position v1
T3    | Update tags = ["A"]       |
T4    |                           | Update tags = ["B"]
T5    | Sees tags = ["A"]         | Sees tags = ["B"]
```

Result: User B's update wins, User A's is lost.

---

### Mitigation Strategies

#### 1. Single Owner Model (Current)

**Rule**: Only the position owner can edit
- Eliminates concurrent edits
- Friends can only add comments
- Comments are append-only (no conflicts)

**Benefits**:
- Simple to implement
- No complex locking needed
- Clear ownership model

**Limitations**:
- No collaborative editing
- Owner must incorporate friend feedback manually

---

#### 2. Optimistic UI Updates (Current)

```javascript
const updateMutation = useMutation({
  mutationFn: updateTradeIdea,
  onMutate: async (newData) => {
    // Cancel any outgoing refetches
    await queryClient.cancelQueries({ queryKey: ['positions', 'ideas'] })
    
    // Snapshot previous value
    const previous = queryClient.getQueryData(['positions', 'ideas'])
    
    // Optimistically update UI
    queryClient.setQueryData(['positions', 'ideas'], (old) => {
      return old.map(p => p.id === newData.id ? { ...p, ...newData } : p)
    })
    
    // Return context for rollback
    return { previous }
  },
  onError: (err, newData, context) => {
    // Rollback on error
    queryClient.setQueryData(['positions', 'ideas'], context.previous)
  },
  onSettled: () => {
    // Refetch to ensure consistency
    queryClient.invalidateQueries({ queryKey: ['positions', 'ideas'] })
  }
})
```

**Benefits**:
- Instant UI feedback
- Graceful error handling
- Automatic consistency checks

---

#### 3. Comment Ordering (Current)

**Strategy**: Timestamp-based ordering
```javascript
comments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
```

**Conflict Resolution**:
- All comments accepted (append-only)
- No edit/delete conflicts
- Comments with same timestamp: stable sort by ID

---

### Future: True Concurrency Support

#### Option A: Version Numbers

```python
class Position:
    version: int  # Incremented on each update
    
def update_position(id, updates, expected_version):
    position = Position.query.filter_by(id=id).with_for_update().first()
    
    if position.version != expected_version:
        raise ConflictError("Position was modified by another user")
    
    # Apply updates
    position.version += 1
    db.commit()
```

**Frontend**:
```javascript
const updateWithVersion = {
  ...updates,
  expected_version: position.version
}
```

---

#### Option B: WebSockets for Real-Time Sync

```
┌────────────┐         ┌────────────┐         ┌────────────┐
│  User A    │◄──────► │ WebSocket  │◄──────► │  User B    │
│  Browser   │         │  Server    │         │  Browser   │
└────────────┘         └────────────┘         └────────────┘
                              │
                              ▼
                       ┌────────────┐
                       │  Database  │
                       └────────────┘

Events:
- position.updated
- comment.created
- position.shared
```

**Implementation**:
```python
# Backend
@sio.on('update_position')
async def handle_update(sid, data):
    position = update_position(data)
    
    # Notify all connected users with access
    recipients = get_share_recipients(position.id)
    for recipient in recipients:
        await sio.emit('position_updated', position, room=recipient.user_id)
```

```javascript
// Frontend
socket.on('position_updated', (position) => {
  queryClient.setQueryData(['positions', 'ideas', position.id], position)
  toast.info(`${position.symbol} was updated by owner`)
})
```

---

#### Option C: Operational Transformation

**For collaborative editing** (future):
- Track granular operations (add tag, remove tag, update field)
- Transform conflicting operations
- Ensure eventual consistency

**Example**:
```
User A: Add tag "bullish"
User B: Add tag "short-term"

Server applies both:
tags = ["bullish", "short-term"]
```

---

## Security Model

### Authentication

**Current**:
- Test user mode (authentication disabled for development)
- `current_user` hardcoded in API endpoints

**Future**:
- JWT tokens from `/auth/login`
- Token refresh mechanism
- Role-based access control (admin, user)

---

### Authorization

#### Position Access Control

```python
def can_access_position(user_id, position):
    # Owner always has access
    if position.user_id == user_id:
        return True
    
    # Check for active share
    if position.flavor == 'idea':
        share = PositionShare.query.filter_by(
            position_id=position.id,
            recipient_id=user_id,
            is_active=True
        ).first()
        return share is not None
    
    # Actual positions are private
    return False
```

---

#### Operation Permissions

| Operation | Owner | Shared (View) | Shared (Comment) | Non-Friend |
|-----------|-------|---------------|------------------|------------|
| View      | ✅    | ✅            | ✅               | ❌         |
| Comment   | ✅    | ❌            | ✅               | ❌         |
| Edit      | ✅    | ❌            | ❌               | ❌         |
| Delete    | ✅    | ❌            | ❌               | ❌         |
| Share     | ✅    | ❌            | ❌               | ❌         |

---

### Data Privacy

**Position Data**:
- Only shared with explicitly selected friends
- No "public" sharing option
- Friendship required before sharing

**Account Numbers**:
- Always masked in shared positions
- Only last 4 digits visible
- Schwab account hashes never exposed

**Comments**:
- Visible to all share recipients
- Author always identified
- No anonymous comments

---

## API Contract

### Position Endpoints

#### Get Trade Ideas

```http
GET /api/v1/positions/ideas
Query: ?status=planned&symbol=AAPL&strategy_type=vertical_spread

Response:
{
  "positions": [
    {
      "id": "uuid",
      "symbol": "AAPL",
      "strategy_type": "vertical_spread",
      "status": "planned",
      "tags": ["earnings", "bullish"],
      "legs": [...],
      "comment_count": 5,
      "share_count": 2
    }
  ],
  "total": 15
}
```

---

#### Convert Actual to Trade Idea

```http
POST /api/v1/positions/actual/{position_id}/convert-to-idea

Response:
{
  "id": "new-uuid",
  "flavor": "idea",
  "symbol": "GOOG",
  "strategy_type": "vertical_spread",
  "legs": [...],
  "notes": "Converted from Schwab position on 2025-10-30",
  "created_at": "2025-10-30T10:00:00Z"
}
```

---

#### Share Trade Idea

```http
POST /api/v1/positions/ideas/{position_id}/share

Body:
{
  "friend_ids": ["uuid1", "uuid2"],
  "access_level": "comment"
}

Response:
{
  "position_id": "uuid",
  "shared_with": ["uuid1", "uuid2"],
  "share_count": 2,
  "message": "Position shared successfully"
}
```

---

#### Get Shared Positions

```http
GET /api/v1/positions/shared

Response:
{
  "positions": [
    {
      "id": "uuid",
      "original_position_id": "uuid",
      "owner": {
        "id": "uuid",
        "display_name": "John Doe"
      },
      "symbol": "TSLA",
      "strategy_type": "covered_call",
      "shared_at": "2025-10-29T15:30:00Z",
      "read_only": true,
      "can_comment": true
    }
  ],
  "total": 8
}
```

---

### Comment Endpoints

#### Get Comments

```http
GET /api/v1/positions/{position_id}/comments

Response:
{
  "comments": [
    {
      "id": "uuid",
      "user": {
        "id": "uuid",
        "display_name": "Jane Smith"
      },
      "text": "I like this setup",
      "created_at": "2025-10-30T09:00:00Z"
    }
  ],
  "total": 12
}
```

---

#### Create Comment

```http
POST /api/v1/positions/{position_id}/comments

Body:
{
  "text": "What's your exit strategy?"
}

Response:
{
  "id": "uuid",
  "position_id": "uuid",
  "user_id": "uuid",
  "text": "What's your exit strategy?",
  "created_at": "2025-10-30T10:15:00Z"
}
```

---

## Frontend Components

### Component Hierarchy

```
App1
└── CollaborationDashboard
    ├── Header
    │   ├── Statistics Cards
    │   └── New Idea Button
    ├── Filters & Search
    └── Tabs
        ├── My Ideas Tab
        │   └── TradeIdeaCard[] (editable)
        └── Shared With Me Tab
            └── TradeIdeaCard[] (read-only)

TradeIdeaCard
├── Collapsed Header
│   ├── Symbol, Status, Strategy
│   ├── Key Metrics
│   ├── Action Buttons
│   └── Tags
└── Expanded Content (conditional)
    ├── Left Panel: Position Details
    │   ├── Metrics Grid
    │   ├── Legs Table
    │   └── Tag Input (owner only)
    └── Right Panel: Discussion
        ├── Message Thread
        ├── Message Input
        └── Share Modal (inline)
```

---

### Key Component Props

#### TradeIdeaCard

```typescript
interface TradeIdeaCardProps {
  position: Position;
  isReadOnly: boolean;
  highlightId?: string;  // Auto-expand if matches
  onDelete?: () => void;
  onUpdate?: (updates: Partial<Position>) => void;
}
```

**State**:
- `isExpanded`: Boolean
- `showShareModal`: Boolean
- `newMessage`: String
- `tagInput`: String

**Queries**:
- `comments`: Fetched when expanded
- `friends`: For share modal

**Mutations**:
- `updateMutation`: Update position
- `deleteMutation`: Delete position
- `shareMutation`: Share with friends
- `commentMutation`: Add comment

---

### Data Fetching Patterns

#### Lazy Loading

```javascript
const { data: commentsData } = useQuery({
  queryKey: ['comments', position.id],
  queryFn: () => getPositionComments(position.id),
  enabled: isExpanded  // Only fetch when card is expanded
});
```

**Benefits**:
- Reduces initial load time
- Saves bandwidth
- Improves performance with many positions

---

#### Pagination (Future)

```javascript
const {
  data,
  fetchNextPage,
  hasNextPage
} = useInfiniteQuery({
  queryKey: ['positions', 'ideas'],
  queryFn: ({ pageParam = 0 }) => fetchTradeIdeas({ skip: pageParam, limit: 20 }),
  getNextPageParam: (lastPage, pages) => 
    lastPage.hasMore ? pages.length * 20 : undefined
});
```

---

## Edge Cases & Error Handling

### 1. Converting Deleted Position

**Scenario**: Position deleted from Schwab between page load and conversion

**Handling**:
```javascript
try {
  const tradeIdea = await convertActualToTradeIdea(positionId);
} catch (error) {
  if (error.status === 404) {
    toast.error("Position no longer exists. Please refresh.");
  }
}
```

---

### 2. Sharing with Unfriended User

**Scenario**: User removes friend after share modal opens but before sharing

**Backend Validation**:
```python
for friend_id in friend_ids:
    friendship = Friendship.query.filter_by(
        user_id=current_user.id,
        friend_id=friend_id,
        status='accepted'
    ).first()
    
    if not friendship:
        raise ForbiddenError(f"Not friends with user {friend_id}")
```

---

### 3. Commenting on Unshared Position

**Scenario**: Share revoked while user has comment modal open

**Backend Validation**:
```python
if not can_access_position(user_id, position_id):
    raise UnauthorizedError("Access revoked")
```

**Frontend Handling**:
```javascript
onError: (error) => {
  if (error.status === 403) {
    toast.error("Access revoked by owner");
    navigate('/collaboration');
  }
}
```

---

### 4. Concurrent Tag Edits

**Scenario**: Owner edits tags while viewing on different devices

**Current**: Last-write-wins
**Future**: Merge strategy for arrays

```javascript
// Conflict resolution for tags
const mergedTags = [...new Set([...oldTags, ...newTags])];
```

---

### 5. Network Interruption

**Handling**:
```javascript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      staleTime: 5000,
      cacheTime: 300000
    }
  }
});
```

---

### 6. Large Comment Threads

**Performance**:
- Virtual scrolling for >100 comments (future)
- Pagination: Load 20 comments at a time
- "Load More" button for older comments

---

## Future Enhancements

### Short-Term

1. **Real-Time Updates**
   - WebSocket integration
   - Live comment notifications
   - Position update alerts

2. **Enhanced Permissions**
   - "Can edit" access level
   - Collaborative editing
   - Per-field permissions

3. **Audit Trail**
   - Track all changes
   - "View history" feature
   - Rollback capability

---

### Medium-Term

1. **Advanced Collaboration**
   - Group sharing (multiple recipients at once)
   - Collaboration rooms
   - Threaded comment replies
   - Reactions beyond basic emojis

2. **Conflict Resolution**
   - Version numbers
   - Merge strategies
   - Conflict UI

3. **Notifications**
   - Push notifications
   - Email digests
   - In-app notification center

---

### Long-Term

1. **Operational Transformation**
   - True collaborative editing
   - Live cursors
   - Conflict-free replicated data types (CRDTs)

2. **AI Integration**
   - Smart tagging
   - Similar position suggestions
   - Automated analysis

3. **Mobile App**
   - Native iOS/Android
   - Offline support
   - Push notifications

---

## Performance Considerations

### Current Metrics

- Initial load: ~500ms (10 positions)
- Comment thread load: ~200ms
- Share operation: ~300ms

### Bottlenecks

1. **N+1 Query Problem**
   - Eager load legs with positions
   - Join tables in single query

2. **Large Comment Threads**
   - Pagination needed at >50 comments
   - Virtual scrolling for UI

3. **Cache Invalidation**
   - Too aggressive: Poor UX
   - Too lazy: Stale data

---

## Monitoring & Observability

### Key Metrics to Track

1. **API Performance**
   - Request latency (p50, p95, p99)
   - Error rates by endpoint
   - Database query time

2. **User Engagement**
   - Positions shared per user
   - Comments per position
   - Collaboration activity

3. **Data Volume**
   - Total positions
   - Legs per position
   - Comments per position
   - Share relationships

---

## Conclusion

The collaboration system is designed with:
- ✅ **Simplicity**: Single owner model prevents conflicts
- ✅ **Scalability**: React Query enables efficient caching
- ✅ **Security**: Explicit sharing with friends only
- ✅ **Extensibility**: Clear architecture for real-time features

The current implementation prioritizes correctness and user experience over advanced concurrency. Future enhancements will layer on real-time sync and collaborative editing as usage grows.

---

**Document Maintainer**: Development Team  
**Review Schedule**: After major architecture changes  
**Related Documents**: 
- [Collaboration Features](./collaboration-features.md)
- [Position Management](./position-management.md)
- [Project Capabilities](./project-capabilities.md)

