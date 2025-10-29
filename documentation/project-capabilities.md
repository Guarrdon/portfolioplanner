# Portfolio Planner - Project Capabilities

## Project Vision

The Portfolio Planner is a collaborative platform for tracking, planning, and sharing stock and option trading strategies. It integrates with the Schwab API to import real positions while supporting trade idea planning and collaboration features.

## Current Implementation Status

**Phase 1 (In Progress)**: The application consists of a React frontend with local storage, and we are actively developing a Python FastAPI backend with PostgreSQL database and Schwab API integration.

### Position Flavors
The system manages three distinct types of positions:
- **Actual Positions**: Real positions synced from Schwab API (read-only)
- **Trade Ideas**: User-created planning positions (fully editable, shareable)
- **Shared Positions**: Trade ideas shared by friends (view + comment)

## Core Features Implemented

### Trade Idea Collaboration (NEW)
- **Dual Entry Points**:
  - Convert actual Schwab positions to trade ideas for collaboration
  - Create new trade ideas directly in Collaboration Dashboard
- **Collaboration Dashboard**: Central hub with:
  - "My Trade Ideas" tab - view and manage your trade ideas
  - "Shared With Me" tab - view positions shared by friends
  - Search and filter capabilities
  - Collaboration statistics and activity metrics
- **Collaboration Modal**: Two-step wizard for:
  - Converting positions to trade ideas
  - Selecting friends to share with
  - Adding context notes
- **Position Sharing**: Share trade ideas with friends for discussion
- **Comments System**: Add comments to positions for collaboration
- **Access Control**: Friend-based sharing with view/comment permissions

### Portfolio Management
- **Multiple Strategy Types**: Support for various investment strategies:
  - Covered Calls
  - Put Option Spreads
  - Big Options
  - Margin Spreads (Box Spreads)
  - Dividend Positions
  - Miscellaneous Positions
- **Position Creation**: Comprehensive forms for each strategy type
- **Position Details**: Detailed view of position components and metrics
- **Comments System**: Add, edit, and delete comments on positions
- **Position Tags**: Tagging system for categorization and filtering
- **Activity Logging**: Automatic tracking of all position changes and activities

### Multi-User Functionality
- **User Authentication**: Basic multi-user support with user profiles
- **Account Management**: Create and manage trading accounts
- **Position Sharing**: Share positions with other users
- **Simplified Synchronization**: Streamlined process for syncing shared positions
- **Collaboration Features**: Comment on shared positions, with automatic merging of changes

### Calendar & Event Planning
- **Calendar View**: Month-based calendar visualization
- **Event Management**: Add, view, and manage market events
- **Event Linking**: Link events to specific positions
- **Timeline View**: Chronological view of upcoming events

### Analytics & Reporting
- **Portfolio Analytics**: Overview dashboard with key metrics
- **Position Metrics**: Strategy-specific calculations (max profit, risk, etc.)
- **Concentration Analysis**: Track symbol concentration and position exposure

### User Interface
- **Dashboard View**: Overview of all strategies
- **Filtering & Sorting**: Advanced filtering based on various criteria
- **Search Capabilities**: Search by symbol, account, or custom filters
- **Responsive Design**: Mobile-friendly interface using Tailwind CSS
- **User Settings**: Profile management and preference settings

## Technical Implementation

### Frontend Technologies
- **React 18**: Component-based UI with React hooks
- **React Router**: Client-side routing
- **Context API**: Global state management
- **Tailwind CSS**: Utility-first styling
- **Local Storage**: Client-side data persistence
- **Lucide React**: Icon library for UI elements

### Data Management
- **Optimistic Updates**: UI updates immediately while changes sync
- **Activity Tracking**: Comprehensive history of position changes
- **Validation**: Robust form validation for all strategy types
- **Local Storage Interface**: Abstract storage layer for future backend integration

### Collaboration Features
- **Friend Management**: Add/remove friends for position sharing
- **Simple Sync Mechanism**: Straightforward synchronization of shared positions
- **Change Tracking**: Minimal, user-friendly change indicators
- **Comment Merging**: Automatic retention of comments from all users

## In Development (Phase 1)

### Backend Infrastructure
- ✅ **Architecture Design**: Complete technical architecture defined
- ✅ **Python Backend**: FastAPI RESTful API with SQLite (dev) and PostgreSQL (prod) support
- 🔨 **Authentication**: JWT-based user authentication and authorization (structure complete, UI pending)
- ✅ **Database**: Multi-database support with custom types for UUID and arrays
- ✅ **Schwab Integration**: OAuth flow implemented with real API and mock data support

### Position Management
- ✅ **Actual Positions**: Schwab API sync with account selection fully implemented
  - Real-time position data from Schwab API
  - Strategy auto-detection (covered calls, vertical spreads, box spreads, big options)
  - Multi-account support with account filtering
  - Position grouping by account → strategy → symbol
  - Comprehensive metrics: P&L, cost basis, current value, Greeks (placeholders)
