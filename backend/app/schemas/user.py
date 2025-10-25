"""User schemas"""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class UserBase(BaseModel):
    """Base user schema"""
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=100)
    full_name: Optional[str] = None


class UserCreate(UserBase):
    """Schema for user registration"""
    password: str = Field(..., min_length=8, max_length=100)


class UserUpdate(BaseModel):
    """Schema for user update"""
    email: Optional[EmailStr] = None
    username: Optional[str] = Field(None, min_length=3, max_length=100)
    full_name: Optional[str] = None
    password: Optional[str] = Field(None, min_length=8, max_length=100)


class UserResponse(UserBase):
    """Schema for user response"""
    id: UUID
    is_active: bool
    is_superuser: bool
    created_at: datetime
    last_login: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class UserSchwabAccountResponse(BaseModel):
    """Schema for Schwab account response"""
    id: UUID
    account_hash: str
    account_number: Optional[str] = None
    account_type: Optional[str] = None
    sync_enabled: bool
    last_synced: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class UserSchwabAccountUpdate(BaseModel):
    """Schema for updating Schwab account settings"""
    sync_enabled: bool

