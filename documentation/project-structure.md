# Portfolio Planner MVP - Updated Project Structure

## Directory Structure
```
portfolio-planner/
├── frontend/
│   ├── public/
│   │   ├── index.html
│   │   ├── favicon.ico
│   │   └── manifest.json
│   ├── src/
│   │   ├── components/
│   │   │   ├── analysis/
│   │   │   │   └── PortfolioAnalytics.jsx
│   │   │   ├── auth/
│   │   │   │   ├── LoginForm.jsx
│   │   │   │   └── RequireAuth.jsx
│   │   │   ├── calendar/
│   │   │   │   ├── CalendarView.jsx
│   │   │   │   ├── EventList.jsx
│   │   │   │   └── EventDetail.jsx
│   │   │   ├── common/
│   │   │   │   ├── AccountSelect.jsx
│   │   │   │   ├── Comments.jsx
│   │   │   │   ├── CommonFormFields.jsx
│   │   │   │   ├── EmptyState.jsx
│   │   │   │   ├── FilterSort.jsx
│   │   │   │   ├── Header.jsx
│   │   │   │   ├── Navigation.jsx
│   │   │   │   ├── ProfileMenu.jsx
│   │   │   │   ├── SharedPositionBadge.jsx
│   │   │   │   ├── StrategySelector.jsx
│   │   │   │   ├── SyncAllButton.jsx
│   │   │   │   ├── SyncNotification.jsx
│   │   │   │   └── Toggle.jsx
│   │   │   ├── forms/
│   │   │   │   ├── BaseStrategyForm.jsx
│   │   │   │   ├── BigOptionForm.jsx
│   │   │   │   ├── BOXSpreadForm1.jsx
│   │   │   │   ├── CoveredCallForm.jsx
│   │   │   │   ├── DividendForm.jsx
│   │   │   │   ├── MiscForm.jsx
│   │   │   │   ├── PositionLegForm.jsx
│   │   │   │   └── PutSpreadForm.jsx
│   │   │   ├── metrics/
│   │   │   │   ├── BigOptionsMetricsCalculator.jsx
│   │   │   │   ├── BoxSpreadMetricsCalculator.jsx
│   │   │   │   ├── DividendMetricsCalculator.jsx
│   │   │   │   ├── MaxProfitCalculator.jsx
│   │   │   │   ├── MiscMetricsCalculator.jsx
│   │   │   │   └── SpreadMetricsCalculator.jsx
│   │   │   ├── modals/
│   │   │   │   ├── DeleteConfirmationModal.jsx
│   │   │   │   └── SharePositionModal.jsx
│   │   │   ├── portfolio/
│   │   │   │   ├── PortfolioView.jsx
│   │   │   │   └── StrategyCard.jsx
│   │   │   ├── positions/
│   │   │   │   ├── ActivityLog.jsx
│   │   │   │   ├── ConflictResolution.jsx
│   │   │   │   ├── ExpandedPositionCard.jsx
│   │   │   │   ├── PositionActions.jsx
│   │   │   │   ├── PositionDetails.jsx
│   │   │   │   ├── SharedUpdatesIndicator.jsx
│   │   │   │   ├── SyncStatusBadge.jsx
│   │   │   │   └── UnsyncedChangesBadge.jsx
│   │   │   ├── settings/
│   │   │   │   ├── AccountManagement.jsx
│   │   │   │   ├── FriendManagement.jsx
│   │   │   │   ├── ProfileSettings.jsx
│   │   │   │   └── SettingsView.jsx
│   │   │   └── strategies/
│   │   │       ├── BigOptionsView.jsx
│   │   │       ├── BoxSpreadsView.jsx
│   │   │       ├── CoveredCallsView.jsx
│   │   │       ├── DividendsView.jsx
│   │   │       ├── MiscView.jsx
│   │   │       ├── PutSpreadsView.jsx
│   │   │       └── StrategyView.jsx
│   │   ├── contexts/
│   │   │   ├── AccountsContext.jsx
│   │   │   ├── CalendarContext.jsx
│   │   │   ├── CommentsContext.jsx
│   │   │   ├── FriendsContext.jsx
│   │   │   ├── PortfolioContext.jsx
│   │   │   └── UserContext.jsx
│   │   ├── hooks/
│   │   │   └── useSyncCheck.js
│   │   ├── utils/
│   │   │   ├── activityTracking.js
│   │   │   ├── commentsStorage.js
│   │   │   ├── optimisticUpdates.js
│   │   │   ├── storage/
│   │   │   │   └── storage.js
│   │   │   ├── testing/
│   │   │   │   └── testHelpers.js
│   │   │   └── validation/
│   │   │       ├── baseValidation.js
│   │   │       ├── bigOptionsValidation.js
│   │   │       ├── coveredCallValidation.js
│   │   │       ├── dividendValidation.js
│   │   │       ├── index.js
│   │   │       ├── miscValidation.js
│   │   │       └── putSpreadValidation.js
│   │   ├── styles/
│   │   │   └── index.css
│   │   ├── App1.jsx
│   │   └── index.js
│   ├── .gitignore
│   ├── package.json
│   ├── postcss.config.js
│   └── tailwind.config.js
├── documentation/
│   ├── project-plan-review.md
│   └── project-structure.txt
└── backend/ (planned but not implemented yet)
```

## Component Organization

### Core Components
- **App1.jsx** - Main application component with routing and context providers
- **components/portfolio/PortfolioView.jsx** - Main portfolio overview
- **components/calendar/CalendarView.jsx** - Calendar view for planning

### Strategy-Specific Components
- **components/strategies/** - Strategy-specific views
  - CoveredCallsView.jsx
  - PutSpreadsView.jsx
  - BigOptionsView.jsx
  - DividendsView.jsx
  - BoxSpreadsView.jsx
  - MiscView.jsx
  - StrategyView.jsx (base component for all strategy views)

### Position Management Components
- **components/positions/** - Position card and related components
  - ExpandedPositionCard.jsx
  - PositionActions.jsx
  - ActivityLog.jsx
  - ConflictResolution.jsx

### Forms 
- **components/forms/** - Strategy-specific forms
  - BaseStrategyForm.jsx (base form component)
  - Strategy-specific forms (CoveredCallForm.jsx, PutSpreadForm.jsx, etc.)

### User Interface Components
- **components/common/** - Reusable UI components
  - Header.jsx
  - Navigation.jsx
  - FilterSort.jsx
  - Comments.jsx

### Authentication Components
- **components/auth/** - Authentication related components
  - LoginForm.jsx
  - RequireAuth.jsx

### Settings Components
- **components/settings/** - User settings and account management
  - SettingsView.jsx
  - ProfileSettings.jsx
  - AccountManagement.jsx
  - FriendManagement.jsx

### Calculation Components
- **components/metrics/** - Financial calculation components
  - MaxProfitCalculator.jsx
  - SpreadMetricsCalculator.jsx
  - BoxSpreadMetricsCalculator.jsx

## Context Providers
- **UserContext** - User authentication and profile
- **PortfolioContext** - Portfolio data management
- **CalendarContext** - Calendar events
- **CommentsContext** - Position comments
- **AccountsContext** - User accounts
- **FriendsContext** - User relationships for sharing

## Utility Modules
- **utils/storage/** - Local storage management
- **utils/validation/** - Form validation logic
- **utils/activityTracking.js** - Position activity logging
- **utils/optimisticUpdates.js** - Optimistic UI updates for shared positions

## Custom Hooks
- **hooks/useSyncCheck.js** - Hook for checking shared position updates