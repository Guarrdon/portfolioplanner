"""Transactions API endpoints — live Schwab fetches, annotations,
classified positions, and tag (custom group) memberships."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.schemas.transaction import (
    TransactionsByUnderlyingResponse,
    TransactionsByAccountResponse,
    TransactionAnnotationUpdate,
    TransactionAnnotationResponse,
    ClassifyTransactionsRequest,
    ClassifyTransactionsResponse,
    UnclassifyTransactionsRequest,
    TransactionPositionInfo,
    TransactionPositionUpdate,
    OpenPositionsResponse,
)
from app.services import schwab_transactions
from app.services.schwab_transactions import _UNSET

router = APIRouter(prefix="/transactions", tags=["transactions"])

# TODO: replace with real current_user once auth is wired in the frontend
_TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


@router.get("/by-underlying/{underlying}", response_model=TransactionsByUnderlyingResponse)
def get_transactions_by_underlying(
    underlying: str,
    account_id: Optional[str] = Query(None, description="Account hash; all accounts if omitted"),
    days: int = Query(365, ge=1, le=730),
    refresh: bool = Query(False, description="Force pull from Schwab even if cache is fresh"),
    db: Session = Depends(get_db),
):
    """Fetch transactions for an underlying. Reads from cache by default;
    pulls only the gap from Schwab on cache miss or stale."""
    try:
        return schwab_transactions.fetch_transactions_by_underlying(
            user_id=_TEST_USER_ID,
            db=db,
            underlying=underlying,
            account_id=account_id,
            days=days,
            refresh=refresh,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch transactions: {e}",
        )


@router.get("/cache-progress/{account_hash}")
def get_cache_progress(account_hash: str):
    """Read the current Schwab-cache-warming progress for an account. Polled by
    the UI during long initial loads so the user sees per-chunk progress."""
    return schwab_transactions.get_cache_progress(account_hash)


@router.get("/by-account/{account_hash}", response_model=TransactionsByAccountResponse)
def get_transactions_by_account(
    account_hash: str,
    days: int = Query(365, ge=1, le=730),
    refresh: bool = Query(False, description="Force pull from Schwab even if cache is fresh"),
    db: Session = Depends(get_db),
):
    """Fetch every transaction for an account (no underlying filter)."""
    import logging, traceback
    log = logging.getLogger(__name__)
    try:
        return schwab_transactions.fetch_transactions_by_account(
            user_id=_TEST_USER_ID,
            db=db,
            account_id=account_hash,
            days=days,
            refresh=refresh,
        )
    except ValueError as e:
        log.warning(f"by-account 400 for {account_hash[:8]}: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        tb = traceback.format_exc()
        log.error(f"by-account 500 for {account_hash[:8]}: {e}\n{tb}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"{type(e).__name__}: {e}",
        )


@router.get("/open-positions/{underlying}", response_model=OpenPositionsResponse)
def get_open_positions_for_underlying(
    underlying: str,
    account_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Live-fetch current open positions (stock + options) for an underlying,
    bypassing the DB's strategy-grouped duplicates."""
    try:
        return schwab_transactions.fetch_open_positions_for_underlying(
            user_id=_TEST_USER_ID,
            db=db,
            underlying=underlying,
            account_id=account_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch open positions: {e}",
        )


@router.get("/open-positions")
def get_all_open_positions(
    account_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Live-fetch every current open position (stock + options) for the
    account, grouped by underlying. One Schwab round-trip; the UI reads it
    once per page load and reconciles every saved position against it."""
    try:
        return schwab_transactions.fetch_all_open_positions(
            user_id=_TEST_USER_ID,
            db=db,
            account_id=account_id,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch open positions: {e}",
        )


@router.patch("/{schwab_transaction_id}/annotation", response_model=TransactionAnnotationResponse)
def update_transaction_annotation(
    schwab_transaction_id: str,
    patch: TransactionAnnotationUpdate,
    db: Session = Depends(get_db),
):
    """Upsert an annotation (hidden/disposition/note/transaction_position_id).
    Fields omitted from the body are left unchanged."""
    sent = patch.model_dump(exclude_unset=True)
    kwargs = {}
    for k in ("hidden", "disposition", "note", "transaction_position_id"):
        if k in sent:
            kwargs[k] = sent[k]
    ann = schwab_transactions.upsert_annotation(
        db=db,
        user_id=_TEST_USER_ID,
        schwab_transaction_id=schwab_transaction_id,
        **kwargs,
    )
    return TransactionAnnotationResponse(
        schwab_transaction_id=ann.schwab_transaction_id,
        hidden=ann.hidden,
        disposition=ann.disposition,
        note=ann.note,
        transaction_position_id=ann.transaction_position_id,
    )


@router.post("/classify", response_model=ClassifyTransactionsResponse)
def classify_transactions(
    req: ClassifyTransactionsRequest,
    db: Session = Depends(get_db),
):
    """Attach the given transactions to a classified position. Pass an
    existing transaction_position_id to extend it, or omit to create one."""
    if not req.schwab_transaction_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="schwab_transaction_ids required")
    pid = schwab_transactions.classify_transactions(
        db=db,
        user_id=_TEST_USER_ID,
        schwab_transaction_ids=req.schwab_transaction_ids,
        transaction_position_id=req.transaction_position_id,
        position_type=req.position_type,
        default_name=req.name,
    )
    return ClassifyTransactionsResponse(
        transaction_position_id=pid,
        count=len(req.schwab_transaction_ids),
    )


@router.patch("/positions/{transaction_position_id}", response_model=TransactionPositionInfo)
def update_transaction_position(
    transaction_position_id: str,
    patch: TransactionPositionUpdate,
    db: Session = Depends(get_db),
):
    """Edit a classified position's name, note, or position_type."""
    sent = patch.model_dump(exclude_unset=True)
    kwargs = {}
    for k in ("name", "note", "position_type"):
        if k in sent:
            kwargs[k] = sent[k]
    pos = schwab_transactions.update_transaction_position(
        db=db,
        user_id=_TEST_USER_ID,
        transaction_position_id=transaction_position_id,
        **kwargs,
    )
    return TransactionPositionInfo(
        id=pos.id,
        name=pos.name,
        note=pos.note,
        position_type=pos.position_type,
        created_at=pos.created_at.isoformat() if pos.created_at else None,
    )


@router.post("/unclassify")
def unclassify_transactions(
    req: UnclassifyTransactionsRequest,
    db: Session = Depends(get_db),
):
    """Remove the given transactions from their classified position."""
    if not req.schwab_transaction_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="schwab_transaction_ids required")
    schwab_transactions.unclassify_transactions(
        db=db,
        user_id=_TEST_USER_ID,
        schwab_transaction_ids=req.schwab_transaction_ids,
    )
    return {"count": len(req.schwab_transaction_ids)}
