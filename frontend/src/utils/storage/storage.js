// const OWNED_POSITIONS_KEY_PREFIX = 'portfolio_planner_owned_positions';
// const SHARED_POSITIONS_KEY_PREFIX = 'portfolio_planner_shared_positions';
// const COMMENTS_KEY_PREFIX = 'portfolio_planner_comments';
// const EVENTS_KEY_PREFIX = 'portfolio_planner_events';

// Constants for storage keys
export const STORAGE_KEYS = {
  OWNED_POSITIONS: 'portfolio_planner_owned_positions',
  SHARED_POSITIONS: 'portfolio_planner_shared_positions',
  COMMENTS: 'portfolio_planner_comments',
  EVENTS: 'portfolio_planner_events',
  USER_PREFERENCES: 'portfolio_planner_preferences',
  USERS: 'portfolio_planner_users',
  CURRENT_USER: 'portfolio_planner_current_user',
  ACCOUNTS: 'portfolio_planner_accounts'
};

const buildStorageKey = (prefix, userId) => `${prefix}_${userId}`;
const getStorageKey = (userId, key) => `${userId}_${key}`;

export const userStorage = {
  STORAGE_KEYS, // Export storage keys

  // Key building methods
  buildOwnedPositionsKey: (userId) => buildStorageKey(STORAGE_KEYS.OWNED_POSITIONS, userId),
  buildSharedPositionsKey: (userId) => buildStorageKey(STORAGE_KEYS.SHARED_POSITIONS, userId),
  buildAccountsKey: (userId) => buildStorageKey(STORAGE_KEYS.ACCOUNTS, userId),
  
  // Rest of the existing userStorage implementation remains the same
  initializeUserStorage: (userId) => {
    if (!userId) return false;
    try {
      // Ensure USERS key exists in localStorage
      if (!localStorage.getItem(STORAGE_KEYS.USERS)) {
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify([]));
      }

      // Initialize empty arrays if they don't exist
      if (!localStorage.getItem(buildStorageKey(STORAGE_KEYS.OWNED_POSITIONS, userId))) {
        localStorage.setItem(buildStorageKey(STORAGE_KEYS.OWNED_POSITIONS, userId), JSON.stringify([]));
      }
      if (!localStorage.getItem(buildStorageKey(STORAGE_KEYS.SHARED_POSITIONS, userId))) {
        localStorage.setItem(buildStorageKey(STORAGE_KEYS.SHARED_POSITIONS, userId), JSON.stringify([]));
      }
      return true;
    } catch (error) {
      console.error('Error initializing user storage:', error);
      return false;
    }
  },

  getAccounts: (userId) => {
    try {
      const key = buildStorageKey(STORAGE_KEYS.ACCOUNTS, userId);
      const accounts = localStorage.getItem(key);
      return accounts ? JSON.parse(accounts) : [];
    } catch (error) {
      console.error('Error getting accounts:', error);
      return [];
    }
  },
  saveAccounts: (userId, accounts) => {
    try {
      const key = userStorage.buildAccountsKey(userId);
      localStorage.setItem(key, JSON.stringify(accounts));
      return true;
    } catch (error) {
      console.error('Error saving accounts:', error);
      return false;
    }
  },
  // Owned positions methods
  getOwnedPositions: (userId) => {
    try {
      if (!userId) return [];
      const key = userStorage.buildOwnedPositionsKey(userId);
      const storedData = localStorage.getItem(key);
      return storedData ? JSON.parse(storedData) : [];
    } catch (error) {
      console.error('Error getting owned positions:', error);
      return [];
    }
  },
  
  saveOwnedPositions: (userId, positions) => {
    try {
      if (!userId) return false;
      const key = userStorage.buildOwnedPositionsKey(userId);
      localStorage.setItem(key, JSON.stringify(positions));
      return true;
    } catch (error) {
      console.error('Error saving owned positions:', error);
      return false;
    }
  },
  
  // Shared positions methods
  getSharedPositions: (userId) => {
    try {
      if (!userId) return [];
      const key = userStorage.buildSharedPositionsKey(userId);
      const storedData = localStorage.getItem(key);
      return storedData ? JSON.parse(storedData) : [];
    } catch (error) {
      console.error('Error getting shared positions:', error);
      return [];
    }
  },

  // Individual position operations
  saveOwnedPosition: (userId, position) => {
    try {
      if (!userId || !position) return false;
      const positions = userStorage.getOwnedPositions(userId);
      const index = positions.findIndex(p => p.id === position.id);
      
      if (index >= 0) {
        positions[index] = position;
      } else {
        positions.push(position);
      }
      
      return userStorage.saveOwnedPositions(userId, positions);
    } catch (error) {
      console.error('Error saving owned position:', error);
      return false;
    }
  },
  
  saveSharedPositions: (userId, positions) => {
    try {
      if (!userId) return false;
      const key = userStorage.buildSharedPositionsKey(userId);
      localStorage.setItem(key, JSON.stringify(positions));
      return true;
    } catch (error) {
      console.error('Error saving shared positions:', error);
      return false;
    }
  },
  saveSharedPosition: (userId, position) => {
    try {
      if (!userId || !position) return false;
      const positions = userStorage.getSharedPositions(userId);
      const index = positions.findIndex(p => p.id === position.id);
      
      if (index >= 0) {
        positions[index] = position;
      } else {
        positions.push(position);
      }
      
      return userStorage.saveSharedPositions(userId, positions);
    } catch (error) {
      console.error('Error saving shared position:', error);
      return false;
    }
  },

  deleteOwnedPosition: (userId, positionId) => {
    try {
      if (!userId || !positionId) return false;
      const positions = userStorage.getOwnedPositions(userId);
      const updatedPositions = positions.filter(p => p.id !== positionId);
      return userStorage.saveOwnedPositions(userId, updatedPositions);
    } catch (error) {
      console.error('Error deleting owned position:', error);
      return false;
    }
  },

  // Event Management
  getEvents: (userId) => {
    try {
      const key = getStorageKey(userId, STORAGE_KEYS.EVENTS);
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch (error) {
      console.error('Error getting events:', error);
      return [];
    }
  },

  saveEvent: (userId, event) => {
    try {
      const key = getStorageKey(userId, STORAGE_KEYS.EVENTS);
      const events = userStorage.getEvents(userId);

      const index = events.findIndex(e => e.id === event.id);
      if (index >= 0) {
        events[index] = event;
      } else {
        events.push(event);
      }

      localStorage.setItem(key, JSON.stringify(events));
      return true;
    } catch (error) {
      console.error('Error saving event:', error);
      return false;
    }
  },

  deleteEvent: (userId, eventId) => {
    try {
      const key = getStorageKey(userId, STORAGE_KEYS.EVENTS);
      const events = userStorage.getEvents(userId);

      const updatedEvents = events.filter(e => e.id !== eventId);
      localStorage.setItem(key, JSON.stringify(updatedEvents));
      return true;
    } catch (error) {
      console.error('Error deleting event:', error);
      return false;
    }
  },

  // Comment Management
  getComments: (userId, positionId) => {
    try {
      const key = getStorageKey(userId, STORAGE_KEYS.COMMENTS);
      const allComments = JSON.parse(localStorage.getItem(key) || '[]');
      return positionId
        ? allComments.filter(c => c.positionId === positionId)
        : allComments;
    } catch (error) {
      console.error('Error getting comments:', error);
      return [];
    }
  },

  saveComment: (userId, positionId, comment) => {
    try {
      const key = getStorageKey(userId, STORAGE_KEYS.COMMENTS);
      const comments = userStorage.getComments(userId);

      const index = comments.findIndex(c => c.id === comment.id);
      if (index >= 0) {
        comments[index] = comment;
      } else {
        comments.push({ ...comment, positionId });
      }

      localStorage.setItem(key, JSON.stringify(comments));
      return true;
    } catch (error) {
      console.error('Error saving comment:', error);
      return false;
    }
  },

  deleteComment: (userId, commentId) => {
    try {
      const key = getStorageKey(userId, STORAGE_KEYS.COMMENTS);
      const comments = userStorage.getComments(userId);

      const updatedComments = comments.filter(c => c.id !== commentId);
      localStorage.setItem(key, JSON.stringify(updatedComments));
      return true;
    } catch (error) {
      console.error('Error deleting comment:', error);
      return false;
    }
  },

  // Clear all data (useful for testing)
  clearAllData: () => {
    try {
      Object.values(STORAGE_KEYS).forEach(key => {
        const keys = Object.keys(localStorage).filter(k => k.startsWith(key));
        keys.forEach(k => localStorage.removeItem(k));
      });
      return true;
    } catch (error) {
      console.error('Error clearing storage:', error);
      return false;
    }
  }
};