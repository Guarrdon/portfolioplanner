"""User-defined tags for transactions and classified positions."""
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, UniqueConstraint
from datetime import datetime
import uuid

from app.core.database import Base, GUID


class Tag(Base):
    """
    Open-ended user label. A tag can be applied to raw transactions and/or
    transaction_positions via TagMembership. Tags are the user's own
    organization layer (e.g. "2025 Completed", "Big Options", "Cash Mgmt")
    and are deliberately excluded from portfolio summary math — summaries
    always roll up from raw transactions and classified positions, never
    from tags, to avoid double-counting when a member belongs to multiple.
    """
    __tablename__ = "tags"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_user_tag_name"),
    )

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    user_id = Column(GUID, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    note = Column(Text, nullable=True)
    color = Column(String, nullable=True)  # hex like "#aabbcc", randomized at create time

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class TagMembership(Base):
    """
    Polymorphic join: a tag can contain raw transactions AND classified
    positions. member_type is one of:
      - "transaction"           → member_id = schwab_transaction_id
      - "transaction_position"  → member_id = transaction_positions.id
    """
    __tablename__ = "tag_memberships"
    __table_args__ = (
        UniqueConstraint("tag_id", "member_type", "member_id", name="uq_tag_member"),
    )

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    tag_id = Column(GUID, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False, index=True)
    member_type = Column(String, nullable=False, index=True)
    member_id = Column(String, nullable=False, index=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
