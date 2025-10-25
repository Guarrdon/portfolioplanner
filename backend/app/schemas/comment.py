"""Comment schemas"""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class CommentBase(BaseModel):
    """Base comment schema"""
    text: str = Field(..., min_length=1, max_length=5000)


class CommentCreate(CommentBase):
    """Schema for creating a comment"""
    pass


class CommentUpdate(CommentBase):
    """Schema for updating a comment"""
    pass


class CommentResponse(CommentBase):
    """Schema for comment response"""
    id: UUID
    position_id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

