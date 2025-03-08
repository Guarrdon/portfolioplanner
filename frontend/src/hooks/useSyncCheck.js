// frontend/src/hooks/useSyncCheck.js
import { useState, useEffect, useCallback } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useUser } from '../contexts/UserContext';
import { getPositionsWithChanges } from '../utils/optimisticUpdates';

/**
 * Custom hook to periodically check for position updates
 * @param {number} initialDelayMs - Initial delay before first check (default: 1000ms)
 * @param {number} intervalMs - Interval between checks (default: 60000ms = 1 minute)
 * @returns {object} - Sync check state and control methods
 */
export const useSyncCheck = (initialDelayMs = 1000, intervalMs = 60000) => {
  const { checkForSharedPositionUpdates, ownedStrategies, sharedStrategies } = usePortfolio();
  const { currentUser } = useUser();
  const [positionsNeedingUpdate, setPositionsNeedingUpdate] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);
  const [error, setError] = useState(null);

  // Perform a check for remote updates
  const performCheck = useCallback(async () => {
    // Don't run if no user logged in
    if (!currentUser?.id) return [];
    
    setLoading(true);
    setError(null);
    
    try {
      // First check for remote updates (from API or shared positions)
      const remoteUpdates = await checkForSharedPositionUpdates(currentUser.id);
      
      // Then check for positions with hasAvailableUpdates flag
      const allPositions = [];
      
      // Check shared positions
      Object.values(sharedStrategies).forEach(strategyPositions => {
        strategyPositions.forEach(position => {
          if (position.hasAvailableUpdates === true && 
              position.ownerId !== currentUser.id) {
            allPositions.push({
              id: position.id,
              originalId: position.originalId,
              symbol: position.symbol,
              lastSyncedAt: position.lastSyncedAt,
              updateType: 'owner_update'
            });
          }
        });
      });
      
      // Check owned positions for updates from shared users
      Object.values(ownedStrategies).forEach(strategyPositions => {
        strategyPositions.forEach(position => {
          if (position.shared && 
              position.hasSharedUserUpdates === true && 
              position.ownerId === currentUser.id) {
            allPositions.push({
              id: position.id,
              symbol: position.symbol,
              lastSyncedAt: position.lastSyncedAt,
              updateType: 'shared_user_update'
            });
          }
        });
      });
      
      // Also check for positions with unsaved local changes
      const positionsWithLocalChanges = getPositionsWithChanges().map(positionId => {
        // Find the position with this ID
        let foundPosition = null;
        
        // Check in shared positions
        for (const strategyPositions of Object.values(sharedStrategies)) {
          foundPosition = strategyPositions.find(p => p.id === positionId);
          if (foundPosition) break;
        }
        
        // Check in owned positions if not found
        if (!foundPosition) {
          for (const strategyPositions of Object.values(ownedStrategies)) {
            foundPosition = strategyPositions.find(p => p.id === positionId);
            if (foundPosition) break;
          }
        }
        
        if (foundPosition) {
          return {
            id: foundPosition.id,
            originalId: foundPosition.originalId,
            symbol: foundPosition.symbol,
            lastSyncedAt: foundPosition.lastSyncedAt,
            updateType: 'local_changes'
          };
        }
        
        return null;
      }).filter(Boolean);
      
      // Combine all sources of updates, removing duplicates by ID
      const combinedUpdates = [...remoteUpdates, ...allPositions, ...positionsWithLocalChanges];
      const uniqueUpdates = Array.from(new Map(combinedUpdates.map(update => [update.id, update])).values());
      
      setPositionsNeedingUpdate(uniqueUpdates);
      setLastChecked(new Date());
      return uniqueUpdates;
    } catch (err) {
      setError(err.message || 'Error checking for updates');
      console.error('Sync check error:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, checkForSharedPositionUpdates, ownedStrategies, sharedStrategies]);

  // Initial check on login + periodic checks
  useEffect(() => {
    // Reset state when user changes
    setPositionsNeedingUpdate([]);
    setLastChecked(null);
    setError(null);
    
    // Don't proceed if no user is logged in
    if (!currentUser?.id) return;
    
    // Initial check after short delay (wait for position data to load)
    const initialTimer = setTimeout(() => {
      performCheck();
    }, initialDelayMs);
    
    // Set up periodic checks
    const intervalId = setInterval(() => {
      performCheck();
    }, intervalMs);
    
    // Clean up timers on unmount or user change
    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
    };
  }, [currentUser?.id, initialDelayMs, intervalMs, performCheck]);

  return {
    positionsNeedingUpdate,
    loading,
    lastChecked,
    error,
    performCheck,
    hasUpdates: positionsNeedingUpdate.length > 0
  };
};

export default useSyncCheck;