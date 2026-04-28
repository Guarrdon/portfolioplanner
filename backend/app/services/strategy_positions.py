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
from datetime import datetime
from typing import Dict, List, Any, Optional

from sqlalchemy.orm import Session

from app.models import (
    Tag,
    TagMembership,
    TransactionAnnotation,
    TransactionPosition,
    SchwabTransactionCache,
    Position,
    PositionLeg,
)
from app.models.user import UserSchwabAccount
from app.services.schwab_service import get_schwab_client, fetch_account_data
from app.services.schwab_transactions import _normalize_transaction
from app.core.strategy_classes import is_valid_strategy_class


def _bucket_synced_positions(user_id: str, db: Session) -> Dict[str, Any]:
    """Read active synced positions from the local cache and bucket by
    (underlying, account_hash). No live Schwab calls.

    Position metrics are computed from PositionLeg data (premium = avg open
    price, current_price, quantity) rather than position-level aggregates,
    so multi-leg setups (covered_call grouped, etc.) still expose per-leg
    truth. Day P&L is taken at the position level — atomic positions get
    accurate per-leg attribution; multi-leg positions get the combined
    figure attributed to the bucket as a whole.

    Returns:
      buckets: { (underlying, account_hash) → {
          stock: { quantity, avg_cost, current_price, market_value,
                   cost_basis, unrealized_pnl, day_pnl, day_pnl_pct }
                 | None,
          calls: [ { symbol, strike, expiration, quantity (signed),
                     open_price, current_price, market_value, cost,
                     unrealized_pnl, delta, day_pnl } ],
          puts:  [ ...same shape... ],
          account_number, account_type,
          last_synced  (most recent leg's parent position's last_synced),
      }}
      most_recent_sync: datetime | None
    """
    rows = (
        db.query(Position)
        .filter(
            Position.user_id == user_id,
            Position.flavor == "actual",
            Position.status == "active",
        )
        .all()
    )

    buckets: Dict[tuple, Dict[str, Any]] = {}
    most_recent_sync = None

    for p in rows:
        if p.last_synced and (most_recent_sync is None or p.last_synced > most_recent_sync):
            most_recent_sync = p.last_synced

        und = (p.underlying or "").upper()
        ah = p.account_id or ""
        if not und:
            continue
        key = (und, ah)
        b = buckets.setdefault(key, {
            "stock": None,
            "calls": [],
            "puts": [],
            "account_number": p.account_number,
            "account_type": None,
            "last_synced": p.last_synced,
        })
        if b["account_number"] is None:
            b["account_number"] = p.account_number
        if p.last_synced and (b["last_synced"] is None or p.last_synced > b["last_synced"]):
            b["last_synced"] = p.last_synced

        # Per-position day P&L. Atomic legs get accurate attribution; for
        # grouped multi-leg positions we attribute the combined day P&L to
        # the first stock leg if any, otherwise spread proportionally — but
        # in practice the user's strategy panels render the row-level day
        # number, so we just sum at the bucket level later.
        pos_day_pnl = float(p.current_day_pnl) if p.current_day_pnl is not None else None

        legs = list(p.legs or [])
        # Distribute position day_pnl across legs proportional to abs(market
        # value) so single-leg positions land 1:1.
        leg_mvs = []
        for l in legs:
            qty = float(l.quantity or 0)
            cur = float(l.current_price or 0)
            mult = 100 if (l.asset_type or "").lower() == "option" else 1
            leg_mvs.append(abs(qty * cur * mult))
        total_mv = sum(leg_mvs) or 1.0

        for idx, l in enumerate(legs):
            asset_type = (l.asset_type or "").lower()
            qty = float(l.quantity or 0)
            premium = float(l.premium or 0)
            current_price = float(l.current_price or 0)
            mult = 100 if asset_type == "option" else 1
            mv = qty * current_price * mult
            cost = qty * premium * mult
            unreal = mv - cost
            day_share = (
                pos_day_pnl * (leg_mvs[idx] / total_mv)
                if pos_day_pnl is not None and total_mv > 0 else None
            )

            if asset_type == "stock" and qty > 0:
                # Aggregate stock side across positions in the same bucket
                # (covered_call positions have their stock leg here too).
                if b["stock"] is None:
                    b["stock"] = {
                        "quantity": 0.0, "cost_basis": 0.0, "market_value": 0.0,
                        "unrealized_pnl": 0.0, "day_pnl": 0.0,
                        "_have_day": False,
                    }
                s = b["stock"]
                s["quantity"] += qty
                s["cost_basis"] += cost
                s["market_value"] += mv
                s["unrealized_pnl"] += unreal
                if day_share is not None:
                    s["day_pnl"] += day_share
                    s["_have_day"] = True
            elif asset_type == "option":
                opt_type = (l.option_type or "").lower()
                exp = l.expiration
                # Convert date → ISO string for the response shape
                exp_iso = exp.isoformat() if hasattr(exp, "isoformat") else (str(exp) if exp else None)
                leg_dict = {
                    "symbol": l.symbol,
                    "strike": float(l.strike) if l.strike is not None else None,
                    "expiration": exp_iso,
                    "quantity": qty,
                    "open_price": premium,
                    "current_price": current_price,
                    "market_value": mv,
                    "cost": cost,
                    "unrealized_pnl": unreal,
                    "delta": float(l.delta) if l.delta is not None else None,
                    "day_pnl": day_share,
                }
                if opt_type == "call":
                    b["calls"].append(leg_dict)
                elif opt_type == "put":
                    b["puts"].append(leg_dict)

    # Finalize stock-side: derive avg_cost / current_price from aggregates.
    for b in buckets.values():
        s = b["stock"]
        if s is None:
            continue
        q = s["quantity"]
        s["avg_cost"] = (s["cost_basis"] / q) if q else 0.0
        s["current_price"] = (s["market_value"] / q) if q else 0.0
        if not s["_have_day"]:
            s["day_pnl"] = None
        s.pop("_have_day", None)

    return {"buckets": buckets, "most_recent_sync": most_recent_sync}


