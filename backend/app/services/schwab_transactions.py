"""
Schwab transactions service

Fetches transactions for a given underlying symbol across one or more
accounts. Raw Schwab payloads are cached in `schwab_transaction_cache`
(per user/account/transaction_id) so repeated requests don't round-trip to
Schwab and so refreshes only need to pull what's new.
"""
import logging
import re
import threading
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional

from sqlalchemy.orm import Session
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.models import (
    TransactionAnnotation,
    TransactionPosition,
    Tag,
    TagMembership,
    SchwabTransactionCache,
    SchwabTransactionCacheState,
)
from app.services.schwab_service import get_schwab_client, fetch_account_data
from app.services.underlying_quotes import get_or_refresh_quotes
from app.models.user import UserSchwabAccount

# Refresh window: when we re-fetch from Schwab, overlap this far back beyond
# the last fetched cutoff in case any late-settling activity was recorded
# under an earlier date than its actual processing time.
_REFRESH_OVERLAP = timedelta(days=2)
# Default lookback when populating an account's cache for the first time.
# Schwab's get_transactions endpoint documents a 60-day per-call cap, so we
# chunk longer windows into 60-day slices.
_INITIAL_LOOKBACK = timedelta(days=730)
_SCHWAB_PER_CALL_MAX = timedelta(days=60)


def _chunk_window(start: datetime, end: datetime) -> List[tuple]:
    """Split [start, end] into chunks no longer than _SCHWAB_PER_CALL_MAX."""
    chunks = []
    cursor = start
    while cursor < end:
        chunk_end = min(cursor + _SCHWAB_PER_CALL_MAX, end)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end
    return chunks

logger = logging.getLogger(__name__)


# OCC option symbol format: TICKER (variable, space-padded to 6) + YYMMDD + C/P + strike*1000 (8 digits)
_OCC_RE = re.compile(r"^([A-Z]+)\s*(\d{6})([CP])(\d{8})$")


def _extract_underlying_from_symbol(symbol: str) -> Optional[str]:
    """Return the underlying ticker for a stock or OCC option symbol; None if unparseable."""
    if not symbol:
        return None
    cleaned = symbol.replace(" ", "")
    m = _OCC_RE.match(cleaned)
    if m:
        return m.group(1)
    # Stock: just letters (and maybe . for class shares)
    if re.match(r"^[A-Z\.]+$", cleaned):
        return cleaned.split(".")[0]
    return None


def _matches_underlying(item_instrument: Dict[str, Any], underlying: str) -> bool:
    """True if a transferItem's instrument is for the given underlying (stock or option)."""
    if not item_instrument:
        return False
    explicit_under = (item_instrument.get("underlyingSymbol") or "").lstrip("$").upper()
    if explicit_under == underlying:
        return True
    sym = (item_instrument.get("symbol") or "").upper()
    if sym == underlying:
        return True
    parsed = _extract_underlying_from_symbol(sym)
    return parsed == underlying


