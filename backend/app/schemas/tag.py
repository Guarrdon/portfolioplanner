"""Tag (custom group) schemas."""
from pydantic import BaseModel, Field
from typing import Optional, List, Literal


MemberType = Literal["transaction", "transaction_position"]


class TagCreate(BaseModel):
    name: str
    note: Optional[str] = None
    color: Optional[str] = None  # if omitted, server picks a random palette color


class TagUpdate(BaseModel):
    name: Optional[str] = None
    note: Optional[str] = None
    color: Optional[str] = None


class TagResponse(BaseModel):
    id: str
    name: str
    note: Optional[str] = None
    color: Optional[str] = None
    created_at: Optional[str] = None


class TagMembershipRequest(BaseModel):
    member_type: MemberType
    member_id: str


class TagMembershipBatchRequest(BaseModel):
    members: List[TagMembershipRequest] = Field(default_factory=list)


class TagMembershipResponse(BaseModel):
    tag_id: str
    member_type: str
    member_id: str
