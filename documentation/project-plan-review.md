# Portfolio Planner MVP - Project Planning Document

## Project Overview
A web-based portfolio planning tool with two primary capabilities:
1. Portfolio visualization and planning
2. Calendar-based action planning for market moves

## Technology Stack
- Frontend: React/JavaScript
- Backend: Python
- Deployment: Local development initially, AWS deployment planned

## Key Features (Initial)
- Manual data entry for MVP
- Portfolio visualization
- Calendar/planning interface
- Local hosting

## Future Considerations
- Data import capabilities:
  - Schwab brokerage API integration
  - Yahoo Finance market data feed
- AWS deployment
- Real-time market data integration
- Multi-user collaboration features:
  - Shared portfolio views
  - Collaborative planning

## Requirements Gathering

### Calendar Interface Requirements
1. Split View Layout:
   - Left side: Traditional month calendar
     - Scrollable across months
     - Dynamic event loading per month
     - Visual indicators for events/notes
   - Right side: Chronological event list
     - Scrollable timeline of upcoming events
     - Continuous loading of future events
     
2. Event Features:
   - Cross-linking between calendar and list views
   - Event details visible in both views
   - Future consideration: Event caching for performance

### Data Entry Requirements
1. Strategy-Specific Forms:
   - Covered Calls: Stock details + related option fields
   - Put Option Spread: Multiple option entry fields
   - Big Options: Single option focus
   - Dividends: Stock-specific fields
   - Misc: Flexible form for other position types

2. Entry Features:
   - Dynamic fields based on selected strategy
   - Basic position entry for v1
   - Future consideration: Position modifications (averaging up/down)

### Planning Interface Requirements
1. Action Types:
   - Position modifications (partial exits, adding hedges)
   - Market event tracking (earnings dates, dividend dates)
   - Strategy notes with conditions (e.g., "close if volatility exceeds X%")
   
2. Interface Features:
   - Calendar view for date-based planning
   - Position linking capabilities
   - Comment system:
     - Chronological history of all comments
     - Timestamp for each comment
     - Full comment history viewable per position
   - Tagging system:
     - Tags displayed prominently at position level
     - Easy add/remove tag functionality
     - Future: AI-powered automatic tag suggestions
   - No immediate alerting mechanism needed

### Portfolio Data Structure
1. Primary Groupings (Strategies):
   - Covered Calls
   - Standard Put Option Spread
   - Big Options
   - Dividends
   - Misc
   - Future consideration: Custom grouping for exotic positions/pairs

2. Investment Data Points:
   - Account identifier
   - Strategy category
   - Symbol
   - Asset type (stock/option/future)
   - Quantity/Amount
   - Cost basis/Credit received
   - Option-specific data:
     - Call/Put indicator
     - Expiration date
     - Strike price
   - Opening transaction datetime
   - Volume
   - Volatility
   - Custom risk level
   - Notes field
   - Tags (e.g., "close soon", "double up")