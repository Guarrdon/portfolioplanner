"""Position schemas"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal
from uuid import UUID


# Position Leg Schemas
class PositionLegBase(BaseModel):
    """Base schema for position leg"""
    symbol: Optional[str] = None
    asset_type: str = Field(..., description="stock or option")
    option_type: Optional[str] = Field(None, description="call or put")
    strike: Optional[Decimal] = None
    expiration: Optional[date] = None
    quantity: Decimal
    premium: Optional[Decimal] = None
    current_price: Optional[Decimal] = None
    target_premium: Optional[Decimal] = None


class PositionLegCreate(PositionLegBase):
    """Schema for creating a position leg"""
    pass


class PositionLegResponse(PositionLegBase):
    """Schema for position leg response"""
    id: UUID
    position_id: UUID
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# Position Schemas
class PositionBase(BaseModel):
    """Base schema for position"""
    symbol: str = Field(..., min_length=1, max_length=20)
    underlying: str = Field(..., min_length=1, max_length=20)
    strategy_type: str = Field(..., description="covered_call, put_spread, etc.")
    status: Optional[str] = Field(default="active")
    notes: Optional[str] = None
    tags: Optional[List[str]] = Field(default_factory=list)


class PositionCreate(PositionBase):
    """Schema for creating a trade idea position"""
    planned_entry_date: Optional[date] = None
    target_quantity: Optional[Decimal] = None
    target_entry_price: Optional[Decimal] = None
    max_profit: Optional[Decimal] = None
    max_loss: Optional[Decimal] = None
    legs: List[PositionLegCreate] = Field(default_factory=list)


class PositionUpdate(BaseModel):
    """Schema for updating a position"""
    status: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    planned_entry_date: Optional[date] = None
    target_quantity: Optional[Decimal] = None
    target_entry_price: Optional[Decimal] = None
    max_profit: Optional[Decimal] = None
    max_loss: Optional[Decimal] = None


class PositionResponse(PositionBase):
    """Schema for position response"""
    id: UUID
    flavor: str
    user_id: UUID
    original_position_id: Optional[UUID] = None
    account_id: Optional[str] = None
    account_number: Optional[str] = None
    
    # Actual position fields
    quantity: Optional[Decimal] = None
    cost_basis: Optional[Decimal] = None
    current_value: Optional[Decimal] = None
    unrealized_pnl: Optional[Decimal] = None
    entry_date: Optional[date] = None
    exit_date: Optional[date] = None
    
    # Trade idea fields
    planned_entry_date: Optional[date] = None
    target_quantity: Optional[Decimal] = None
    target_entry_price: Optional[Decimal] = None
    max_profit: Optional[Decimal] = None
    max_loss: Optional[Decimal] = None
    
    # Metadata
    last_synced: Optional[datetime] = None
    read_only: bool
    created_at: datetime
    updated_at: datetime
    
    # Related data
    legs: List[PositionLegResponse] = Field(default_factory=list)
    
    class Config:
        from_attributes = True


class PositionListResponse(BaseModel):
    """Schema for list of positions"""
    total: int
    positions: List[PositionResponse]


class PositionShareCreate(BaseModel):
    """Schema for sharing a position"""
    friend_ids: List[UUID] = Field(..., min_length=1)
    access_level: str = Field(default="view")


class SyncRequest(BaseModel):
    """Schema for Schwab sync request"""
    account_ids: Optional[List[str]] = Field(default=None, description="Optional list of account IDs to sync")


class SyncResponse(BaseModel):
    """Schema for sync response"""
    success: bool
    message: str
    synced_count: int
    positions: List[PositionResponse]

