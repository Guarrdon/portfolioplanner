"""User model"""
from sqlalchemy import Column, String, Boolean, DateTime, Text
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from app.core.database import Base, GUID


class User(Base):
    """User account model"""
    __tablename__ = "users"
    
    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    
    # Profile
    full_name = Column(String(255))
    avatar_url = Column(String(500))
    
    # Status
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    last_login = Column(DateTime)
    
    # Relationships
    positions = relationship("Position", back_populates="user", foreign_keys="Position.user_id")
    schwab_credentials = relationship("UserSchwabCredentials", back_populates="user", uselist=False)
    schwab_accounts = relationship("UserSchwabAccount", back_populates="user")
    comments = relationship("Comment", back_populates="user")
    
    # Friendships (shares)
    shared_positions_received = relationship(
        "PositionShare", 
        back_populates="recipient",
        foreign_keys="PositionShare.recipient_id"
    )
    
    def __repr__(self):
        return f"<User {self.username}>"


class UserSchwabCredentials(Base):
    """Schwab API credentials for a user"""
    __tablename__ = "user_schwab_credentials"
    
    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    user_id = Column(GUID, nullable=False, unique=True, index=True)
    
    # Encrypted tokens
    access_token = Column(Text, nullable=False)  # Encrypted
    refresh_token = Column(Text, nullable=False)  # Encrypted
    
    # Token metadata
    token_created_at = Column(DateTime, nullable=False)
    token_expires_at = Column(DateTime, nullable=False)
    last_refreshed_at = Column(DateTime)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    user = relationship("User", back_populates="schwab_credentials")
    
    def __repr__(self):
        return f"<UserSchwabCredentials user_id={self.user_id}>"


class UserSchwabAccount(Base):
    """Schwab brokerage accounts linked to a user"""
    __tablename__ = "user_schwab_accounts"
    
    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    user_id = Column(GUID, nullable=False, index=True)
    
    # Account details
    account_hash = Column(String(255), nullable=False)
    account_number = Column(String(50))  # Masked for display
    account_type = Column(String(50))  # MARGIN, CASH, IRA, etc.
    
    # Sync configuration
    sync_enabled = Column(Boolean, default=True)
    last_synced = Column(DateTime)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    user = relationship("User", back_populates="schwab_accounts")
    
    def __repr__(self):
        return f"<UserSchwabAccount {self.account_number} ({self.account_type})>"


class Friendship(Base):
    """User friendship/connection for sharing positions"""
    __tablename__ = "friendships"
    
    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    user_id = Column(GUID, nullable=False, index=True)
    friend_id = Column(GUID, nullable=False, index=True)
    
    # Status
    status = Column(String(20), default="pending")  # pending, accepted, rejected, blocked
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    def __repr__(self):
        return f"<Friendship {self.user_id} -> {self.friend_id} ({self.status})>"

