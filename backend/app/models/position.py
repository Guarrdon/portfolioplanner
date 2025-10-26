"""Position models"""
from sqlalchemy import Column, String, Boolean, DateTime, Numeric, Date, ForeignKey, Text, ARRAY
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from app.core.database import Base, GUID


class Position(Base):
    """Main position model supporting actual, idea, and shared positions"""
    __tablename__ = "positions"
    
    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    
    # Position type
    flavor = Column(String(20), nullable=False, index=True)  # actual, idea, shared
    
    # Ownership
    user_id = Column(GUID, nullable=False, index=True)
    original_position_id = Column(GUID, ForeignKey("positions.id"), nullable=True)
    
    # Account info
    account_id = Column(String(255))  # Schwab account hash or user account ID
    account_number = Column(String(50))  # Masked for display
    
    # Position details
    symbol = Column(String(20), nullable=False, index=True)
    underlying = Column(String(20), nullable=False, index=True)
    strategy_type = Column(String(50), nullable=False)  # covered_call, put_spread, etc.
    status = Column(String(20), default="active", index=True)  # active, closed, planned, etc.
    
    # Quantities and values (for actual positions)
    quantity = Column(Numeric(18, 4))
    cost_basis = Column(Numeric(18, 2))
    current_value = Column(Numeric(18, 2))
    unrealized_pnl = Column(Numeric(18, 2))
    
    # Planning fields (for trade ideas)
    planned_entry_date = Column(Date)
    target_quantity = Column(Numeric(18, 4))
    target_entry_price = Column(Numeric(18, 2))
    max_profit = Column(Numeric(18, 2))
    max_loss = Column(Numeric(18, 2))
    
    # Metadata
    notes = Column(Text)
    tags = Column(ARRAY(String))  # PostgreSQL array of strings
    
    # Dates
    entry_date = Column(Date)
    exit_date = Column(Date)
    
    # Sync info
    last_synced = Column(DateTime)
    
    # Permissions
    read_only = Column(Boolean, default=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    user = relationship("User", back_populates="positions", foreign_keys=[user_id])
    legs = relationship("PositionLeg", back_populates="position", cascade="all, delete-orphan")
    comments = relationship("Comment", back_populates="position", cascade="all, delete-orphan")
    shares = relationship("PositionShare", back_populates="position", cascade="all, delete-orphan")
    
    # For shared positions
    original_position = relationship("Position", remote_side=[id])
    
    def __repr__(self):
        return f"<Position {self.flavor} {self.symbol} {self.strategy_type}>"


class PositionLeg(Base):
    """Individual leg of a position (stock or option)"""
    __tablename__ = "position_legs"
    
    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    position_id = Column(GUID, ForeignKey("positions.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Leg details
    symbol = Column(String(50))  # OCC symbol for options
    asset_type = Column(String(20), nullable=False)  # stock, option
    
    # For options
    option_type = Column(String(10))  # call, put
    strike = Column(Numeric(18, 2))
    expiration = Column(Date)
    
    # Quantities and prices
    quantity = Column(Numeric(18, 4), nullable=False)
    premium = Column(Numeric(18, 2))
    current_price = Column(Numeric(18, 2))
    
    # For trade ideas
    target_premium = Column(Numeric(18, 2))
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    position = relationship("Position", back_populates="legs")
    
    def __repr__(self):
        return f"<PositionLeg {self.asset_type} {self.symbol}>"


class PositionShare(Base):
    """Sharing relationship for positions"""
    __tablename__ = "position_shares"
    
    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    position_id = Column(GUID, ForeignKey("positions.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_id = Column(GUID, nullable=False, index=True)
    recipient_id = Column(GUID, nullable=False, index=True)
    
    # Access control
    access_level = Column(String(20), default="view")  # view, comment
    
    # Status
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    shared_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relationships
    position = relationship("Position", back_populates="shares")
    recipient = relationship("User", back_populates="shared_positions_received", foreign_keys=[recipient_id])
    
    def __repr__(self):
        return f"<PositionShare position={self.position_id} to={self.recipient_id}>"