def _normalize_transaction(tx: Dict[str, Any], underlying: Optional[str], account_number_masked: str) -> Optional[Dict[str, Any]]:
    """
    Flatten a Schwab transaction into a single row-shaped record. If `underlying`
    is provided, only transactions touching that ticker are kept. If None, every
    transaction is normalized (account-wide view).
    """
    transfer_items = tx.get("transferItems") or []
    if underlying:
        relevant_items = [it for it in transfer_items if _matches_underlying(it.get("instrument") or {}, underlying)]
        if not relevant_items:
            return None
    else:
        # Account-wide: keep every leg with an instrument. Skip pure fee-only
        # rows (no instrument) since they don't bind to a position.
        relevant_items = [it for it in transfer_items if (it.get("instrument") or {}).get("symbol") or (it.get("instrument") or {}).get("assetType")]
        if not relevant_items:
            return None

    # Prefer tradeDate if present, fall back to time
    tx_time = tx.get("tradeDate") or tx.get("time")
    try:
        tx_dt = datetime.fromisoformat(tx_time.replace("Z", "+00:00")) if tx_time else None
    except Exception:
        tx_dt = None

    net_amount = tx.get("netAmount")

    # Derive a compact list of legs with just what the UI needs
    legs = []
    for item in relevant_items:
        inst = item.get("instrument") or {}
        legs.append({
            "symbol": inst.get("symbol"),
            # Strip leading "$" — Schwab uses "$SPX" for index options but
            # we key everything by bare ticker; quotes layer re-adds it.
            "underlying": (inst.get("underlyingSymbol") or _extract_underlying_from_symbol(inst.get("symbol") or "") or "").lstrip("$"),
            "asset_type": inst.get("assetType"),
            "option_type": (inst.get("putCall") or "").lower() or None,
            "strike": inst.get("strikePrice"),
            "expiration": inst.get("optionExpirationDate") or inst.get("expirationDate"),
            "amount": item.get("amount"),            # quantity
            "price": item.get("price"),              # per-share / per-contract
            "cost": item.get("cost"),                # signed cash effect for this leg
            "position_effect": item.get("positionEffect"),  # OPENING / CLOSING
            "fee_type": item.get("feeType"),
        })

    # Is this an options-only, a stock-only, or a mixed row?
    asset_kinds = {(l.get("asset_type") or "").upper() for l in legs}
    if "OPTION" in asset_kinds and len(asset_kinds) == 1:
        category = "option"
    elif asset_kinds and "OPTION" not in asset_kinds:
        category = "stock"
    else:
        category = "mixed"

    return {
        "schwab_transaction_id": str(tx.get("activityId") or tx.get("transactionId") or tx.get("id") or ""),
        "date": tx_dt.isoformat() if tx_dt else None,
        "type": tx.get("type"),
        "sub_type": tx.get("subAccount") or tx.get("status"),
        "description": tx.get("description"),
        "net_amount": net_amount,
        "category": category,
        "account_number": account_number_masked,
        "legs": legs,
    }


def _mask_account_number(num: Optional[str]) -> str:
    if not num:
        return "****"
    return "****" + str(num)[-4:]


def _extract_tx_id(tx: Dict[str, Any]) -> Optional[str]:
    """Schwab uses different id keys depending on activity type. Mirror the
    fallback chain we use during normalization so cache rows match."""
    raw = tx.get("activityId") or tx.get("transactionId") or tx.get("id")
    return str(raw) if raw is not None else None


def _extract_tx_date(tx: Dict[str, Any]) -> Optional[datetime]:
    raw = tx.get("tradeDate") or tx.get("time")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def _upsert_cache_rows(
    db: Session,
    user_id: str,
    account_hash: str,
    payloads: List[Dict[str, Any]],
) -> int:
    """Insert-or-replace cache rows for the given Schwab payloads. Returns
    the number of rows that were new (didn't exist in cache yet)."""
    new_count = 0
    seen_in_batch = set()
    for tx in payloads:
        tx_id = _extract_tx_id(tx)
        tx_date = _extract_tx_date(tx)
        if not tx_id or tx_date is None:
            continue
        # Skip duplicates within this same batch (Schwab returns overlapping
        # rows on date-window boundaries).
        if tx_id in seen_in_batch:
            continue
        seen_in_batch.add(tx_id)
        # Naïve datetime for SQLite-friendly storage
        tx_date_naive = tx_date.astimezone(timezone.utc).replace(tzinfo=None) if tx_date.tzinfo else tx_date
        existing = db.query(SchwabTransactionCache).filter_by(
            user_id=user_id,
            account_hash=account_hash,
            schwab_transaction_id=tx_id,
        ).first()
        if existing is None:
            db.add(SchwabTransactionCache(
                user_id=user_id,
                account_hash=account_hash,
                schwab_transaction_id=tx_id,
                trade_date=tx_date_naive,
                raw_payload=tx,
                fetched_at=datetime.utcnow(),
            ))
            new_count += 1
        else:
            existing.raw_payload = tx
            existing.trade_date = tx_date_naive
            existing.fetched_at = datetime.utcnow()
    return new_count


