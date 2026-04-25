"""Transaction annotation + link-group models"""
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean, UniqueConstraint
from datetime import datetime
import uuid

from app.core.database import Base, GUID


class TransactionAnnotation(Base):
    """
    User-editable metadata attached to a Schwab transaction.

    Transactions themselves are not persisted; we fetch them live from Schwab.
    Annotations are keyed by (user_id, schwab_transaction_id) so they survive
    re-fetches and let the user hide rows / mark disposition / add notes / link.
    """
    __tablename__ = "transaction_annotations"
    __table_args__ = (
        UniqueConstraint("user_id", "schwab_transaction_id", name="uq_user_tx"),
    )

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    user_id = Column(GUID, ForeignKey("users.id"), nullable=False, index=True)
    schwab_transaction_id = Column(String, nullable=False, index=True)

    hidden = Column(Boolean, default=False, nullable=False)
    # "closed" / "expired" / "assigned" / "rolled" — informational, no calc impact
    disposition = Column(String, nullable=True)
    note = Column(Text, nullable=True)
    # FK-like ref to transaction_link_groups.id (stored as string; not enforced at DB level
    # so groups can be deleted without cascading annotation cleanup)
    link_group_id = Column(String, nullable=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class TransactionLinkGroup(Base):
    """
    Named, commentable group that visually binds multiple transactions together.

    Creation happens the first time the user links 2+ transactions. The id is
    also used as the `link_group_id` on each annotation.
    """
    __tablename__ = "transaction_link_groups"

    id = Column(String, primary_key=True)  # short hex id, matches annotation.link_group_id
    user_id = Column(GUID, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=True)
    note = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
