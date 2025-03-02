import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { useUser } from './UserContext';
import { userStorage } from '../utils/storage/storage';
import { 
  logCommentActivity, 
  logTagAddedActivity, 
  logTagRemovedActivity,
  logPositionEditedActivity
  // We'll use logSyncPerformedActivity later when needed
} from '../utils/activityTracking';
import { 
  hasUnsavedChanges, 
  getUnsavedChanges, 
  clearChanges,
  unsyncedChanges 
} from '../utils/optimisticUpdates';

const PortfolioContext = createContext();

// Strategy name mapping for standardization
const STRATEGY_MAPPING = {
  'Covered Call': 'coveredCalls',
  'coveredCalls': 'coveredCalls',
  'Put Spread': 'putSpreads',
  'putSpreads': 'putSpreads',
  'Big Option': 'bigOptions',
  'bigOptions': 'bigOptions',
  'Box Spread': 'boxSpreads',
  'boxSpreads': 'boxSpreads',
  'Dividend': 'dividends',
  'dividends': 'dividends',
  'Misc': 'misc',
  'misc': 'misc'
};

export const initialState = {
  ownedStrategies: {
    coveredCalls: [],
    putSpreads: [],
    bigOptions: [],
    boxSpreads: [],
    dividends: [],
    misc: []
  },
  sharedStrategies: {
    coveredCalls: [],
    putSpreads: [],
    bigOptions: [],
    boxSpreads: [],
    dividends: [],
    misc: []
  },
  loading: true,
  error: null
};

const validatePosition = (position) => {
  if (!position.userId || !position.ownerId) {
    throw new Error('User ID and Owner ID are required for position');
  }

  if (!position.strategy || !position.symbol || !position.account) {
    throw new Error('Missing required fields');
  }

  if (position.legs) {
    position.legs.forEach(leg => {
      if (leg.type === 'stock') {
        if (!leg.shares || !leg.costBasis || !leg.side) {
          throw new Error('Stock leg missing required fields');
        }
      } else if (leg.type === 'option') {
        if (!leg.optionType || !leg.contracts || !leg.strike || !leg.premium || !leg.expiration || !leg.side) {
          throw new Error('Option leg missing required fields');
        }
      } else {
        throw new Error('Invalid leg type');
      }
    });
  }

  return true;
};

const standardizeStrategy = (strategyName) => {
  return STRATEGY_MAPPING[strategyName] || strategyName;
};

const standardizePosition = (position, userId) => {
  if (!position) return position;

  const standardizedPosition = {
    ...position,
    strategy: standardizeStrategy(position.strategy),
    userId,
    ownerId: position.ownerId || userId,
    legs: position.legs?.map(leg => ({
      ...leg,
      id: leg.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    })),
    comments: position.comments || [],
    tags: position.tags || [],
    activityLog: position.activityLog || [], // Ensure activityLog array exists
    // Add shared fields preservation
    shared: position.shared,
    sharedWith: position.sharedWith || [],
    sharedAt: position.sharedAt,
    sharedBy: position.sharedBy
  };

  return calculatePositionMetrics(standardizedPosition);
};

const calculatePositionMetrics = (position) => {
  if (!position.legs || position.legs.length === 0) return position;

  const legs = position.legs;
  const metrics = {
    totalValue: 0,
    maxRisk: 0,
    maxProfit: 0
  };

  legs.forEach(leg => {
    if (leg.type === 'stock') {
      const value = leg.shares * leg.costBasis;
      metrics.totalValue += leg.side === 'long' ? value : -value;
    } else if (leg.type === 'option') {
      const value = leg.contracts * leg.premium * 100;
      metrics.totalValue += leg.side === 'long' ? -value : value;
    }
  });

  return {
    ...position,
    metrics
  };
};

function portfolioReducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':
      return {
        ...state,
        loading: action.payload
      };

    case 'RESET_STATE':
      return {
        ...initialState,
        loading: false
      };

    case 'LOAD_OWNED_POSITIONS': {
      const { userId, positions, timestamp } = action.payload;

      return {
        ...state,
        ownedStrategies: positions.reduce((acc, position) => {
          const strategy = standardizeStrategy(position.strategy);
          if (!acc[strategy]) acc[strategy] = [];
          acc[strategy].push(standardizePosition(position, userId));
          return acc;
        }, { ...initialState.ownedStrategies }),
        loading: false,
        processedUserId: userId,
        lastLoadTimestamp: timestamp
      };
    }

    case 'LOAD_SHARED_POSITIONS': {
      const { userId, positions } = action.payload;

      // Group shared positions by strategy
      const groupedPositions = positions.reduce((acc, position) => {
        const strategy = standardizeStrategy(position.strategy);
        if (!acc[strategy]) acc[strategy] = [];
        // Ensure shared position is properly marked
        const standardizedPosition = {
          ...standardizePosition(position, userId),
          shared: true // Mark as shared position
        };
        acc[strategy].push(standardizedPosition);
        return acc;
      }, { ...initialState.sharedStrategies });

      return {
        ...state,
        sharedStrategies: groupedPositions,
        loading: false
      };
    }

    case 'ADD_POSITION': {
      const { userId, position } = action.payload;
      const standardizedPosition = standardizePosition(position, userId);
      const strategy = standardizedPosition.strategy;

      return {
        ...state,
        ownedStrategies: {
          ...state.ownedStrategies,
          [strategy]: [
            ...(state.ownedStrategies[strategy] || []),
            standardizedPosition
          ]
        }
      };
    }

    case 'UPDATE_POSITION': {
      const { userId, position } = action.payload;
      const standardizedPosition = standardizePosition(position, userId);
      const strategy = standardizedPosition.strategy;
      const isOwned = standardizedPosition.ownerId === userId;

      const targetStrategies = isOwned ? 'ownedStrategies' : 'sharedStrategies';

      return {
        ...state,
        [targetStrategies]: {
          ...state[targetStrategies],
          [strategy]: state[targetStrategies][strategy].map(pos =>
            pos.id === standardizedPosition.id ? standardizedPosition : pos
          )
        }
      };
    }

    case 'DELETE_POSITION': {
      const { positionId, strategy } = action.payload;
      const standardStrategy = standardizeStrategy(strategy);

      return {
        ...state,
        ownedStrategies: {
          ...state.ownedStrategies,
          [standardStrategy]: state.ownedStrategies[standardStrategy]
            .filter(pos => pos.id !== positionId)
        }
      };
    }

    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
        loading: false
      };

    case 'CLEAR_ERROR':
      return {
        ...state,
        error: null
      };

    default:
      return state;
  }
}

