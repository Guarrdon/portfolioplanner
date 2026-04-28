"""Tag (custom group) API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.schemas.tag import (
    TagCreate,
    TagUpdate,
    TagResponse,
    TagMembershipRequest,
    TagMembershipResponse,
    StrategyPositionsResponse,
    LongStockHoldingsResponse,
)
from app.services import tags as tags_service
from app.services import strategy_positions as strategy_positions_service

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


@router.get("/strategy/long_stock/holdings", response_model=LongStockHoldingsResponse)
def get_long_stock_holdings(db: Session = Depends(get_db)):
    """Long Stock holdings, live-first. One row per active Schwab stock
    position (per account) tagged into a long_stock Group, with chain
    history attached as overlay and reconciliation status computed."""
    return strategy_positions_service.fetch_long_stock_holdings(
        user_id=_TEST_USER_ID,
        db=db,
    )
