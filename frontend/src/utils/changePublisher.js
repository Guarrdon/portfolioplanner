// src/utils/changePublisher.js
export const publishChange = (changeType, position, changeData) => {
    // In the future: This will publish to a message queue/event system
    // For now: Store in localStorage as a stand-in
    const changes = JSON.parse(localStorage.getItem('pendingChanges') || '[]');
    changes.push({
      id: `change_${Date.now()}`,
      type: changeType,
      positionId: position.id,
      originalId: position.originalId || position.id,
      ownerId: position.ownerId || position.userId,
      timestamp: new Date().toISOString(),
      data: changeData,
      recipients: position.sharedWith || [],
      processed: []
    });
    localStorage.setItem('pendingChanges', JSON.stringify(changes));
  };