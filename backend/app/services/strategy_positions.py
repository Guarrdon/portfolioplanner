"""
Strategy-positions service — assembles the data backing each per-strategy
detail panel.

Walks the user-driven classification chain:

    Tag (strategy_classes contains <strategy_class>)
      └─ TagMembership (member_type='transaction_position')
           └─ TransactionPosition
                └─ TransactionAnnotation (transaction_position_id=...)
                     └─ raw transactions (from SchwabTransactionCache)

For each position it returns the normalized transactions plus a live-price
map covering every symbol referenced. The frontend rolls up cost / credits /
current value / net using the same FILO close-out math used in
TransactionsView so there's a single source of rollup truth.

Strategy panels are membership-driven, by design: the user decides what
belongs in each strategy area by tagging Groups (Tags) — auto-detection
from leg shape is intentionally NOT used here.
"""
from typing import Dict, List, Any, Optional

from sqlalchemy.orm import Session

from app.models import (
    Tag,
    TagMembership,
    TransactionAnnotation,
    TransactionPosition,
    SchwabTransactionCache,
)
from app.services.schwab_service import get_schwab_client, fetch_account_data
from app.services.schwab_transactions import _normalize_transaction
from app.core.strategy_classes import is_valid_strategy_class


def _build_live_price_map(user_id: str, db: Session) -> Dict[str, float]:
    """Per-symbol current_price drawn from live Schwab account data. Covers
    both stock symbols and full option symbols, since the rollup math needs
    both."""
    try:
        data = fetch_account_data(user_id, db, None)
    except Exception:
        return {}
    out: Dict[str, float] = {}
    for p in data.get("positions") or []:
        sym = (p.get("symbol") or "").strip().upper()
        cp = p.get("current_price")
        if not sym or cp is None:
            continue
        try:
            out[sym] = float(cp)
        except (TypeError, ValueError):
            continue
    return out


_STOCK_ASSET_TYPES = {"EQUITY", "STOCK", "ETF", "COLLECTIVE_INVESTMENT", "MUTUAL_FUND"}


def _underlying_from_legs(legs: List[Dict[str, Any]]) -> str:
    """Pick the security underlying out of a flattened tx's legs.

    Schwab payloads put commission/fee entries (assetType=CURRENCY) BEFORE
    the actual EQUITY/OPTION leg in transferItems — sometimes 4 fee rows
    before the real ticker. We must skip those, otherwise every TRADE
    transaction's "underlying" comes back as CURRENCY_USD.
    """
    if not legs:
        return ""
    # Pass 1: explicit option underlying or stock-class assetType.
    for leg in legs:
        at = (leg.get("asset_type") or "").upper()
        if at in {"EQUITY", "STOCK", "ETF", "MUTUAL_FUND", "COLLECTIVE_INVESTMENT", "OPTION"}:
            u = leg.get("underlying") or leg.get("symbol") or ""
            if u:
                return str(u).upper().lstrip("$")
    # Pass 2: anything with a non-CURRENCY symbol.
    for leg in legs:
        at = (leg.get("asset_type") or "").upper()
        if at == "CURRENCY":
            continue
        u = leg.get("underlying") or leg.get("symbol") or ""
        if u:
            return str(u).upper().lstrip("$")
    return ""