def _portfolio_liquidation_value(user_id: str, db: Session) -> float:
    rows = (
        db.query(UserSchwabAccount)
        .filter(
            UserSchwabAccount.user_id == user_id,
            UserSchwabAccount.sync_enabled == True,  # noqa: E712
        )
        .all()
    )
    return sum(float(r.liquidation_value or 0) for r in rows)


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

    # 6) Source of truth: synced active positions from local cache (no
    #    live Schwab calls — the user explicitly chose cache-only loads).
    snap = _bucket_synced_positions(user_id, db)
    buckets = snap["buckets"]
    last_synced = snap["most_recent_sync"]
    portfolio_lv = _portfolio_liquidation_value(user_id, db)

    holdings: List[Dict[str, Any]] = []
    for (sym, ah), b in buckets.items():
        s = b.get("stock")
        if s is None or s["quantity"] <= 0:
            continue

        chains = chains_by_underlying.get(sym, [])
        # Strategy gate: only include holdings the user has tagged into
        # this strategy class via at least one chain.
        if not chains:
            continue

        qty = s["quantity"]
        avg = s["avg_cost"]
        cur = s["current_price"]
        cost_basis = s["cost_basis"]
        market_value = s["market_value"]
        unrealized = s["unrealized_pnl"]
        day_pnl = s["day_pnl"]
        day_pct = (
            (day_pnl / (market_value - day_pnl)) * 100
            if day_pnl is not None and (market_value - day_pnl) != 0 else None
        )

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
            "account_hash": ah,
            "account_number": b.get("account_number"),
            "account_type": b.get("account_type"),
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
        "last_synced": last_synced.isoformat() if last_synced else None,
    }


