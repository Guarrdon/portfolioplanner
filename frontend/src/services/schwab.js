/**
 * Schwab API service
 * 
 * Handles all API calls related to Schwab positions and account management
 */
import api from './api';

/**
 * Fetch actual positions from Schwab
 * @param {Object} params - Query parameters
 * @param {string} params.status - Filter by status
 * @param {string} params.account_id - Filter by account ID
 * @param {string} params.symbol - Filter by symbol
 * @returns {Promise<{total: number, positions: Array}>}
 */
export const fetchActualPositions = async (params = {}) => {
  const response = await api.get('/positions/actual', { params });
  return response.data;
};

/**
 * Sync positions from Schwab API
 * @param {string[]} accountIds - Optional array of account IDs to sync
 * @returns {Promise<{success: boolean, message: string, synced_count: number, positions: Array}>}
 */
export const syncSchwabPositions = async (accountIds = null) => {
  const response = await api.post('/positions/sync', {
    account_ids: accountIds
  });
  return response.data;
};

/**
 * Get list of Schwab accounts for current user
 * @returns {Promise<Array>}
 */
export const getSchwabAccounts = async () => {
  const response = await api.get('/schwab/accounts');
  return response.data;
};

/**
 * Update Schwab account settings
 * @param {string} accountId - Account ID
 * @param {Object} settings - Settings to update
 * @param {boolean} settings.sync_enabled - Enable/disable sync for this account
 * @returns {Promise<Object>}
 */
export const updateSchwabAccountSettings = async (accountId, settings) => {
  const response = await api.put(`/schwab/accounts/${accountId}`, settings);
  return response.data;
};

/**
 * Get a specific position by ID
 * @param {string} positionId - Position ID
 * @returns {Promise<Object>}
 */
export const getPosition = async (positionId) => {
  const response = await api.get(`/positions/${positionId}`);
  return response.data;
};

/**
 * Manually update a position's strategy type
 * @param {string} positionId - Position ID
 * @param {string} strategyType - New strategy type
 * @returns {Promise<Object>}
 */
export const updatePositionStrategy = async (positionId, strategyType) => {
  const response = await api.patch(
    `/positions/actual/${positionId}/strategy`,
    null,
    { params: { strategy_type: strategyType } }
  );
  return response.data;
};

