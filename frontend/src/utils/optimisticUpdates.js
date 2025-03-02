// frontend/src/utils/optimisticUpdates.js

/**
 * Tracks positions with local uncommitted changes
 * @type {Map<string, Object>}
 */
export const unsyncedChanges = new Map();

/**
 * Records a change to a position for optimistic updates
 * @param {string} positionId - ID of the position
 * @param {string} changeType - Type of change (tags, comments, details)
 * @param {*} changeData - The change data
 */
export const recordChange = (positionId, changeType, changeData) => {
  // Initialize position entry if it doesn't exist
  if (!unsyncedChanges.has(positionId)) {
    unsyncedChanges.set(positionId, {
      lastLocalUpdate: new Date().toISOString(),
      changes: {}
    });
  }

  const positionChanges = unsyncedChanges.get(positionId);
  
  // Update the change record
  if (!positionChanges.changes[changeType]) {
    positionChanges.changes[changeType] = [];
  }
  
  positionChanges.changes[changeType].push({
    timestamp: new Date().toISOString(),
    data: changeData
  });

  // Update the lastLocalUpdate timestamp
  positionChanges.lastLocalUpdate = new Date().toISOString();
};

/**
 * Clear all recorded changes for a position after syncing
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
 * Check if a position has any unsaved changes
 * @param {string} positionId - ID of the position
 * @returns {boolean} - True if position has unsaved changes
 */
export const hasUnsavedChanges = (positionId) => {
  return unsyncedChanges.has(positionId);
};

/**
 * Get all positions with unsaved changes
 * @returns {Array} - Array of position IDs with unsaved changes
 */
export const getPositionsWithChanges = () => {
  return Array.from(unsyncedChanges.keys());
};