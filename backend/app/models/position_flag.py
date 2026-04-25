"""Position flag model — user-editable flag + note attached to a Schwab position"""
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean, UniqueConstraint
from datetime import datetime
import uuid

from app.core.database import Base, GUID


class PositionFlag(Base):
    """
    User flag + optional note on a Schwab position, keyed by position signature
    (a SHA256 of structural fields) so the flag survives re-syncs as long as the
    position's structure is unchanged. Mirrors the TransactionAnnotation pattern.
    """
    __tablename__ = "position_flags"
    __table_args__ = (
        UniqueConstraint("user_id", "position_signature", name="uq_user_position_flag"),
    )

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    user_id = Column(GUID, ForeignKey("users.id"), nullable=False, index=True)
    position_signature = Column(String, nullable=False, index=True)

    flagged = Column(Boolean, default=False, nullable=False)
    note = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
