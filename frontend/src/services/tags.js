/**
 * Tags (custom group) API service.
 */
import api from './api';

export const fetchTags = async () => {
  const response = await api.get('/tags');
  return response.data;
};

export const createTag = async ({ name, note = null, color = null, strategyClasses = null }) => {
  const response = await api.post('/tags', {
    name, note, color, strategy_classes: strategyClasses,
  });
  return response.data;
};

export const updateTag = async (tagId, patch) => {
  const response = await api.patch(`/tags/${encodeURIComponent(tagId)}`, patch);
  return response.data;
};

export const deleteTag = async (tagId) => {
  await api.delete(`/tags/${encodeURIComponent(tagId)}`);
};

export const addTagMember = async (tagId, { memberType, memberId }) => {
  const response = await api.post(`/tags/${encodeURIComponent(tagId)}/members`, {
    member_type: memberType,
    member_id: memberId,
  });
  return response.data;
};

export const removeTagMember = async (tagId, { memberType, memberId }) => {
  await api.delete(
    `/tags/${encodeURIComponent(tagId)}/members/${encodeURIComponent(memberType)}/${encodeURIComponent(memberId)}`
  );
};

/**
 * Fetch all positions tagged with a given strategy_class, with the
 * transactions and live prices needed to compute rollups.
 */
export const fetchStrategyPositions = async (strategyClass) => {
  const response = await api.get(`/tags/strategy/${encodeURIComponent(strategyClass)}`);
  return response.data;
};

// Holdings fetchers accept an optional accountHash. When set, the backend
// scopes positions, payments, and aggregates to that one account; null/
// undefined preserves the cross-account view.
const holdingsParams = (accountHash) =>
  accountHash ? { params: { account_hash: accountHash } } : undefined;

/**
 * Fetch live-first Long Stock holdings — one row per active Schwab stock
 * position tagged into a long_stock Group, with chain history attached.
 */
export const fetchLongStockHoldings = async (accountHash = null) => {
  const response = await api.get('/tags/strategy/long_stock/holdings', holdingsParams(accountHash));
  return response.data;
};

/**
 * Fetch live-first Covered Calls holdings — one row per short-call leg
 * paired with its underlying long stock holding.
 */
export const fetchCoveredCallsHoldings = async (accountHash = null) => {
  const response = await api.get('/tags/strategy/covered_calls/holdings', holdingsParams(accountHash));
  return response.data;
};

/**
 * Fetch group-driven Verticals holdings — one row per tagged
 * transaction_position whose open legs form a 2-leg balanced spread.
 */
export const fetchVerticalsHoldings = async (accountHash = null) => {
  const response = await api.get('/tags/strategy/verticals/holdings', holdingsParams(accountHash));
  return response.data;
};

/**
 * Fetch group-driven Single-Leg short-premium holdings — sold puts,
 * sold calls, short straddles, short strangles. Excludes long premium
 * and any chain with a long leg.
 */
export const fetchSingleLegHoldings = async (accountHash = null) => {
  const response = await api.get('/tags/strategy/single_leg/holdings', holdingsParams(accountHash));
  return response.data;
};

/**
 * Fetch group-driven Big Options long-premium holdings — long calls,
 * long puts, long straddles, long strangles. Lottery-style plays;
 * payload includes catalyst proximity, trim history, hit-rate stats.
 */
export const fetchBigOptionsHoldings = async (accountHash = null) => {
  const response = await api.get('/tags/strategy/big_options/holdings', holdingsParams(accountHash));
  return response.data;
};

/**
 * Fetch group-driven Box Spreads holdings — 4-leg balanced boxes acting
 * as synthetic loans. Includes FRED 3-mo T-bill benchmark and
 * account-exposure aggregates (face value settling 30d / 90d / all).
 */
export const fetchBoxSpreadsHoldings = async (accountHash = null) => {
  const response = await api.get('/tags/strategy/box_spreads/holdings', holdingsParams(accountHash));
  return response.data;
};

/**
 * Fetch Cash Mgmt holdings — deployed-cash vehicles (MMFs, treasury
 * ETFs, short-bond ETFs, account sweep) + box-spread short liabilities,
 * with net-carry aggregates and FRED 1-mo / 3-mo benchmarks.
 */
export const fetchCashMgmtHoldings = async (accountHash = null) => {
  const response = await api.get('/tags/strategy/cash_mgmt/holdings', holdingsParams(accountHash));
  return response.data;
};

/**
 * Fetch Dividends holdings — past-first income view. Each row is a tagged
 * underlying with TTM dividends received, count of payouts, and the user-
 * set qualified flag (or "unset" → panel shows "verify").
 */
export const fetchDividendsHoldings = async (accountHash = null) => {
  const response = await api.get('/tags/strategy/dividends/holdings', holdingsParams(accountHash));
  return response.data;
};

/**
 * Upsert the user's qualified-vs-non-qualified flag for one ticker.
 * Pass qualified=null with no note to clear the row.
 */
export const setDividendClassification = async (symbol, { qualified, note } = {}) => {
  const body = {};
  if (qualified !== undefined) body.qualified = qualified;
  if (note !== undefined) body.note = note;
  const response = await api.put(
    `/tags/strategy/dividends/classifications/${encodeURIComponent(symbol)}`,
    body,
  );
  return response.data;
};