# =============================================================================
# Live-first holdings view (Covered Calls)
# =============================================================================

def _underlyings_touched_by_chain(recs: List[Dict[str, Any]]) -> set:
    """Set of underlyings any leg of the chain references (stock or option)."""
    out: set = set()
    for r in recs:
        for leg in r.get("legs") or []:
            at = (leg.get("asset_type") or "").upper()
            if at == "CURRENCY":
                continue
            u = (leg.get("underlying") or leg.get("symbol") or "").upper().lstrip("$")
            if u:
                out.add(u)
    return out


def _classify_call_mode(strike: float, spot: float, dte: int) -> str:
    """Sub-mode hint for a covered-call leg.

    Income       — OTM, near-term: harvesting time premium.
    Accumulation — OTM, longer-dated: low-Δ overlay, willing to hold.
    Protection   — ITM: deep enough that the call is mostly intrinsic,
                   acting as downside protection on the long stock.
    ATM          — strike near spot (±2%): mode unclear without delta.
    """
    if spot <= 0 or strike <= 0:
        return "?"
    pct_otm = (strike - spot) / spot * 100  # positive = OTM
    if pct_otm < -2:
        return "Protection"
    if pct_otm < 2:
        return "ATM"
    if dte <= 60:
        return "Income"
    return "Accumulation"


