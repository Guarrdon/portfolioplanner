"""Transaction annotation + classified-position models"""
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean, UniqueConstraint
from datetime import datetime
import uuid

from app.core.database import Base, GUID


class TransactionAnnotation(Base):
    """
    User-editable metadata attached to a Schwab transaction.

    Transactions themselves are not persisted (we fetch them live or from the
    raw cache); annotations are keyed by (user_id, schwab_transaction_id) so
    they survive re-fetches and let the user hide rows / mark disposition /
    add notes / classify into a TransactionPosition.
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
    # FK-like ref to transaction_positions.id (stored as string; not enforced
    # at DB level so positions can be deleted without cascading annotations).
    transaction_position_id = Column(String, nullable=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class TransactionPosition(Base):
    """
    A classified chain of transactions that together represent one logical
    "position" — e.g. a sold vertical put, a rolled call, a stock holding,
    a box spread.

    Distinct from app.models.position.Position, which represents live
    position state synced from Schwab and user trade ideas. This model lives
    purely on the transactions side: every entry is materialized by either
    auto-classify or manual user classification.

    The `id` is a short hex string and matches transaction_annotations.transaction_position_id.
    """
    __tablename__ = "transaction_positions"

    id = Column(String, primary_key=True)
    user_id = Column(GUID, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=True)
    note = Column(Text, nullable=True)
    # stock | assigned_stock | sold_put | sold_call | bought_put | bought_call
    # | sold_vertical_put | sold_vertical_call | bought_vertical_put | bought_vertical_call
    # | rolled_options | box_spread | iron_condor | manual
    position_type = Column(String, nullable=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
