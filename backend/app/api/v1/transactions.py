"""Transactions API endpoints (live-fetched from Schwab + user annotations)"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.schemas.transaction import (
    TransactionsByUnderlyingResponse,
    TransactionAnnotationUpdate,
    TransactionAnnotationResponse,
    LinkTransactionsRequest,
    LinkTransactionsResponse,
    LinkGroupInfo,
    LinkGroupUpdate,
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
    db: Session = Depends(get_db),
):
    """Live-fetch transactions for an underlying across one or all accounts."""
    try:
        return schwab_transactions.fetch_transactions_by_underlying(
            user_id=_TEST_USER_ID,
            db=db,
            underlying=underlying,
            account_id=account_id,
            days=days,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch transactions: {e}",
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


@router.patch("/{schwab_transaction_id}/annotation", response_model=TransactionAnnotationResponse)
def update_transaction_annotation(
    schwab_transaction_id: str,
    patch: TransactionAnnotationUpdate,
    db: Session = Depends(get_db),
):
    """Upsert an annotation (hidden/disposition/note/link_group_id). Fields omitted
    from the body are left unchanged."""
    # Only pass fields that were actually set in the request body (exclude_unset).
    sent = patch.model_dump(exclude_unset=True)
    kwargs = {}
    for k in ("hidden", "disposition", "note", "link_group_id"):
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
        link_group_id=ann.link_group_id,
    )


@router.post("/link", response_model=LinkTransactionsResponse)
def link_transactions(
    req: LinkTransactionsRequest,
    db: Session = Depends(get_db),
):
    """Link a set of transactions into a visual group. Pass an existing group_id
    to extend it, or omit for a freshly-generated id."""
    if not req.schwab_transaction_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="schwab_transaction_ids required")
    gid = schwab_transactions.link_transactions(
        db=db,
        user_id=_TEST_USER_ID,
        schwab_transaction_ids=req.schwab_transaction_ids,
        group_id=req.group_id,
    )
    return LinkTransactionsResponse(group_id=gid, count=len(req.schwab_transaction_ids))


@router.patch("/link-groups/{group_id}", response_model=LinkGroupInfo)
def update_link_group(
    group_id: str,
    patch: LinkGroupUpdate,
    db: Session = Depends(get_db),
):
    """Edit a link group's name and/or note."""
    sent = patch.model_dump(exclude_unset=True)
    kwargs = {}
    if "name" in sent:
        kwargs["name"] = sent["name"]
    if "note" in sent:
        kwargs["note"] = sent["note"]
    grp = schwab_transactions.update_link_group(
        db=db,
        user_id=_TEST_USER_ID,
        group_id=group_id,
        **kwargs,
    )
    return LinkGroupInfo(
        id=grp.id,
        name=grp.name,
        note=grp.note,
        created_at=grp.created_at.isoformat() if grp.created_at else None,
    )


@router.post("/unlink", response_model=LinkTransactionsResponse)
def unlink_transactions(
    req: LinkTransactionsRequest,
    db: Session = Depends(get_db),
):
    """Remove the given transactions from their link group."""
    if not req.schwab_transaction_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="schwab_transaction_ids required")
    schwab_transactions.unlink_transactions(
        db=db,
        user_id=_TEST_USER_ID,
        schwab_transaction_ids=req.schwab_transaction_ids,
    )
    return LinkTransactionsResponse(group_id="", count=len(req.schwab_transaction_ids))
