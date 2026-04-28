"""Tag (custom group) service."""
import random
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.models import Tag, TagMembership


# Palette used for randomized tag colors when the caller doesn't provide one.
_PALETTE = [
    "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
    "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
    "#06b6d4", "#84cc16", "#6366f1", "#d946ef",
]


_UNSET = object()


def _pick_color() -> str:
    return random.choice(_PALETTE)


def list_tags(db: Session, user_id: str) -> List[Tag]:
    return db.query(Tag).filter(Tag.user_id == user_id).order_by(Tag.name.asc()).all()


def list_tag_member_counts(db: Session, user_id: str) -> Dict[str, int]:
    """Map tag_id (str) → total member count, in one grouped query."""
    from sqlalchemy import func
    rows = (
        db.query(TagMembership.tag_id, func.count(TagMembership.id))
        .join(Tag, Tag.id == TagMembership.tag_id)
        .filter(Tag.user_id == user_id)
        .group_by(TagMembership.tag_id)
        .all()
    )
    return {str(tag_id): cnt for (tag_id, cnt) in rows}


def create_tag(
    db: Session,
    user_id: str,
    name: str,
    note: Optional[str] = None,
    color: Optional[str] = None,
    strategy_classes: Optional[List[str]] = None,
) -> Tag:
    from app.core.strategy_classes import normalize_strategy_classes
    sc = normalize_strategy_classes(strategy_classes) if strategy_classes is not None else []
    tag = Tag(
        user_id=user_id, name=name, note=note,
        color=color or _pick_color(),
        strategy_classes=sc if sc else None,
    )
    db.add(tag)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(Tag).filter(Tag.user_id == user_id, Tag.name == name).first()
        if existing:
            return existing
        raise
    db.refresh(tag)
    return tag


def update_tag(
    db: Session,
    user_id: str,
    tag_id: str,
    name=_UNSET,
    note=_UNSET,
    color=_UNSET,
    strategy_classes=_UNSET,
) -> Optional[Tag]:
    tag = db.query(Tag).filter(Tag.user_id == user_id, Tag.id == tag_id).first()
    if tag is None:
        return None
    if name is not _UNSET and name:
        tag.name = name
    if note is not _UNSET:
        tag.note = note or None
    if color is not _UNSET:
        tag.color = color or None
    if strategy_classes is not _UNSET:
        from app.core.strategy_classes import normalize_strategy_classes
        sc = normalize_strategy_classes(strategy_classes)
        tag.strategy_classes = sc if sc else None
    db.commit()
    db.refresh(tag)
    return tag


def delete_tag(db: Session, user_id: str, tag_id: str) -> bool:
    tag = db.query(Tag).filter(Tag.user_id == user_id, Tag.id == tag_id).first()
    if tag is None:
        return False
    db.delete(tag)  # CASCADE removes memberships
    db.commit()
    return True


def add_member(
    db: Session,
    user_id: str,
    tag_id: str,
    member_type: str,
    member_id: str,
) -> Optional[TagMembership]:
    """Idempotent: returns the existing membership row if already present."""
    tag = db.query(Tag).filter(Tag.user_id == user_id, Tag.id == tag_id).first()
    if tag is None:
        return None
    existing = db.query(TagMembership).filter(
        TagMembership.tag_id == tag.id,
        TagMembership.member_type == member_type,
        TagMembership.member_id == member_id,
    ).first()
    if existing:
        return existing
    m = TagMembership(tag_id=tag.id, member_type=member_type, member_id=member_id)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def remove_member(
    db: Session,
    user_id: str,
    tag_id: str,
    member_type: str,
    member_id: str,
) -> bool:
    tag = db.query(Tag).filter(Tag.user_id == user_id, Tag.id == tag_id).first()
    if tag is None:
        return False
    deleted = db.query(TagMembership).filter(
        TagMembership.tag_id == tag.id,
        TagMembership.member_type == member_type,
        TagMembership.member_id == member_id,
    ).delete()
    db.commit()
    return deleted > 0
