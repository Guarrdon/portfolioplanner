"""Comment schemas"""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class CommentBase(BaseModel):
    """Base schema for comment"""
    text: str = Field(..., min_length=1, max_length=5000)


class CommentCreate(CommentBase):
    """Schema for creating a comment"""
    pass


class CommentUpdate(BaseModel):
    """Schema for updating a comment"""
    text: str = Field(..., min_length=1, max_length=5000)


class UserInfo(BaseModel):
    """Minimal user info for comment display"""
    id: UUID
    username: Optional[str] = None
    full_name: Optional[str] = None
    display_name: Optional[str] = None  # Computed field
    avatar_url: Optional[str] = None
    
    class Config:
        from_attributes = True


class CommentResponse(CommentBase):
    """Schema for comment response"""
    id: UUID
    position_id: UUID
    user_id: UUID
    user: Optional[UserInfo] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class CommentListResponse(BaseModel):
    """Schema for list of comments"""
    total: int
    comments: list[CommentResponse]
