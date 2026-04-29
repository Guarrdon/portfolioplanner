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
    last_synced: Optional[str] = None


class CoveredCallHolding(BaseModel):
    """One short-call leg paired with its underlying long stock holding.
    Multiple laddered calls produce multiple rows sharing stock context."""
    underlying: str
    account_hash: Optional[str] = None
    account_number: Optional[str] = None
    account_type: Optional[str] = None

    stock_shares: float
    stock_avg_cost: float = 0.0
    stock_current_price: float = 0.0
    stock_market_value: float = 0.0
    stock_cost_basis: float = 0.0
    stock_unrealized_pnl: float = 0.0
    stock_current_day_pnl: Optional[float] = None

    call_symbol: Optional[str] = None
    call_strike: Optional[float] = None
    call_expiration: Optional[str] = None
    call_dte: Optional[int] = None
    call_quantity: float = 0.0
    call_open_price: float = 0.0
    call_current_price: float = 0.0
    premium_received: float = 0.0
    close_cost: float = 0.0
    call_unrealized_pnl: float = 0.0
    capture_pct: Optional[float] = None
    otm_pct: Optional[float] = None
    mode: Optional[str] = None  # Income | Accumulation | Protection | ATM | ?
    call_delta: Optional[float] = None
    call_current_day_pnl: Optional[float] = None

    coverage_ratio: Optional[float] = None
    row_total_pnl: Optional[float] = None

    tag_ids: List[str] = Field(default_factory=list)
    reconciliation: StrategyReconciliation


class CoveredCallsHoldingsResponse(BaseModel):
    strategy_class: str = "covered_calls"
    tags: List[StrategyTagInfo] = Field(default_factory=list)
    holdings: List[CoveredCallHolding] = Field(default_factory=list)
    portfolio_liquidation_value: float = 0.0
    last_synced: Optional[str] = None


class VerticalHolding(BaseModel):
    """One vertical-spread row: two same-type, same-expiration option legs
    (one short, one long) attached to a tagged transaction_position chain."""
    underlying: str
    account_hash: Optional[str] = None
    account_number: Optional[str] = None
    type: str  # Credit Put | Credit Call | Debit Put | Debit Call
    is_credit: bool
    option_type: str  # put | call
    strikes_label: str
    short_strike: float
    long_strike: float
    expiration: Optional[str] = None
    dte: Optional[int] = None
    contracts: float
    net_at_open: float
    current_value: float
    unrealized_pnl: float
    capture_pct: Optional[float] = None
    max_profit: float
    max_loss: float
    width: float
    short_otm_pct: Optional[float] = None
    short_delta: Optional[float] = None
    risk_label: str
    risk_pop_pct: Optional[float] = None
    action: str
    spot: float = 0.0
    day_pnl: Optional[float] = None
    dollars_per_day: Optional[float] = None
    row_total_pnl: float
    tag_ids: List[str] = Field(default_factory=list)
    reconciliation: StrategyReconciliation
    chain_id: str
    chain_name: Optional[str] = None


class VerticalsHoldingsResponse(BaseModel):
    strategy_class: str = "verticals"
    tags: List[StrategyTagInfo] = Field(default_factory=list)
    holdings: List[VerticalHolding] = Field(default_factory=list)
    portfolio_liquidation_value: float = 0.0
    last_synced: Optional[str] = None
    excluded_complex_count: int = 0


class SingleLegLegView(BaseModel):
    """Per-leg snapshot inside a single-leg row — the panel uses this to
    render two-leg straddle/strangle rows expanded."""
    symbol: str
    option_type: str  # put | call
    strike: float
    otm_pct: Optional[float] = None
    delta: Optional[float] = None
    iv: Optional[float] = None
    theta: Optional[float] = None
    current_price: float = 0.0


