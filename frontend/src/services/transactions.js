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

export const fetchTransactionsByUnderlying = async (underlying, { accountId, days = 365 } = {}) => {
  const params = { days };
  if (accountId) params.account_id = accountId;
  const response = await api.get(`/transactions/by-underlying/${encodeURIComponent(underlying)}`, { params });
  return response.data;
};

export const updateTransactionAnnotation = async (schwabTransactionId, patch) => {
  const response = await api.patch(
    `/transactions/${encodeURIComponent(schwabTransactionId)}/annotation`,
    patch
  );
  return response.data;
};

export const linkTransactions = async (txIds, groupId = null) => {
  const response = await api.post('/transactions/link', {
    schwab_transaction_ids: txIds,
    group_id: groupId,
  });
  return response.data;
};

export const unlinkTransactions = async (txIds) => {
  const response = await api.post('/transactions/unlink', {
    schwab_transaction_ids: txIds,
  });
  return response.data;
};

export const updateLinkGroup = async (groupId, patch) => {
  const response = await api.patch(
    `/transactions/link-groups/${encodeURIComponent(groupId)}`,
    patch
  );
  return response.data;
};