def fetch_strategy_positions(
    user_id: str,
    db: Session,
    strategy_class: str,
) -> Dict[str, Any]:
    """Return tags + tagged transaction-positions (with their transactions
    and a live-price map) for one strategy class."""
    if not is_valid_strategy_class(strategy_class):
        raise ValueError(f"unknown strategy_class: {strategy_class}")

    # 1) Tags carrying this strategy_class. Stored as a JSON array in SQLite,
    #    so filter in Python — the per-user tag list is small.
    user_tags = db.query(Tag).filter(Tag.user_id == user_id).all()
    tags = [
        t for t in user_tags
        if t.strategy_classes and strategy_class in t.strategy_classes
    ]

    if not tags:
        return {
            "strategy_class": strategy_class,
            "tags": [],
            "positions": [],
            "live_prices": {},
        }

    tag_ids = [t.id for t in tags]
    tag_id_strs = [str(t.id) for t in tags]

    # 2) Memberships: only transaction_position members participate in
    #    rolled-up position metrics. Loose-transaction memberships exist but
    #    aren't the strategy panel's unit of analysis.
    memberships = db.query(TagMembership).filter(
        TagMembership.tag_id.in_(tag_ids),
        TagMembership.member_type == "transaction_position",
    ).all()

    position_ids = sorted({m.member_id for m in memberships})
    tags_by_pid: Dict[str, List[str]] = {}
    for m in memberships:
        tags_by_pid.setdefault(m.member_id, []).append(str(m.tag_id))

    tag_payload = [
        {
            "id": str(t.id),
            "name": t.name,
            "color": t.color,
            "note": t.note,
            "strategy_classes": list(t.strategy_classes or []),
        }
        for t in tags
    ]

    if not position_ids:
        return {
            "strategy_class": strategy_class,
            "tags": tag_payload,
            "positions": [],
            "live_prices": {},
        }

    # 3) Resolve transaction_positions
    pos_rows = db.query(TransactionPosition).filter(
        TransactionPosition.user_id == user_id,
        TransactionPosition.id.in_(position_ids),
    ).all()
    pos_by_id = {p.id: p for p in pos_rows}

    # 4) Annotations give us the schwab_transaction_id list per position
    annotations = db.query(TransactionAnnotation).filter(
        TransactionAnnotation.user_id == user_id,
        TransactionAnnotation.transaction_position_id.in_(position_ids),
    ).all()
    txids_by_pid: Dict[str, List[str]] = {}
    all_tx_ids: set = set()
    for a in annotations:
        if not a.transaction_position_id or not a.schwab_transaction_id:
            continue
        txids_by_pid.setdefault(a.transaction_position_id, []).append(a.schwab_transaction_id)
        all_tx_ids.add(a.schwab_transaction_id)

    # 5) Pull cached raw payloads in one shot
    payload_by_id: Dict[str, Dict[str, Any]] = {}
    if all_tx_ids:
        cached = db.query(SchwabTransactionCache).filter(
            SchwabTransactionCache.user_id == user_id,
            SchwabTransactionCache.schwab_transaction_id.in_(list(all_tx_ids)),
        ).all()
        payload_by_id = {r.schwab_transaction_id: r.raw_payload for r in cached}

    # 6) Normalize per position
    out_positions: List[Dict[str, Any]] = []
    referenced_symbols: set = set()
    for pid in position_ids:
        p = pos_by_id.get(pid)
        if p is None:
            continue
        recs: List[Dict[str, Any]] = []
        for tx_id in txids_by_pid.get(pid, []):
            payload = payload_by_id.get(tx_id)
            if payload is None:
                continue
            rec = _normalize_transaction(payload, None, "")
            if rec:
                recs.append(rec)
                for leg in rec.get("legs") or []:
                    s = (leg.get("symbol") or "").strip().upper()
                    if s:
                        referenced_symbols.add(s)
        recs.sort(key=lambda r: r.get("date") or "")

        out_positions.append({
            "id": p.id,
            "name": p.name,
            "note": p.note,
            "position_type": p.position_type,
            "underlying": _underlying_from_legs(
                [leg for r in recs for leg in (r.get("legs") or [])]
            ),
            "tag_ids": tags_by_pid.get(pid, []),
            "tx_count": len(recs),
            "first_tx_date": recs[0]["date"] if recs else None,
            "last_tx_date": recs[-1]["date"] if recs else None,
            "transactions": recs,
        })

    # 7) Live prices for every symbol the rollup math will see
    live_prices_full = _build_live_price_map(user_id, db)
    live_prices = {s: live_prices_full[s] for s in referenced_symbols if s in live_prices_full}

    return {
        "strategy_class": strategy_class,
        "tags": tag_payload,
        "positions": out_positions,
        "live_prices": live_prices,
    }


# =============================================================================
# Live-first holdings view (Long Stock)
# =============================================================================

def _chain_per_underlying_qty(recs: List[Dict[str, Any]]) -> Dict[str, float]:
    """Net signed stock-leg shares per underlying for one chain's txs."""
    out: Dict[str, float] = {}
    for r in recs:
        for leg in r.get("legs") or []:
            at = (leg.get("asset_type") or "").upper()
            if at not in _STOCK_ASSET_TYPES:
                continue
            u = (leg.get("underlying") or leg.get("symbol") or "").upper().lstrip("$")
            if not u:
                continue
            try:
                amt = float(leg.get("amount") or 0)
            except (TypeError, ValueError):
                continue
            out[u] = out.get(u, 0.0) + amt
    return out


def _chain_buy_sell_for_underlying(
    recs: List[Dict[str, Any]], underlying: str
) -> Dict[str, float]:
    """Aggregate stock buys/sells in chain `recs` filtered to one underlying."""
    buy_qty = 0.0
    buy_cash = 0.0
    sell_qty = 0.0
    sell_cash = 0.0
    for r in recs:
        for leg in r.get("legs") or []:
            at = (leg.get("asset_type") or "").upper()
            if at not in _STOCK_ASSET_TYPES:
                continue
            u = (leg.get("underlying") or leg.get("symbol") or "").upper().lstrip("$")
            if u != underlying:
                continue
            try:
                amt = float(leg.get("amount") or 0)
                cash = abs(float(leg.get("cost") or 0))
            except (TypeError, ValueError):
                continue
            if amt > 0:
                buy_qty += amt
                buy_cash += cash
            elif amt < 0:
                sell_qty += -amt
                sell_cash += cash
    return {
        "buy_qty": buy_qty, "buy_cash": buy_cash,
        "sell_qty": sell_qty, "sell_cash": sell_cash,
    }


