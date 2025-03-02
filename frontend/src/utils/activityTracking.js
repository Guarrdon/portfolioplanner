// frontend/src/utils/activityTracking.js

/**
 * Creates a new activity log entry
 * @param {string} type - Type of activity (comment_added, tag_added, tag_removed, position_edited, sync_performed)
 * @param {object} user - Current user object with id and displayName
 * @param {object} data - Any relevant data for the activity
 * @returns {object} Activity log entry
 */
export const createActivityEntry = (type, user, data = {}) => {
    return {
      id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      userId: user?.id,
      userName: user?.displayName || 'Unknown User',
      timestamp: new Date().toISOString(),
      data
    };
  };
  
  /**
   * Adds a new activity to the position's activity log
   * @param {object} position - The position to update
   * @param {object} activity - The activity to add
   * @returns {object} Updated position with new activity
   */
  export const addActivityToPosition = (position, activity) => {
    if (!position) return position;
    
    // Make sure activityLog array exists
    const activityLog = Array.isArray(position.activityLog) 
      ? position.activityLog 
      : [];
    
    return {
      ...position,
      activityLog: [...activityLog, activity]
    };
  };
  
  /**
   * Log a comment activity
   * @param {object} position - The position object
   * @param {object} user - Current user object
   * @param {string} commentText - The comment text
   * @returns {object} Updated position with activity logged
   */
  export const logCommentActivity = (position, user, commentText) => {
    const activity = createActivityEntry('comment_added', user, { text: commentText });
    return addActivityToPosition(position, activity);
  };
  
  /**
   * Log a tag added activity
   * @param {object} position - The position object
   * @param {object} user - Current user object
   * @param {string} tag - The tag that was added
   * @returns {object} Updated position with activity logged
   */
  export const logTagAddedActivity = (position, user, tag) => {
    const activity = createActivityEntry('tag_added', user, { tag });
    return addActivityToPosition(position, activity);
  };
  
  /**
   * Log a tag removed activity
   * @param {object} position - The position object
   * @param {object} user - Current user object
   * @param {string} tag - The tag that was removed
   * @returns {object} Updated position with activity logged
   */
  export const logTagRemovedActivity = (position, user, tag) => {
    const activity = createActivityEntry('tag_removed', user, { tag });
    return addActivityToPosition(position, activity);
  };
  
  /**
   * Log a position edited activity
   * @param {object} position - The position object
   * @param {object} user - Current user object
   * @param {array} changedFields - Array of field names that were changed
   * @returns {object} Updated position with activity logged
   */
  export const logPositionEditedActivity = (position, user, changedFields = []) => {
    const activity = createActivityEntry('position_edited', user, { fields: changedFields });
    return addActivityToPosition(position, activity);
  };
  
  /**
   * Log a sync performed activity
   * @param {object} position - The position object
   * @param {object} user - Current user object
   * @param {number} changeCount - Number of changes synced
   * @returns {object} Updated position with activity logged
   */
  export const logSyncPerformedActivity = (position, user, changeCount = 0) => {
    const activity = createActivityEntry('sync_performed', user, { changeCount });
    return addActivityToPosition(position, activity);
  };
  
  /**
   * Get all activities since a specific timestamp
   * @param {object} position - The position object
   * @param {string} since - ISO timestamp to filter activities from
   * @returns {array} Filtered activity log
   */
  export const getActivitiesSince = (position, since) => {
    if (!position?.activityLog || !Array.isArray(position.activityLog)) {
      return [];
    }
    
    const sinceDate = new Date(since);
    return position.activityLog.filter(activity => {
      const activityDate = new Date(activity.timestamp);
      return activityDate > sinceDate;
    });
  };
  
  /**
   * Calculate activity counts by type
   * @param {object} position - The position object
   * @returns {object} Counts of different activity types
   */
  export const getActivityCounts = (position) => {
    if (!position?.activityLog || !Array.isArray(position.activityLog)) {
      return { total: 0 };
    }
    
    return position.activityLog.reduce((counts, activity) => {
      const type = activity.type || 'unknown';
      counts[type] = (counts[type] || 0) + 1;
      counts.total += 1;
      return counts;
    }, { total: 0 });
  };
  
  /**
   * Compare two position versions and detect changes
   * @param {object} originalPosition - Original position before changes
   * @param {object} updatedPosition - Updated position after changes
   * @returns {object} Object containing detected changes
   */
  export const detectPositionChanges = (originalPosition, updatedPosition) => {
    if (!originalPosition || !updatedPosition) {
      return { hasChanges: false, changes: [] };
    }
  
    const changes = [];
    
    // Check basic fields
    const basicFields = ['symbol', 'account'];
    basicFields.forEach(field => {
      if (originalPosition[field] !== updatedPosition[field]) {
        changes.push({ 
          field, 
          oldValue: originalPosition[field], 
          newValue: updatedPosition[field]
        });
      }
    });
    
    // Check tags
    const originalTags = originalPosition.tags || [];
    const updatedTags = updatedPosition.tags || [];
    
    const addedTags = updatedTags.filter(tag => !originalTags.includes(tag));
    const removedTags = originalTags.filter(tag => !updatedTags.includes(tag));
    
    if (addedTags.length > 0) {
      changes.push({ field: 'tags', action: 'added', values: addedTags });
    }
    
    if (removedTags.length > 0) {
      changes.push({ field: 'tags', action: 'removed', values: removedTags });
    }
    
    // Check legs (more complex structure)
    const originalLegs = originalPosition.legs || [];
    const updatedLegs = updatedPosition.legs || [];
    
    if (originalLegs.length !== updatedLegs.length) {
      changes.push({ 
        field: 'legs', 
        action: originalLegs.length < updatedLegs.length ? 'added' : 'removed',
        count: Math.abs(originalLegs.length - updatedLegs.length)
      });
    } else {
      // Check if any leg properties changed
      for (let i = 0; i < originalLegs.length; i++) {
        const originalLeg = originalLegs[i];
        const updatedLeg = updatedLegs.find(leg => leg.id === originalLeg.id);
        
        if (!updatedLeg) {
          changes.push({ 
            field: 'legs', 
            action: 'changed',
            message: `Leg ${i+1} was replaced`
          });
          continue;
        }
        
        // Compare leg properties
        const legFields = ['type', 'side', 'shares', 'costBasis', 
                           'contracts', 'strike', 'premium', 'expiration'];
                           
        const legChanges = legFields.filter(field => 
          originalLeg[field] !== updatedLeg[field]
        );
        
        if (legChanges.length > 0) {
          changes.push({ 
            field: 'legs', 
            action: 'modified',
            leg: originalLeg.id,
            properties: legChanges
          });
        }
      }
    }
    
    // Check comments (only count additions)
    const originalComments = originalPosition.comments || [];
    const updatedComments = updatedPosition.comments || [];
    
    if (updatedComments.length > originalComments.length) {
      const newCommentCount = updatedComments.length - originalComments.length;
      changes.push({ 
        field: 'comments', 
        action: 'added',
        count: newCommentCount
      });
    }
    
    return {
      hasChanges: changes.length > 0,
      changes
    };
  };