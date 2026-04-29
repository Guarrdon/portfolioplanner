"""Earnings + manual catalyst lookup.

Source of truth split:
  - EarningsCache (auto, yfinance, 12h TTL): public earnings dates.
  - UserCatalyst (manual): user-defined catalysts (FDA, conferences, etc.).

The Big Options panel calls `get_catalysts_in_window()` to find any catalyst
falling between today and a position's expiration. Earnings + manual entries
are merged and sorted by date.

Why yfinance: free, no API key, the de-facto retail wrapper for Yahoo
Finance data. It occasionally breaks when Yahoo changes endpoints — we
swallow exceptions and let the panel show stale dates rather than crash.
"""
from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta
from typing import Dict, Iterable, List, Optional

from sqlalchemy.orm import Session

from app.models.catalyst import EarningsCache, UserCatalyst

logger = logging.getLogger(__name__)

# yfinance hits Yahoo endpoints; we want to be polite. One symbol at a time
# is the supported API surface for `Ticker.calendar`. Sleep between calls
# protects against per-IP throttles.
INTER_SYMBOL_DELAY_SECONDS = 0.25
DEFAULT_TTL_SECONDS = 12 * 60 * 60  # 12h — same-day refresh, next-day catchup

# Tickers Yahoo doesn't track (indices, futures). Skipping these saves
# pointless 404s and lets the cache stay clean.
_NON_QUOTABLE_PREFIXES = ("$", ".")


def _quotable(symbol: str) -> bool:
    if not symbol:
        return False
    if any(symbol.startswith(p) for p in _NON_QUOTABLE_PREFIXES):
        return False
    if ":" in symbol:  # futures contract codes
        return False
    return True


def _extract_earnings_date(calendar) -> Optional[date]:
    """Pull the earliest earnings date from yfinance's Ticker.calendar dict.

    Shape varies:
      {'Earnings Date': [datetime.date(2026, 4, 30)]}              # confirmed
      {'Earnings Date': [datetime.date(2026, 5, 6),                # estimated
                         datetime.date(2026, 5, 12)]}
      {} or None                                                   # no data
    """
    if not isinstance(calendar, dict):
        return None
    raw = calendar.get("Earnings Date")
    if not raw:
        return None
    if isinstance(raw, list):
        candidates = [d for d in raw if isinstance(d, date)]
        if not candidates:
            return None
        return min(candidates)
    if isinstance(raw, date):
        return raw
    return None


def _fetch_one(symbol: str) -> Optional[date]:
    """Single yfinance lookup. Returns None on error or no-data."""
    try:
        import yfinance as yf  # imported lazily — keeps the prod boot lean
    except ImportError:
        logger.warning("yfinance not installed; skipping earnings fetch")
        return None
    try:
        t = yf.Ticker(symbol)
        cal = t.calendar
    except Exception as exc:
        # yfinance throws connection errors / parse errors when Yahoo's
        # endpoints shift. Caller treats this as "no data."
        logger.warning("yfinance lookup failed for %s: %s", symbol, exc)
        return None
    return _extract_earnings_date(cal)


def refresh_earnings_for_symbols(
    db: Session,
    symbols: Iterable[str],
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
) -> Dict[str, Optional[date]]:
    """Refresh stale entries for the given symbols. Returns the resulting
    map {symbol → next_earnings_date or None}.

    Symbols with `has_no_data='Y'` set within TTL are skipped — Yahoo
    isn't going to start tracking a symbol it doesn't know about, so
    re-checking every sync is waste.
    """
    wanted = sorted({(s or "").strip().upper() for s in symbols if _quotable((s or "").strip())})
    if not wanted:
        return {}

    now = datetime.utcnow()
    fresh_after = now - timedelta(seconds=ttl_seconds)

    rows = (
        db.query(EarningsCache)
        .filter(EarningsCache.symbol.in_(wanted))
        .all()
    )
    cached = {r.symbol: r for r in rows}

    out: Dict[str, Optional[date]] = {}
    to_fetch: List[str] = []

    for sym in wanted:
        row = cached.get(sym)
        if row and row.fetched_at and row.fetched_at >= fresh_after:
            # Fresh row — serve cached. has_no_data='Y' means Yahoo didn't
            # know it last time; we still served it as None.
            out[sym] = row.next_earnings_date
            continue
        to_fetch.append(sym)

    if not to_fetch:
        return out

    for i, sym in enumerate(to_fetch):
        if i > 0:
            time.sleep(INTER_SYMBOL_DELAY_SECONDS)
        next_date = _fetch_one(sym)
        out[sym] = next_date

        row = cached.get(sym)
        if row is None:
            row = EarningsCache(symbol=sym)
            db.add(row)
            cached[sym] = row
        row.next_earnings_date = next_date
        row.has_no_data = "N" if next_date else "Y"
        row.fetched_at = now

    try:
        db.commit()
    except Exception as exc:
        logger.warning("failed to commit earnings_cache: %s", exc)
        db.rollback()

    return out


def get_catalysts_in_window(
    db: Session,
    user_id: str,
    symbol: str,
    window_end: date,
    window_start: Optional[date] = None,
) -> List[Dict[str, object]]:
    """Return catalysts for `symbol` falling inside [window_start, window_end].

    Merges earnings (auto) + user catalysts (manual). Each entry:
        {date: ISO str, label: str, source: 'earnings' | 'manual'}
    Sorted by date ascending. Window default starts at today.
    """
    today = window_start or datetime.utcnow().date()
    sym = (symbol or "").strip().upper()
    if not sym or window_end is None or window_end < today:
        return []

    out: List[Dict[str, object]] = []

    earnings = (
        db.query(EarningsCache)
        .filter(EarningsCache.symbol == sym)
        .first()
    )
    if earnings and earnings.next_earnings_date:
        if today <= earnings.next_earnings_date <= window_end:
            out.append({
                "date": earnings.next_earnings_date.isoformat(),
                "label": "Earnings",
                "source": "earnings",
            })

    manual_rows = (
        db.query(UserCatalyst)
        .filter(
            UserCatalyst.user_id == user_id,
            UserCatalyst.symbol == sym,
            UserCatalyst.catalyst_date >= today,
            UserCatalyst.catalyst_date <= window_end,
        )
        .all()
    )
    for r in manual_rows:
        out.append({
            "date": r.catalyst_date.isoformat(),
            "label": r.label or "Catalyst",
            "source": "manual",
        })

    out.sort(key=lambda e: e["date"])
    return out


def get_next_catalyst(
    db: Session,
    user_id: str,
    symbol: str,
    window_end: date,
) -> Optional[Dict[str, object]]:
    """Convenience: nearest catalyst inside the window, or None."""
    items = get_catalysts_in_window(db, user_id, symbol, window_end)
    return items[0] if items else None
