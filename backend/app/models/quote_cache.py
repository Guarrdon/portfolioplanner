"""Underlying spot price cache.

Schwab option positions don't carry the underlying's spot price. We need it
to display "where is the underlying right now" alongside option positions.
The Schwab Market Data quotes endpoint provides it, but we don't want to
re-fetch on every page load — quotes are cheap but rate-limited and the
user has explicitly said real-time isn't needed.

One row per (user_id, symbol). `fetched_at` drives staleness. Callers
decide the TTL.
"""
from sqlalchemy import Column, String, DateTime, Float
from datetime import datetime

from app.core.database import Base, GUID


class UnderlyingQuoteCache(Base):
    __tablename__ = "underlying_quote_cache"

    user_id = Column(GUID, primary_key=True)
    symbol = Column(String(32), primary_key=True)

    last_price = Column(Float, nullable=True)
    bid = Column(Float, nullable=True)
    ask = Column(Float, nullable=True)
    fetched_at = Column(DateTime, default=datetime.utcnow, nullable=False)
