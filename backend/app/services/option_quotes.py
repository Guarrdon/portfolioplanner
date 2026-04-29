"""Option greeks + IV fetching for synced position legs.

Schwab's `/marketdata/v1/quotes` endpoint, when given option (OCC) symbols,
returns delta/gamma/theta/vega and an IV figure on each option's `quote`
block. Position sync uses this to stamp greeks onto PositionLeg rows in
the same transaction the prices were stamped — so the UI never shows a
price from one snapshot next to a delta from another.

Design mirrors `underlying_quotes.py`:
  - 50 symbols per Schwab call
  - 3 second delay between chunks
  - Failures are swallowed (returns partial map); caller decides fallback

We do not cache option quotes separately. Greeks ride along with the
position sync cadence — the user explicitly asked for snapshot-consistent
data, not realtime, so a single fetch per sync is the right shape.
"""
from __future__ import annotations

import logging
import time
from typing import Dict, Iterable, List

logger = logging.getLogger(__name__)

CHUNK_SIZE = 50
INTER_CHUNK_DELAY_SECONDS = 3.0


def _normalize_option_payload(sym: str, payload: dict) -> dict:
    """Pull greeks + IV out of a Schwab option quote envelope.

    Schwab nests the numbers under `quote`. `volatility` is reported as a
    percentage (e.g. 28.5 means 28.5% IV); we store it as-is so the UI
    layer can decide whether to render `28.5%` or divide by 100.

    Missing fields stay None — option chains can return partial data right
    around expiration or off-hours.
    """
    quote = payload.get("quote", {}) if isinstance(payload, dict) else {}
    return {
        "symbol": sym,
        "delta": _f(quote.get("delta")),
        "gamma": _f(quote.get("gamma")),
        "theta": _f(quote.get("theta")),
        "vega": _f(quote.get("vega")),
        "iv": _f(quote.get("volatility")),
    }


def _f(v):
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _fetch_chunk(client, symbols: List[str]) -> Dict[str, dict]:
    """Single Schwab quotes call for option symbols. Returns
    {symbol: {delta, gamma, theta, vega, iv}}. Errors → empty dict and
    caller falls back to whatever was already on the leg."""
    if not symbols:
        return {}
    try:
        resp = client.get_quotes(symbols)
    except Exception as exc:
        logger.warning("schwab get_quotes (options) raised: %s", exc)
        return {}
    if resp.status_code != 200:
        logger.warning(
            "schwab get_quotes (options) returned status=%s for %d symbols",
            resp.status_code, len(symbols),
        )
        return {}
    try:
        body = resp.json()
    except Exception:
        logger.warning("schwab get_quotes (options) returned non-JSON body")
        return {}
    out: Dict[str, dict] = {}
    if not isinstance(body, dict):
        return out
    for sym, payload in body.items():
        if not isinstance(payload, dict):
            continue
        out[sym] = _normalize_option_payload(sym, payload)
    return out


def fetch_option_quotes_chunked(
    client, option_symbols: Iterable[str]
) -> Dict[str, dict]:
    """Hit Schwab in chunks of CHUNK_SIZE for option (OCC) symbols.
    Returns the combined map keyed by the *exact* symbol string passed in.

    Schwab keys its response by whatever symbol shape it received, and
    Schwab's positions API returns OCC strings with embedded spaces (e.g.
    `"AAPL  260116C00200000"`). We pass them through unchanged so the
    response keys line up with what the caller already has.
    """
    seen = set()
    cleaned: List[str] = []
    for s in option_symbols:
        if not s:
            continue
        s = s.strip()
        if not s or s in seen:
            continue
        seen.add(s)
        cleaned.append(s)

    if not cleaned:
        return {}

    out: Dict[str, dict] = {}
    chunks = [cleaned[i:i + CHUNK_SIZE] for i in range(0, len(cleaned), CHUNK_SIZE)]
    for i, chunk in enumerate(chunks):
        if i > 0:
            time.sleep(INTER_CHUNK_DELAY_SECONDS)
        out.update(_fetch_chunk(client, chunk))
    return out


def stamp_greeks_on_legs(legs, quotes_by_symbol: Dict[str, dict]) -> int:
    """Patch delta/gamma/theta/vega/iv onto a list of PositionLeg objects.

    `legs` is any iterable of ORM PositionLeg rows (already attached to
    the session). Lookup is by exact `leg.symbol`. Stocks are skipped.

    Returns the number of legs that received at least one populated field
    — useful for logging "patched 12 of 14 option legs".
    """
    if not quotes_by_symbol:
        return 0
    patched = 0
    for leg in legs:
        if leg.asset_type != "option":
            continue
        q = quotes_by_symbol.get(leg.symbol)
        if not q:
            # Symbols sometimes round-trip with stripped spaces; fall back
            # to a space-collapsed lookup so we still match if Schwab
            # normalized them.
            q = quotes_by_symbol.get(leg.symbol.replace(" ", "")) if leg.symbol else None
        if not q:
            continue
        if q.get("delta") is not None:
            leg.delta = q["delta"]
        if q.get("gamma") is not None:
            leg.gamma = q["gamma"]
        if q.get("theta") is not None:
            leg.theta = q["theta"]
        if q.get("vega") is not None:
            leg.vega = q["vega"]
        if q.get("iv") is not None:
            leg.iv = q["iv"]
        if any(q.get(k) is not None for k in ("delta", "gamma", "theta", "vega", "iv")):
            patched += 1
    return patched
