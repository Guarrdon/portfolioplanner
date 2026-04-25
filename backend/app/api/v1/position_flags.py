"""Position flags API — user-managed flags + notes on synced Schwab positions"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.position_flag import (
    PositionFlagUpdate,
    PositionFlagResponse,
    PositionFlagsListResponse,
)
from app.services import position_flag_service

router = APIRouter(prefix="/position-flags", tags=["position-flags"])

# TODO: replace with real current_user once auth is wired in the frontend
_TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


@router.get("", response_model=PositionFlagsListResponse)
def list_position_flags(db: Session = Depends(get_db)):
    """Return all of the user's position flags, keyed by position signature."""
    rows = position_flag_service.list_flags(db=db, user_id=_TEST_USER_ID)
    return PositionFlagsListResponse(
        flags={
            r.position_signature: PositionFlagResponse(
                position_signature=r.position_signature,
                flagged=r.flagged,
                note=r.note,
            )
            for r in rows
        }
    )


@router.patch("/{position_signature}", response_model=PositionFlagResponse)
def update_position_flag(
    position_signature: str,
    patch: PositionFlagUpdate,
    db: Session = Depends(get_db),
):
    """Upsert a flag (flagged/note). Fields omitted from the body are left unchanged."""
    if not position_signature:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="position_signature required")
    sent = patch.model_dump(exclude_unset=True)
    kwargs = {}
    for k in ("flagged", "note"):
        if k in sent:
            kwargs[k] = sent[k]
    row = position_flag_service.upsert_flag(
        db=db,
        user_id=_TEST_USER_ID,
        position_signature=position_signature,
        **kwargs,
    )
    return PositionFlagResponse(
        position_signature=row.position_signature,
        flagged=row.flagged,
        note=row.note,
    )
