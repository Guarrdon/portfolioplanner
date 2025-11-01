"""
Application configuration using Pydantic Settings
"""
from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""
    
    # Application
    APP_NAME: str = "Portfolio Planner"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    
    # Database
    DATABASE_URL: str
    
    # Security
    SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ENCRYPTION_KEY: str
    
    # CORS
    CORS_ORIGINS: str = "http://localhost:3000"
    
    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS origins from comma-separated string"""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]
    
    # Schwab API
    USE_MOCK_SCHWAB_DATA: bool = True
    SCHWAB_CALLBACK_URL: str = "http://localhost:8000/api/v1/schwab/callback"
    
    # Logging
    LOG_LEVEL: str = "INFO"
    
    # Collaboration (for distributed architecture)
    ENABLE_COLLABORATION: bool = False
    COLLABORATION_SERVICE_URL: str = "http://localhost:9000"
    BACKEND_USER_ID: str = "default-user"
    BACKEND_URL: str = "http://localhost:8000"
    BACKEND_DISPLAY_NAME: str = "Default User"
    
    class Config:
        env_file = ".env"
        case_sensitive = True


# Create global settings instance
settings = Settings()

