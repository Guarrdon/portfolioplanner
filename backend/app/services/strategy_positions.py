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
from app.services.earnings_calendar import get_next_catalyst
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
                    "theta": float(l.theta) if l.theta is not None else None,
                    "iv": float(l.iv) if l.iv is not None else None,
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


# =============================================================================
# Group-driven holdings view (Verticals)
# =============================================================================

def _build_live_lookups(snap_buckets: Dict[tuple, Dict[str, Any]]):
    """Index live-snapshot legs for symbol-keyed lookup."""
    by_und: Dict[str, Dict[str, Any]] = {}
    by_opt: Dict[str, Dict[str, Any]] = {}
    for (und, _ah), b in snap_buckets.items():
        s = b.get("stock")
        if s and (und not in by_und or s["quantity"] > by_und[und]["quantity"]):
            by_und[und] = s
        for leg in (b.get("calls") or []) + (b.get("puts") or []):
            sym = leg.get("symbol")
            if sym:
                by_opt[sym] = leg
    return by_und, by_opt


def _net_at_open_for_legs(recs: List[Dict[str, Any]], leg_symbols: set) -> float:
    """Sum signed leg.cost for OPENING transactions on the given option leg
    symbols. Schwab's per-leg cost is already signed, so a credit spread's
    sum is positive and a debit's is negative."""
    total = 0.0
    for r in recs:
        for leg in r.get("legs") or []:
            if (leg.get("asset_type") or "").upper() != "OPTION":
                continue
            if (leg.get("position_effect") or "").upper() != "OPENING":
                continue
            if leg.get("symbol") not in leg_symbols:
                continue
            try:
                total += float(leg.get("cost") or 0)
            except (TypeError, ValueError):
                pass
    return total


def _classify_vertical_action(
    capture_pct: Optional[float], short_otm_pct: Optional[float], dte: Optional[int]
) -> str:
    """Action chip for a vertical row."""
    if short_otm_pct is not None and short_otm_pct < 0:
        return "ITM-risk"
    if capture_pct is not None and capture_pct >= 75:
        return "Take it"
    if capture_pct is not None and capture_pct >= 50:
        return "Close"
    if dte is not None and dte <= 7 and (capture_pct is None or abs(capture_pct) < 25):
        return "DTE-stop"
    return "Hold"


