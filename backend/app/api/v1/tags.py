"""Tag (custom group) API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.schemas.tag import (
    TagCreate,
    TagUpdate,
    TagResponse,
    TagMembershipRequest,
    TagMembershipResponse,
    StrategyPositionsResponse,
    LongStockHoldingsResponse,
    CoveredCallsHoldingsResponse,
    VerticalsHoldingsResponse,
    SingleLegHoldingsResponse,
    BigOptionsHoldingsResponse,
    BoxSpreadsHoldingsResponse,
    CashMgmtHoldingsResponse,
    DividendsHoldingsResponse,
    DividendClassificationUpdate,
    DividendClassificationResponse,
)
from app.services import tags as tags_service
from app.services import strategy_positions as strategy_positions_service
from app.models import DividendClassification
from datetime import datetime

router = APIRouter(prefix="/tags", tags=["tags"])

_TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


def _to_response(t, member_count: int = 0) -> TagResponse:
    return TagResponse(
        id=str(t.id),
        name=t.name,
        note=t.note,
        color=t.color,
        strategy_classes=t.strategy_classes or [],
        member_count=member_count,
        created_at=t.created_at.isoformat() if t.created_at else None,
    )


@router.get("", response_model=List[TagResponse])
def list_tags(db: Session = Depends(get_db)):
    tags = tags_service.list_tags(db=db, user_id=_TEST_USER_ID)
    counts = tags_service.list_tag_member_counts(db=db, user_id=_TEST_USER_ID)
    return [_to_response(t, member_count=counts.get(str(t.id), 0)) for t in tags]


@router.post("", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
def create_tag(req: TagCreate, db: Session = Depends(get_db)):
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name required")
    try:
        t = tags_service.create_tag(
            db=db, user_id=_TEST_USER_ID,
            name=req.name.strip(), note=req.note, color=req.color,
            strategy_classes=req.strategy_classes,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return _to_response(t)


@router.patch("/{tag_id}", response_model=TagResponse)
def update_tag(tag_id: str, req: TagUpdate, db: Session = Depends(get_db)):
    sent = req.model_dump(exclude_unset=True)
    try:
        t = tags_service.update_tag(db=db, user_id=_TEST_USER_ID, tag_id=tag_id, **sent)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    if t is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="tag not found")
    return _to_response(t)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: str, db: Session = Depends(get_db)):
    if not tags_service.delete_tag(db=db, user_id=_TEST_USER_ID, tag_id=tag_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="tag not found")


@router.post("/{tag_id}/members", response_model=TagMembershipResponse, status_code=status.HTTP_201_CREATED)
def add_member(tag_id: str, req: TagMembershipRequest, db: Session = Depends(get_db)):
    m = tags_service.add_member(
        db=db, user_id=_TEST_USER_ID, tag_id=tag_id,
        member_type=req.member_type, member_id=req.member_id,
    )
    if m is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="tag not found")
    return TagMembershipResponse(tag_id=str(m.tag_id), member_type=m.member_type, member_id=m.member_id)


@router.delete("/{tag_id}/members/{member_type}/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(tag_id: str, member_type: str, member_id: str, db: Session = Depends(get_db)):
    if member_type not in ("transaction", "transaction_position"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid member_type")
    if not tags_service.remove_member(
        db=db, user_id=_TEST_USER_ID, tag_id=tag_id,
        member_type=member_type, member_id=member_id,
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="membership not found")


@router.get("/strategy/{strategy_class}", response_model=StrategyPositionsResponse)
def get_strategy_positions(strategy_class: str, db: Session = Depends(get_db)):
    """Tags + tagged positions (with rollup-ready transactions and live prices)
    for one of the 11 strategy classes. Drives strategy detail panels."""
    try:
        return strategy_positions_service.fetch_strategy_positions(
            user_id=_TEST_USER_ID,
            db=db,
            strategy_class=strategy_class,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# Strategy holdings endpoints accept an optional ?account_hash=... to scope
# positions, payments, and aggregates to a single account. Omitted = the
# original cross-account aggregate view.
_ACCOUNT_HASH_Q = Query(
    None,
    description="Schwab account_hash to scope holdings to a single account",
)


@router.get("/strategy/long_stock/holdings", response_model=LongStockHoldingsResponse)
def get_long_stock_holdings(
    db: Session = Depends(get_db),
    account_hash: Optional[str] = _ACCOUNT_HASH_Q,
):
    """Long Stock holdings, live-first. One row per active Schwab stock
    position (per account) tagged into a long_stock Group, with chain
    history attached as overlay and reconciliation status computed."""
    return strategy_positions_service.fetch_long_stock_holdings(
        user_id=_TEST_USER_ID,
        db=db,
        account_hash=account_hash,
    )


@router.get("/strategy/covered_calls/holdings", response_model=CoveredCallsHoldingsResponse)
def get_covered_calls_holdings(
    db: Session = Depends(get_db),
    account_hash: Optional[str] = _ACCOUNT_HASH_Q,
):
    """Covered Calls holdings, live-first. One row per short-call leg
    paired with its underlying long stock; laddered calls each get their
    own row sharing stock context."""
    return strategy_positions_service.fetch_covered_calls_holdings(
        user_id=_TEST_USER_ID,
        db=db,
        account_hash=account_hash,
    )


@router.get("/strategy/verticals/holdings", response_model=VerticalsHoldingsResponse)
def get_verticals_holdings(
    db: Session = Depends(get_db),
    account_hash: Optional[str] = _ACCOUNT_HASH_Q,
):
    """Verticals holdings, group-driven. One row per tagged
    transaction_position whose currently-open legs form a balanced
    same-type/same-expiration two-leg spread."""
    return strategy_positions_service.fetch_verticals_holdings(
        user_id=_TEST_USER_ID,
        db=db,
        account_hash=account_hash,
    )


@router.get("/strategy/single_leg/holdings", response_model=SingleLegHoldingsResponse)
def get_single_leg_holdings(
    db: Session = Depends(get_db),
    account_hash: Optional[str] = _ACCOUNT_HASH_Q,
):
    """Single-Leg short-premium holdings, group-driven. One row per tagged
    transaction_position whose currently-open legs are 1-2 short option
    legs (no longs, no stock). Covers sold puts, sold calls, short
    straddles, and short strangles."""
    return strategy_positions_service.fetch_single_leg_holdings(
        user_id=_TEST_USER_ID,
        db=db,
        account_hash=account_hash,
    )


@router.get("/strategy/big_options/holdings", response_model=BigOptionsHoldingsResponse)
def get_big_options_holdings(
    db: Session = Depends(get_db),
    account_hash: Optional[str] = _ACCOUNT_HASH_Q,
):
    """Big Options long-premium holdings, group-driven. Lottery-style
    plays: long calls, long puts, long straddles, long strangles. Includes
    earnings/catalyst proximity, trim history, concentration warnings,
    hit-rate stats over closed chains."""
    return strategy_positions_service.fetch_big_options_holdings(
        user_id=_TEST_USER_ID,
        db=db,
        account_hash=account_hash,
    )


@router.get("/strategy/box_spreads/holdings", response_model=BoxSpreadsHoldingsResponse)
def get_box_spreads_holdings(
    db: Session = Depends(get_db),
    account_hash: Optional[str] = _ACCOUNT_HASH_Q,
):
    """Box Spreads holdings, group-driven. 4-leg balanced boxes acting
    as synthetic loans. Long boxes earn implied yield; short boxes pay
    an implied rate (typical SPX margin financing). Includes FRED 3-mo
    T-bill benchmark for yield comparison and account-exposure
    aggregates (face value settling 30d / 90d / all)."""
    return strategy_positions_service.fetch_box_spreads_holdings(
        user_id=_TEST_USER_ID,
        db=db,
        account_hash=account_hash,
    )


@router.get("/strategy/cash_mgmt/holdings", response_model=CashMgmtHoldingsResponse)
def get_cash_mgmt_holdings(
    db: Session = Depends(get_db),
    account_hash: Optional[str] = _ACCOUNT_HASH_Q,
):
    """Cash Mgmt holdings — diversification across low-yield vehicles
    (MMFs, treasury ETFs, short-bond ETFs, account sweep) plus the
    cost-of-carry from box-spread short liabilities. Net carry is the
    spread between deployed-cash yield and weighted borrow rate.
    Yields are derived from FRED (DGS1MO + DGS3MO) per vehicle type."""
    return strategy_positions_service.fetch_cash_mgmt_holdings(
        user_id=_TEST_USER_ID,
        db=db,
        account_hash=account_hash,
    )


@router.get("/strategy/dividends/holdings", response_model=DividendsHoldingsResponse)
def get_dividends_holdings(
    db: Session = Depends(get_db),
    account_hash: Optional[str] = _ACCOUNT_HASH_Q,
):
    """Dividends holdings — past-first income view. One row per tagged
    underlying. TTM income comes from cached Schwab DIVIDEND_OR_INTEREST
    transactions whose payer matches a tagged ticker; we don't project
    future payouts (no ex-div / rate data without an external source).
    Per-symbol qualified flag is user-set via the classifications endpoint."""
    return strategy_positions_service.fetch_dividends_holdings(
        user_id=_TEST_USER_ID,
        db=db,
        account_hash=account_hash,
    )


@router.put(
    "/strategy/dividends/classifications/{symbol}",
    response_model=DividendClassificationResponse,
)
def upsert_dividend_classification(
    symbol: str,
    body: DividendClassificationUpdate,
    db: Session = Depends(get_db),
):
    """User-set qualified flag for a single ticker. Body's qualified=null
    clears the row back to "unset" (panel surfaces "verify")."""
    sym = (symbol or "").strip().upper()
    if not sym:
        raise HTTPException(status_code=400, detail="symbol required")

    row = db.query(DividendClassification).filter(
        DividendClassification.user_id == _TEST_USER_ID,
        DividendClassification.symbol == sym,
    ).first()

    if body.qualified is None and body.note in (None, ""):
        # Treat null/null as a clear: drop the row entirely so the absence
        # is unambiguous and counts as "unset" everywhere.
        if row:
            db.delete(row)
            db.commit()
        return DividendClassificationResponse(
            symbol=sym, qualified=None, note=None, updated_at=None,
        )

    if row is None:
        row = DividendClassification(
            user_id=_TEST_USER_ID,
            symbol=sym,
            qualified=bool(body.qualified) if body.qualified is not None else False,
            note=body.note,
        )
        db.add(row)
    else:
        if body.qualified is not None:
            row.qualified = bool(body.qualified)
        if body.note is not None:
            row.note = body.note or None
        row.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(row)
    return DividendClassificationResponse(
        symbol=row.symbol,
        qualified=row.qualified,
        note=row.note,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
    )