class SingleLegHolding(BaseModel):
    """One short-premium row: a short put, short call, short straddle, or
    short strangle. Two-leg rows (straddle/strangle) carry both strikes."""
    underlying: str
    account_hash: Optional[str] = None
    account_number: Optional[str] = None
    type: str  # Short Put | Short Call | Short Straddle | Short Strangle
    row_type: str  # short_put | short_call | short_straddle | short_strangle
    strikes_label: str
    short_strikes: List[float] = Field(default_factory=list)
    expiration: Optional[str] = None
    dte: Optional[int] = None
    contracts: float

    premium_received: float
    close_cost: float
    intrinsic_remaining: float
    extrinsic_remaining: float
    extrinsic_pct_of_premium: Optional[float] = None
    capture_pct: Optional[float] = None
    unrealized_pnl: float
    row_total_pnl: float

    max_loss: Optional[float] = None  # None = undefined / unbounded
    capital_at_risk: Optional[float] = None
    annualized_return_pct: Optional[float] = None

    breakeven_lower: Optional[float] = None
    breakeven_upper: Optional[float] = None
    distance_from_be_pct: Optional[float] = None

    spot: float = 0.0
    worst_otm_pct: Optional[float] = None
    worst_delta: Optional[float] = None
    any_leg_itm: bool = False

    dollars_per_day: Optional[float] = None
    day_pnl: Optional[float] = None

    legs: List[SingleLegLegView] = Field(default_factory=list)

    risk_label: str
    risk_pop_pct: Optional[float] = None
    action: str  # Hold | Take it | Review | Assignment risk

    tag_ids: List[str] = Field(default_factory=list)
    reconciliation: StrategyReconciliation
    chain_id: str
    chain_name: Optional[str] = None


class SingleLegHoldingsResponse(BaseModel):
    strategy_class: str = "single_leg"
    tags: List[StrategyTagInfo] = Field(default_factory=list)
    holdings: List[SingleLegHolding] = Field(default_factory=list)
    portfolio_liquidation_value: float = 0.0
    last_synced: Optional[str] = None
    excluded_complex_count: int = 0


class BigOptionsLegView(BaseModel):
    """Per-leg snapshot inside a Big Options row."""
    symbol: str
    option_type: str  # call | put
    strike: float
    expiration: Optional[str] = None
    dte: Optional[int] = None
    contracts: float
    original_contracts: float
    cost_paid: float
    current_price: float = 0.0
    current_value: float = 0.0
    atm_dist_pct: Optional[float] = None
    otm_pct: Optional[float] = None
    is_itm: bool = False
    delta: Optional[float] = None
    iv: Optional[float] = None
    theta: Optional[float] = None


class BigOptionsCatalyst(BaseModel):
    """Earnings or user-defined catalyst falling in the row's window."""
    date: str
    label: str
    source: str  # earnings | manual


class BigOptionsHolding(BaseModel):
    """One Big Options row: long-premium chain (call/put/straddle/strangle/multi)."""
    underlying: str
    account_hash: Optional[str] = None
    account_number: Optional[str] = None
    type: str  # Long Call | Long Put | Long Straddle | Long Strangle | Long Multi
    row_type: str
    strikes_label: str
    expiration: Optional[str] = None
    min_dte: Optional[int] = None
    contracts: float
    original_contracts: float
    trimmed_pct: Optional[float] = None
    spot: float = 0.0

    cost_paid: float
    current_value: float
    partials_realized: float = 0.0
    unrealized_pnl: float
    row_total_pnl: float
    multiple: Optional[float] = None

    intrinsic_remaining: float = 0.0
    time_premium_left: float = 0.0
    theta_per_day: Optional[float] = None
    theta_next_7d: Optional[float] = None
    days_held: Optional[int] = None
    min_atm_dist_pct: Optional[float] = None
    worst_leg_otm_pct: Optional[float] = None
    distance_to_itm_pct: Optional[float] = None
    any_leg_itm: bool = False

    pct_port: Optional[float] = None
    oversized: Optional[str] = None  # None | 'soft' | 'hard'

    status: str  # Sweet spot | Patient | Decay zone | Theta cliff | ?
    catalyst: Optional[BigOptionsCatalyst] = None

    legs: List[BigOptionsLegView] = Field(default_factory=list)
    tag_ids: List[str] = Field(default_factory=list)
    reconciliation: StrategyReconciliation
    chain_id: str
    chain_name: Optional[str] = None


class BigOptionsClosedStats(BaseModel):
    """Aggregate stats over closed (fully-exited) Big Options chains."""
    closed_count: int = 0
    winners: int = 0
    losers: int = 0
    hit_rate_pct: Optional[float] = None
    avg_win: Optional[float] = None
    avg_loss: Optional[float] = None
    total_realized: float = 0.0


class BigOptionsConcentrationThresholds(BaseModel):
    target_usd: float = 2000.0
    soft_cap_usd: float = 5000.0
    soft_cap_port_pct: float = 1.0


class BigOptionsHoldingsResponse(BaseModel):
    strategy_class: str = "big_options"
    tags: List[StrategyTagInfo] = Field(default_factory=list)
    holdings: List[BigOptionsHolding] = Field(default_factory=list)
    portfolio_liquidation_value: float = 0.0
    last_synced: Optional[str] = None
    excluded_complex_count: int = 0
    stats: BigOptionsClosedStats = Field(default_factory=BigOptionsClosedStats)
    concentration_thresholds: BigOptionsConcentrationThresholds = Field(
        default_factory=BigOptionsConcentrationThresholds
    )


