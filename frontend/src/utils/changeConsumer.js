// frontend/src/utils/changeConsumer.js

/**
 * Simplified function to consume pending changes for a user
 * @param {string} userId - The user ID to check for changes
 * @returns {Array} - Array of relevant changes
 */
export const consumeChanges = (userId) => {
  if (!userId) return [];
  
  // Get all pending changes
  const allChanges = JSON.parse(localStorage.getItem('pendingChanges') || '[]');
  
  // Find changes for this user that haven't been processed
  const userChanges = allChanges.filter(change => 
    (change.recipients.includes(userId) || change.ownerId === userId) &&
    !change.processed.includes(userId)
  );
  
  // Mark as processed
  if (userChanges.length > 0) {
    const updatedChanges = allChanges.map(change => {
      if (userChanges.some(uc => uc.id === change.id)) {
        return {
          ...change,
          processed: [...change.processed, userId]
        };
      }
      return change;
    });
    
    localStorage.setItem('pendingChanges', JSON.stringify(updatedChanges));
  }
  
  return userChanges;
};

/**
 * Check if there are updates available for a specific position
 * @param {string} userId - User ID
 * @param {string} positionId - Position ID
 * @returns {boolean} - True if updates are available
 */
export const hasUpdatesForPosition = (userId, positionId) => {
  if (!userId || !positionId) return false;
  
  const allChanges = JSON.parse(localStorage.getItem('pendingChanges') || '[]');
  
  return allChanges.some(change => 
    change.positionId === positionId &&
    change.recipients.includes(userId) &&
    !change.processed.includes(userId)
  );
};