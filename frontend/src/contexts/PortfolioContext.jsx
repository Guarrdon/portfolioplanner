import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { useUser } from './UserContext';
import { userStorage } from '../utils/storage/storage';
import {
  createActivityEntry,
  addActivityToPosition,

} from '../utils/activityTracking';
import { clearChanges } from '../utils/optimisticUpdates';
import { publishChange } from '../utils/changePublisher';
import {
  consumeChanges,
  hasUpdatesForPosition,
  getChangesForPosition
} from '../utils/changeConsumer';

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

// Function Definitions
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

const standardizeStrategy = (strategyName) => STRATEGY_MAPPING[strategyName] || strategyName;

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

      const groupedPositions = positions.reduce((acc, position) => {
        const strategy = standardizeStrategy(position.strategy);
        if (!acc[strategy]) acc[strategy] = [];
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
      };

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
    if (!userId) return;

    try {
      dispatch({ type: 'SET_LOADING', payload: true });

      const ownedPositions = await userStorage.getOwnedPositions(userId);
      const sharedPositions = await userStorage.getSharedPositions(userId);

      dispatch({
        type: 'LOAD_OWNED_POSITIONS',
        payload: {
          userId,
          positions: ownedPositions || [],
          timestamp: Date.now()
        }
      });

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

    if (mounted) {
      loadPositions();
    }

    return () => {
      mounted = false;
    };
  }, [userId, loadPositions]);

  const checkForUpdates = useCallback(() => {
    if (!currentUser?.id) return;

    const pendingChanges = consumeChanges(currentUser.id);

    pendingChanges.forEach(change => {
      if (change.type === 'POSITION_UPDATED') {
        const positionsToCheck = state.shared || [];
        const positionToUpdate = positionsToCheck.find(p =>
          p.originalId === change.positionId && p.ownerId === change.ownerId
        );

        if (positionToUpdate) {
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

        const initialActivity = {
          id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'position_created',
          userId: currentUser.id,
          userName: currentUser.displayName || 'User',
          timestamp: new Date().toISOString()
        };

        enrichedPosition.activityLog.push(initialActivity);

        const existingPositions = userStorage.getOwnedPositions(currentUser.id);

        const updatedPositions = [...existingPositions, enrichedPosition];

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
  
    checkForSharedPositionUpdates: async (userId) => {
      if (!userId) return [];
    
      try {
        const sharedPositions = userStorage.getSharedPositions(userId) || [];
    
        const positionsNeedingUpdate = [];
    
        for (const sharedPosition of sharedPositions) {
          if (!sharedPosition.originalId || !sharedPosition.ownerId) {
            continue;
          }
    
          const hasUpdates = hasUpdatesForPosition(userId, sharedPosition.originalId);
          if (hasUpdates) {
            positionsNeedingUpdate.push({
              id: sharedPosition.id,
              originalId: sharedPosition.originalId,
              symbol: sharedPosition.symbol,
              lastSyncedAt: sharedPosition.lastSyncedAt
            });
          }
        }
    
        return positionsNeedingUpdate;
      } catch (error) {
        console.error('Error checking for shared position updates:', error);
        return [];
      }
    },
    
    addSharedPosition: async (position) => {
      if (!currentUser?.id) return false;

      try {
        const sharedPositions = userStorage.getSharedPositions(currentUser.id) || [];

        if (sharedPositions.some(p => p.id === position.id)) {
          return true;
        }

        const updatedPositions = [...sharedPositions, {
          ...position,
          shared: true,
          receivedAt: new Date().toISOString(),
          activityLog: position.activityLog || []
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
    syncAllSharedPositions: async (checkOnly = false) => {
      if (!currentUser?.id) return 0;
      
      try {
        const sharedPositions = [];
        Object.values(state.sharedStrategies).forEach(strategyPositions => {
          sharedPositions.push(...strategyPositions);
        });
        
        const positionsWithUpdates = [];
        for (const position of sharedPositions) {
          if (position.ownerId !== currentUser.id && position.originalId) {
            const hasUpdates = hasUpdatesForPosition(currentUser.id, position.originalId);
            if (hasUpdates) {
              positionsWithUpdates.push(position);
            }
          }
        }
        
        if (checkOnly) {
          return positionsWithUpdates.length;
        }
        
        for (const position of positionsWithUpdates) {
          await value.syncSharedPosition(position.id);
        }
        
        return positionsWithUpdates.length;
      } catch (error) {
        console.error('Error in syncAllSharedPositions:', error);
        return 0;
      }
    },

    updatePosition: (position) => {
      if (!currentUser?.id) return false;
    
      try {
        const isOwned = position.ownerId === currentUser.id;
    
        const originalPosition = value.getPositionById(position.id);
    
        if (!originalPosition) {
          throw new Error('Position not found');
        }
    
        const changedFields = [];
        let updatedPosition = { ...position };
    
        if (!Array.isArray(updatedPosition.activityLog)) {
          updatedPosition.activityLog = [];
        }
    
        if (isOwned) {
          const originalTags = originalPosition.tags || [];
          const newTags = updatedPosition.tags || [];
    
          const addedTags = newTags.filter(tag => !originalTags.includes(tag));
          const removedTags = originalTags.filter(tag => !newTags.includes(tag));
    
          addedTags.forEach(tag => {
            // Create new tag activity entry
            const tagActivity = createActivityEntry('tag_added', currentUser, { tag });
            updatedPosition = addActivityToPosition(updatedPosition, tagActivity);
            changedFields.push(`Added tag "${tag}"`);
          });
    
          removedTags.forEach(tag => {
            // Create tag removed activity entry
            const tagActivity = createActivityEntry('tag_removed', currentUser, { tag });
            updatedPosition = addActivityToPosition(updatedPosition, tagActivity);
            changedFields.push(`Removed tag "${tag}"`);
          });
    
          const originalCommentIds = new Set((originalPosition.comments || []).map(c => c.id));
          const newComments = (updatedPosition.comments || []).filter(c => !originalCommentIds.has(c.id));
    
          newComments.forEach(comment => {
            // Create comment activity entry
            const commentActivity = createActivityEntry('comment_added', currentUser, { text: comment.text });
            updatedPosition = addActivityToPosition(updatedPosition, commentActivity);
            changedFields.push('Added comment');
          });
    
          const coreFields = ['symbol', 'account', 'legs'];
          const changedCoreFields = coreFields.filter(field =>
            JSON.stringify(originalPosition[field]) !== JSON.stringify(updatedPosition[field])
          );
    
          if (changedCoreFields.length > 0) {
            // Create position edited activity
            const editActivity = createActivityEntry('position_edited', currentUser, { fields: changedCoreFields });
            updatedPosition = addActivityToPosition(updatedPosition, editActivity);
            changedFields.push(...changedCoreFields.map(field => `Changed ${field}`));
          }
        }
    
        // Set updatedAt timestamp
        updatedPosition.updatedAt = new Date().toISOString();
    
        if (isOwned) {
          validatePosition(updatedPosition);
          userStorage.saveOwnedPosition(currentUser.id, updatedPosition);
    
          // Publish changes if this is a shared position and there are recipients
          if (updatedPosition.shared && updatedPosition.sharedWith?.length > 0 && changedFields.length > 0) {
            publishChange('POSITION_UPDATED', updatedPosition, {
              updatedAt: updatedPosition.updatedAt,
              changedFields, // Include specific changes for better tracking
              changelog: updatedPosition.activityLog?.slice(-1)[0] // Include the latest activity log entry
            }, currentUser.id); // Pass current user ID as the publisher
          }
          
          const ownedPositions = userStorage.getOwnedPositions(currentUser.id);
          dispatch({
            type: 'LOAD_OWNED_POSITIONS',
            payload: { userId: currentUser.id, positions: ownedPositions }
          });
        } else {
          // This is a shared position the user has received
          // Record changes to be synced back to the original owner
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
    
          // Publish changes back to the owner
          if (changedFields.length > 0) {
            publishChange('SHARED_POSITION_UPDATED', updatedPosition, {
              updatedAt: updatedPosition.updatedAt,
              changedFields,
              changelog: updatedPosition.activityLog?.slice(-1)[0]
            }, currentUser.id); // Pass current user ID as the publisher
          }
    
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
        // Owner syncing their own position - this is for handling updates from shared users
        console.log(`Owner syncing position ${sharedPositionId}`);
        
        // Get all changes made to this position by shared users
        const changes = getChangesForPosition(currentUser.id, sharedPosition.id);
        
        // If no changes, nothing to do
        if (changes.length === 0) {
          console.log('No changes to sync');
          return true;
        }
        
        // Apply changes from shared users
        for (const change of changes) {
          if (change.type === 'SHARED_POSITION_UPDATED') {
            // Handle updates from shared users
            console.log(`Processing change from shared user: ${change.publisherId}`);
            
            // Look up the shared user's copy of the position
            const sharedCopies = userStorage.getSharedPositions(change.publisherId) || [];
            const userCopy = sharedCopies.find(p => p.originalId === sharedPosition.id);
            
            if (userCopy) {
              // Typically we'd just want to sync comments, tags and other non-structural changes
              // from shared users
              
              // Merge comments from the shared user
              const sharedUserComments = (userCopy.comments || [])
                .filter(comment => comment.userId === change.publisherId);
                
              const ownerComments = sharedPosition.comments || [];
              
              // Add comments that don't already exist in owner's position
              const newComments = sharedUserComments.filter(comment => 
                !ownerComments.some(c => c.id === comment.id)
              );
              
              if (newComments.length > 0) {
                const updatedComments = [...ownerComments, ...newComments];
                
                // Update the owner's position
                const updatedPosition = {
                  ...sharedPosition,
                  comments: updatedComments,
                  lastSyncedAt: new Date().toISOString()
                };
                
                // Save to storage
                userStorage.saveOwnedPosition(currentUser.id, updatedPosition);
                
                // Log the sync activity
                const activity = {
                  id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                  type: 'sync_performed',
                  userId: currentUser.id,
                  userName: currentUser.displayName || 'User',
                  timestamp: new Date().toISOString(),
                  data: {
                    changeCount: newComments.length,
                    fromUser: change.publisherId
                  }
                };
                
                updatedPosition.activityLog = [
                  ...(updatedPosition.activityLog || []),
                  activity
                ];
                
                userStorage.saveOwnedPosition(currentUser.id, updatedPosition);
              }
            }
          }
        }
        
        const ownedPositions = userStorage.getOwnedPositions(currentUser.id);
        dispatch({
          type: 'LOAD_OWNED_POSITIONS',
          payload: { userId: currentUser.id, positions: ownedPositions }
        });
        
        return true;
      } else {
        // Shared user syncing with original owner's copy
        console.log(`Shared user syncing position ${sharedPositionId}`);
        
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

        // Simple merge - keep local comments and tags, take everything else from original
        const localComments = sharedPosition.comments?.filter(comment => 
          comment.userId === currentUser.id
        ) || [];
        
        const originalComments = originalPosition.comments || [];
        
        // Merge comments - original first, then local
        const mergedComments = [...originalComments];
        localComments.forEach(comment => {
          if (!mergedComments.some(c => c.id === comment.id)) {
            mergedComments.push(comment);
          }
        });
        
        // Create the updated position
        const updatedPosition = {
          ...originalPosition,
          id: sharedPosition.id,
          userId: currentUser.id,
          shared: true,
          originalId: sharedPosition.originalId,
          ownerId: sharedPosition.ownerId,
          sharedAt: sharedPosition.sharedAt,
          sharedBy: sharedPosition.sharedBy,
          comments: mergedComments,
          lastSyncedAt: new Date().toISOString()
        };
        
        // Add a sync activity
        const activity = {
          id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'sync_performed',
          userId: currentUser.id,
          userName: currentUser.displayName || 'User',
          timestamp: new Date().toISOString(),
          data: {
            changeCount: 1
          }
        };
        
        updatedPosition.activityLog = [
          ...(updatedPosition.activityLog || []),
          activity
        ];

        // Save updated position
        const success = userStorage.saveSharedPosition(currentUser.id, updatedPosition);
        
        // Mark changes as processed
        if (success) {
          clearChanges(sharedPositionId);
          
          // IMPORTANT FIX: Also mark any published changes from the owner as processed
          // This ensures the "Update Available" notification disappears after syncing
          const allChanges = JSON.parse(localStorage.getItem('pendingChanges') || '[]');
          const updatedChanges = allChanges.map(change => {
            // Check if this change is for the original position and targeted at current user
            if ((change.positionId === sharedPosition.originalId || 
                 change.originalId === sharedPosition.originalId) && 
                change.recipients.includes(currentUser.id) &&
                !change.processed.includes(currentUser.id)) {
                  
              return {
                ...change,
                processed: [...change.processed, currentUser.id]
              };
            }
            return change;
          });
          
          // Save the updated changes back to storage
          localStorage.setItem('pendingChanges', JSON.stringify(updatedChanges));
          
          const sharedPositions = userStorage.getSharedPositions(currentUser.id);
          dispatch({
            type: 'LOAD_SHARED_POSITIONS',
            payload: { userId: currentUser.id, positions: sharedPositions }
          });
        }

        return success;
      }
    } catch (error) {
      console.error('Error syncing shared position:', error);
      return false;
    }
  },    
    calculatePositionMetrics,
    validatePosition,
    
    getStrategyPositions: (strategyType) => {
      const standardizedType = standardizeStrategy(strategyType);
      const ownedPositions = state.ownedStrategies[standardizedType] || [];
      const sharedPositions = state.sharedStrategies[standardizedType] || [];

      const positionMap = new Map();

      ownedPositions.forEach(position => {
        positionMap.set(position.id, { ...position, owned: true });
      });

      sharedPositions.forEach(position => {
        if (!positionMap.has(position.id)) {
          positionMap.set(position.id, { ...position, shared: true });
        }
      });

      return Array.from(positionMap.values());
    },
    
    getPositionById: (id) => {
      for (const strategy of Object.values(state.ownedStrategies)) {
        const position = strategy.find(p => p.id === id);
        if (position) return { ...position, owned: true };
      }

      for (const strategy of Object.values(state.sharedStrategies)) {
        const position = strategy.find(p => p.id === id);
        if (position) return { ...position, shared: true };
      }

      return null;
    },
    
    getSharedPositionUpdates: (positionId) => {
      if (!currentUser?.id) return [];

      try {
        const ownedPosition = value.getPositionById(positionId);
        if (!ownedPosition || ownedPosition.ownerId !== currentUser.id) {
          return [];
        }

        const updatesFromShared = [];

        const allUsers = JSON.parse(localStorage.getItem(userStorage.STORAGE_KEYS.USERS) || '[]');

        allUsers.forEach(user => {
          if (user.id === currentUser.id) return;

          const sharedPositions = userStorage.getSharedPositions(user.id) || [];
          const sharedCopy = sharedPositions.find(p => p.originalId === positionId);

          if (sharedCopy) {
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

    loadPositions,
    checkForUpdates
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