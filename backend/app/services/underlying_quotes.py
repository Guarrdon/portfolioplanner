"""Underlying spot price fetching with caching.

Schwab option positions don't carry the underlying spot. We need it to show
"where is the underlying right now" alongside option positions. This module
batches calls to Schwab's quotes endpoint, caches results in
underlying_quote_cache, and serves stale-while-tolerable reads.

Design constraints set by the user:
  - 50 symbols per Schwab call (defensive, well below practical limits)
  - 3 second delay between chunks (defensive, against rate limits)
  - TTL: 15 minutes (real-time isn't needed)
  - Skip futures (anything starting with "."), they're a different endpoint
  - One refresh per page load if cache is stale; otherwise serve from cache
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional

from sqlalchemy.orm import Session

from app.models.quote_cache import UnderlyingQuoteCache

logger = logging.getLogger(__name__)

CHUNK_SIZE = 50
INTER_CHUNK_DELAY_SECONDS = 3.0
DEFAULT_TTL_SECONDS = 15 * 60

# Schwab quotes its cash-settled indices with a leading '$'. Option chains
# reference the bare ticker (SPX, NDX, etc.), so we translate at the quote
# boundary and map the response back to the bare ticker.
INDEX_QUOTE_SYMBOLS = {
    "SPX": "$SPX",
    "SPXW": "$SPX",   # SPX weeklies share the SPX index spot
    "NDX": "$NDX",
    "NDXP": "$NDX",
    "RUT": "$RUT",
    "DJX": "$DJX",
    "VIX": "$VIX",
    "XSP": "$XSP",
}


def _quotable(symbol: str) -> bool:
    """Skip futures contract codes (Schwab uses '.XYZ:XCME' style) — those
    require the futures market data endpoint, not /marketdata/v1/quotes."""
    if not symbol:
        return False
    if symbol.startswith("."):
        return False
    if ":" in symbol:
        return False
    return True


def _to_quote_symbol(symbol: str) -> str:
    """Translate a bare underlying ticker to Schwab's quote symbol form.
    Indices need a leading '$'; everything else passes through."""
    return INDEX_QUOTE_SYMBOLS.get(symbol, symbol)


def _normalize_quote_payload(sym: str, payload: dict) -> dict:
    """Pull last/bid/ask out of Schwab's verbose quote envelope. Different
    asset types nest the prices slightly differently; pick the first thing
    that looks like a tradable price."""
    quote = payload.get("quote", {}) if isinstance(payload, dict) else {}
    last = quote.get("lastPrice")
    if last is None:
        last = quote.get("mark")
    if last is None:
        last = quote.get("closePrice")
    return {
        "symbol": sym,
        "last_price": float(last) if last is not None else None,
        "bid": float(quote.get("bidPrice")) if quote.get("bidPrice") is not None else None,
        "ask": float(quote.get("askPrice")) if quote.get("askPrice") is not None else None,
    }


def _fetch_chunk(client, symbols: List[str]) -> Dict[str, dict]:
    """Single Schwab quotes call. Returns {symbol: {last, bid, ask}}.
    Failures are logged and the chunk's symbols are simply omitted from
    the result map — caller decides how to fall back."""
    if not symbols:
        return {}
    try:
        resp = client.get_quotes(symbols)
    except Exception as exc:
        logger.warning("schwab get_quotes raised: %s", exc)
        return {}
    if resp.status_code != 200:
        logger.warning(
            "schwab get_quotes returned status=%s for %d symbols",
            resp.status_code, len(symbols),
        )
        return {}
    try:
        body = resp.json()
    except Exception:
        logger.warning("schwab get_quotes returned non-JSON body")
        return {}
    out: Dict[str, dict] = {}
    if not isinstance(body, dict):
        return out
    for sym, payload in body.items():
        if not isinstance(payload, dict):
            continue
        out[sym.upper()] = _normalize_quote_payload(sym.upper(), payload)
    return out


def fetch_quotes_chunked(client, symbols: Iterable[str]) -> Dict[str, dict]:
    """Hit Schwab in chunks of CHUNK_SIZE, sleeping INTER_CHUNK_DELAY_SECONDS
    between chunks. Returns the combined map keyed by the *bare* ticker
    (e.g. SPX, not $SPX). Symbols failing the `_quotable` filter are
    silently dropped."""
    seen_bare = set()
    bares_for_quote: Dict[str, List[str]] = {}  # quote_symbol -> [bare tickers]
    for s in symbols:
        s = (s or "").strip().upper()
        if not s or s in seen_bare:
            continue
        if not _quotable(s):
            continue
        seen_bare.add(s)
        qsym = _to_quote_symbol(s)
        bares_for_quote.setdefault(qsym, []).append(s)

    if not bares_for_quote:
        return {}

    quote_symbols = list(bares_for_quote.keys())
    out: Dict[str, dict] = {}
    chunks = [quote_symbols[i:i + CHUNK_SIZE] for i in range(0, len(quote_symbols), CHUNK_SIZE)]
    for i, chunk in enumerate(chunks):
        if i > 0:
            time.sleep(INTER_CHUNK_DELAY_SECONDS)
        chunk_resp = _fetch_chunk(client, chunk)
        # Fan a single quote response out to every bare ticker that shared
        # the quote symbol (e.g. $SPX -> SPX and SPXW).
        for qsym, data in chunk_resp.items():
            for bare in bares_for_quote.get(qsym, [qsym]):
                out[bare] = {**data, "symbol": bare}
    return out


def read_cached_quotes(
    user_id: str,
    db: Session,
    symbols: Iterable[str],
) -> Dict[str, dict]:
    """Cache-only read — never hits Schwab. Returns whatever's in
    UnderlyingQuoteCache for the requested symbols. Stale entries are still
    returned with their `fetched_at`; callers can decide whether to act on
    them. Symbols not in cache are simply omitted."""
    wanted = [s.strip().upper() for s in symbols if s and s.strip()]
    if not wanted:
        return {}
    rows = (
        db.query(UnderlyingQuoteCache)
        .filter(UnderlyingQuoteCache.user_id == user_id)
        .filter(UnderlyingQuoteCache.symbol.in_(wanted))
        .all()
    )
    out: Dict[str, dict] = {}
    for r in rows:
        if r.last_price is None:
            continue
        out[r.symbol] = {
            "last_price": r.last_price,
            "bid": r.bid,
            "ask": r.ask,
            "fetched_at": r.fetched_at.isoformat() if r.fetched_at else None,
        }
    return out


def get_or_refresh_quotes(
    user_id: str,
    db: Session,
    symbols: Iterable[str],
    client,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
) -> Dict[str, dict]:
    """Return spot info for each requested symbol.

    Cache hits within TTL are returned without an API call. Anything stale
    or missing is fetched from Schwab in chunks (50/call, 3s between),
    written back to the cache, and merged into the result.

    Returns map keyed by uppercase symbol → {last_price, bid, ask, fetched_at}.
    Symbols whose fetch fails are simply omitted from the map; callers
    should treat absence as "no spot available."
    """
    wanted = [s.strip().upper() for s in symbols if s and _quotable(s.strip().upper())]
    if not wanted:
        return {}

    now = datetime.utcnow()
    fresh_after = now - timedelta(seconds=ttl_seconds)

    # Read whatever we already have. Anything fresh we serve directly;
    # stale or missing rows go to the refetch list.
    rows = (
        db.query(UnderlyingQuoteCache)
        .filter(UnderlyingQuoteCache.user_id == user_id)
        .filter(UnderlyingQuoteCache.symbol.in_(wanted))
        .all()
    )
    cached_by_sym = {r.symbol: r for r in rows}

    fresh: Dict[str, dict] = {}
    to_fetch: List[str] = []
    for sym in wanted:
        row = cached_by_sym.get(sym)
        if row and row.fetched_at and row.fetched_at >= fresh_after and row.last_price is not None:
            fresh[sym] = {
                "last_price": row.last_price,
                "bid": row.bid,
                "ask": row.ask,
                "fetched_at": row.fetched_at.isoformat(),
            }
        else:
            to_fetch.append(sym)

    if not to_fetch:
        return fresh

    fetched = fetch_quotes_chunked(client, to_fetch)
    if fetched:
        for sym, data in fetched.items():
            existing = cached_by_sym.get(sym)
            if existing:
                existing.last_price = data.get("last_price")
                existing.bid = data.get("bid")
                existing.ask = data.get("ask")
                existing.fetched_at = now
            else:
                db.add(UnderlyingQuoteCache(
                    user_id=user_id,
                    symbol=sym,
                    last_price=data.get("last_price"),
                    bid=data.get("bid"),
                    ask=data.get("ask"),
                    fetched_at=now,
                ))
            fresh[sym] = {
                "last_price": data.get("last_price"),
                "bid": data.get("bid"),
                "ask": data.get("ask"),
                "fetched_at": now.isoformat(),
            }
        try:
            db.commit()
        except Exception as exc:
            logger.warning("failed to commit underlying_quote_cache: %s", exc)
            db.rollback()

    return fresh
