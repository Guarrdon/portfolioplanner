// src/utils/changeConsumer.js
export const consumeChanges = (userId) => {
    if (!userId) return [];
    
    const allChanges = JSON.parse(localStorage.getItem('pendingChanges') || '[]');
    
    // Find changes targeting this user that haven't been processed
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