# ---------- in-memory cache-warming progress (per-account) ----------
# Polled by GET /transactions/cache-progress/{account_hash} so the UI can show
# how far through Schwab's chunked transactions API a fetch is. Single-process
# only; resets on backend restart.
_progress_lock = threading.Lock()
_cache_progress: Dict[str, Dict[str, Any]] = {}  # account_hash → {state, chunks_done, chunks_total, txs_loaded, message, started_at}


def _set_progress(account_hash: str, **kwargs) -> None:
    if not account_hash:
        return
    with _progress_lock:
        cur = _cache_progress.get(account_hash) or {}
        cur.update(kwargs)
        _cache_progress[account_hash] = cur


def get_cache_progress(account_hash: str) -> Dict[str, Any]:
    """Read the current cache-warming progress for an account."""
    with _progress_lock:
        return dict(_cache_progress.get(account_hash) or {"state": "idle"})


def _ensure_account_cache(
    db: Session,
    user_id: str,
    account_hash: str,
    account_number_masked: str,
    client,
    requested_window_start: datetime,
    refresh: bool,
) -> None:
    """Make sure the cache covers the requested window for this account.
    Pulls only the missing slice from Schwab. Updates cache state in place.

    On refresh=True we always re-pull the recent window even if cached state
    looks current — used when the user explicitly hits "Refresh"."""
    state = db.query(SchwabTransactionCacheState).filter_by(
        user_id=user_id, account_hash=account_hash
    ).first()
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    # Decide what slice (if any) to pull from Schwab.
    pulls: List[tuple] = []  # list of (start, end) tuples

    if state is None:
        pulls.append((requested_window_start, now_utc))
    else:
        # Extend backwards if caller asked for an older window than we cover.
        if requested_window_start < state.earliest_fetched_date:
            pulls.append((requested_window_start, state.earliest_fetched_date))
        # Pull the trailing edge for new activity. Always do this on refresh;
        # otherwise only if our last fetch is older than the overlap window.
        if refresh or (now_utc - state.last_fetched_at) > _REFRESH_OVERLAP:
            tail_start = state.last_fetched_at - _REFRESH_OVERLAP
            if tail_start < now_utc:
                pulls.append((tail_start, now_utc))

    if not pulls:
        _set_progress(account_hash, state="idle", chunks_done=0, chunks_total=0, txs_loaded=0, message="cache fresh")
        return

    earliest_pulled = state.earliest_fetched_date if state else None
    # Each (start, end) may exceed Schwab's 60-day per-call window — chunk it.
    expanded_pulls: List[tuple] = []
    for (start, end) in pulls:
        expanded_pulls.extend(_chunk_window(start, end))

    chunks_total = len(expanded_pulls)
    txs_loaded = 0
    _set_progress(
        account_hash,
        state="warming",
        chunks_done=0,
        chunks_total=chunks_total,
        txs_loaded=0,
        message=f"Pulling {chunks_total} chunk(s) from Schwab",
        started_at=now_utc.isoformat(),
        account_number_masked=account_number_masked,
    )

    for i, (start, end) in enumerate(expanded_pulls):
        _set_progress(
            account_hash,
            chunks_done=i,
            message=f"Pulling {start.date()} → {end.date()} ({i+1}/{chunks_total})",
        )
        try:
            # schwab-py expects timezone-aware datetimes
            resp = client.get_transactions(
                account_hash,
                start_date=start.replace(tzinfo=timezone.utc),
                end_date=end.replace(tzinfo=timezone.utc),
            )
        except Exception as e:
            logger.warning(f"get_transactions failed for account {account_number_masked}: {e}")
            continue
        if resp.status_code != 200:
            logger.warning(
                f"get_transactions non-200 for account {account_number_masked}: {resp.status_code} {resp.text[:200]}"
            )
            continue
        payload = resp.json()
        if not isinstance(payload, list):
            logger.warning(f"Unexpected transactions payload shape for account {account_number_masked}: {type(payload)}")
            continue
        new_rows = _upsert_cache_rows(db, user_id, account_hash, payload)
        # Flush so the next chunk's existence-check sees what we just added.
        db.flush()
        txs_loaded += len(payload)
        logger.info(
            f"Cached {len(payload)} txs ({new_rows} new) for account {account_number_masked} "
            f"window {start.date()} → {end.date()}"
        )
        _set_progress(
            account_hash,
            chunks_done=i + 1,
            txs_loaded=txs_loaded,
            message=f"Cached {txs_loaded} txs ({i+1}/{chunks_total} chunks)",
        )
        if earliest_pulled is None or start < earliest_pulled:
            earliest_pulled = start

    _set_progress(
        account_hash,
        state="done",
        chunks_done=chunks_total,
        message=f"Loaded {txs_loaded} txs across {chunks_total} chunk(s)",
    )

    if state is None:
        state = SchwabTransactionCacheState(
            user_id=user_id,
            account_hash=account_hash,
            last_fetched_at=now_utc,
            earliest_fetched_date=earliest_pulled or requested_window_start,
        )
        db.add(state)
    else:
        state.last_fetched_at = now_utc
        if earliest_pulled and earliest_pulled < state.earliest_fetched_date:
            state.earliest_fetched_date = earliest_pulled
    db.commit()


