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

/**
 * Fetch live-first Long Stock holdings — one row per active Schwab stock
 * position tagged into a long_stock Group, with chain history attached.
 */
export const fetchLongStockHoldings = async () => {
  const response = await api.get('/tags/strategy/long_stock/holdings');
  return response.data;
};

/**
 * Fetch live-first Covered Calls holdings — one row per short-call leg
 * paired with its underlying long stock holding.
 */
export const fetchCoveredCallsHoldings = async () => {
  const response = await api.get('/tags/strategy/covered_calls/holdings');
  return response.data;
};

/**
 * Fetch group-driven Verticals holdings — one row per tagged
 * transaction_position whose open legs form a 2-leg balanced spread.
 */
export const fetchVerticalsHoldings = async () => {
  const response = await api.get('/tags/strategy/verticals/holdings');
  return response.data;
};

/**
 * Fetch group-driven Single-Leg short-premium holdings — sold puts,
 * sold calls, short straddles, short strangles. Excludes long premium
 * and any chain with a long leg.
 */
export const fetchSingleLegHoldings = async () => {
  const response = await api.get('/tags/strategy/single_leg/holdings');
  return response.data;
};

/**
 * Fetch group-driven Big Options long-premium holdings — long calls,
 * long puts, long straddles, long strangles. Lottery-style plays;
 * payload includes catalyst proximity, trim history, hit-rate stats.
 */
export const fetchBigOptionsHoldings = async () => {
  const response = await api.get('/tags/strategy/big_options/holdings');
  return response.data;
};
