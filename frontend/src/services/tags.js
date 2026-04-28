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