def _read_cached_payloads(
    db: Session,
    user_id: str,
    account_hash: str,
    window_start: datetime,
    window_end: datetime,
) -> List[Dict[str, Any]]:
    rows = db.query(SchwabTransactionCache).filter(
        SchwabTransactionCache.user_id == user_id,
        SchwabTransactionCache.account_hash == account_hash,
        SchwabTransactionCache.trade_date >= window_start,
        SchwabTransactionCache.trade_date <= window_end,
    ).all()
    return [r.raw_payload for r in rows]


def fetch_transactions_by_underlying(
    user_id: str,
    db: Session,
    underlying: str,
    account_id: Optional[str] = None,
    days: int = 365,
    refresh: bool = False,
) -> Dict[str, Any]:
    """
    Fetch and normalize transactions for one underlying symbol across the user's
    Schwab accounts (or a specific account hash if provided).

    Returns a dict with `transactions` (sorted chronologically ASC), `annotations`
    keyed by schwab_transaction_id, and a `summary` of net cash deltas.
    """
    underlying = (underlying or "").strip().upper()
    if not underlying:
        raise ValueError("underlying symbol required")

    client = get_schwab_client(user_id, db)

    # Determine accounts to scan
    accounts_resp = client.get_account_numbers()
    if accounts_resp.status_code != 200:
        raise RuntimeError(f"Failed to list Schwab accounts: {accounts_resp.status_code}")
    all_accounts = accounts_resp.json()

    if account_id:
        target_accounts = [a for a in all_accounts if a.get("hashValue") == account_id]
    else:
        target_accounts = all_accounts

    if not target_accounts:
        return {"transactions": [], "annotations": {}, "summary": _empty_summary(), "underlying": underlying}

    # Caller's date window. We always pull at least the initial lookback into
    # cache so subsequent shorter windows can be served without re-fetching.
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    requested_start = now_utc - timedelta(days=days)
    cache_warm_start = now_utc - max(timedelta(days=days), _INITIAL_LOOKBACK)

    records: List[Dict[str, Any]] = []

    for acc in target_accounts:
        acc_hash = acc.get("hashValue")
        acc_num = acc.get("accountNumber")
        masked = _mask_account_number(acc_num)
        _ensure_account_cache(
            db=db,
            user_id=user_id,
            account_hash=acc_hash,
            account_number_masked=masked,
            client=client,
            requested_window_start=cache_warm_start,
            refresh=refresh,
        )
        cached = _read_cached_payloads(db, user_id, acc_hash, requested_start, now_utc)
        for tx in cached:
            rec = _normalize_transaction(tx, underlying, masked)
            if rec:
                rec["account_hash"] = acc_hash
                records.append(rec)

    # Chronological ASC
    records.sort(key=lambda r: r.get("date") or "")

    return _attach_annotations_positions_tags(db, user_id, records, extra={"underlying": underlying, "days": days})


