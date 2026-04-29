"""Earnings + user-defined catalyst dates.

Two tables, deliberately split by source-of-truth:

- EarningsCache: auto-populated from Yahoo Finance via yfinance. Global
  (no user_id) since earnings calendars are public data and identical
  across users. 12h TTL — earnings dates rarely change, but we want a
  same-day refresh window so a moved date catches up by the next morning.

- UserCatalyst: user-managed catalysts (FDA decisions, conference dates,
  lockup expirations). Multiple rows per (user_id, symbol) allowed since
  a single underlying can have several upcoming catalysts.

The Big Options panel reads both and surfaces the nearest catalyst that
falls inside a position's [today, expiration] window.
"""
from sqlalchemy import Column, String, Date, DateTime, Index
from datetime import datetime
import uuid

from app.core.database import Base, GUID


class EarningsCache(Base):
    """Cached next-earnings-date per ticker. Global (no user_id)."""
    __tablename__ = "earnings_cache"

    symbol = Column(String(32), primary_key=True)
    # Confirmed or estimated date. yfinance sometimes returns a range of
    # two dates (estimated). We store the earliest — that's the date the
    # position-side catalyst-window check should treat as "in scope."
    next_earnings_date = Column(Date, nullable=True)
    # Set when yfinance returned no calendar entry — distinct from "we
    # haven't fetched yet." Lets us avoid retrying every sync for tickers
    # Yahoo doesn't track (small caps, ETFs, indices).
    has_no_data = Column(String(1), nullable=False, default="N")  # "Y" / "N"
    fetched_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class UserCatalyst(Base):
    """User-defined catalyst dates. Manual entry, multiple per symbol."""
    __tablename__ = "user_catalysts"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    user_id = Column(GUID, nullable=False, index=True)
    symbol = Column(String(32), nullable=False, index=True)
    catalyst_date = Column(Date, nullable=False)
    # Free-text label for what this catalyst is. "FDA panel", "Q4 earnings
    # call rescheduled", "Investor day", etc. Optional.
    label = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


# Composite index on (user_id, symbol) for the panel-side query that
# reads "all catalysts for this user, this ticker."
Index(
    "ix_user_catalysts_user_symbol",
    UserCatalyst.user_id, UserCatalyst.symbol,
)
