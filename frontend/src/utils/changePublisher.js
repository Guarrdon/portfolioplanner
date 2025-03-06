// frontend/src/utils/changePublisher.js

/**
 * Simplified function to publish a change event
 * @param {string} changeType - Type of change (POSITION_UPDATED, etc)
 * @param {Object} position - The position that changed
 * @param {Object} data - Additional change data
 */
export const publishChange = (changeType, position, data = {}) => {
  if (!position || !position.id) return;
  
  // Get current changes from localStorage
  const pendingChanges = JSON.parse(localStorage.getItem('pendingChanges') || '[]');
  
  // Add the new change
  pendingChanges.push({
    id: `change_${Date.now()}`,
    type: changeType,
    positionId: position.id,
    ownerId: position.ownerId,
    timestamp: new Date().toISOString(),
    data: data,
    // Recipients are either all shared users (if owner is publishing) or just the owner (if shared user is publishing)
    recipients: position.ownerId === data.publisherId ? (position.sharedWith || []) : [position.ownerId],
    processed: []
  });
  
  // Save back to localStorage
  localStorage.setItem('pendingChanges', JSON.stringify(pendingChanges));
};