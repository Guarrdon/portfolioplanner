"""Transaction schemas (for live-fetched Schwab transactions + user annotations)"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class TransactionAnnotationUpdate(BaseModel):
    hidden: Optional[bool] = None
    disposition: Optional[str] = Field(
        default=None,
        description="'expired', 'assigned', or empty string to clear"
    )
    note: Optional[str] = None
    link_group_id: Optional[str] = None


class TransactionAnnotationResponse(BaseModel):
    schwab_transaction_id: str
    hidden: bool
    disposition: Optional[str] = None
    note: Optional[str] = None
    link_group_id: Optional[str] = None


class LinkTransactionsRequest(BaseModel):
    schwab_transaction_ids: List[str]
    group_id: Optional[str] = None  # None = create new group; pass existing id to add to it


class LinkTransactionsResponse(BaseModel):
    group_id: str
    count: int


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


class LinkGroupInfo(BaseModel):
    id: str
    name: Optional[str] = None
    note: Optional[str] = None
    created_at: Optional[str] = None


class LinkGroupUpdate(BaseModel):
    name: Optional[str] = None
    note: Optional[str] = None


class TransactionsByUnderlyingResponse(BaseModel):
    underlying: str
    days: int
    transactions: List[TransactionRecord]
    annotations: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    summary: TransactionsSummary
    link_groups: Dict[str, LinkGroupInfo] = Field(default_factory=dict)


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
    stock: OpenStockLeg
    options: List[OpenOptionLeg]
