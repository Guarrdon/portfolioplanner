# Reference Implementation

This directory contains reference implementations used as inspiration for the Portfolio Planner Schwab API integration.

## Contents

### LoP-s-Premium-Tracker
A desktop application that demonstrates Schwab API integration patterns, including:
- OAuth 2.0 authentication flow
- Token management and automatic refresh
- Position data fetching and transformation
- Options portfolio analysis
- Account management

## Usage

These files are **reference only** and are not directly executed by the Portfolio Planner application. They serve as examples for:

1. **Schwab API Patterns**: How to authenticate and make API calls
2. **Data Transformation**: Converting Schwab API responses to usable formats
3. **Token Management**: Handling OAuth tokens and refresh logic
4. **Error Handling**: Dealing with API errors and edge cases

## Integration Approach

The Portfolio Planner uses concepts from this reference implementation but with significant differences:

| Aspect | Reference Implementation | Portfolio Planner |
|--------|-------------------------|-------------------|
| Architecture | Desktop GUI application | Web application (React + FastAPI) |
| Authentication | Per-machine token file | Per-user database-stored tokens |
| Data Storage | Local files and memory | PostgreSQL database |
| Token Management | File-based with standalone manager | Database-backed with encryption |
| Accounts | All accounts synced | User-selected accounts only |
| Purpose | Portfolio tracking | Planning + tracking + collaboration |

## Key Files

- `schwab_helper.py` - Schwab API client wrappers
- `standalone_token_refresh.py` - Token refresh manager
- `options_portfolio_analyzer.py` - Position analysis logic
- `get_refresh_token.py` - Initial OAuth flow

## Notes

- These files require dependencies listed in `requirements.txt`
- Configuration files (`.toml`, `.json`) are not included (gitignored)
- For actual Portfolio Planner integration, see `backend/app/services/schwab.py`

---

**Source**: LoP's Premium Tracker
**Purpose**: Reference implementation for learning
**Status**: Archived for reference
**Last Reviewed**: 2025-10-25