export function PortfolioProvider({ children }) {
  const [state, dispatch] = useReducer(portfolioReducer, initialState);
  const { currentUser } = useUser();
  const userId = currentUser?.id;

  const loadPositions = useCallback(async () => {
    // Simple guard for no userId
    if (!userId) return;

    try {
      dispatch({ type: 'SET_LOADING', payload: true });

      // Load both owned and shared positions
      const ownedPositions = await userStorage.getOwnedPositions(userId);
      const sharedPositions = await userStorage.getSharedPositions(userId);

      // Load owned positions first
      dispatch({
        type: 'LOAD_OWNED_POSITIONS',
        payload: {
          userId,
          positions: ownedPositions || [],
          timestamp: Date.now()
        }
      });

      // Then load shared positions
      dispatch({
        type: 'LOAD_SHARED_POSITIONS',
        payload: {
          userId,
          positions: sharedPositions || [],
          timestamp: Date.now()
        }
      });

    } catch (error) {
      console.error('Error loading positions:', error);
      dispatch({ type: 'SET_ERROR', payload: error.message });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [userId]);

  useEffect(() => {
    let mounted = true;

    if (!userId) {
      dispatch({ type: 'RESET_STATE' });
      return;
    }

    // Call loadPositions if component is mounted
    if (mounted) {
      loadPositions();
    }

    // Cleanup function
    return () => {
      mounted = false;
    };
  }, [userId, loadPositions]); // Include loadPositions in dependencies


  const value = {
    ...state,
    addPosition: (position) => {
      if (!currentUser?.id) return false;

      try {
        const enrichedPosition = {
          ...position,
          ownedStrategies: userId ? state.ownedStrategies : initialState.ownedStrategies,
          sharedStrategies: userId ? state.sharedStrategies : initialState.sharedStrategies,
          userId: currentUser.id,
          ownerId: currentUser.id,
          id: position.id || `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          activityLog: [] // Initialize activity log
        };

        validatePosition(enrichedPosition);

        // Create initial activity log entry for position creation
        const initialActivity = {
          id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'position_created',
          userId: currentUser.id,
          userName: currentUser.displayName || 'User',
          timestamp: new Date().toISOString()
        };

        enrichedPosition.activityLog.push(initialActivity);

        // Retrieve existing positions
        const existingPositions = userStorage.getOwnedPositions(currentUser.id);

        // Add the new position to the existing array
        const updatedPositions = [...existingPositions, enrichedPosition];

        // Save the updated positions
        userStorage.saveOwnedPositions(currentUser.id, updatedPositions);

        dispatch({
          type: 'LOAD_OWNED_POSITIONS',
          payload: { userId: currentUser.id, positions: updatedPositions }
        });

        return true;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },

    addSharedPosition: async (position) => {
      if (!currentUser?.id) return false;

      try {
        const sharedPositions = userStorage.getSharedPositions(currentUser.id) || [];

        // Check if position is already shared
        if (sharedPositions.some(p => p.id === position.id)) {
          return true; // Already shared
        }

        // Add new shared position
        const updatedPositions = [...sharedPositions, {
          ...position,
          shared: true,
          receivedAt: new Date().toISOString(),
          activityLog: position.activityLog || [] // Preserve activity log
        }];

        const success = userStorage.saveSharedPositions(currentUser.id, updatedPositions);

        if (success) {
          dispatch({
            type: 'LOAD_SHARED_POSITIONS',
            payload: { userId: currentUser.id, positions: updatedPositions }
          });
        }

        return success;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },

    syncSharedPosition: async (sharedPositionId) => {
      if (!currentUser?.id) return false;
    
      try {
        // First get the shared position
        const sharedPosition = value.getPositionById(sharedPositionId);
        if (!sharedPosition || !sharedPosition.shared || !sharedPosition.originalId) {
          throw new Error('Invalid shared position');
        }
    
        // Check if the original position still exists
        const originalOwnerId = sharedPosition.ownerId;
        if (!originalOwnerId) {
          throw new Error('Original owner info missing');
        }
    
        // Get the original position from the owner
        const ownerPositions = userStorage.getOwnedPositions(originalOwnerId);
        const originalPosition = ownerPositions.find(p => p.id === sharedPosition.originalId);
    
        if (!originalPosition) {
          throw new Error('Original position no longer exists');
        }
    
        // Check for local changes before syncing
        const hasLocalChanges = unsyncedChanges.has(sharedPositionId);
        
        // Notify the user about potential data loss if there are local changes
        if (hasLocalChanges) {
          // In a real app, this would be a modal confirmation
          // For this implementation, we'll just log a warning and proceed
          console.warn('Syncing will overwrite local changes');
          
          // Add merge logic here for handling conflicts
          // For now, let's just preserve local comments when syncing
          const localChanges = getUnsavedChanges(sharedPositionId);
          const localComments = localChanges?.changes?.comments || [];
          
          // Extract the comments we need to preserve
          const commentsToPreserve = localComments
            .filter(change => change.data.action === 'add')
            .map(change => change.data.comment);
          
          // Make sure comments don't get lost in sync
          if (commentsToPreserve.length > 0) {
            originalPosition.comments = [
              ...(originalPosition.comments || []),
              ...commentsToPreserve
            ];
          }
        }
    
        // Log the sync activity
        const syncActivity = {
          id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'sync_performed',
          userId: currentUser.id,
          userName: currentUser.displayName || 'User',
          timestamp: new Date().toISOString(),
          data: {
            originalOwnerId: originalPosition.ownerId,
            syncTime: new Date().toISOString(),
            changeCount: 1 // You could calculate actual changes here
          }
        };
    
        // Apply updates from original to shared position
        const updatedSharedPosition = {
          ...sharedPosition,
          // Update shared position with original position's data, keeping shared metadata
          symbol: originalPosition.symbol,
          account: originalPosition.account,
          tags: originalPosition.tags || [],
          legs: originalPosition.legs || [],
          comments: originalPosition.comments || [],
          // Update activity log with new sync entry
          activityLog: [...(sharedPosition.activityLog || []), syncActivity],
          // Update sync timestamp
          lastSyncedAt: new Date().toISOString()
        };
    
        // Save the updated shared position
        const success = userStorage.saveSharedPosition(currentUser.id, updatedSharedPosition);
    
        // Clear out the local changes after successful sync
        if (success && hasLocalChanges) {
          clearChanges(sharedPositionId);
        }
    
        // Refresh shared positions in state
        if (success) {
          const sharedPositions = userStorage.getSharedPositions(currentUser.id);
          dispatch({
            type: 'LOAD_SHARED_POSITIONS',
            payload: { userId: currentUser.id, positions: sharedPositions }
          });
        }
    
        return success;
      } catch (error) {
        console.error('Error syncing shared position:', error);
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },
    
    updatePosition: (position) => {
      if (!currentUser?.id) return false;

      try {
        const isOwned = position.ownerId === currentUser.id;
        
        // Get the original position for comparison
        const originalPosition = value.getPositionById(position.id);
        
        if (!originalPosition) {
          throw new Error('Position not found');
        }
        
        // Track changes for activity logging
        const changedFields = [];
        let updatedPosition = { ...position };
        
        // Initialize activityLog if it doesn't exist
        if (!Array.isArray(updatedPosition.activityLog)) {
          updatedPosition.activityLog = [];
        }
        
        // Track tag changes
        if (isOwned) {
          const originalTags = originalPosition.tags || [];
          const newTags = updatedPosition.tags || [];
          
          // Find added tags
          const addedTags = newTags.filter(tag => !originalTags.includes(tag));
          // Find removed tags
          const removedTags = originalTags.filter(tag => !newTags.includes(tag));
          
          // Log tag additions
          addedTags.forEach(tag => {
            updatedPosition = logTagAddedActivity(updatedPosition, currentUser, tag);
            changedFields.push(`Added tag "${tag}"`);
          });
          
          // Log tag removals
          removedTags.forEach(tag => {
            updatedPosition = logTagRemovedActivity(updatedPosition, currentUser, tag);
            changedFields.push(`Removed tag "${tag}"`);
          });
          
          // Find new comments (only log once)
          const originalCommentIds = new Set((originalPosition.comments || []).map(c => c.id));
          const newComments = (updatedPosition.comments || []).filter(c => !originalCommentIds.has(c.id));
          
          // Log new comments
          newComments.forEach(comment => {
            updatedPosition = logCommentActivity(updatedPosition, currentUser, comment.text);
            changedFields.push('Added comment');
          });
          
          // If other fields changed, log position edit activity
          const coreFields = ['symbol', 'account', 'legs'];
          const changedCoreFields = coreFields.filter(field => 
            JSON.stringify(originalPosition[field]) !== JSON.stringify(updatedPosition[field])
          );
          
          if (changedCoreFields.length > 0) {
            updatedPosition = logPositionEditedActivity(updatedPosition, currentUser, changedCoreFields);
            changedFields.push(...changedCoreFields.map(field => `Changed ${field}`));
          }
        }

        if (isOwned) {
          validatePosition(updatedPosition);
          userStorage.saveOwnedPosition(currentUser.id, updatedPosition);

          // Reload owned positions after update
          const ownedPositions = userStorage.getOwnedPositions(currentUser.id);
          dispatch({
            type: 'LOAD_OWNED_POSITIONS',
            payload: { userId: currentUser.id, positions: ownedPositions }
          });
        } else {
          // For shared positions, only update comments and tags
          const sharedPositions = userStorage.getSharedPositions(currentUser.id);
          const updatedSharedPositions = sharedPositions.map(p =>
            p.id === position.id ? {
              ...p,
              comments: updatedPosition.comments,
              tags: updatedPosition.tags,
              activityLog: updatedPosition.activityLog
            } : p
          );
          userStorage.saveSharedPositions(currentUser.id, updatedSharedPositions);

          // Reload shared positions after update
          dispatch({
            type: 'LOAD_SHARED_POSITIONS',
            payload: { userId: currentUser.id, positions: updatedSharedPositions }
          });
        }

        return true;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },

    deletePosition: async (id, strategy) => {
      if (!currentUser?.id) return false;
    
      try {
        // First, check if the position exists in owned positions
        const ownedSuccess = userStorage.deleteOwnedPosition(currentUser.id, id);
        
        // Remove from shared positions for all users
        const allUsers = JSON.parse(localStorage.getItem(userStorage.STORAGE_KEYS.USERS) || '[]');
        
        allUsers.forEach(user => {
          const sharedPositions = userStorage.getSharedPositions(user.id);
          const updatedSharedPositions = sharedPositions.filter(
            pos => pos.id !== id && pos.originalId !== id
          );
          userStorage.saveSharedPositions(user.id, updatedSharedPositions);
        });
    
        if (ownedSuccess) {
          dispatch({
            type: 'DELETE_POSITION',
            payload: { userId: currentUser.id, positionId: id, strategy }
          });
          
          // Reload shared positions to reflect the deletion
          dispatch({
            type: 'LOAD_SHARED_POSITIONS',
            payload: { 
              userId: currentUser.id, 
              positions: userStorage.getSharedPositions(currentUser.id)
            }
          });
        }
    
        return ownedSuccess;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },
        
    calculatePositionMetrics,
    validatePosition,

    // Add the new getStrategyPositions method here
    getStrategyPositions: (strategyType) => {
      const standardizedType = standardizeStrategy(strategyType);
      const ownedPositions = state.ownedStrategies[standardizedType] || [];
      const sharedPositions = state.sharedStrategies[standardizedType] || [];

      // Combine positions, ensuring no duplicates by ID
      const positionMap = new Map();

      // Add owned positions first (they take precedence)
      ownedPositions.forEach(position => {
        positionMap.set(position.id, { ...position, owned: true });
      });

      // Add shared positions if not already present
      sharedPositions.forEach(position => {
        if (!positionMap.has(position.id)) {
          positionMap.set(position.id, { ...position, shared: true });
        }
      });

      return Array.from(positionMap.values());
    },

    // Modify the existing getPositionById to include owned/shared flags
    getPositionById: (id) => {
      // Check owned positions first
      for (const strategy of Object.values(state.ownedStrategies)) {
        const position = strategy.find(p => p.id === id);
        if (position) return { ...position, owned: true };
      }

      // Then check shared positions
      for (const strategy of Object.values(state.sharedStrategies)) {
        const position = strategy.find(p => p.id === id);
        if (position) return { ...position, shared: true };
      }

      return null;
    },

    getSharedPositionUpdates: (positionId) => {
      if (!currentUser?.id) return [];
    
      try {
        // Get the original position
        const ownedPosition = value.getPositionById(positionId);
        if (!ownedPosition || ownedPosition.ownerId !== currentUser.id) {
          return []; // Not an owned position
        }
    
        // Get all users who have this position shared with them
        const updatesFromShared = [];
    
        // In a real implementation with a server, this would be a database query
        // Here we'll check all users' shared positions in localStorage
        const allUsers = JSON.parse(localStorage.getItem(userStorage.STORAGE_KEYS.USERS) || '[]');
        
        allUsers.forEach(user => {
          if (user.id === currentUser.id) return; // Skip current user
          
          const sharedPositions = userStorage.getSharedPositions(user.id) || [];
          const sharedCopy = sharedPositions.find(p => p.originalId === positionId);
          
          if (sharedCopy) {
            // Check for comments made by this user
            const userComments = (sharedCopy.comments || [])
              .filter(comment => comment.userId === user.id)
              .map(comment => ({
                ...comment,
                fromUser: user.displayName || 'Unknown User',
                fromPosition: sharedCopy.id
              }));
            
            if (userComments.length > 0) {
              updatesFromShared.push({
                userId: user.id,
                userName: user.displayName || 'Unknown User',
                lastSyncedAt: sharedCopy.lastSyncedAt,
                comments: userComments,
                positionId: sharedCopy.id
              });
            }
          }
        });
        
        return updatesFromShared;
      } catch (error) {
        console.error('Error getting shared position updates:', error);
        return [];
      }
    },

    saveOwnedPosition: (userId, position) => {
      try {
        const positions = userStorage.getOwnedPositions(userId);
        const index = positions.findIndex(p => p.id === position.id);

        if (index !== -1) {
          positions[index] = position;
        } else {
          positions.push(position);
        }
        localStorage.setItem(userStorage.buildOwnedPositionsKey(userId), JSON.stringify(positions));
        return true;
      } catch (error) {
        console.error('Error saving owned position:', error);
        return false;
      }
    },

    saveOwnedPositions: (userId, positions) => {
      try {
        localStorage.setItem(userStorage.buildOwnedPositionsKey(userId), JSON.stringify(positions));
        return true;
      } catch (error) {
        console.error('Error saving owned positions:', error);
        return false;
      }
    },

    isPositionOwner: (positionId) => {
      const position = value.getPositionById(positionId);
      return position?.ownerId === currentUser?.id;
    },

    clearError: () => {
      dispatch({ type: 'CLEAR_ERROR' });
    },
    
    // Load positions method for external use
    loadPositions
  };

  return (
    <PortfolioContext.Provider value={value}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  const context = useContext(PortfolioContext);
  if (context === undefined) {
    throw new Error('usePortfolio must be used within a PortfolioProvider');
  }
  return context;
}

export default PortfolioContext;