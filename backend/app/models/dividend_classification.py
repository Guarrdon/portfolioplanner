"""Dividend classification model — per-(user, symbol) qualified/non-qualified flag.

The user curates which holdings count as their "dividends strategy" via Tag
membership; this table layers a tax classification on top so the panel can
total qualified-vs-non-qualified income. We intentionally don't try to
auto-detect qualified status (REIT/MLP/foreign markers are unreliable) —
the user toggles per holding and the 1099-DIV is still authoritative.
"""
from sqlalchemy import Column, String, DateTime, Boolean, Text, ForeignKey, UniqueConstraint
from datetime import datetime
import uuid

from app.core.database import Base, GUID


class DividendClassification(Base):
    __tablename__ = "dividend_classifications"
    __table_args__ = (
        UniqueConstraint("user_id", "symbol", name="uq_user_symbol_dividend_class"),
    )

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    user_id = Column(GUID, ForeignKey("users.id"), nullable=False, index=True)
    symbol = Column(String, nullable=False, index=True)

    # Three-state via boolean + nullability:
    #   True   → qualified
    #   False  → non-qualified
    #   absent → unset (panel shows "verify")
    qualified = Column(Boolean, nullable=False)
    note = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
