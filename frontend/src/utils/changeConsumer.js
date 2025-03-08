// frontend/src/utils/changeConsumer.js

/**
 * Consumes pending changes for a user and marks them as processed
 * @param {string} userId - The user ID to check for changes
 * @returns {Array} - Array of relevant changes
 */
export const consumeChanges = (userId) => {
  if (!userId) return [];
  
  try {
    // Get all pending changes
    const allChanges = JSON.parse(localStorage.getItem('pendingChanges') || '[]');
    
    if (allChanges.length === 0) {
      return [];
    }
    
    // Find changes for this user that haven't been processed
    const userChanges = allChanges.filter(change => 
      // Include changes where this user is a recipient
      (change.recipients.includes(userId) || 
       // Or changes published by this user (for tracking purposes)
       change.publisherId === userId) &&
      // And the change hasn't been processed by this user yet
      !change.processed.includes(userId)
    );
    
    if (userChanges.length > 0) {
      console.log(`Found ${userChanges.length} changes for user ${userId}`);
    }
    
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
  } catch (error) {
    console.error('Error consuming changes:', error);
    return [];
  }
};

/**
 * Check if there are updates available for a specific position
 * @param {string} userId - User ID
 * @param {string} positionId - Position ID or original ID for shared positions
 * @returns {boolean} - True if updates are available
 */
export const hasUpdatesForPosition = (userId, positionId) => {
  if (!userId || !positionId) return false;
  
  try {
    const allChanges = JSON.parse(localStorage.getItem('pendingChanges') || '[]');
    
    // We need to check both the position ID and original ID for shared positions
    return allChanges.some(change => 
      // Match either the position ID or the original ID
      (change.positionId === positionId || change.originalId === positionId) &&
      // The user is in the recipients list
      change.recipients.includes(userId) &&
      // The change hasn't been processed by this user yet
      !change.processed.includes(userId)
    );
  } catch (error) {
    console.error('Error checking for position updates:', error);
    return false;
  }
};

/**
 * Gets all changes that affect a specific position
 * @param {string} userId - User ID
 * @param {string} positionId - Position ID or original ID
 * @returns {Array} - Array of changes for the position
 */
export const getChangesForPosition = (userId, positionId) => {
  if (!userId || !positionId) return [];
  
  try {
    const allChanges = JSON.parse(localStorage.getItem('pendingChanges') || '[]');
    
    return allChanges.filter(change => 
      (change.positionId === positionId || change.originalId === positionId) &&
      change.recipients.includes(userId) &&
      !change.processed.includes(userId)
    );
  } catch (error) {
    console.error('Error getting changes for position:', error);
    return [];
  }
};