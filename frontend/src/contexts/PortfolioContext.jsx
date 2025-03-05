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
  getUnsavedChanges,
  clearChanges,
  unsyncedChanges
} from '../utils/optimisticUpdates';
import { detectPositionChanges } from '../utils/activityTracking';
import { publishChange } from '../utils/changePublisher';
import { consumeChanges } from '../utils/changeConsumer';

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

    case 'UPDATE_POSITION_SYNC_STATUS':
      return {
        ...state,
        shared: state.shared.map(position =>
          position.id === action.payload.positionId ?
            { ...position, hasAvailableUpdates: action.payload.hasAvailableUpdates } :
            position
        )
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



  const checkForUpdates = useCallback(() => {
    if (!currentUser?.id) return;

    const pendingChanges = consumeChanges(currentUser.id);

    pendingChanges.forEach(change => {
      if (change.type === 'POSITION_UPDATED') {
        // Find the corresponding position in state
        const positionsToCheck = state.shared || [];
        const positionToUpdate = positionsToCheck.find(p =>
          p.originalId === change.positionId && p.ownerId === change.ownerId
        );

        if (positionToUpdate) {
          // Mark it as having updates available
          dispatch({
            type: 'UPDATE_POSITION_SYNC_STATUS',
            payload: {
              positionId: positionToUpdate.id,
              hasAvailableUpdates: true
            }
          });
        }
      }
    });
  }, [currentUser?.id, state.shared, dispatch]);

  const syncPosition = useCallback(async (positionId) => {
    const positionToSync = state.shared.find(p => p.id === positionId);
    if (!positionToSync || !positionToSync.originalId || !positionToSync.ownerId) return;

    // In a real implementation, this would use the messaging system
    // For now, use localStorage to get the latest version
    const ownedPositions = JSON.parse(localStorage.getItem(`positions_${positionToSync.ownerId}`) || '[]');
    const originalPosition = ownedPositions.find(p => p.id === positionToSync.originalId);

    if (originalPosition) {
      // Preserve local comments when syncing
      const localComments = positionToSync.comments?.filter(c => c.userId === currentUser.id) || [];
      const ownerComments = originalPosition.comments || [];

      // Merge comments (avoid duplicates)
      const mergedComments = [...ownerComments];
      localComments.forEach(comment => {
        if (!mergedComments.some(c => c.id === comment.id)) {
          mergedComments.push(comment);
        }
      });

      // Create synced version
      const syncedPosition = {
        ...positionToSync,
        ...originalPosition,
        id: positionToSync.id,
        comments: mergedComments,
        lastSyncedAt: new Date().toISOString(),
        hasAvailableUpdates: false
      };

      // Save to storage and update state
      userStorage.saveSharedPosition(currentUser.id, syncedPosition);
      dispatch({
        type: 'UPDATE_SHARED_POSITION',
        payload: { position: syncedPosition }
      });

      return true;
    }

    return false;
  }, [state.shared, currentUser?.id, dispatch]);

  // Add this function inside the PortfolioProvider component
  const checkForSharedPositionUpdates = useCallback(async (userId) => {
    if (!userId) return [];

    try {
      // Get all shared positions for this user
      const sharedPositions = userStorage.getSharedPositions(userId) || [];

      // Array to store positions that need updates
      const positionsNeedingUpdate = [];

      // Check each shared position against its original
      for (const sharedPosition of sharedPositions) {
        // Skip if not a proper shared position
        if (!sharedPosition.originalId || !sharedPosition.ownerId) {
          continue;
        }

        // Get the original position from its owner
        const originalOwnerId = sharedPosition.ownerId;
        const ownerPositions = userStorage.getOwnedPositions(originalOwnerId);
        const originalPosition = ownerPositions.find(p => p.id === sharedPosition.originalId);

        // Skip if original no longer exists
        if (!originalPosition) {
          continue;
        }

        // Compare last update times
        const originalLastUpdated = new Date(originalPosition.updatedAt || originalPosition.createdAt);
        const sharedLastSynced = new Date(sharedPosition.lastSyncedAt || sharedPosition.sharedAt);

        // If original was updated after last sync, it needs an update
        if (originalLastUpdated > sharedLastSynced) {
          positionsNeedingUpdate.push({
            id: sharedPosition.id,
            originalId: originalPosition.id,
            symbol: sharedPosition.symbol,
            lastSyncedAt: sharedPosition.lastSyncedAt,
            updateAvailableAt: originalPosition.updatedAt
          });
        }
      }

      return positionsNeedingUpdate;
    } catch (error) {
      console.error('Error checking for shared position updates:', error);
      return [];
    }
  }, []);

  useEffect(() => {
    if (currentUser?.id) {
      // Existing initialization code...

      // Add check for updates
      checkForUpdates();

      // Optional: Set up polling for updates
      const intervalId = setInterval(checkForUpdates, 60000); // Every minute
      return () => clearInterval(intervalId);
    }
  }, [currentUser?.id, checkForUpdates]);


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
    // Inside the value object that's provided to the context
    checkForSharedPositionUpdates: async () => {
      if (!currentUser?.id) return [];
      return checkForSharedPositionUpdates(currentUser.id);
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
        // Get the shared position
        const sharedPosition = value.getPositionById(sharedPositionId);
        if (!sharedPosition) {
          throw new Error('Position not found');
        }

        // Handle differently based on whether current user is the owner or receiver
        const isOwner = sharedPosition.ownerId === currentUser.id;

        if (isOwner) {
          // For owners - we don't sync because they have the original
          console.log('Current user is the owner - no need to sync');
          return true;
        } else {
          // For recipients - sync with original owner's copy
          if (!sharedPosition.originalId || !sharedPosition.ownerId) {
            throw new Error('Cannot sync - missing original position info');
          }

          // Get the original position from the owner
          const originalOwnerId = sharedPosition.ownerId;
          const ownerPositions = userStorage.getOwnedPositions(originalOwnerId);
          const originalPosition = ownerPositions.find(p => p.id === sharedPosition.originalId);

          if (!originalPosition) {
            throw new Error('Original position no longer exists');
          }

          // Check for local changes before syncing
          const hasLocalChanges = unsyncedChanges.has(sharedPositionId);

          if (hasLocalChanges) {
            // In a real app, this would be handled by the conflict resolution UI
            // For now, we'll preserve important local data
            const localChanges = getUnsavedChanges(sharedPositionId);
            const localCommentsChanges = localChanges?.changes?.comments || [];

            // Extract comments we need to preserve
            const commentsToPreserve = localCommentsChanges
              .filter(change => change.data.action === 'add')
              .map(change => change.data.comment);

            // Get all existing comments from the shared position that aren't in original
            const existingLocalComments = (sharedPosition.comments || [])
              .filter(comment => comment.userId === currentUser.id);

            // Combine preserved comments
            const localComments = [...existingLocalComments, ...commentsToPreserve];

            // Detect and log changes between versions
            const changes = detectPositionChanges(sharedPosition, originalPosition);

            // Log sync activity with details about changes
            const syncActivity = {
              id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              type: 'sync_performed',
              userId: currentUser.id,
              userName: currentUser.displayName || 'User',
              timestamp: new Date().toISOString(),
              data: {
                originalOwnerId: originalPosition.ownerId,
                syncTime: new Date().toISOString(),
                changeCount: changes.hasChanges ? changes.changes.length : 0,
                changesDetected: changes.hasChanges
              }
            };

            // Apply updates from original position but keep shared metadata
            // and preserve local comments
            const updatedSharedPosition = {
              ...originalPosition,
              // Keep shared position's ID and metadata
              id: sharedPosition.id,
              userId: currentUser.id,
              shared: true,
              originalId: sharedPosition.originalId,
              ownerId: sharedPosition.ownerId,
              sharedAt: sharedPosition.sharedAt,
              sharedBy: sharedPosition.sharedBy,
              // Merge comments (original + local)
              comments: [
                ...(originalPosition.comments || []),
                ...localComments
              ],
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

            return success;
          } else {
            // No local changes - simpler sync
            const syncActivity = {
              id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              type: 'sync_performed',
              userId: currentUser.id,
              userName: currentUser.displayName || 'User',
              timestamp: new Date().toISOString()
            };

            // Apply updates from original position but keep shared metadata
            const updatedSharedPosition = {
              ...originalPosition,
              // Preserve the shared position's ID and metadata
              id: sharedPosition.id,
              userId: currentUser.id,
              shared: true,
              originalId: sharedPosition.originalId,
              ownerId: sharedPosition.ownerId,
              sharedAt: sharedPosition.sharedAt,
              sharedBy: sharedPosition.sharedBy,
              // Add activity log entry and update sync timestamp
              activityLog: [...(sharedPosition.activityLog || []), syncActivity],
              lastSyncedAt: new Date().toISOString()
            };

            // Save the updated shared position
            const success = userStorage.saveSharedPosition(currentUser.id, updatedSharedPosition);
            return success;
          }
        }
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

          if (position.ownerId === currentUser.id && position.shared && position.sharedWith?.length > 0) {
            publishChange('POSITION_UPDATED', position, {
              updatedAt: position.updatedAt
            });
          }
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
    loadPositions,
    checkForUpdates,
    syncPosition
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