class BoxSpreadHolding(BaseModel):
    """One box-spread row: a 4-leg balanced box at one expiration."""
    underlying: str
    account_hash: Optional[str] = None
    account_number: Optional[str] = None
    type: str  # Long Box | Short Box
    row_type: str  # long_box | short_box
    direction: str  # long | short
    strikes_label: str
    low_strike: float
    high_strike: float
    expiration: Optional[str] = None
    dte: Optional[int] = None
    days_held: Optional[int] = None
    total_term_days: Optional[int] = None
    contracts: float

    face_value: float
    net_at_open: float
    open_principal: float
    current_value: float
    unrealized_pnl: float
    row_total_pnl: float

    implied_rate_pct: Optional[float] = None
    delta_vs_benchmark_pct: Optional[float] = None
    daily_carry: Optional[float] = None
    margin: float = 0.0
    pct_port: Optional[float] = None

    status: str  # Settling soon | Patient | ?
    below_benchmark: bool = False

    tag_ids: List[str] = Field(default_factory=list)
    reconciliation: StrategyReconciliation
    chain_id: str
    chain_name: Optional[str] = None


class BoxSpreadsBenchmark(BaseModel):
    series_id: str
    rate_pct: Optional[float] = None
    rate_date: Optional[str] = None
    fetched_at: Optional[str] = None


class BoxSpreadsExpirationConcentration(BaseModel):
    expiration: str
    face_value: float


class BoxSpreadsExposure(BaseModel):
    long_face_total: float = 0.0
    short_face_total: float = 0.0
    long_cash_at_open: float = 0.0
    short_cash_at_open: float = 0.0
    net_face: float = 0.0
    short_face_30d: float = 0.0
    short_face_90d: float = 0.0
    short_face_pct_port: Optional[float] = None
    margin_total: float = 0.0
    short_concentration: List[BoxSpreadsExpirationConcentration] = Field(default_factory=list)


class BoxSpreadsHoldingsResponse(BaseModel):
    strategy_class: str = "box_spreads"
    tags: List[StrategyTagInfo] = Field(default_factory=list)
    holdings: List[BoxSpreadHolding] = Field(default_factory=list)
    portfolio_liquidation_value: float = 0.0
    last_synced: Optional[str] = None
    excluded_complex_count: int = 0
    benchmark: Optional[BoxSpreadsBenchmark] = None
    exposure: BoxSpreadsExposure = Field(default_factory=BoxSpreadsExposure)


# ---- Cash Mgmt -----------------------------------------------------------

class CashMgmtHolding(BaseModel):
    """One deployed-cash row: an MMF / treasury-ETF / short-bond-ETF
    position tagged into cash_mgmt, or a synthetic 'sweep' row for
    uninvested account cash."""
    symbol: str
    name: Optional[str] = None
    vehicle_type: str  # mmf | floating_rate_etf | treasury_etf | short_bond_etf | sweep | other
    liquidity_tier: str  # T+0 | T+1 | hold
    account_hash: Optional[str] = None
    account_number: Optional[str] = None
    quantity: Optional[float] = None
    current_price: Optional[float] = None
    market_value: float
    cost_basis: float = 0.0
    unrealized_pnl: float = 0.0
    est_yield_pct: Optional[float] = None
    yield_source: str  # fred_derived | static | unknown
    annual_income: Optional[float] = None
    tag_ids: List[str] = Field(default_factory=list)
    is_synthetic: bool = False
    pct_cash: Optional[float] = None
    pct_port: Optional[float] = None


class CashMgmtLiability(BaseModel):
    """A short box-spread liability — borrow side of the carry trade."""
    underlying: Optional[str] = None
    expiration: Optional[str] = None
    dte: Optional[int] = None
    face_value: float
    implied_rate_pct: Optional[float] = None
    tag_ids: List[str] = Field(default_factory=list)
    chain_id: Optional[str] = None
    chain_name: Optional[str] = None


class CashMgmtLadderBucket(BaseModel):
    """One month's-worth of cash-flow events: cash freeing up vs box debt
    settling. Cash side is mostly empty for liquid vehicles; debt side
    drives the wall-of-maturities view."""
    month: str
    cash_freeing: float = 0.0
    debt_settling: float = 0.0


class CashMgmtBenchmarks(BaseModel):
    rate_1mo: Optional[BoxSpreadsBenchmark] = None
    rate_3mo: Optional[BoxSpreadsBenchmark] = None


