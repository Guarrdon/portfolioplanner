"""Tag (custom group) schemas."""
from pydantic import BaseModel, Field
from typing import Optional, List, Literal


MemberType = Literal["transaction", "transaction_position"]


class TagCreate(BaseModel):
    name: str
    note: Optional[str] = None
    color: Optional[str] = None  # if omitted, server picks a random palette color
    strategy_classes: Optional[List[str]] = None  # subset of the 11 keys


class TagUpdate(BaseModel):
    name: Optional[str] = None
    note: Optional[str] = None
    color: Optional[str] = None
    strategy_classes: Optional[List[str]] = None  # full replacement; pass [] to clear


class TagResponse(BaseModel):
    id: str
    name: str
    note: Optional[str] = None
    color: Optional[str] = None
    strategy_classes: List[str] = Field(default_factory=list)
    member_count: Optional[int] = 0
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


class StrategyTagInfo(BaseModel):
    id: str
    name: str
    color: Optional[str] = None
    note: Optional[str] = None
    strategy_classes: List[str] = Field(default_factory=list)


class StrategyPositionInfo(BaseModel):
    """A user-classified transaction_position rolled up for a strategy panel.

    Carries the constituent transactions verbatim — the frontend computes
    cost / credits / current value / net using the same FILO math used in
    the per-account transactions view, so rollup math has a single source.
    """
    id: str
    name: Optional[str] = None
    note: Optional[str] = None
    position_type: Optional[str] = None
    underlying: Optional[str] = None
    tag_ids: List[str] = Field(default_factory=list)
    tx_count: int = 0
    first_tx_date: Optional[str] = None
    last_tx_date: Optional[str] = None
    transactions: List[dict] = Field(default_factory=list)


class StrategyPositionsResponse(BaseModel):
    strategy_class: str
    tags: List[StrategyTagInfo] = Field(default_factory=list)
    positions: List[StrategyPositionInfo] = Field(default_factory=list)
    live_prices: dict = Field(default_factory=dict)


class StrategyChainInfo(BaseModel):
    """A user-classified transaction_position attached to a live holding,
    along with its constituent transactions for chain-level analysis."""
    id: str
    name: Optional[str] = None
    position_type: Optional[str] = None
    tag_ids: List[str] = Field(default_factory=list)
    chain_shares: float = 0.0  # signed; can be ≤ 0 if pre-window
    tx_count: int = 0
    first_tx_date: Optional[str] = None
    last_tx_date: Optional[str] = None
    transactions: List[dict] = Field(default_factory=list)


class StrategyReconciliation(BaseModel):
    state: str  # reconciled | pre_window | discrepancy
    summary: Optional[str] = None


class LongStockHolding(BaseModel):
    """Live-source-of-truth Long Stock holding — one row per active Schwab
    stock position (per account) tagged into a long_stock Group."""
    underlying: str
    account_hash: Optional[str] = None
    account_number: Optional[str] = None
    account_type: Optional[str] = None
    shares: float
    avg_cost: float = 0.0
    cost_basis: float = 0.0
    current_price: float = 0.0
    market_value: float = 0.0
    unrealized_pnl: float = 0.0
    current_day_pnl: Optional[float] = None
    current_day_pnl_percentage: Optional[float] = None
    tag_ids: List[str] = Field(default_factory=list)
    chains: List[StrategyChainInfo] = Field(default_factory=list)
    reconciliation: StrategyReconciliation
    realized_pnl: Optional[float] = None
    earliest_chain_tx_date: Optional[str] = None


class LongStockHoldingsResponse(BaseModel):
    strategy_class: str = "long_stock"
    tags: List[StrategyTagInfo] = Field(default_factory=list)
    holdings: List[LongStockHolding] = Field(default_factory=list)
    portfolio_liquidation_value: float = 0.0
