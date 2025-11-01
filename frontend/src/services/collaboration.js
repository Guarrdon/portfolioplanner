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
  // Get current user ID from localStorage (correct key)
  const currentUserId = localStorage.getItem('portfolio_planner_current_user');
  
  const response = await api.get('/positions/ideas', { 
    params: {
      ...params,
      user_id: currentUserId
    }
  });
  return response.data;
};

/**
 * Create a new trade idea
 * @param {Object} tradeIdea - Trade idea data
 * @returns {Promise<Object>} Created trade idea
 */
export const createTradeIdea = async (tradeIdea) => {
  // Pass current user ID for authorization
  const currentUserId = localStorage.getItem('portfolio_planner_current_user');
  const response = await api.post('/positions/ideas', tradeIdea, {
    params: {
      user_id: currentUserId
    }
  });
  return response.data;
};

/**
 * Update a trade idea
 * @param {string} positionId - Position ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated trade idea
 */
export const updateTradeIdea = async (positionId, updates) => {
  // Pass current user ID for authorization
  const currentUserId = localStorage.getItem('portfolio_planner_current_user');
  const response = await api.put(`/positions/ideas/${positionId}`, updates, {
    params: {
      user_id: currentUserId
    }
  });
  return response.data;
};

/**
 * Update tags on a trade idea (allowed for both owners and recipients)
 * @param {string} positionId - Position ID
 * @param {string[]} tags - Array of tag strings
 * @returns {Promise<Object>} Updated trade idea
 */
export const updateTradeIdeaTags = async (positionId, tags) => {
  // Pass current user ID for authorization
  const currentUserId = localStorage.getItem('portfolio_planner_current_user');
  const response = await api.patch(`/positions/ideas/${positionId}/tags`, tags, {
    params: {
      user_id: currentUserId
    }
  });
  return response.data;
};

/**
 * Delete a trade idea (only owner can delete)
 * @param {string} positionId - Position ID to delete
 * @returns {Promise<void>}
 */
export const deleteTradeIdea = async (positionId) => {
  // Pass current user ID for authorization
  const currentUserId = localStorage.getItem('portfolio_planner_current_user');
  await api.delete(`/positions/ideas/${positionId}`, {
    params: {
      user_id: currentUserId
    }
  });
};

/**
 * Remove a shared position from your view (unshare from yourself)
 * @param {string} positionId - Position ID to unshare
 * @returns {Promise<void>}
 */
export const unshareFromMe = async (positionId) => {
  // Pass current user ID
  const currentUserId = localStorage.getItem('portfolio_planner_current_user');
  await api.delete(`/positions/ideas/${positionId}/unshare`, {
    params: {
      user_id: currentUserId
    }
  });
};

/**
 * Share a trade idea with friends
 * @param {string} positionId - Position ID to share
 * @param {string[]} friendIds - Array of friend user IDs
 * @param {string} accessLevel - Access level (view, comment)
 * @returns {Promise<{success: boolean, message: string, share_count: number}>}
 */
export const shareTradeIdea = async (positionId, friendIds, accessLevel = 'comment') => {
  // Pass current user ID for authorization (to verify ownership)
  const currentUserId = localStorage.getItem('portfolio_planner_current_user');
  const response = await api.post(`/positions/ideas/${positionId}/share`, {
    friend_ids: friendIds,
    access_level: accessLevel
  }, {
    params: {
      user_id: currentUserId
    }
  });
  return response.data;
};

/**
 * Fetch positions shared with the current user
 * @returns {Promise<{total: number, positions: Array}>}
 */
export const fetchSharedPositions = async () => {
  // Get current user ID from localStorage
  const currentUserId = localStorage.getItem('portfolio_planner_current_user');
  
  const response = await api.get('/positions/shared', {
    params: {
      user_id: currentUserId
    }
  });
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


