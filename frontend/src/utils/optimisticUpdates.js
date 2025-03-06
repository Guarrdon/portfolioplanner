// frontend/src/utils/optimisticUpdates.js

/**
 * Simple map to track positions with local changes
 * @type {Map<string, Object>}
 */
export const unsyncedChanges = new Map();

/**
 * Records a change to a position for publishing
 * @param {string} positionId - ID of the position
 * @param {string} changeType - Type of change (tags, comments, details)
 * @param {*} changeData - The change data
 */
export const recordChange = (positionId, changeType, changeData) => {
  if (!unsyncedChanges.has(positionId)) {
    unsyncedChanges.set(positionId, {
      timestamp: new Date().toISOString(),
      changes: {}
    });
  }

  const positionChanges = unsyncedChanges.get(positionId);
  
  if (!positionChanges.changes[changeType]) {
    positionChanges.changes[changeType] = [];
  }
  
  positionChanges.changes[changeType].push({
    timestamp: new Date().toISOString(),
    data: changeData
  });
};

/**
 * Clear all recorded changes for a position
 * @param {string} positionId - ID of the position
 */
export const clearChanges = (positionId) => {
  unsyncedChanges.delete(positionId);
};

/**
 * Get all unsaved changes for a position
 * @param {string} positionId - ID of the position
 * @returns {Object|null} - Object containing change info or null if no changes
 */
export const getUnsavedChanges = (positionId) => {
  return unsyncedChanges.get(positionId) || null;
};

/**
 * Check if a position has any pending changes
 * @param {string} positionId - ID of the position
 * @returns {boolean} - True if position has changes
 */
export const hasUnsavedChanges = (positionId) => {
  return unsyncedChanges.has(positionId);
};

/**
 * Get all positions with pending changes
 * @returns {Array} - Array of position IDs with changes
 */
export const getPositionsWithChanges = () => {
  return Array.from(unsyncedChanges.keys());
};