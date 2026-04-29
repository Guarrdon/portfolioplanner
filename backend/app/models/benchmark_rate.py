"""Cached benchmark interest rates from FRED.

One row per FRED series_id (e.g. 'DGS3MO' for 3-month Treasury). 24h TTL —
rates change daily but a few-hour-stale rate is fine for the box-spreads
yield-comparison use case.
"""
from sqlalchemy import Column, String, DateTime, Float, Date
from datetime import datetime

from app.core.database import Base


class BenchmarkRateCache(Base):
    __tablename__ = "benchmark_rate_cache"

    series_id = Column(String(32), primary_key=True)
    # Latest published rate as a percentage (e.g. 3.68 for 3.68%).
    rate_pct = Column(Float, nullable=True)
    # Date FRED says the rate is effective for (last business day on weekends).
    rate_date = Column(Date, nullable=True)
    fetched_at = Column(DateTime, default=datetime.utcnow, nullable=False)