class CashMgmtAggregates(BaseModel):
    total_cash: float = 0.0
    weighted_cash_yield_pct: Optional[float] = None
    annual_cash_income: float = 0.0
    total_borrowed_face: float = 0.0
    weighted_borrow_rate_pct: Optional[float] = None
    annual_borrow_cost: float = 0.0
    net_carry_dollars: float = 0.0
    net_carry_bps: Optional[float] = None
    borrowed_30d: float = 0.0
    borrowed_90d: float = 0.0
    cash_pct_port: Optional[float] = None
    borrowed_pct_port: Optional[float] = None
    max_concentration_pct: Optional[float] = None
    max_concentration_symbol: Optional[str] = None


class CashMgmtHoldingsResponse(BaseModel):
    strategy_class: str = "cash_mgmt"
    tags: List[StrategyTagInfo] = Field(default_factory=list)
    holdings: List[CashMgmtHolding] = Field(default_factory=list)
    liabilities: List[CashMgmtLiability] = Field(default_factory=list)
    ladder: List[CashMgmtLadderBucket] = Field(default_factory=list)
    portfolio_liquidation_value: float = 0.0
    last_synced: Optional[str] = None
    benchmarks: CashMgmtBenchmarks = Field(default_factory=CashMgmtBenchmarks)
    aggregates: CashMgmtAggregates = Field(default_factory=CashMgmtAggregates)


# ---------- Dividends ----------

class DividendPayment(BaseModel):
    symbol: str
    account_hash: Optional[str] = None
    date: Optional[str] = None
    amount: float = 0.0
    description: Optional[str] = None
    qualified_dividend: Optional[bool] = None
    schwab_transaction_id: Optional[str] = None


class DividendHolding(BaseModel):
    """One row per tagged underlying. TTM income comes from cached Schwab
    DIVIDEND_OR_INTEREST transactions. `qualified` is user-set:
      True  → qualified
      False → non-qualified
      None  → unset (panel surfaces "verify")
    """
    underlying: str
    shares: float = 0.0
    avg_cost: float = 0.0
    cost_basis: float = 0.0
    current_price: float = 0.0
    market_value: float = 0.0
    unrealized_pnl: float = 0.0
    all_time_income: float = 0.0
    net_return: float = 0.0
    net_return_pct: Optional[float] = None
    account_numbers: List[str] = Field(default_factory=list)
    tag_ids: List[str] = Field(default_factory=list)
    qualified: Optional[bool] = None
    qualified_source: str = "unknown"  # 'user' | 'schwab' | 'unknown'
    ttm_income: float = 0.0
    ttm_qualified_income: float = 0.0
    ttm_non_qualified_income: float = 0.0
    ttm_unknown_income: float = 0.0
    ttm_payment_count: int = 0
    ttm_yield_pct: Optional[float] = None
    avg_per_payout: Optional[float] = None
    last_paid: Optional[str] = None
    first_paid: Optional[str] = None
    all_payment_count: int = 0
    pct_port_mv: Optional[float] = None
    pct_port_cost: Optional[float] = None
    recent_payments: List[DividendPayment] = Field(default_factory=list)


class DividendsAggregates(BaseModel):
    ttm_income_total: float = 0.0
    ttm_income_qualified: float = 0.0
    ttm_income_non_qualified: float = 0.0
    ttm_income_unclassified: float = 0.0
    weighted_ttm_yield_pct: Optional[float] = None
    holdings_count: int = 0
    last_paid: Optional[str] = None
    total_market_value: float = 0.0
    total_cost_basis: float = 0.0
    total_unrealized_pnl: float = 0.0
    total_all_time_income: float = 0.0
    total_net_return: float = 0.0
    total_net_return_pct: Optional[float] = None
    pct_port_mv: Optional[float] = None


class DividendsHoldingsResponse(BaseModel):
    strategy_class: str = "dividends"
    tags: List[StrategyTagInfo] = Field(default_factory=list)
    holdings: List[DividendHolding] = Field(default_factory=list)
    portfolio_liquidation_value: float = 0.0
    last_synced: Optional[str] = None
    aggregates: DividendsAggregates = Field(default_factory=DividendsAggregates)


class DividendClassificationUpdate(BaseModel):
    """PUT body for /tags/strategy/dividends/classifications/{symbol}.
    qualified=null clears the classification (returns the row to "verify").
    """
    qualified: Optional[bool] = None
    note: Optional[str] = None


class DividendClassificationResponse(BaseModel):
    symbol: str
    qualified: Optional[bool] = None
    note: Optional[str] = None
    updated_at: Optional[str] = None
