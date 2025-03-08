// frontend/src/utils/changePublisher.js

/**
 * Publishes a change event to be consumed by other users
 * @param {string} changeType - Type of change (POSITION_UPDATED, etc)
 * @param {Object} position - The position that changed
 * @param {Object} data - Additional change data
 * @param {string} publisherId - ID of the user making the change
 * @returns {boolean} - Whether the change was successfully published
 */
export const publishChange = (changeType, position, data = {}, publisherId) => {
  if (!position || !position.id) return false;
  
  // Position validation
  if (!position.ownerId) {
    console.error('Cannot publish change: position missing ownerId');
    return false;
  }

  // Publisher validation (should be the current user's ID)
  if (!publisherId) {
    console.error('Cannot publish change: missing publisherId');
    return false;
  }
  
  try {
    // Get current changes from localStorage
    const pendingChanges = JSON.parse(localStorage.getItem('pendingChanges') || '[]');
    
    // Determine recipients based on who is publishing the change
    let recipients = [];
    
    if (position.ownerId === publisherId) {
      // Owner is publishing changes to shared users
      recipients = position.sharedWith || [];
      console.log(`Owner ${publisherId} publishing changes to ${recipients.length} users`);
    } else {
      // Shared user is publishing changes to owner
      recipients = [position.ownerId];
      console.log(`User ${publisherId} publishing changes to owner ${position.ownerId}`);
    }
    
    // Skip if no recipients
    if (recipients.length === 0) {
      console.log('No recipients for change, skipping');
      return false;
    }
    
    // Create the change record with essential metadata
    const changeRecord = {
      id: `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: changeType,
      positionId: position.id,
      originalId: position.originalId || position.id,
      ownerId: position.ownerId,
      publisherId,
      timestamp: new Date().toISOString(),
      data: {
        ...data,
        publisherId,
        updatedAt: data.updatedAt || new Date().toISOString()
      },
      recipients,
      processed: []
    };
    
    // Add the new change
    pendingChanges.push(changeRecord);
    
    // Save back to localStorage
    localStorage.setItem('pendingChanges', JSON.stringify(pendingChanges));
    
    console.log('Change published successfully:', {
      type: changeType,
      positionId: position.id,
      recipients: recipients.length
    });
    
    return true;
  } catch (error) {
    console.error('Error publishing change:', error);
    return false;
  }
};