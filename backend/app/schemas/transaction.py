"""Transaction schemas (live-fetched Schwab transactions, annotations,
classified positions, and tag memberships)."""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class TransactionAnnotationUpdate(BaseModel):
    hidden: Optional[bool] = None
    disposition: Optional[str] = Field(
        default=None,
        description="'expired', 'assigned', or empty string to clear"
    )
    note: Optional[str] = None
    transaction_position_id: Optional[str] = None


class TransactionAnnotationResponse(BaseModel):
    schwab_transaction_id: str
    hidden: bool
    disposition: Optional[str] = None
    note: Optional[str] = None
    transaction_position_id: Optional[str] = None


class ClassifyTransactionsRequest(BaseModel):
    schwab_transaction_ids: List[str]
    transaction_position_id: Optional[str] = None  # None = create new; existing id appends
    position_type: Optional[str] = None
    name: Optional[str] = None


class ClassifyTransactionsResponse(BaseModel):
    transaction_position_id: str
    count: int


class UnclassifyTransactionsRequest(BaseModel):
    schwab_transaction_ids: List[str]


class TransactionLeg(BaseModel):
    symbol: Optional[str] = None
    underlying: Optional[str] = None
    asset_type: Optional[str] = None
    option_type: Optional[str] = None
    strike: Optional[float] = None
    expiration: Optional[str] = None
    amount: Optional[float] = None
    price: Optional[float] = None
    cost: Optional[float] = None
    position_effect: Optional[str] = None
    fee_type: Optional[str] = None


class TransactionRecord(BaseModel):
    schwab_transaction_id: str
    date: Optional[str] = None
    type: Optional[str] = None
    sub_type: Optional[str] = None
    description: Optional[str] = None
    net_amount: Optional[float] = None
    category: Optional[str] = None
    account_number: Optional[str] = None
    account_hash: Optional[str] = None
    legs: List[TransactionLeg] = Field(default_factory=list)


class TransactionsSummary(BaseModel):
    visible_count: int
    hidden_count: int
    stock_net_cash: float
    options_net_cash: float
    total_net_cash: float


class TransactionPositionInfo(BaseModel):
    id: str
    name: Optional[str] = None
    note: Optional[str] = None
    position_type: Optional[str] = None
    created_at: Optional[str] = None


class TransactionPositionUpdate(BaseModel):
    name: Optional[str] = None
    note: Optional[str] = None
    position_type: Optional[str] = None


class TagMembershipInfo(BaseModel):
    tag_id: str
    member_type: str  # "transaction" | "transaction_position"
    member_id: str


class TagInfo(BaseModel):
    id: str
    name: str
    note: Optional[str] = None
    color: Optional[str] = None
    created_at: Optional[str] = None


class TransactionsByUnderlyingResponse(BaseModel):
    underlying: str
    days: int
    transactions: List[TransactionRecord]
    annotations: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    summary: TransactionsSummary
    positions: Dict[str, TransactionPositionInfo] = Field(default_factory=dict)
    tags: Dict[str, TagInfo] = Field(default_factory=dict)
    tag_memberships: List[TagMembershipInfo] = Field(default_factory=list)


class TransactionsByAccountResponse(BaseModel):
    account_hash: str
    account_number: Optional[str] = None
    days: int
    transactions: List[TransactionRecord]
    annotations: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    summary: TransactionsSummary
    positions: Dict[str, TransactionPositionInfo] = Field(default_factory=dict)
    tags: Dict[str, TagInfo] = Field(default_factory=dict)
    tag_memberships: List[TagMembershipInfo] = Field(default_factory=list)


class OpenStockLeg(BaseModel):
    quantity: float
    average_cost: float
    cost_basis: float
    current_value: float
    unrealized_pnl: float


class OpenOptionLeg(BaseModel):
    symbol: Optional[str] = None
    underlying: Optional[str] = None
    option_type: Optional[str] = None
    strike: Optional[float] = None
    expiration: Optional[str] = None
    quantity: float
    open_price: float
    current_price: float
    unrealized_pnl: float
    account_number: Optional[str] = None


class OpenPositionsResponse(BaseModel):
    underlying: str
    underlying_price: Optional[float] = None
    underlying_quote_at: Optional[str] = None
    stock: OpenStockLeg
    options: List[OpenOptionLeg]
