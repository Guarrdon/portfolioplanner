/**
 * Transactions API service
 */
import api from './api';

export const fetchOpenPositionsForUnderlying = async (underlying, { accountId } = {}) => {
  const params = {};
  if (accountId) params.account_id = accountId;
  const response = await api.get(`/transactions/open-positions/${encodeURIComponent(underlying)}`, { params });
  return response.data;
};

export const fetchAllOpenPositions = async ({ accountId } = {}) => {
  const params = {};
  if (accountId) params.account_id = accountId;
  const response = await api.get('/transactions/open-positions', { params });
  return response.data;  // { positions_by_underlying: { [und]: { stock, options } } }
};

export const fetchTransactionsByUnderlying = async (underlying, { accountId, days = 365, refresh = false } = {}) => {
  const params = { days };
  if (accountId) params.account_id = accountId;
  if (refresh) params.refresh = true;
  const response = await api.get(`/transactions/by-underlying/${encodeURIComponent(underlying)}`, { params });
  return response.data;
};

export const fetchTransactionsByAccount = async (accountHash, { days = 365, refresh = false } = {}) => {
  const params = { days };
  if (refresh) params.refresh = true;
  const response = await api.get(`/transactions/by-account/${encodeURIComponent(accountHash)}`, { params });
  return response.data;
};

export const fetchCacheProgress = async (accountHash) => {
  const response = await api.get(`/transactions/cache-progress/${encodeURIComponent(accountHash)}`);
  return response.data;
};

export const updateTransactionAnnotation = async (schwabTransactionId, patch) => {
  const response = await api.patch(
    `/transactions/${encodeURIComponent(schwabTransactionId)}/annotation`,
    patch
  );
  return response.data;
};

export const classifyTransactions = async (txIds, { positionId = null, positionType = null, name = null } = {}) => {
  const response = await api.post('/transactions/classify', {
    schwab_transaction_ids: txIds,
    transaction_position_id: positionId,
    position_type: positionType,
    name,
  });
  return response.data;
};

export const unclassifyTransactions = async (txIds) => {
  const response = await api.post('/transactions/unclassify', {
    schwab_transaction_ids: txIds,
  });
  return response.data;
};

export const updateTransactionPosition = async (positionId, patch) => {
  const response = await api.patch(
    `/transactions/positions/${encodeURIComponent(positionId)}`,
    patch
  );
  return response.data;
};
