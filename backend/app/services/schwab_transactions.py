"""
Schwab transactions service

Live-fetches transactions for a given underlying symbol across one or more
accounts. Transactions are NOT persisted — only user annotations are.
"""
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional

from sqlalchemy.orm import Session

from app.models import TransactionAnnotation, TransactionLinkGroup
from app.services.schwab_service import get_schwab_client, fetch_account_data
from app.models.user import UserSchwabAccount

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
    explicit_under = (item_instrument.get("underlyingSymbol") or "").upper()
    if explicit_under == underlying:
        return True
    sym = (item_instrument.get("symbol") or "").upper()
    if sym == underlying:
        return True
    parsed = _extract_underlying_from_symbol(sym)
    return parsed == underlying


def _normalize_transaction(tx: Dict[str, Any], underlying: str, account_number_masked: str) -> Optional[Dict[str, Any]]:
    """
    Flatten a Schwab transaction into one or more row-shaped records scoped
    to the given underlying. Returns a single record with a `legs` array.
    """
    transfer_items = tx.get("transferItems") or []
    # Find items that match the underlying; keep everything for context but flag matches
    relevant_items = [it for it in transfer_items if _matches_underlying(it.get("instrument") or {}, underlying)]
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
            "underlying": inst.get("underlyingSymbol") or _extract_underlying_from_symbol(inst.get("symbol") or ""),
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


def fetch_transactions_by_underlying(
    user_id: str,
    db: Session,
    underlying: str,
    account_id: Optional[str] = None,
    days: int = 365,
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

    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    end_date = datetime.now(timezone.utc)

    records: List[Dict[str, Any]] = []

    for acc in target_accounts:
        acc_hash = acc.get("hashValue")
        acc_num = acc.get("accountNumber")
        masked = _mask_account_number(acc_num)
        try:
            resp = client.get_transactions(acc_hash, start_date=start_date, end_date=end_date)
        except Exception as e:
            logger.warning(f"get_transactions failed for account {masked}: {e}")
            continue

        if resp.status_code != 200:
            logger.warning(
                f"get_transactions non-200 for account {masked}: {resp.status_code} {resp.text[:200]}"
            )
            continue

        payload = resp.json()
        if not isinstance(payload, list):
            logger.warning(f"Unexpected transactions payload shape for account {masked}: {type(payload)}")
            continue

        for tx in payload:
            rec = _normalize_transaction(tx, underlying, masked)
            if rec:
                rec["account_hash"] = acc_hash
                records.append(rec)

    # Chronological ASC
    records.sort(key=lambda r: r.get("date") or "")

    # Attach annotations
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
                "link_group_id": a.link_group_id,
            }

    summary = _compute_summary(records, ann_map)

    # Fetch any link-group metadata referenced by these annotations
    group_ids = sorted({a.get("link_group_id") for a in ann_map.values() if a.get("link_group_id")})
    link_groups: Dict[str, Dict[str, Any]] = {}
    if group_ids:
        rows = db.query(TransactionLinkGroup).filter(
            TransactionLinkGroup.user_id == user_id,
            TransactionLinkGroup.id.in_(group_ids),
        ).all()
        for row in rows:
            link_groups[row.id] = {
                "id": row.id,
                "name": row.name,
                "note": row.note,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        # Synthesize placeholder entries for any orphan group ids (annotation exists
        # but group row was deleted) so UI can still render without crashing.
        for gid in group_ids:
            link_groups.setdefault(gid, {"id": gid, "name": None, "note": None, "created_at": None})

    return {
        "underlying": underlying,
        "days": days,
        "transactions": records,
        "annotations": ann_map,
        "summary": summary,
        "link_groups": link_groups,
    }


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

    return {
        "underlying": underlying,
        "stock": {
            "quantity": round(stock_qty, 6),
            "average_cost": round(stock_avg_cost, 4),
            "cost_basis": round(stock_cost_total, 2),
            "current_value": round(stock_value_total, 2),
            "unrealized_pnl": round(stock_value_total - stock_cost_total, 2),
        },
        "options": options_out,
    }


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
    link_group_id=_UNSET,
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
    if link_group_id is not _UNSET:
        ann.link_group_id = link_group_id or None
    db.commit()
    db.refresh(ann)
    return ann


def link_transactions(
    db: Session,
    user_id: str,
    schwab_transaction_ids: List[str],
    group_id: Optional[str] = None,
    default_name: Optional[str] = None,
) -> str:
    """Assign the same link_group_id to all given transactions. If group_id is not
    provided, a fresh one is created with an auto-generated name. Returns the
    group_id used."""
    import uuid
    created_new = False
    if group_id is None and schwab_transaction_ids:
        group_id = uuid.uuid4().hex[:10]
        created_new = True

    if created_new:
        name = default_name or f"Group {datetime.utcnow().strftime('%b %d %H:%M')}"
        grp = TransactionLinkGroup(id=group_id, user_id=user_id, name=name, note=None)
        db.add(grp)

    for tx_id in schwab_transaction_ids:
        upsert_annotation(
            db=db,
            user_id=user_id,
            schwab_transaction_id=tx_id,
            link_group_id=group_id,
        )
    return group_id or ""


def update_link_group(
    db: Session,
    user_id: str,
    group_id: str,
    name=_UNSET,
    note=_UNSET,
) -> Optional[TransactionLinkGroup]:
    grp = db.query(TransactionLinkGroup).filter(
        TransactionLinkGroup.user_id == user_id,
        TransactionLinkGroup.id == group_id,
    ).first()
    if grp is None:
        # Lazily create a row so the UI can edit orphan groups (cases where annotation
        # exists but link_groups row was missing from a pre-feature upgrade).
        grp = TransactionLinkGroup(id=group_id, user_id=user_id)
        db.add(grp)
    if name is not _UNSET:
        grp.name = name or None
    if note is not _UNSET:
        grp.note = note or None
    db.commit()
    db.refresh(grp)
    return grp


def unlink_transactions(
    db: Session,
    user_id: str,
    schwab_transaction_ids: List[str],
) -> None:
    for tx_id in schwab_transaction_ids:
        upsert_annotation(
            db=db,
            user_id=user_id,
            schwab_transaction_id=tx_id,
            link_group_id=None,
        )