def _attach_annotations_positions_tags(
    db: Session,
    user_id: str,
    records: List[Dict[str, Any]],
    extra: Dict[str, Any],
) -> Dict[str, Any]:
    """Take a list of normalized transactions and decorate with annotations,
    classified-position metadata, tag memberships, and a summary."""
    tx_ids = [r["schwab_transaction_id"] for r in records if r.get("schwab_transaction_id")]
    ann_map: Dict[str, Dict[str, Any]] = {}
    if tx_ids:
        annotations = db.query(TransactionAnnotation).filter(
            TransactionAnnotation.user_id == user_id,
            TransactionAnnotation.schwab_transaction_id.in_(tx_ids),
        ).all()
        for a in annotations:
            ann_map[a.schwab_transaction_id] = {
                "hidden": a.hidden,
                "disposition": a.disposition,
                "note": a.note,
                "transaction_position_id": a.transaction_position_id,
            }

    summary = _compute_summary(records, ann_map)

    position_ids = sorted({a.get("transaction_position_id") for a in ann_map.values() if a.get("transaction_position_id")})
    positions: Dict[str, Dict[str, Any]] = {}
    if position_ids:
        rows = db.query(TransactionPosition).filter(
            TransactionPosition.user_id == user_id,
            TransactionPosition.id.in_(position_ids),
        ).all()
        for row in rows:
            positions[row.id] = {
                "id": row.id,
                "name": row.name,
                "note": row.note,
                "position_type": row.position_type,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        for pid in position_ids:
            positions.setdefault(pid, {"id": pid, "name": None, "note": None, "position_type": None, "created_at": None})

    tag_memberships: List[Dict[str, str]] = []
    tags_by_id: Dict[str, Dict[str, Any]] = {}
    if tx_ids or position_ids:
        member_filters = []
        if tx_ids:
            member_filters.append((TagMembership.member_type == "transaction") & (TagMembership.member_id.in_(tx_ids)))
        if position_ids:
            member_filters.append((TagMembership.member_type == "transaction_position") & (TagMembership.member_id.in_(position_ids)))
        from sqlalchemy import or_
        membership_rows = (
            db.query(TagMembership)
            .join(Tag, Tag.id == TagMembership.tag_id)
            .filter(Tag.user_id == user_id)
            .filter(or_(*member_filters))
            .all()
        ) if member_filters else []
        tag_ids_in_use = sorted({str(m.tag_id) for m in membership_rows})
        if tag_ids_in_use:
            tag_rows = db.query(Tag).filter(Tag.user_id == user_id, Tag.id.in_(tag_ids_in_use)).all()
            for t in tag_rows:
                tags_by_id[str(t.id)] = {
                    "id": str(t.id),
                    "name": t.name,
                    "note": t.note,
                    "color": t.color,
                    "created_at": t.created_at.isoformat() if t.created_at else None,
                }
        for m in membership_rows:
            tag_memberships.append({
                "tag_id": str(m.tag_id),
                "member_type": m.member_type,
                "member_id": m.member_id,
            })

    out = {
        "transactions": records,
        "annotations": ann_map,
        "summary": summary,
        "positions": positions,
        "tags": tags_by_id,
        "tag_memberships": tag_memberships,
    }
    out.update(extra)
    return out


def fetch_transactions_by_account(
    user_id: str,
    db: Session,
    account_id: str,
    days: int = 365,
    refresh: bool = False,
) -> Dict[str, Any]:
    """Fetch every transaction for a single account (no underlying filter)."""
    if not account_id:
        raise ValueError("account_id required")

    client = get_schwab_client(user_id, db)
    accounts_resp = client.get_account_numbers()
    if accounts_resp.status_code != 200:
        raise RuntimeError(f"Failed to list Schwab accounts: {accounts_resp.status_code}")
    all_accounts = accounts_resp.json()
    target = next((a for a in all_accounts if a.get("hashValue") == account_id), None)
    if not target:
        raise ValueError(f"Account {account_id} not found for user")

    acc_hash = target.get("hashValue")
    acc_num = target.get("accountNumber")
    masked = _mask_account_number(acc_num)

    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    requested_start = now_utc - timedelta(days=days)
    cache_warm_start = now_utc - max(timedelta(days=days), _INITIAL_LOOKBACK)

    _ensure_account_cache(
        db=db,
        user_id=user_id,
        account_hash=acc_hash,
        account_number_masked=masked,
        client=client,
        requested_window_start=cache_warm_start,
        refresh=refresh,
    )
    cached = _read_cached_payloads(db, user_id, acc_hash, requested_start, now_utc)
    records: List[Dict[str, Any]] = []
    for tx in cached:
        rec = _normalize_transaction(tx, None, masked)
        if rec:
            rec["account_hash"] = acc_hash
            records.append(rec)
    records.sort(key=lambda r: r.get("date") or "")

    return _attach_annotations_positions_tags(
        db, user_id, records,
        extra={"account_hash": acc_hash, "account_number": masked, "days": days},
    )


def fetch_open_positions_for_underlying(
    user_id: str,
    db: Session,
    underlying: str,
    account_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Fetch current open positions for an underlying directly from Schwab.

    Bypasses the synced Position/PositionLeg tables (which split a single contract
    into multiple rows when strategy-grouping applies). This returns one row per
    actual contract/stock holding, which is what the UI needs to judge close-out P&L.
    """
    underlying = (underlying or "").strip().upper()
    if not underlying:
        raise ValueError("underlying symbol required")

    # fetch_account_data returns one entry per actual Schwab position (pre-grouping)
    account_ids = [account_id] if account_id else None
    data = fetch_account_data(user_id, db, account_ids)
    raw_positions = data.get("positions", [])

    # Keep only entries matching the underlying (stock by symbol, options by underlying)
    stock_legs = []
    option_legs = []
    for p in raw_positions:
        asset_type = (p.get("asset_type") or "").lower()
        sym = (p.get("symbol") or "").upper()
        und = (p.get("underlying") or "").upper()

        if asset_type == "stock":
            if sym == underlying:
                stock_legs.append(p)
        elif asset_type == "option":
            if und == underlying:
                option_legs.append(p)

    # Aggregate stock across accounts (net qty, weighted avg cost)
    stock_qty = 0.0
    stock_cost_total = 0.0
    stock_value_total = 0.0
    for s in stock_legs:
        q = float(s.get("quantity") or 0)
        ap = float(s.get("average_price") or 0)
        cp = float(s.get("current_price") or 0)
        stock_qty += q
        stock_cost_total += q * ap
        stock_value_total += q * cp
    stock_avg_cost = (stock_cost_total / stock_qty) if stock_qty else 0.0

    # Normalize option legs for the UI
    options_out = []
    for o in option_legs:
        qty = float(o.get("quantity") or 0)
        open_price = float(o.get("average_price") or 0)
        cur_price = float(o.get("current_price") or 0)
        mult = 100
        unrealized = (cur_price - open_price) * qty * mult
        options_out.append({
            "symbol": o.get("symbol"),
            "underlying": o.get("underlying") or underlying,
            "option_type": o.get("option_type"),
            "strike": o.get("strike"),
            "expiration": o.get("expiration").isoformat() if hasattr(o.get("expiration"), "isoformat") else o.get("expiration"),
            "quantity": qty,
            "open_price": open_price,
            "current_price": cur_price,
            "unrealized_pnl": round(unrealized, 2),
            "account_number": o.get("account_number"),
        })

    # Sort options by expiration ascending
    options_out.sort(key=lambda r: r.get("expiration") or "")

    # Single-symbol spot lookup (cached). Same TTL/throttling rules apply.
    try:
        client = get_schwab_client(user_id, db)
        spots = get_or_refresh_quotes(user_id, db, [underlying], client)
    except Exception as exc:
        logger.warning("underlying spot fetch failed: %s", exc)
        spots = {}
    spot = spots.get(underlying) or {}

    return {
        "underlying": underlying,
        "underlying_price": spot.get("last_price"),
        "underlying_quote_at": spot.get("fetched_at"),
        "stock": {
            "quantity": round(stock_qty, 6),
            "average_cost": round(stock_avg_cost, 4),
            "cost_basis": round(stock_cost_total, 2),
            "current_value": round(stock_value_total, 2),
            "unrealized_pnl": round(stock_value_total - stock_cost_total, 2),
        },
        "options": options_out,
    }


def fetch_all_open_positions(
    user_id: str,
    db: Session,
    account_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Single-round-trip variant of fetch_open_positions_for_underlying that
    returns every open position grouped by underlying. Used by the UI to
    reconcile every saved position against its live counterpart.
    """
    account_ids = [account_id] if account_id else None
    data = fetch_account_data(user_id, db, account_ids)
    raw_positions = data.get("positions", [])

    # Bucket by underlying.
    stock_by_und: Dict[str, list] = {}
    option_by_und: Dict[str, list] = {}
    for p in raw_positions:
        asset_type = (p.get("asset_type") or "").lower()
        sym = (p.get("symbol") or "").upper()
        und = (p.get("underlying") or "").upper()
        if asset_type == "stock" and sym:
            stock_by_und.setdefault(sym, []).append(p)
        elif asset_type == "option" and und:
            option_by_und.setdefault(und, []).append(p)

    underlyings = sorted(set(stock_by_und.keys()) | set(option_by_und.keys()))

    # Batch-fetch underlying spot prices once for all symbols on the page
    # (50/call, 3s between, 15-min cache TTL). See underlying_quotes.py.
    try:
        client = get_schwab_client(user_id, db)
        spots = get_or_refresh_quotes(user_id, db, underlyings, client)
    except Exception as exc:
        logger.warning("underlying spot fetch failed: %s", exc)
        spots = {}

    out_by_und: Dict[str, Any] = {}
    for und in underlyings:
        stock_legs = stock_by_und.get(und, [])
        option_legs = option_by_und.get(und, [])

        stock_qty = 0.0
        stock_cost_total = 0.0
        stock_value_total = 0.0
        for s in stock_legs:
            q = float(s.get("quantity") or 0)
            ap = float(s.get("average_price") or 0)
            cp = float(s.get("current_price") or 0)
            stock_qty += q
            stock_cost_total += q * ap
            stock_value_total += q * cp
        stock_avg_cost = (stock_cost_total / stock_qty) if stock_qty else 0.0

        options_out = []
        for o in option_legs:
            qty = float(o.get("quantity") or 0)
            open_price = float(o.get("average_price") or 0)
            cur_price = float(o.get("current_price") or 0)
            mult = 100
            unrealized = (cur_price - open_price) * qty * mult
            options_out.append({
                "symbol": o.get("symbol"),
                "underlying": o.get("underlying") or und,
                "option_type": o.get("option_type"),
                "strike": o.get("strike"),
                "expiration": o.get("expiration").isoformat() if hasattr(o.get("expiration"), "isoformat") else o.get("expiration"),
                "quantity": qty,
                "open_price": open_price,
                "current_price": cur_price,
                "unrealized_pnl": round(unrealized, 2),
                "account_number": o.get("account_number"),
            })
        options_out.sort(key=lambda r: r.get("expiration") or "")

        spot = spots.get(und) or {}

        out_by_und[und] = {
            "underlying": und,
            "underlying_price": spot.get("last_price"),
            "underlying_quote_at": spot.get("fetched_at"),
            "stock": {
                "quantity": round(stock_qty, 6),
                "average_cost": round(stock_avg_cost, 4),
                "cost_basis": round(stock_cost_total, 2),
                "current_value": round(stock_value_total, 2),
                "unrealized_pnl": round(stock_value_total - stock_cost_total, 2),
            },
            "options": options_out,
        }

    return {"positions_by_underlying": out_by_und}


def _empty_summary() -> Dict[str, Any]:
    return {
        "visible_count": 0,
        "hidden_count": 0,
        "stock_net_cash": 0.0,
        "options_net_cash": 0.0,
        "total_net_cash": 0.0,
    }


def _compute_summary(records: List[Dict[str, Any]], annotations: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    stock_net = 0.0
    opt_net = 0.0
    visible = 0
    hidden = 0
    for r in records:
        ann = annotations.get(r.get("schwab_transaction_id") or "", {})
        if ann.get("hidden"):
            hidden += 1
            continue
        visible += 1
        amt = r.get("net_amount") or 0
        try:
            amt = float(amt)
        except Exception:
            amt = 0.0
        if r.get("category") == "stock":
            stock_net += amt
        elif r.get("category") == "option":
            opt_net += amt
        else:
            # Mixed (e.g. assignment + stock leg in one tx) — bucket into stock
            stock_net += amt
    return {
        "visible_count": visible,
        "hidden_count": hidden,
        "stock_net_cash": round(stock_net, 2),
        "options_net_cash": round(opt_net, 2),
        "total_net_cash": round(stock_net + opt_net, 2),
    }


# Sentinel so callers can explicitly clear a field by passing None where the default is "leave unchanged".
_UNSET = object()


def upsert_annotation(
    db: Session,
    user_id: str,
    schwab_transaction_id: str,
    hidden=_UNSET,
    disposition=_UNSET,
    note=_UNSET,
    transaction_position_id=_UNSET,
) -> TransactionAnnotation:
    ann = db.query(TransactionAnnotation).filter(
        TransactionAnnotation.user_id == user_id,
        TransactionAnnotation.schwab_transaction_id == schwab_transaction_id,
    ).first()
    if ann is None:
        ann = TransactionAnnotation(
            user_id=user_id,
            schwab_transaction_id=schwab_transaction_id,
            hidden=False,
        )
        db.add(ann)
    if hidden is not _UNSET:
        ann.hidden = bool(hidden)
    if disposition is not _UNSET:
        ann.disposition = disposition or None
    if note is not _UNSET:
        ann.note = note
    if transaction_position_id is not _UNSET:
        ann.transaction_position_id = transaction_position_id or None
    db.commit()
    db.refresh(ann)
    return ann


def classify_transactions(
    db: Session,
    user_id: str,
    schwab_transaction_ids: List[str],
    transaction_position_id: Optional[str] = None,
    position_type: Optional[str] = None,
    default_name: Optional[str] = None,
) -> str:
    """Attach all given transactions to a TransactionPosition. If
    transaction_position_id is omitted, a new position is created. Returns the
    position id used."""
    import uuid
    created_new = False
    if transaction_position_id is None and schwab_transaction_ids:
        transaction_position_id = uuid.uuid4().hex[:10]
        created_new = True

    if created_new:
        name = default_name or f"Position {datetime.utcnow().strftime('%b %d %H:%M')}"
        pos = TransactionPosition(
            id=transaction_position_id,
            user_id=user_id,
            name=name,
            note=None,
            position_type=position_type or "manual",
        )
        db.add(pos)
    elif position_type:
        # Caller is appending to an existing position AND wants to update its type
        existing = db.query(TransactionPosition).filter(
            TransactionPosition.user_id == user_id,
            TransactionPosition.id == transaction_position_id,
        ).first()
        if existing:
            existing.position_type = position_type

    for tx_id in schwab_transaction_ids:
        upsert_annotation(
            db=db,
            user_id=user_id,
            schwab_transaction_id=tx_id,
            transaction_position_id=transaction_position_id,
        )
    return transaction_position_id or ""


def update_transaction_position(
    db: Session,
    user_id: str,
    transaction_position_id: str,
    name=_UNSET,
    note=_UNSET,
    position_type=_UNSET,
) -> Optional[TransactionPosition]:
    pos = db.query(TransactionPosition).filter(
        TransactionPosition.user_id == user_id,
        TransactionPosition.id == transaction_position_id,
    ).first()
    if pos is None:
        # Lazily create — covers orphan rows from pre-rename upgrades.
        pos = TransactionPosition(id=transaction_position_id, user_id=user_id)
        db.add(pos)
    if name is not _UNSET:
        pos.name = name or None
    if note is not _UNSET:
        pos.note = note or None
    if position_type is not _UNSET:
        pos.position_type = position_type or None
    db.commit()
    db.refresh(pos)
    return pos


def unclassify_transactions(
    db: Session,
    user_id: str,
    schwab_transaction_ids: List[str],
) -> None:
    for tx_id in schwab_transaction_ids:
        upsert_annotation(
            db=db,
            user_id=user_id,
            schwab_transaction_id=tx_id,
            transaction_position_id=None,
        )