def fetch_long_stock_holdings(
    user_id: str,
    db: Session,
) -> Dict[str, Any]:
    """Live-first Long Stock view.

    Source of truth = active stock positions from Schwab. For each holding
    we look up tagged transaction_position chains that touch this underlying
    (any chain whose tag carries strategy_class='long_stock'), attach the
    chain history as overlay, and compute reconciliation.

    Critical: many users have BUY transactions older than the cache window
    and only the SELL legs are classified into chains — so the chain's net
    stock qty can be ≤ 0 while Schwab still reports the position as open
    (the original buys are pre-history). The live qty is authoritative; the
    chain just contributes context (tags, realized P&L on sold lots,
    earliest classified tx date).
    """
    strategy_class = "long_stock"

    # 1) Tags carrying long_stock
    user_tags = db.query(Tag).filter(Tag.user_id == user_id).all()
    tags = [
        t for t in user_tags
        if t.strategy_classes and strategy_class in t.strategy_classes
    ]
    tag_id_set = {t.id for t in tags}

    # 2) Memberships → transaction_position ids
    memberships: List[TagMembership] = []
    if tag_id_set:
        memberships = db.query(TagMembership).filter(
            TagMembership.tag_id.in_(list(tag_id_set)),
            TagMembership.member_type == "transaction_position",
        ).all()
    pos_ids = sorted({m.member_id for m in memberships})
    tag_ids_by_pid: Dict[str, List[str]] = {}
    for m in memberships:
        tag_ids_by_pid.setdefault(m.member_id, []).append(str(m.tag_id))

    # 3) Annotations: chain → schwab_transaction_id list
    txids_by_pid: Dict[str, List[str]] = {}
    all_tx_ids: set = set()
    if pos_ids:
        annotations = db.query(TransactionAnnotation).filter(
            TransactionAnnotation.user_id == user_id,
            TransactionAnnotation.transaction_position_id.in_(pos_ids),
        ).all()
        for a in annotations:
            if not a.transaction_position_id or not a.schwab_transaction_id:
                continue
            txids_by_pid.setdefault(a.transaction_position_id, []).append(a.schwab_transaction_id)
            all_tx_ids.add(a.schwab_transaction_id)

    # 4) Pull cached payloads
    payload_by_id: Dict[str, Dict[str, Any]] = {}
    if all_tx_ids:
        cached = db.query(SchwabTransactionCache).filter(
            SchwabTransactionCache.user_id == user_id,
            SchwabTransactionCache.schwab_transaction_id.in_(list(all_tx_ids)),
        ).all()
        payload_by_id = {r.schwab_transaction_id: r.raw_payload for r in cached}

    # 5) Normalize per chain; index chains by underlying they touch
    pos_rows: List[TransactionPosition] = []
    if pos_ids:
        pos_rows = db.query(TransactionPosition).filter(
            TransactionPosition.user_id == user_id,
            TransactionPosition.id.in_(pos_ids),
        ).all()
    pos_by_id = {p.id: p for p in pos_rows}

    chains_by_underlying: Dict[str, List[Dict[str, Any]]] = {}
    for pid in pos_ids:
        p = pos_by_id.get(pid)
        if p is None:
            continue
        recs: List[Dict[str, Any]] = []
        for tx_id in txids_by_pid.get(pid, []):
            payload = payload_by_id.get(tx_id)
            if payload is None:
                continue
            rec = _normalize_transaction(payload, None, "")
            if rec:
                recs.append(rec)
        recs.sort(key=lambda r: r.get("date") or "")

        per_und = _chain_per_underlying_qty(recs)
        # Attach chain to every underlying it touched, even if net is zero or
        # negative — pre-window buys may make Schwab's qty bigger than chain
        # qty, but we still want to expose the chain (tags, sells history)
        # against that holding.
        for u in per_und.keys():
            chains_by_underlying.setdefault(u, []).append({
                "id": p.id,
                "name": p.name,
                "position_type": p.position_type,
                "tag_ids": tag_ids_by_pid.get(pid, []),
                "chain_shares": per_und[u],  # signed; can be ≤ 0 if pre-window
                "tx_count": len(recs),
                "first_tx_date": recs[0]["date"] if recs else None,
                "last_tx_date": recs[-1]["date"] if recs else None,
                "transactions": recs,
            })

    # 6) Live source of truth: active stock positions from Schwab
    try:
        live = fetch_account_data(user_id, db, None)
    except Exception:
        live = {"accounts": [], "positions": []}
    raw_positions = live.get("positions") or []
    accounts = live.get("accounts") or []
    portfolio_lv = sum(
        float(a.get("liquidation_value") or 0) for a in accounts
    )

    holdings: List[Dict[str, Any]] = []
    for p in raw_positions:
        if (p.get("asset_type") or "").lower() != "stock":
            continue
        sym = (p.get("symbol") or "").upper()
        if not sym:
            continue
        try:
            qty = float(p.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0.0
        if qty <= 0:
            continue  # Long Stock excludes shorts and zero-qty rows

        chains = chains_by_underlying.get(sym, [])
        # Strategy gate: only include holdings the user has tagged into
        # this strategy class via at least one chain.
        if not chains:
            continue

        avg = float(p.get("average_price") or 0)
        cur = float(p.get("current_price") or 0)
        cost_basis = float(p.get("cost_basis") if p.get("cost_basis") is not None else qty * avg)
        market_value = float(p.get("current_value") if p.get("current_value") is not None else qty * cur)
        unrealized = float(p.get("unrealized_pnl") if p.get("unrealized_pnl") is not None else market_value - cost_basis)
        day_pnl = p.get("current_day_pnl")
        day_pct = p.get("current_day_pnl_percentage")

        # Tag dedupe across all chains touching this holding
        tag_id_dedup: List[str] = []
        seen_tids: set = set()
        for c in chains:
            for tid in c.get("tag_ids") or []:
                if tid not in seen_tids:
                    seen_tids.add(tid)
                    tag_id_dedup.append(tid)

        # Reconciliation: sum of chain net shares vs live qty.
        chain_shares_sum = sum(float(c.get("chain_shares") or 0) for c in chains)
        if abs(chain_shares_sum - qty) < 1e-6:
            recon = {
                "state": "reconciled",
                "summary": "chain coverage matches live shares",
            }
        elif chain_shares_sum < qty:
            # Common case: original buys older than cache window.
            recon = {
                "state": "pre_window",
                "summary": (
                    f"chain has {chain_shares_sum:g}; live shows {qty:g}. "
                    "Older buys are likely outside the transaction history window."
                ),
            }
        else:
            recon = {
                "state": "discrepancy",
                "summary": (
                    f"chain claims {chain_shares_sum:g} but Schwab shows {qty:g}. "
                    "Tag may include sells of shares not currently held."
                ),
            }

        # Realized P&L from classified sells (FIFO approximation using each
        # chain's own avg buy price). Skip chains with no buys (can't infer
        # cost basis from the chain alone).
        realized_total = 0.0
        realized_known = False
        for c in chains:
            bs = _chain_buy_sell_for_underlying(c["transactions"], sym)
            if bs["sell_qty"] > 0 and bs["buy_qty"] > 0:
                avg_buy = bs["buy_cash"] / bs["buy_qty"]
                r = bs["sell_cash"] - bs["sell_qty"] * avg_buy
                if abs(r) >= 1:
                    realized_total += r
                    realized_known = True

        # Earliest classified-tx date across chains. NOTE: this is the
        # earliest tx in our history, not necessarily the original purchase
        # date if buys are pre-window. The live position's actual entry date
        # may be older.
        earliest_date = None
        for c in chains:
            d = c.get("first_tx_date")
            if d and (earliest_date is None or d < earliest_date):
                earliest_date = d

        holdings.append({
            "underlying": sym,
            "account_hash": p.get("account_hash"),
            "account_number": p.get("account_number"),
            "account_type": p.get("account_type"),
            "shares": qty,
            "avg_cost": avg,
            "cost_basis": cost_basis,
            "current_price": cur,
            "market_value": market_value,
            "unrealized_pnl": unrealized,
            "current_day_pnl": float(day_pnl) if day_pnl is not None else None,
            "current_day_pnl_percentage": float(day_pct) if day_pct is not None else None,
            "tag_ids": tag_id_dedup,
            "chains": chains,
            "reconciliation": recon,
            "realized_pnl": realized_total if realized_known else None,
            "earliest_chain_tx_date": earliest_date,
        })

    return {
        "strategy_class": strategy_class,
        "tags": [
            {
                "id": str(t.id), "name": t.name, "color": t.color, "note": t.note,
                "strategy_classes": list(t.strategy_classes or []),
            }
            for t in tags
        ],
        "holdings": holdings,
        "portfolio_liquidation_value": portfolio_lv,
    }
