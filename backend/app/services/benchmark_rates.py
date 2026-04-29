"""FRED benchmark interest-rate fetcher.

Used by the Box Spreads panel to compute "Δ vs benchmark" — the gap
between a box's implied yield and the comparable risk-free rate. The
default series is `DGS3MO` (3-month Treasury constant maturity rate),
which tracks short-tenor box-spread implied rates closely.

Lazy-fetch model: panel callers ask `get_latest_rate_pct(series_id)`,
which serves cache rows fresher than 24h or refreshes from FRED. If the
key isn't configured or the call fails, callers get None and the panel
gracefully drops to no-benchmark mode rather than crashing.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

import requests
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.benchmark_rate import BenchmarkRateCache

logger = logging.getLogger(__name__)

DEFAULT_SERIES = "DGS3MO"  # 3-month Treasury constant maturity rate
DEFAULT_TTL_SECONDS = 24 * 60 * 60  # 24h — rates change daily, sub-day refresh is overkill
FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"


def _fetch_from_fred(series_id: str) -> Optional[dict]:
    """Hit FRED for the latest published observation. Returns
    {'rate_pct': float, 'rate_date': date} or None.

    FRED returns the most recent observations sorted desc; we walk the
    list looking for the first non-'.' value (FRED uses '.' for missing
    days like federal holidays).
    """
    api_key = (settings.FRED_API_KEY or "").strip()
    if not api_key:
        logger.warning("FRED_API_KEY not configured; skipping benchmark fetch")
        return None
    params = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "sort_order": "desc",
        "limit": 10,  # cushion against a few stale-day misses (holidays)
    }
    try:
        resp = requests.get(FRED_BASE_URL, params=params, timeout=10)
    except Exception as exc:
        logger.warning("FRED request raised: %s", exc)
        return None
    if resp.status_code != 200:
        logger.warning("FRED returned status=%s: %s", resp.status_code, resp.text[:200])
        return None
    try:
        body = resp.json()
    except Exception:
        logger.warning("FRED returned non-JSON body")
        return None
    for obs in body.get("observations") or []:
        val = obs.get("value")
        if val and val != ".":
            try:
                return {
                    "rate_pct": float(val),
                    "rate_date": datetime.fromisoformat(obs["date"]).date(),
                }
            except (TypeError, ValueError):
                continue
    return None


def get_latest_rate_pct(
    db: Session,
    series_id: str = DEFAULT_SERIES,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
) -> Optional[float]:
    """Return the latest cached or freshly-fetched rate for the series.

    Returns None when the rate is unavailable (no key, FRED outage,
    series doesn't exist). Callers should treat None as "skip the
    benchmark comparison" rather than 0.
    """
    now = datetime.utcnow()
    fresh_after = now - timedelta(seconds=ttl_seconds)

    row = (
        db.query(BenchmarkRateCache)
        .filter(BenchmarkRateCache.series_id == series_id)
        .first()
    )

    if row and row.fetched_at and row.fetched_at >= fresh_after and row.rate_pct is not None:
        return float(row.rate_pct)

    fetched = _fetch_from_fred(series_id)
    if fetched is None:
        # Serve stale-but-cached rate if we have one — better than None
        # when FRED is having a bad day.
        if row and row.rate_pct is not None:
            return float(row.rate_pct)
        return None

    if row is None:
        row = BenchmarkRateCache(series_id=series_id)
        db.add(row)
    row.rate_pct = fetched["rate_pct"]
    row.rate_date = fetched["rate_date"]
    row.fetched_at = now

    try:
        db.commit()
    except Exception as exc:
        logger.warning("failed to commit benchmark_rate_cache: %s", exc)
        db.rollback()

    return fetched["rate_pct"]


def get_latest_rate_with_meta(
    db: Session,
    series_id: str = DEFAULT_SERIES,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
) -> Optional[dict]:
    """Same as get_latest_rate_pct but returns full metadata for display.
    Returns {'rate_pct', 'rate_date' (ISO str), 'series_id', 'fetched_at'}
    or None."""
    rate = get_latest_rate_pct(db, series_id, ttl_seconds)
    if rate is None:
        return None
    row = (
        db.query(BenchmarkRateCache)
        .filter(BenchmarkRateCache.series_id == series_id)
        .first()
    )
    if not row:
        return None
    return {
        "series_id": series_id,
        "rate_pct": float(row.rate_pct) if row.rate_pct is not None else None,
        "rate_date": row.rate_date.isoformat() if row.rate_date else None,
        "fetched_at": row.fetched_at.isoformat() if row.fetched_at else None,
    }
