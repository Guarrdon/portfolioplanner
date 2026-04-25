"""Position flag schemas"""
from pydantic import BaseModel
from typing import Optional, Dict


class PositionFlagUpdate(BaseModel):
    flagged: Optional[bool] = None
    note: Optional[str] = None


class PositionFlagResponse(BaseModel):
    position_signature: str
    flagged: bool
    note: Optional[str] = None


class PositionFlagsListResponse(BaseModel):
    flags: Dict[str, PositionFlagResponse]