- ✅ **Trade Ideas**: Already functional in frontend, backend API in progress
- 🔨 **Shared Positions**: Backend sharing infrastructure in development

### Schwab Positions UI
- ✅ **Dense Data Grid Interface**: Application-style table for viewing 100-200+ positions
  - **Single-account view** with dropdown selector for account filtering
  - Multi-level collapsible grouping (Strategy → Symbol → Legs)
  - Expandable position rows showing individual option/stock legs
  - Intelligent multi-state expansion controls (Collapsed → Strategies → Fully Expanded)
  - OCC option symbol decoding to human-readable format (e.g., "NVDA 19DEC25 170 P")
  - Color-coded P&L indicators (green/red) and day P&L (blue/orange)
  - Visual indicators for puts vs. calls (blue badges for calls, purple for puts)
  - **Account summary card** at top with comprehensive metrics:
    - Position metrics: Cost Basis, Current Value, Unrealized P&L, P&L%, Today's P&L
    - Risk metrics: BP Effect, Net Exposure
    - **Account balances**: Net Liquid, Cash Sweep
    - **Smart Buying Power display**: Auto-detects account type
      - Reg-T accounts: Shows separate "Stock BP" and "Options BP"
      - Portfolio Margin: Shows single "Buying Power" (when values equal)
    - Always visible, even for accounts with no positions
  - Hash-based position filtering (matches `account_hash` to `account_id` for security)
  - Real-time sync with refresh button
  - Empty state handling with full account info display
  - Subtle strategy-level summaries embedded in headers
  
### Strategy Detection & Classification
- ✅ **Automated Strategy Recognition**: Backend logic to identify common option strategies
  - **Covered Calls**: Long stock + short call
  - **Vertical Spreads**: Bull/bear call and put spreads
  - **Box Spreads**: 4-leg arbitrage strategies
  - **Big Options**: Large single-leg positions (qty ≥ 10 or cost ≥ $5000)
  - **Single Options**: Smaller single-leg positions
  - **Long/Short Stock**: Individual equity holdings
  - Signed cost basis calculations for proper multi-leg P&L
  
### Data Transformations
- ✅ **Option Symbol Parsing**: OCC format decoding with timezone-safe expiration handling
- ✅ **Signed Cost Basis**: Proper credit/debit handling for multi-leg strategies
- ✅ **Position Leg Rollups**: Accurate aggregation of leg metrics to position level
- ✅ **Days to Expiration**: Timezone-aware calculation with shortest DTE for multi-leg strategies
- ✅ **Trade Price vs. Current Price**: Separation of entry price and market price for accurate P&L

## Future Development (Planned)

### Phase 2: Enhanced Schwab Integration
- ✅ **Account Balance Details**: Complete implementation with smart display
  - Net Liquid (liquidation value)
  - Cash Sweep (cash balance)
  - Intelligent Buying Power display (auto-detects Reg-T vs Portfolio Margin)
- ✅ **Single Account View**: Dropdown selector for focused account analysis
- ✅ **Empty Account Handling**: Full summary display even without positions
- **OAuth 2.0 Flow**: Complete Schwab authentication in app UI
- **Real-time Sync Automation**: Automatic background sync on schedule
- **Token Management**: Enhanced token refresh and error handling
- **Greeks Integration**: Display real-time Delta, Theta, Vega from Schwab API
- **Day Trading Buying Power**: Add display for `dayTradingBuyingPower` field

### Phase 3: Enhanced Collaboration
- ✅ **Trade Idea Collaboration**: Convert actual positions to trade ideas for collaboration
- ✅ **Collaboration Dashboard**: Central hub for managing collaborative trade ideas
- ✅ **Dual Entry Points**: Collaborate from Schwab positions or dashboard
- ✅ **Position Sharing**: Share trade ideas with friends
- ✅ **Comments System**: Discuss positions with collaborators
- **Real-time Notifications**: Alert users of position updates and shares
- **Activity Feeds**: Track friend activity and position changes
- **Enhanced Permissions**: Granular sharing controls
- **Performance Analytics**: Track shared position performance

### Phase 4: Advanced Features
- **Market Data Integration**: Real-time quotes and greeks
- **P&L Tracking**: Historical performance analysis
- **Risk Analysis**: Portfolio-level risk metrics
- **Automated Insights**: AI-powered trade suggestions
- **Mobile App**: Native iOS/Android applications

### Deployment & Operations
- **AWS Deployment**: Cloud hosting with auto-scaling
- **CI/CD Pipeline**: Automated testing and deployment
- **Monitoring**: Application performance monitoring
- **Backup & Recovery**: Automated database backups

## Feature Status Legend
- ✅ **Complete**: Feature implemented and tested
- 🔨 **In Progress**: Actively being developed
- 📋 **Planned**: Designed and scheduled
- 🔮 **Future**: Long-term roadmap item