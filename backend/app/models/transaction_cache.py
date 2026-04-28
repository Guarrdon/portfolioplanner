"""Schwab transaction cache.

Schwab transactions are immutable historical records — once a trade is
recorded, it doesn't change. We cache the raw Schwab payloads per
(user_id, account_hash, schwab_transaction_id) so that:

  - The transactions endpoint doesn't have to round-trip to Schwab on every
    page load.
  - "Refresh" only needs to fetch transactions newer than what's cached.
  - Auto-group / debugging tooling can read consistent data without
    re-hitting Schwab.

Annotations and link groups stay in their own tables and join on top of the
cached payload.
"""
from sqlalchemy import Column, String, DateTime, JSON
from datetime import datetime

from app.core.database import Base, GUID


class SchwabTransactionCache(Base):
    """One row per Schwab transaction. Raw payload is stored verbatim so we
    can re-normalize for any underlying without losing data."""
    __tablename__ = "schwab_transaction_cache"

    user_id = Column(GUID, primary_key=True)
    account_hash = Column(String(64), primary_key=True)
    schwab_transaction_id = Column(String(64), primary_key=True)

    # Denormalized for date-range queries without needing to parse JSON.
    trade_date = Column(DateTime, nullable=False, index=True)
    raw_payload = Column(JSON, nullable=False)

    fetched_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class SchwabTransactionCacheState(Base):
    """Per-account fetch bookkeeping. Tells us the time window we've already
    pulled from Schwab so refreshes can fetch only the gap."""
    __tablename__ = "schwab_transaction_cache_state"

    user_id = Column(GUID, primary_key=True)
    account_hash = Column(String(64), primary_key=True)

    # The end of the most recent successful fetch. Refreshes pull from
    # (last_fetched_at - safety_overlap) to now.
    last_fetched_at = Column(DateTime, nullable=False)

    # The earliest start_date we've ever pulled. If a caller asks for a
    # longer window than this covers, we extend backwards.
    earliest_fetched_date = Column(DateTime, nullable=False)