def fetch_verticals_holdings(
    user_id: str,
    db: Session,
) -> Dict[str, Any]:
    """Group-driven Verticals view.

    Each tagged transaction_position with exactly two same-type, same-
    expiration option legs (one short / one long, equal contract counts,
    different strikes) is one vertical spread. Anything else is excluded
    and counted as 'complex' for the footer note.

    Greeks (delta) are used for PoP when synced; otherwise we fall back
    to short-leg distance-to-spot. TODO(opportunity): theta + IV when the
    quote-side instrument cache lands.
    """
    strategy_class = "verticals"

    user_tags = db.query(Tag).filter(Tag.user_id == user_id).all()
    tags = [
        t for t in user_tags
        if t.strategy_classes and strategy_class in t.strategy_classes
    ]

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

    payload_by_id: Dict[str, Dict[str, Any]] = {}
    if all_tx_ids:
        cached = db.query(SchwabTransactionCache).filter(
            SchwabTransactionCache.user_id == user_id,
            SchwabTransactionCache.schwab_transaction_id.in_(list(all_tx_ids)),
        ).all()
        payload_by_id = {r.schwab_transaction_id: r.raw_payload for r in cached}

    pos_rows: List[TransactionPosition] = []
    if pos_ids:
        pos_rows = db.query(TransactionPosition).filter(
            TransactionPosition.user_id == user_id,
            TransactionPosition.id.in_(pos_ids),
        ).all()
    pos_by_id = {p.id: p for p in pos_rows}

    snap = _bucket_synced_positions(user_id, db)
    last_synced = snap["most_recent_sync"]
    portfolio_lv = _portfolio_liquidation_value(user_id, db)
    live_stock_by_und, live_option_by_sym = _build_live_lookups(snap["buckets"])

    today = datetime.utcnow().date()
    holdings: List[Dict[str, Any]] = []
    excluded_complex = 0

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
        open_legs = [o for o in summary["options"].values() if abs(o["qty"]) > 1e-9]

        if len(open_legs) != 2:
            if open_legs:
                excluded_complex += 1
            continue
        a, b = open_legs
        if a["option_type"] != b["option_type"]:
            excluded_complex += 1
            continue
        if a["expiration"] != b["expiration"]:
            excluded_complex += 1
            continue
        if a["strike"] == b["strike"]:
            continue
        shorts = [l for l in (a, b) if l["qty"] < 0]
        longs = [l for l in (a, b) if l["qty"] > 0]
        if len(shorts) != 1 or len(longs) != 1:
            excluded_complex += 1
            continue
        short_leg = shorts[0]
        long_leg = longs[0]
        if abs(abs(short_leg["qty"]) - abs(long_leg["qty"])) > 1e-9:
            excluded_complex += 1
            continue

        contracts = abs(short_leg["qty"])
        und = (short_leg.get("underlying") or long_leg.get("underlying") or "").upper().lstrip("$")

        net_at_open = _net_at_open_for_legs(
            recs, {short_leg["symbol"], long_leg["symbol"]}
        )
        is_credit = net_at_open > 0
        opt_type = short_leg["option_type"]

        try:
            short_strike = float(short_leg.get("strike") or 0)
            long_strike = float(long_leg.get("strike") or 0)
        except (TypeError, ValueError):
            continue
        width = abs(short_strike - long_strike) * 100 * contracts

        if is_credit:
            max_profit = abs(net_at_open)
            max_loss = max(0.0, width - max_profit)
        else:
            max_profit = max(0.0, width - abs(net_at_open))
            max_loss = abs(net_at_open)

        short_live = live_option_by_sym.get(short_leg["symbol"]) or {}
        long_live = live_option_by_sym.get(long_leg["symbol"]) or {}
        short_cur = float(short_live.get("current_price") or 0) if short_live else 0
        long_cur = float(long_live.get("current_price") or 0) if long_live else 0
        # Cash effect of closing: buy back short (pay), sell long (receive).
        current_value = contracts * (long_cur - short_cur) * 100
        unrealized = net_at_open + current_value
        capture_pct = (unrealized / max_profit * 100) if max_profit > 0 else None

        short_day = short_live.get("day_pnl") if short_live else None
        long_day = long_live.get("day_pnl") if long_live else None
        if short_day is not None or long_day is not None:
            day_pnl = (short_day or 0) + (long_day or 0)
        else:
            day_pnl = None

        live_stock = live_stock_by_und.get(und) or {}
        spot = float(live_stock.get("current_price") or 0) if live_stock else 0
        short_otm_pct = None
        if spot > 0 and short_strike > 0:
            if opt_type == "put":
                short_otm_pct = (spot - short_strike) / spot * 100
            else:
                short_otm_pct = (short_strike - spot) / spot * 100

        exp = short_leg.get("expiration")
        exp_iso = exp.isoformat() if hasattr(exp, "isoformat") else (str(exp) if exp else None)
        dte = None
        if exp_iso:
            try:
                dte = (datetime.fromisoformat(str(exp_iso)[:10]).date() - today).days
            except Exception:
                dte = None

        dollars_per_day = (abs(current_value) / dte) if (dte and dte > 0) else None

        if is_credit:
            type_chip = "Credit Put" if opt_type == "put" else "Credit Call"
        else:
            type_chip = "Debit Put" if opt_type == "put" else "Debit Call"

        # TODO(opportunity): once delta sync populates PositionLeg.delta,
        # this branch becomes the default path. The OTM fallback stays for
        # robustness when the leg isn't in the live snapshot at all.
        short_delta = short_live.get("delta") if short_live else None
        if short_delta is not None:
            pop_pct = max(0.0, min(100.0, (1 - abs(float(short_delta))) * 100))
            if pop_pct >= 75:
                risk_label = "Safe"
            elif pop_pct >= 55:
                risk_label = "OK"
            elif pop_pct >= 35:
                risk_label = "At risk"
            else:
                risk_label = "Likely"
            risk_pop = pop_pct
        elif short_otm_pct is not None:
            if short_otm_pct >= 5:
                risk_label = "Safe"
            elif short_otm_pct >= 0:
                risk_label = "At risk"
            else:
                risk_label = "ITM"
            risk_pop = None
        else:
            risk_label = "?"
            risk_pop = None

        action = _classify_vertical_action(capture_pct, short_otm_pct, dte)

        if short_live and long_live:
            recon = {"state": "live", "summary": "both legs synced"}
        else:
            missing = []
            if not short_live:
                missing.append("short")
            if not long_live:
                missing.append("long")
            recon = {
                "state": "mismatch",
                "summary": f"missing live data for: {', '.join(missing)}",
            }

        type_letter = "P" if opt_type == "put" else "C"
        strikes_label = f"{short_strike:g} / {long_strike:g} {type_letter}"

        holdings.append({
            "underlying": und,
            "account_hash": "",
            "account_number": None,
            "type": type_chip,
            "is_credit": is_credit,
            "option_type": opt_type,
            "strikes_label": strikes_label,
            "short_strike": short_strike,
            "long_strike": long_strike,
            "expiration": str(exp_iso)[:10] if exp_iso else None,
            "dte": dte,
            "contracts": contracts,
            "net_at_open": net_at_open,
            "current_value": current_value,
            "unrealized_pnl": unrealized,
            "capture_pct": capture_pct,
            "max_profit": max_profit,
            "max_loss": max_loss,
            "width": width,
            "short_otm_pct": short_otm_pct,
            "short_delta": float(short_delta) if short_delta is not None else None,
            "risk_label": risk_label,
            "risk_pop_pct": risk_pop,
            "action": action,
            "spot": spot,
            "day_pnl": day_pnl,
            "dollars_per_day": dollars_per_day,
            "row_total_pnl": unrealized,
            "tag_ids": tag_ids_by_pid.get(pid, []),
            "reconciliation": recon,
            "chain_id": p.id,
            "chain_name": p.name,
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
        "excluded_complex_count": excluded_complex,
    }


# ----------------------------------------------------------------------------
# Single-Leg Options (short premium) — sold puts, sold calls,
# short straddles, short strangles.
#
# Long premium and any chain with a long leg is excluded — those don't share
# the rolling/extrinsic-driven workflow this panel is built around.
# ----------------------------------------------------------------------------

def _classify_single_leg_action(
    *,
    capture_pct: Optional[float],
    extrinsic_pct_of_premium: Optional[float],
    any_leg_itm: bool,
    unrealized_pnl: float,
    dte: Optional[int],
) -> str:
    """Action chip for a single-leg short-premium row.

    Thresholds match the user's stated workflow: ~20-30 DTE is the review
    window, but a deep-ITM old position with no extrinsic can still get
    assigned, so we flag that regardless of DTE.

      Assignment risk — ITM AND extrinsic_remaining < 5% of premium
      Review          — DTE ≤ 30 AND (unrealized < 0 OR any leg ITM)
                        AND extrinsic_remaining < 25% of premium
      Take it         — capture ≥ 80% AND DTE > 7
      otherwise       — Hold
    """
    if any_leg_itm and extrinsic_pct_of_premium is not None and extrinsic_pct_of_premium < 5:
        return "Assignment risk"
    if (
        dte is not None and dte <= 30
        and (unrealized_pnl < 0 or any_leg_itm)
        and extrinsic_pct_of_premium is not None and extrinsic_pct_of_premium < 25
    ):
        return "Review"
    if capture_pct is not None and capture_pct >= 80 and (dte is None or dte > 7):
        return "Take it"
    return "Hold"


def _opening_date_for_legs(recs: List[Dict[str, Any]], leg_symbols: set):
    """Earliest OPENING transaction date across the given option leg symbols.
    Used to derive DTE-at-open for annualized-return math."""
    earliest = None
    for r in recs:
        for leg in r.get("legs") or []:
            if (leg.get("asset_type") or "").upper() != "OPTION":
                continue
            if (leg.get("position_effect") or "").upper() != "OPENING":
                continue
            if leg.get("symbol") not in leg_symbols:
                continue
            d = r.get("date")
            if not d:
                continue
            if earliest is None or d < earliest:
                earliest = d
    return earliest


def fetch_single_leg_holdings(
    user_id: str,
    db: Session,
) -> Dict[str, Any]:
    """Group-driven Single-Leg (short premium) view.

    A chain qualifies if it has 1 or 2 short option legs and no long legs
    or stock legs. One-leg chains are short_put or short_call. Two-leg
    chains must share an expiration and have equal contract counts; same
    strike → straddle, different strikes → strangle.

    Anything else (long premium, mixed long/short, 3+ legs, stock-bearing)
    is excluded and counted in `excluded_complex_count` so the footer can
    explain why a tagged chain doesn't appear.
    """
    strategy_class = "single_leg"

    user_tags = db.query(Tag).filter(Tag.user_id == user_id).all()
    tags = [
        t for t in user_tags
        if t.strategy_classes and strategy_class in t.strategy_classes
    ]

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

    payload_by_id: Dict[str, Dict[str, Any]] = {}
    if all_tx_ids:
        cached = db.query(SchwabTransactionCache).filter(
            SchwabTransactionCache.user_id == user_id,
            SchwabTransactionCache.schwab_transaction_id.in_(list(all_tx_ids)),
        ).all()
        payload_by_id = {r.schwab_transaction_id: r.raw_payload for r in cached}

    pos_rows: List[TransactionPosition] = []
    if pos_ids:
        pos_rows = db.query(TransactionPosition).filter(
            TransactionPosition.user_id == user_id,
            TransactionPosition.id.in_(pos_ids),
        ).all()
    pos_by_id = {p.id: p for p in pos_rows}

    snap = _bucket_synced_positions(user_id, db)
    last_synced = snap["most_recent_sync"]
    portfolio_lv = _portfolio_liquidation_value(user_id, db)
    live_stock_by_und, live_option_by_sym = _build_live_lookups(snap["buckets"])

    today = datetime.utcnow().date()
    holdings: List[Dict[str, Any]] = []
    excluded_complex = 0

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

        # Reject any chain that touches stock — single-leg short-premium is
        # option-only by design (covered calls live in their own panel).
        if any(abs(s.get("qty", 0)) > 1e-9 for s in summary["stock"].values()):
            excluded_complex += 1
            continue

        open_legs = [o for o in summary["options"].values() if abs(o["qty"]) > 1e-9]
        if not open_legs:
            continue
        if len(open_legs) > 2:
            excluded_complex += 1
            continue
        # Reject if any leg is long — this panel is short-premium only.
        if any(l["qty"] > 0 for l in open_legs):
            excluded_complex += 1
            continue

        # Two-leg chains must be a straddle or strangle: same expiration,
        # one put + one call, equal contract counts.
        if len(open_legs) == 2:
            a, b = open_legs
            if a["expiration"] != b["expiration"]:
                excluded_complex += 1
                continue
            if abs(abs(a["qty"]) - abs(b["qty"])) > 1e-9:
                excluded_complex += 1
                continue
            types = {a["option_type"], b["option_type"]}
            if types != {"put", "call"}:
                # Two short same-type legs is a stacked single-leg — treat
                # as complex for now; user can split into separate Groups.
                excluded_complex += 1
                continue

        # ----- per-row math -----
        contracts = abs(open_legs[0]["qty"])
        leg_symbols = {l["symbol"] for l in open_legs}
        net_at_open = _net_at_open_for_legs(recs, leg_symbols)
        # Short premium: net_at_open should be positive (credit). If a chain
        # somehow nets to a debit at open (e.g. user re-tagged after partial
        # close), we still display but capture math may look odd.
        premium_received = abs(net_at_open) if net_at_open > 0 else 0.0

        und = (open_legs[0].get("underlying") or "").upper().lstrip("$")
        live_stock = live_stock_by_und.get(und) or {}
        spot = float(live_stock.get("current_price") or 0) if live_stock else 0

        # Per-leg current price + greeks from live snapshot.
        live_legs = []
        for ol in open_legs:
            live = live_option_by_sym.get(ol["symbol"]) or {}
            live_legs.append({"meta": ol, "live": live})

        # Close cost = cash to buy back all short legs at current price.
        # Each leg.current_price is per-share; multiply by 100 * contracts.
        close_cost = 0.0
        intrinsic_total = 0.0
        for entry in live_legs:
            meta = entry["meta"]
            live = entry["live"]
            cur = float(live.get("current_price") or 0)
            close_cost += cur * 100 * contracts
            try:
                strike = float(meta.get("strike") or 0)
            except (TypeError, ValueError):
                strike = 0
            opt_type = meta.get("option_type")
            if spot > 0 and strike > 0:
                if opt_type == "put":
                    intrinsic_per_share = max(0.0, strike - spot)
                else:
                    intrinsic_per_share = max(0.0, spot - strike)
                intrinsic_total += intrinsic_per_share * 100 * contracts

        extrinsic_remaining = max(0.0, close_cost - intrinsic_total)
        extrinsic_pct = (
            (extrinsic_remaining / premium_received * 100)
            if premium_received > 0 else None
        )

        # Capture: how much of the original credit has been earned back
        # already (= premium_received - close_cost). Positive = winning.
        captured = premium_received - close_cost
        capture_pct = (captured / premium_received * 100) if premium_received > 0 else None
        unrealized = captured  # synonym for the row-level total P&L

        # Day P&L: sum of leg-level day_pnl from live snapshot.
        day_parts = [entry["live"].get("day_pnl") for entry in live_legs]
        day_pnl = sum(d for d in day_parts if d is not None) if any(d is not None for d in day_parts) else None

        # Per-leg risk metrics; "worst leg" = the one closest to ITM
        # (smallest OTM%, or most negative if breached).
        worst_otm_pct: Optional[float] = None
        worst_delta: Optional[float] = None
        any_leg_itm = False
        leg_views = []
        for entry in live_legs:
            meta = entry["meta"]
            live = entry["live"]
            try:
                strike = float(meta.get("strike") or 0)
            except (TypeError, ValueError):
                strike = 0
            opt_type = meta.get("option_type")
            otm_pct = None
            if spot > 0 and strike > 0:
                if opt_type == "put":
                    otm_pct = (spot - strike) / spot * 100
                else:
                    otm_pct = (strike - spot) / spot * 100
            if otm_pct is not None and otm_pct < 0:
                any_leg_itm = True
            if otm_pct is not None and (worst_otm_pct is None or otm_pct < worst_otm_pct):
                worst_otm_pct = otm_pct
            d = live.get("delta")
            if d is not None and (worst_delta is None or abs(float(d)) > abs(worst_delta)):
                worst_delta = float(d)
            leg_views.append({
                "symbol": meta["symbol"],
                "option_type": opt_type,
                "strike": strike,
                "otm_pct": otm_pct,
                "delta": float(d) if d is not None else None,
                "iv": live.get("iv"),
                "theta": live.get("theta"),
                "current_price": float(live.get("current_price") or 0),
            })

        # DTE from expiration.
        exp_iso = open_legs[0].get("expiration")
        if hasattr(exp_iso, "isoformat"):
            exp_iso = exp_iso.isoformat()
        dte: Optional[int] = None
        if exp_iso:
            try:
                dte = (datetime.fromisoformat(str(exp_iso)[:10]).date() - today).days
            except Exception:
                dte = None

        # $/day theta: prefer summed real per-share theta (theta is given
        # per-share-per-day; multiply by 100 * contracts and sum across
        # short legs — short legs collect theta, so flip sign). Fall back
        # to premium/DTE_at_open if greeks aren't synced yet.
        thetas = [lv["theta"] for lv in leg_views if lv.get("theta") is not None]
        if thetas:
            # Schwab returns theta as a negative number for long options;
            # short legs collect that decay, so we negate to express the
            # daily $ accrual to the seller as a positive number.
            dollars_per_day = -sum(thetas) * 100 * contracts
        else:
            opening_date = _opening_date_for_legs(recs, leg_symbols)
            dte_at_open = None
            if opening_date and exp_iso:
                try:
                    od = datetime.fromisoformat(str(opening_date)[:10]).date()
                    ed = datetime.fromisoformat(str(exp_iso)[:10]).date()
                    dte_at_open = (ed - od).days
                except Exception:
                    dte_at_open = None
            dollars_per_day = (
                premium_received / dte_at_open
                if dte_at_open and dte_at_open > 0 else None
            )

        # Row type + label.
        if len(open_legs) == 1:
            ot = open_legs[0]["option_type"]
            type_chip = "Short Put" if ot == "put" else "Short Call"
            row_type = "short_put" if ot == "put" else "short_call"
            try:
                strike_only = float(open_legs[0].get("strike") or 0)
            except (TypeError, ValueError):
                strike_only = 0
            strikes_label = f"{strike_only:g} {'P' if ot == 'put' else 'C'}"
            short_strikes = [strike_only]
        else:
            put_leg = next(l for l in open_legs if l["option_type"] == "put")
            call_leg = next(l for l in open_legs if l["option_type"] == "call")
            try:
                pk = float(put_leg.get("strike") or 0)
                ck = float(call_leg.get("strike") or 0)
            except (TypeError, ValueError):
                pk = ck = 0
            if abs(pk - ck) < 1e-9:
                type_chip = "Short Straddle"
                row_type = "short_straddle"
                strikes_label = f"{pk:g} P/C"
            else:
                type_chip = "Short Strangle"
                row_type = "short_strangle"
                strikes_label = f"{pk:g} P / {ck:g} C"
            short_strikes = [pk, ck]

        # Max loss: cash-secured put has a defined floor; everything else
        # is technically unbounded on the call side (or both sides for a
        # straddle/strangle). We surface None for unbounded so the UI can
        # render "—" / "Undefined".
        max_loss: Optional[float]
        if row_type == "short_put":
            max_loss = (short_strikes[0] * 100 * contracts) - premium_received
        else:
            max_loss = None

        # Capital tied up: cash-secured put pegs at strike × 100 × contracts.
        # Naked calls / straddles / strangles depend on margin requirements
        # which we don't reliably sync per-row; leave None.
        capital_at_risk: Optional[float] = (
            short_strikes[0] * 100 * contracts if row_type == "short_put" else None
        )

        # Annualized return on capital (only meaningful when capital_at_risk
        # and DTE-at-open are both known).
        annualized_return_pct: Optional[float] = None
        if capital_at_risk and capital_at_risk > 0 and premium_received > 0:
            opening_date = _opening_date_for_legs(recs, leg_symbols)
            if opening_date and exp_iso:
                try:
                    od = datetime.fromisoformat(str(opening_date)[:10]).date()
                    ed = datetime.fromisoformat(str(exp_iso)[:10]).date()
                    dao = (ed - od).days
                    if dao > 0:
                        annualized_return_pct = (
                            (premium_received / capital_at_risk) * (365 / dao) * 100
                        )
                except Exception:
                    pass

        # Breakeven prices. Per share. Strangle/straddle have lower+upper.
        per_share_premium = premium_received / (100 * contracts) if contracts > 0 else 0
        if row_type == "short_put":
            breakeven_lower = short_strikes[0] - per_share_premium
            breakeven_upper = None
        elif row_type == "short_call":
            breakeven_lower = None
            breakeven_upper = short_strikes[0] + per_share_premium
        else:  # straddle or strangle: put strike − prem, call strike + prem
            put_strike = short_strikes[0]
            call_strike = short_strikes[1] if len(short_strikes) > 1 else short_strikes[0]
            breakeven_lower = put_strike - per_share_premium
            breakeven_upper = call_strike + per_share_premium

        # Distance from breakeven (% of spot, signed: positive = safer).
        distance_from_be_pct: Optional[float] = None
        if spot > 0:
            if breakeven_lower is not None and breakeven_upper is not None:
                # Two-sided: pick the closer side.
                d_low = (spot - breakeven_lower) / spot * 100
                d_high = (breakeven_upper - spot) / spot * 100
                distance_from_be_pct = min(d_low, d_high)
            elif breakeven_lower is not None:
                distance_from_be_pct = (spot - breakeven_lower) / spot * 100
            elif breakeven_upper is not None:
                distance_from_be_pct = (breakeven_upper - spot) / spot * 100

        # Risk band — prefer delta-based PoP, fall back to OTM% framing
        # so a missing-greeks row still gets a useful label.
        if worst_delta is not None:
            pop_pct = max(0.0, min(100.0, (1 - abs(worst_delta)) * 100))
            if pop_pct >= 75:
                risk_label = "Safe"
            elif pop_pct >= 55:
                risk_label = "OK"
            elif pop_pct >= 35:
                risk_label = "At risk"
            else:
                risk_label = "Likely"
            risk_pop = pop_pct
        elif worst_otm_pct is not None:
            if worst_otm_pct >= 5:
                risk_label = "Safe"
            elif worst_otm_pct >= 0:
                risk_label = "At risk"
            else:
                risk_label = "Breached"
            risk_pop = None
        else:
            risk_label = "?"
            risk_pop = None

        action = _classify_single_leg_action(
            capture_pct=capture_pct,
            extrinsic_pct_of_premium=extrinsic_pct,
            any_leg_itm=any_leg_itm,
            unrealized_pnl=unrealized,
            dte=dte,
        )

        # Recon: live legs all present?
        missing_syms = [
            entry["meta"]["symbol"] for entry in live_legs
            if not entry["live"]
        ]
        if missing_syms:
            recon = {
                "state": "mismatch",
                "summary": f"missing live data for: {', '.join(missing_syms)}",
            }
        else:
            recon = {"state": "live", "summary": "all legs synced"}

        holdings.append({
            "underlying": und,
            "account_hash": "",
            "account_number": None,
            "type": type_chip,
            "row_type": row_type,
            "strikes_label": strikes_label,
            "short_strikes": short_strikes,
            "expiration": str(exp_iso)[:10] if exp_iso else None,
            "dte": dte,
            "contracts": contracts,
            "premium_received": premium_received,
            "close_cost": close_cost,
            "intrinsic_remaining": intrinsic_total,
            "extrinsic_remaining": extrinsic_remaining,
            "extrinsic_pct_of_premium": extrinsic_pct,
            "capture_pct": capture_pct,
            "unrealized_pnl": unrealized,
            "row_total_pnl": unrealized,
            "max_loss": max_loss,
            "capital_at_risk": capital_at_risk,
            "annualized_return_pct": annualized_return_pct,
            "breakeven_lower": breakeven_lower,
            "breakeven_upper": breakeven_upper,
            "distance_from_be_pct": distance_from_be_pct,
            "spot": spot,
            "worst_otm_pct": worst_otm_pct,
            "worst_delta": worst_delta,
            "any_leg_itm": any_leg_itm,
            "dollars_per_day": dollars_per_day,
            "day_pnl": day_pnl,
            "legs": leg_views,
            "risk_label": risk_label,
            "risk_pop_pct": risk_pop,
            "action": action,
            "tag_ids": tag_ids_by_pid.get(pid, []),
            "reconciliation": recon,
            "chain_id": p.id,
            "chain_name": p.name,
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
        "excluded_complex_count": excluded_complex,
    }

# ----------------------------------------------------------------------------
# Big Options (long premium, lottery-style) — long calls, long puts, long
# straddles, long strangles. Asymmetric bets where max loss is the debit
# paid and upside is uncapped (or strike-defined for long puts).
#
# This panel is *informational* by design. The user has explicitly told us
# their take-partial / take-all / cut decisions are contextual judgment
# calls, so we don't fire prescriptive Action chips. Instead we surface
# state (Sweet spot / Decay zone / Theta cliff), big winners, catalyst
# proximity, trim history, and concentration warnings — and let the user
# make the trade.
# ----------------------------------------------------------------------------

# Concentration thresholds. These are firm because the user gave concrete
# numbers ($2k typical target, $5k or 1% of portfolio soft cap).
_BIG_OPT_TARGET_USD = 2_000.0
_BIG_OPT_SOFT_CAP_USD = 5_000.0
_BIG_OPT_SOFT_CAP_PORT_PCT = 1.0  # 1% of liquidation value


def _classify_big_options_status(
    *,
    min_dte: Optional[int],
    min_atm_dist_pct: Optional[float],
    any_leg_otm: bool,
    multiple: Optional[float],
) -> str:
    """Time-driven status chip for a Big Options row.

    Patient        — DTE > 75. Plenty of room; thesis still has time.
    Sweet spot     — 30 <= DTE <= 75 AND a leg is within +/-5% of ATM.
    Decay zone     — 14 < DTE <= 30 (or 30-75 outside ATM band).
    Theta cliff    — DTE <= 14 AND any leg OTM AND not winning.
    """
    if min_dte is None:
        return "?"
    if min_dte <= 14 and any_leg_otm and (multiple is None or multiple < 1):
        return "Theta cliff"
    if min_dte <= 30:
        return "Decay zone"
    if 30 < min_dte <= 75 and min_atm_dist_pct is not None and min_atm_dist_pct <= 5:
        return "Sweet spot"
    if min_dte > 75:
        return "Patient"
    return "Decay zone"


def _classify_big_options_concentration(
    *,
    capital_at_risk: float,
    portfolio_lv: float,
) -> Optional[str]:
    """Return None / 'soft' / 'hard' for the Over-sized pill.

    Soft cap: $5k OR 1% of portfolio (whichever is *lower* — small accounts
    should get the percentage, large accounts the dollar floor).
    Hard cap: 2x soft cap.
    """
    if capital_at_risk <= 0:
        return None
    pct_cap = portfolio_lv * (_BIG_OPT_SOFT_CAP_PORT_PCT / 100) if portfolio_lv > 0 else 0
    soft_cap = min(_BIG_OPT_SOFT_CAP_USD, pct_cap) if pct_cap > 0 else _BIG_OPT_SOFT_CAP_USD
    if capital_at_risk >= soft_cap * 2:
        return "hard"
    if capital_at_risk >= soft_cap:
        return "soft"
    return None


def _chain_realized_pnl(recs: List[Dict[str, Any]], leg_symbols: set) -> float:
    """Sum signed leg.cost for OPTION legs in the given chain that match the
    leg_symbols. Net positive = closed at a credit (won); negative = lost."""
    total = 0.0
    for r in recs:
        for leg in r.get("legs") or []:
            if (leg.get("asset_type") or "").upper() != "OPTION":
                continue
            if leg.get("symbol") not in leg_symbols:
                continue
            try:
                total += float(leg.get("cost") or 0)
            except (TypeError, ValueError):
                pass
    return total


def _earliest_opening_date(recs: List[Dict[str, Any]], leg_symbols: set):
    """Earliest OPENING transaction date across the given option leg symbols."""
    earliest = None
    for r in recs:
        for leg in r.get("legs") or []:
            if (leg.get("asset_type") or "").upper() != "OPTION":
                continue
            if (leg.get("position_effect") or "").upper() != "OPENING":
                continue
            if leg.get("symbol") not in leg_symbols:
                continue
            d = r.get("date")
            if not d:
                continue
            if earliest is None or d < earliest:
                earliest = d
    return earliest


def fetch_big_options_holdings(
    user_id: str,
    db: Session,
) -> Dict[str, Any]:
    """Group-driven Big Options view.

    Validates 1+ long option legs, no shorts, no stock. One-leg chains are
    long_call or long_put. Two-leg same-expiration long-call + long-put =
    straddle (same strike) or strangle (different strikes). Other shapes
    accepted as 'long_multi' since the user explicitly said unusual shapes
    here are rare and should be treated as independent positions.
    """
    strategy_class = "big_options"

    user_tags = db.query(Tag).filter(Tag.user_id == user_id).all()
    tags = [
        t for t in user_tags
        if t.strategy_classes and strategy_class in t.strategy_classes
    ]

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

    payload_by_id: Dict[str, Dict[str, Any]] = {}
    if all_tx_ids:
        cached = db.query(SchwabTransactionCache).filter(
            SchwabTransactionCache.user_id == user_id,
            SchwabTransactionCache.schwab_transaction_id.in_(list(all_tx_ids)),
        ).all()
        payload_by_id = {r.schwab_transaction_id: r.raw_payload for r in cached}

    pos_rows: List[TransactionPosition] = []
    if pos_ids:
        pos_rows = db.query(TransactionPosition).filter(
            TransactionPosition.user_id == user_id,
            TransactionPosition.id.in_(pos_ids),
        ).all()
    pos_by_id = {p.id: p for p in pos_rows}

    snap = _bucket_synced_positions(user_id, db)
    last_synced = snap["most_recent_sync"]
    portfolio_lv = _portfolio_liquidation_value(user_id, db)
    live_stock_by_und, live_option_by_sym = _build_live_lookups(snap["buckets"])

    today = datetime.utcnow().date()
    holdings: List[Dict[str, Any]] = []
    excluded_complex = 0
    closed_winners = 0
    closed_losers = 0
    closed_total_realized = 0.0
    win_pnls: List[float] = []
    loss_pnls: List[float] = []

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

        if any(abs(s.get("qty", 0)) > 1e-9 for s in summary["stock"].values()):
            excluded_complex += 1
            continue

        all_option_legs = list(summary["options"].values())
        if any(l["qty"] < -1e-9 for l in all_option_legs):
            excluded_complex += 1
            continue

        open_legs = [l for l in all_option_legs if l["qty"] > 1e-9]

        all_leg_symbols = {l["symbol"] for l in all_option_legs if l.get("symbol")}
        any_opened = any(l.get("open_qty", 0) > 0 for l in all_option_legs)
        is_fully_closed = any_opened and not open_legs
        if is_fully_closed and all_leg_symbols:
            realized = _chain_realized_pnl(recs, all_leg_symbols)
            closed_total_realized += realized
            if realized > 0:
                closed_winners += 1
                win_pnls.append(realized)
            elif realized < 0:
                closed_losers += 1
                loss_pnls.append(realized)

        if not open_legs:
            continue

        und = (open_legs[0].get("underlying") or "").upper().lstrip("$")
        live_stock = live_stock_by_und.get(und) or {}
        spot = float(live_stock.get("current_price") or 0) if live_stock else 0

        leg_views = []
        total_cost_paid = 0.0
        total_current_value = 0.0
        total_intrinsic = 0.0
        total_extrinsic = 0.0
        total_original_contracts = 0.0
        total_current_contracts = 0.0
        max_expiration = None
        min_dte: Optional[int] = None
        min_atm_dist_pct: Optional[float] = None
        any_leg_otm = False
        any_leg_itm = False
        worst_leg_otm_pct: Optional[float] = None
        theta_total_per_share = 0.0
        thetas_present = False

        for ol in open_legs:
            sym = ol["symbol"]
            live = live_option_by_sym.get(sym) or {}
            try:
                strike = float(ol.get("strike") or 0)
            except (TypeError, ValueError):
                strike = 0
            opt_type = ol.get("option_type")
            qty = float(ol["qty"])
            original_qty = float(ol.get("open_qty") or 0) or qty
            cost_paid_for_leg = float(ol.get("open_cash") or 0)
            current_price = float(live.get("current_price") or 0)
            current_value_for_leg = qty * current_price * 100

            total_cost_paid += cost_paid_for_leg
            total_current_value += current_value_for_leg
            total_original_contracts += original_qty
            total_current_contracts += qty

            exp = ol.get("expiration")
            exp_iso = exp.isoformat() if hasattr(exp, "isoformat") else (str(exp) if exp else None)
            leg_dte: Optional[int] = None
            if exp_iso:
                try:
                    exp_date = datetime.fromisoformat(str(exp_iso)[:10]).date()
                    leg_dte = (exp_date - today).days
                    if max_expiration is None or exp_date > max_expiration:
                        max_expiration = exp_date
                    if min_dte is None or leg_dte < min_dte:
                        min_dte = leg_dte
                except Exception:
                    pass

            intrinsic_per_share = 0.0
            if spot > 0 and strike > 0:
                if opt_type == "call":
                    intrinsic_per_share = max(0.0, spot - strike)
                else:
                    intrinsic_per_share = max(0.0, strike - spot)
            extrinsic_per_share = max(0.0, current_price - intrinsic_per_share)
            total_intrinsic += intrinsic_per_share * qty * 100
            total_extrinsic += extrinsic_per_share * qty * 100

            atm_dist_pct = None
            otm_pct = None
            is_itm = False
            if spot > 0 and strike > 0:
                atm_dist_pct = abs(strike - spot) / spot * 100
                if min_atm_dist_pct is None or atm_dist_pct < min_atm_dist_pct:
                    min_atm_dist_pct = atm_dist_pct
                if opt_type == "call":
                    otm_pct = (strike - spot) / spot * 100
                    is_itm = spot > strike
                else:
                    otm_pct = (spot - strike) / spot * 100
                    is_itm = spot < strike
                if is_itm:
                    any_leg_itm = True
                else:
                    any_leg_otm = True
                if otm_pct is not None and (worst_leg_otm_pct is None or otm_pct > worst_leg_otm_pct):
                    worst_leg_otm_pct = otm_pct

            theta = live.get("theta")
            if theta is not None:
                theta_total_per_share += float(theta)
                thetas_present = True

            leg_views.append({
                "symbol": sym,
                "option_type": opt_type,
                "strike": strike,
                "expiration": str(exp_iso)[:10] if exp_iso else None,
                "dte": leg_dte,
                "contracts": qty,
                "original_contracts": original_qty,
                "cost_paid": cost_paid_for_leg,
                "current_price": current_price,
                "current_value": current_value_for_leg,
                "atm_dist_pct": atm_dist_pct,
                "otm_pct": otm_pct,
                "is_itm": is_itm,
                "delta": float(live.get("delta")) if live.get("delta") is not None else None,
                "iv": live.get("iv"),
                "theta": float(theta) if theta is not None else None,
            })

        # P&L decomposition for partially-trimmed positions.
        # net_cash_flow = signed sum of every option-leg cost (Schwab signs
        # it: opens are negative debits, closes are positive credits). So
        # total P&L is just `net_cash_flow + current_value of open slice`
        # — Schwab's per-leg cost already encodes who paid whom on each
        # transaction, no double-subtracting the debit.
        net_cash_flow = (
            _chain_realized_pnl(recs, all_leg_symbols)
            if all_leg_symbols else 0.0
        )
        total_pnl = net_cash_flow + total_current_value

        # Unrealized = MTM of the still-open slice vs cost basis allocated
        # to that slice. A 50%-trimmed position has half its original cost
        # still tied up in the open contracts; the other half was either
        # locked in as profit or eaten as loss when trimmed.
        if total_original_contracts > 0 and total_cost_paid > 0:
            cost_basis_open_slice = (
                total_cost_paid * (total_current_contracts / total_original_contracts)
            )
        else:
            cost_basis_open_slice = total_cost_paid
        unrealized = total_current_value - cost_basis_open_slice
        # Realized = locked-in portion of total P&L (zero if never trimmed).
        partials_realized = total_pnl - unrealized

        # Multiple = total return × original capital. Fully-open at +2%
        # reads 1.02x; 50%-trimmed-at-2x with the rest flat reads ~1.5x.
        multiple = (
            (total_cost_paid + total_pnl) / total_cost_paid
            if total_cost_paid > 0 else None
        )

        trimmed_pct = None
        if total_original_contracts > 0:
            trimmed_pct = max(0.0, (1 - total_current_contracts / total_original_contracts) * 100)

        time_premium_left = total_extrinsic

        if thetas_present:
            theta_per_day_dollars = theta_total_per_share * 100 * total_current_contracts
        else:
            if min_dte and min_dte > 0 and time_premium_left > 0:
                theta_per_day_dollars = -(time_premium_left / min_dte)
            else:
                theta_per_day_dollars = None
        theta_next_7d = theta_per_day_dollars * 7 if theta_per_day_dollars is not None else None

        opening_date = _earliest_opening_date(recs, all_leg_symbols)
        days_held = None
        if opening_date:
            try:
                od = datetime.fromisoformat(str(opening_date)[:10]).date()
                days_held = (today - od).days
            except Exception:
                pass

        catalyst = None
        if max_expiration and und:
            try:
                catalyst = get_next_catalyst(db, str(user_id), und, max_expiration)
            except Exception:
                catalyst = None

        pct_port = (total_cost_paid / portfolio_lv * 100) if portfolio_lv > 0 else None
        oversized = _classify_big_options_concentration(
            capital_at_risk=total_cost_paid, portfolio_lv=portfolio_lv,
        )

        status = _classify_big_options_status(
            min_dte=min_dte,
            min_atm_dist_pct=min_atm_dist_pct,
            any_leg_otm=any_leg_otm,
            multiple=multiple,
        )

        if len(open_legs) == 1:
            ot = open_legs[0].get("option_type")
            type_chip = "Long Call" if ot == "call" else "Long Put"
            row_type = "long_call" if ot == "call" else "long_put"
            try:
                strike_only = float(open_legs[0].get("strike") or 0)
            except (TypeError, ValueError):
                strike_only = 0
            strikes_label = f"{strike_only:g} {'C' if ot == 'call' else 'P'}"
        elif len(open_legs) == 2 and {l.get("option_type") for l in open_legs} == {"put", "call"}:
            put_leg = next(l for l in open_legs if l.get("option_type") == "put")
            call_leg = next(l for l in open_legs if l.get("option_type") == "call")
            try:
                pk = float(put_leg.get("strike") or 0)
                ck = float(call_leg.get("strike") or 0)
            except (TypeError, ValueError):
                pk = ck = 0
            same_exp = put_leg.get("expiration") == call_leg.get("expiration")
            if same_exp and abs(pk - ck) < 1e-9:
                type_chip = "Long Straddle"
                row_type = "long_straddle"
                strikes_label = f"{pk:g} P/C"
            elif same_exp:
                type_chip = "Long Strangle"
                row_type = "long_strangle"
                strikes_label = f"{pk:g} P / {ck:g} C"
            else:
                type_chip = "Long Multi"
                row_type = "long_multi"
                strikes_label = f"{pk:g} P / {ck:g} C (mixed exp)"
        else:
            type_chip = "Long Multi"
            row_type = "long_multi"
            strikes_label = " / ".join(
                f"{float(l.get('strike') or 0):g}{'C' if l.get('option_type')=='call' else 'P'}"
                for l in open_legs
            )

        missing = [lv["symbol"] for lv in leg_views if not live_option_by_sym.get(lv["symbol"])]
        if missing:
            recon = {"state": "mismatch", "summary": f"missing live data: {', '.join(missing)}"}
        else:
            recon = {"state": "live", "summary": "all legs synced"}

        distance_to_itm_pct: Optional[float] = None
        if worst_leg_otm_pct is not None and worst_leg_otm_pct > 0:
            distance_to_itm_pct = worst_leg_otm_pct
        elif any_leg_itm:
            distance_to_itm_pct = 0.0

        holdings.append({
            "underlying": und,
            "account_hash": "",
            "account_number": None,
            "type": type_chip,
            "row_type": row_type,
            "strikes_label": strikes_label,
            "expiration": max_expiration.isoformat() if max_expiration else None,
            "min_dte": min_dte,
            "contracts": total_current_contracts,
            "original_contracts": total_original_contracts,
            "trimmed_pct": trimmed_pct,
            "spot": spot,

            "cost_paid": total_cost_paid,
            "current_value": total_current_value,
            "partials_realized": partials_realized,
            "unrealized_pnl": unrealized,
            "row_total_pnl": total_pnl,
            "multiple": multiple,

            "intrinsic_remaining": total_intrinsic,
            "time_premium_left": time_premium_left,
            "theta_per_day": theta_per_day_dollars,
            "theta_next_7d": theta_next_7d,
            "days_held": days_held,
            "min_atm_dist_pct": min_atm_dist_pct,
            "worst_leg_otm_pct": worst_leg_otm_pct,
            "distance_to_itm_pct": distance_to_itm_pct,
            "any_leg_itm": any_leg_itm,

            "pct_port": pct_port,
            "oversized": oversized,

            "status": status,
            "catalyst": catalyst,

            "legs": leg_views,
            "tag_ids": tag_ids_by_pid.get(pid, []),
            "reconciliation": recon,
            "chain_id": p.id,
            "chain_name": p.name,
        })

    closed_total = closed_winners + closed_losers
    hit_rate_pct = (closed_winners / closed_total * 100) if closed_total > 0 else None
    avg_win = (sum(win_pnls) / len(win_pnls)) if win_pnls else None
    avg_loss = (sum(loss_pnls) / len(loss_pnls)) if loss_pnls else None

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
        "excluded_complex_count": excluded_complex,
        "stats": {
            "closed_count": closed_total,
            "winners": closed_winners,
            "losers": closed_losers,
            "hit_rate_pct": hit_rate_pct,
            "avg_win": avg_win,
            "avg_loss": avg_loss,
            "total_realized": closed_total_realized,
        },
        "concentration_thresholds": {
            "target_usd": _BIG_OPT_TARGET_USD,
            "soft_cap_usd": _BIG_OPT_SOFT_CAP_USD,
            "soft_cap_port_pct": _BIG_OPT_SOFT_CAP_PORT_PCT,
        },
    }
