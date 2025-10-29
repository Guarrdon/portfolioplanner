/**
 * Collaboration API service
 * 
 * Handles all API calls related to trade idea collaboration,
 * including converting positions, sharing, and managing collaborative positions
 */
import api from './api';

/**
 * Convert an actual position to a trade idea for collaboration
 * @param {string} positionId - ID of the actual position to convert
 * @returns {Promise<Object>} Created trade idea
 */
export const convertActualToTradeIdea = async (positionId) => {
  const response = await api.post(`/positions/actual/${positionId}/convert-to-idea`);
  return response.data;
};

/**
 * Fetch all trade ideas for the current user
 * @param {Object} params - Query parameters
 * @param {string} params.status - Filter by status
 * @param {string} params.symbol - Filter by symbol
 * @param {string} params.strategy_type - Filter by strategy type
 * @returns {Promise<{total: number, positions: Array}>}
 */
export const fetchTradeIdeas = async (params = {}) => {
  const response = await api.get('/positions/ideas', { params });
  return response.data;
};

/**
 * Create a new trade idea
 * @param {Object} tradeIdea - Trade idea data
 * @returns {Promise<Object>} Created trade idea
 */
export const createTradeIdea = async (tradeIdea) => {
  const response = await api.post('/positions/ideas', tradeIdea);
  return response.data;
};

/**
 * Update a trade idea
 * @param {string} positionId - Position ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated trade idea
 */
export const updateTradeIdea = async (positionId, updates) => {
  const response = await api.put(`/positions/ideas/${positionId}`, updates);
  return response.data;
};

/**
 * Delete a trade idea
 * @param {string} positionId - Position ID to delete
 * @returns {Promise<void>}
 */
export const deleteTradeIdea = async (positionId) => {
  await api.delete(`/positions/ideas/${positionId}`);
};

/**
 * Share a trade idea with friends
 * @param {string} positionId - Position ID to share
 * @param {string[]} friendIds - Array of friend user IDs
 * @param {string} accessLevel - Access level (view, comment)
 * @returns {Promise<{success: boolean, message: string, share_count: number}>}
 */
export const shareTradeIdea = async (positionId, friendIds, accessLevel = 'comment') => {
  const response = await api.post(`/positions/ideas/${positionId}/share`, {
    friend_ids: friendIds,
    access_level: accessLevel
  });
  return response.data;
};

/**
 * Fetch positions shared with the current user
 * @returns {Promise<{total: number, positions: Array}>}
 */
export const fetchSharedPositions = async () => {
  const response = await api.get('/positions/shared');
  return response.data;
};

/**
 * Get a specific position by ID (any flavor)
 * @param {string} positionId - Position ID
 * @returns {Promise<Object>}
 */
export const getPosition = async (positionId) => {
  const response = await api.get(`/positions/${positionId}`);
  return response.data;
};

/**
 * Get comments for a position
 * @param {string} positionId - Position ID
 * @returns {Promise<Array>}
 */
export const getPositionComments = async (positionId) => {
  const response = await api.get(`/positions/${positionId}/comments`);
  return response.data;
};

/**
 * Add a comment to a position
 * @param {string} positionId - Position ID
 * @param {string} text - Comment text
 * @returns {Promise<Object>} Created comment
 */
export const addPositionComment = async (positionId, text) => {
  const response = await api.post(`/positions/${positionId}/comments`, { text });
  return response.data;
};

/**
 * Update a comment
 * @param {string} commentId - Comment ID
 * @param {string} text - Updated text
 * @returns {Promise<Object>} Updated comment
 */
export const updateComment = async (commentId, text) => {
  const response = await api.put(`/comments/${commentId}`, { text });
  return response.data;
};

/**
 * Delete a comment
 * @param {string} commentId - Comment ID to delete
 * @returns {Promise<void>}
 */
export const deleteComment = async (commentId) => {
  await api.delete(`/comments/${commentId}`);
};


