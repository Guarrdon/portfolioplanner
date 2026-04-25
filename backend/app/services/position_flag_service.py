"""Position flag service — upsert and list user flags keyed by position signature"""
from typing import List
from sqlalchemy.orm import Session

from app.models.position_flag import PositionFlag

_UNSET = object()


def upsert_flag(
    db: Session,
    user_id: str,
    position_signature: str,
    flagged=_UNSET,
    note=_UNSET,
) -> PositionFlag:
    row = (
        db.query(PositionFlag)
        .filter(
            PositionFlag.user_id == user_id,
            PositionFlag.position_signature == position_signature,
        )
        .first()
    )
    if row is None:
        row = PositionFlag(
            user_id=user_id,
            position_signature=position_signature,
            flagged=False,
        )
        db.add(row)
    if flagged is not _UNSET:
        row.flagged = bool(flagged)
    if note is not _UNSET:
        row.note = note
    db.commit()
    db.refresh(row)
    return row


def list_flags(db: Session, user_id: str) -> List[PositionFlag]:
    return (
        db.query(PositionFlag)
        .filter(PositionFlag.user_id == user_id)
        .all()
    )
