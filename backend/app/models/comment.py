"""Comment model"""
from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from app.core.database import Base, GUID


class Comment(Base):
    """Comment on a position"""
    __tablename__ = "comments"
    
    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    position_id = Column(GUID, ForeignKey("positions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(GUID, nullable=False, index=True)
    
    # Content
    text = Column(Text, nullable=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    position = relationship("Position", back_populates="comments")
    user = relationship("User", back_populates="comments")
    
    def __repr__(self):
        return f"<Comment by user={self.user_id} on position={self.position_id}>"