def _chain_legs_summary(recs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Summarize a single chain's transactions by stock-per-underlying and
    by individual option contract.

    The chain IS the position the user has classified into a Group. We do
    not slice, merge, or re-bucket against Schwab's live grouping — each
    chain is self-contained.
    """
    stock: Dict[str, Dict[str, float]] = {}  # underlying → {qty, buy_qty, buy_cash}
    options: Dict[str, Dict[str, Any]] = {}   # full option symbol → {meta, qty (signed net), open_qty, open_cash}

    for r in recs:
        for leg in r.get("legs") or []:
            at = (leg.get("asset_type") or "").upper()
            try:
                amt = float(leg.get("amount") or 0)
                cash = abs(float(leg.get("cost") or 0))
            except (TypeError, ValueError):
                continue

            if at in _STOCK_ASSET_TYPES:
                u = (leg.get("underlying") or leg.get("symbol") or "").upper().lstrip("$")
                if not u:
                    continue
                d = stock.setdefault(u, {"qty": 0.0, "buy_qty": 0.0, "buy_cash": 0.0})
                d["qty"] += amt
                if amt > 0:
                    d["buy_qty"] += amt
                    d["buy_cash"] += cash
            elif at == "OPTION":
                sym = leg.get("symbol")
                if not sym:
                    continue
                d = options.setdefault(sym, {
                    "symbol": sym,
                    "underlying": (leg.get("underlying") or "").upper().lstrip("$"),
                    "option_type": (leg.get("option_type") or "").lower(),
                    "strike": leg.get("strike"),
                    "expiration": leg.get("expiration"),
                    "qty": 0.0,
                    "open_qty": 0.0,
                    "open_cash": 0.0,
                })
                d["qty"] += amt
                effect = (leg.get("position_effect") or "").upper()
                if effect == "OPENING":
                    d["open_qty"] += abs(amt)
                    d["open_cash"] += cash
    return {"stock": stock, "options": options}


def fetch_covered_calls_holdings(
    user_id: str,
    db: Session,
) -> Dict[str, Any]:
    """Group-driven Covered Calls view.

    Each tagged transaction_position is one position; each of its short
    call legs becomes one row. Stock count and call contracts come from
    the chain's own transactions (the user already classified the slice).
    Live data is layered in only for current prices, delta, and day P&L.

    No bucketing across chains, no merging with Schwab's auto-grouping —
    if Schwab put 11000 shares + 10 calls into one Position record but
    the user classified only 1000 + 10 into this Group, we honor the
    user's classification.
    """
    strategy_class = "covered_calls"

    # Tags carrying covered_calls
    user_tags = db.query(Tag).filter(Tag.user_id == user_id).all()
    tags = [
        t for t in user_tags
        if t.strategy_classes and strategy_class in t.strategy_classes
    ]

    # Memberships → transaction_position ids
    tag_id_set = {t.id for t in tags}
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

    # Annotations → tx ids per chain
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

    # Cached payloads
    payload_by_id: Dict[str, Dict[str, Any]] = {}
    if all_tx_ids:
        cached = db.query(SchwabTransactionCache).filter(
            SchwabTransactionCache.user_id == user_id,
            SchwabTransactionCache.schwab_transaction_id.in_(list(all_tx_ids)),
        ).all()
        payload_by_id = {r.schwab_transaction_id: r.raw_payload for r in cached}

    # transaction_position rows (for name / account / etc.)
    pos_rows: List[TransactionPosition] = []
    if pos_ids:
        pos_rows = db.query(TransactionPosition).filter(
            TransactionPosition.user_id == user_id,
            TransactionPosition.id.in_(pos_ids),
        ).all()
    pos_by_id = {p.id: p for p in pos_rows}

    # Live snapshot: lookup tables for current prices + greeks. We only
    # consult these to price the chain's legs; we do not iterate Schwab
    # buckets to find positions.
    snap = _bucket_synced_positions(user_id, db)
    last_synced = snap["most_recent_sync"]
    portfolio_lv = _portfolio_liquidation_value(user_id, db)

    live_stock_by_und: Dict[str, Dict[str, Any]] = {}
    live_option_by_sym: Dict[str, Dict[str, Any]] = {}
    for (und, _ah), b in snap["buckets"].items():
        s = b.get("stock")
        if s and (und not in live_stock_by_und or s["quantity"] > live_stock_by_und[und]["quantity"]):
            live_stock_by_und[und] = s
        for leg in (b.get("calls") or []) + (b.get("puts") or []):
            sym = leg.get("symbol")
            if sym:
                live_option_by_sym[sym] = leg

    today = datetime.utcnow().date()
    holdings: List[Dict[str, Any]] = []

    # Iterate each tagged transaction_position. Group-driven, position-natural.
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
        if not recs:
            continue
        recs.sort(key=lambda r: r.get("date") or "")

        summary = _chain_legs_summary(recs)
        stock_per_und = summary["stock"]
        options = summary["options"]

        # Identify the underlying for this covered-call setup. A chain
        # typically has a single underlying — pick the one with positive
        # net stock buys.
        und = None
        for u, sd in stock_per_und.items():
            if sd["qty"] > 0:
                und = u
                break
        if und is None:
            continue  # no long stock leg — not a covered call

        sd = stock_per_und[und]
        stock_shares = sd["qty"]
        stock_avg = sd["buy_cash"] / sd["buy_qty"] if sd["buy_qty"] > 0 else 0.0
        stock_cb = stock_shares * stock_avg

        # Live underlying price + day P&L per share
        live_stock = live_stock_by_und.get(und) or {}
        stock_cur = float(live_stock.get("current_price") or 0)
        stock_mv = stock_shares * stock_cur if stock_cur else 0
        stock_unreal = stock_mv - stock_cb if stock_cur else 0
        live_total = float(live_stock.get("quantity") or 0)
        live_total_day = live_stock.get("day_pnl")
        stock_day = (
            (live_total_day * stock_shares / live_total)
            if live_total > 0 and live_total_day is not None else None
        )

        # Short call legs from THIS chain only
        short_calls = [
            o for o in options.values()
            if o["option_type"] == "call" and o["qty"] < 0
            and (o["underlying"] == und or not o["underlying"])
        ]
        if not short_calls:
            continue

        short_calls.sort(
            key=lambda o: (str(o.get("expiration") or "9999-12-31"), float(o.get("strike") or 0))
        )

        for o in short_calls:
            contracts = abs(o["qty"])
            avg_open = (o["open_cash"] / o["open_qty"]) if o["open_qty"] > 0 else 0
            premium_received = contracts * avg_open * 100

            live_opt = live_option_by_sym.get(o["symbol"]) or {}
            cur_price = float(live_opt.get("current_price") or 0)
            close_cost = contracts * cur_price * 100
            unreal = premium_received - close_cost
            capture_pct = (unreal / premium_received * 100) if premium_received > 0 else None
            day_pnl = live_opt.get("day_pnl")
            delta = live_opt.get("delta")

            try:
                strike_f = float(o.get("strike")) if o.get("strike") is not None else None
            except (TypeError, ValueError):
                strike_f = None

            exp = o.get("expiration")
            exp_iso = (
                exp.isoformat() if hasattr(exp, "isoformat")
                else (str(exp) if exp else None)
            )
            dte = None
            if exp_iso:
                try:
                    dte = (datetime.fromisoformat(str(exp_iso)[:10]).date() - today).days
                except Exception:
                    dte = None

            otm_pct = (
                ((strike_f - stock_cur) / stock_cur * 100)
                if (strike_f is not None and stock_cur > 0) else None
            )
            mode = _classify_call_mode(strike_f or 0, stock_cur, dte if dte is not None else 0)

            shares_needed = contracts * 100
            coverage_ratio = (
                min(shares_needed / stock_shares, 1.0) if stock_shares > 0 else None
            )
            row_total_pnl = (
                stock_unreal * (coverage_ratio or 0) + unreal
                if stock_unreal is not None else unreal
            )

            # Coverage chip — replaces the old reconciliation copy. Tells
            # the user whether this short call is covered by the chain's
            # stock count.
            if shares_needed <= stock_shares + 1e-6:
                if abs(shares_needed - stock_shares) < 1e-6:
                    cov = {"state": "covered", "summary": f"Fully covered: {contracts:g} contracts × 100 = {stock_shares:g} shares"}
                else:
                    extra = stock_shares - shares_needed
                    cov = {"state": "over_covered", "summary": f"{stock_shares:g} shares cover {contracts:g} contracts; {extra:g} share{'s' if extra != 1 else ''} uncovered in this group"}
            else:
                short = shares_needed - stock_shares
                cov = {"state": "naked", "summary": f"{contracts:g} contracts need {shares_needed:g} shares but group only has {stock_shares:g} ({short:g} short)"}

            holdings.append({
                "underlying": und,
                "account_hash": "",
                "account_number": None,
                "account_type": None,
                # Stock context — sourced from the GROUP's own transactions
                "stock_shares": stock_shares,
                "stock_avg_cost": stock_avg,
                "stock_current_price": stock_cur,
                "stock_market_value": stock_mv,
                "stock_cost_basis": stock_cb,
                "stock_unrealized_pnl": stock_unreal,
                "stock_current_day_pnl": stock_day,
                # Call leg
                "call_symbol": o.get("symbol"),
                "call_strike": strike_f,
                "call_expiration": str(exp_iso)[:10] if exp_iso else None,
                "call_dte": dte,
                "call_quantity": -contracts,
                "call_open_price": avg_open,
                "call_current_price": cur_price,
                "premium_received": premium_received,
                "close_cost": close_cost,
                "call_unrealized_pnl": unreal,
                "capture_pct": capture_pct,
                "otm_pct": otm_pct,
                "mode": mode,
                "call_delta": float(delta) if delta is not None else None,
                "call_current_day_pnl": float(day_pnl) if day_pnl is not None else None,
                "coverage_ratio": coverage_ratio,
                "row_total_pnl": row_total_pnl,
                "tag_ids": tag_ids_by_pid.get(pid, []),
                "reconciliation": cov,
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
        "last_synced": last_synced.isoformat() if last_synced else None,
    }
