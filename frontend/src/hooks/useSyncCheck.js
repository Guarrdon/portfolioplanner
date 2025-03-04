// frontend/src/hooks/useSyncCheck.js
import { useState, useEffect, useCallback } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useUser } from '../contexts/UserContext';

/**
 * Custom hook to periodically check for position updates
 * @param {number} initialDelayMs - Initial delay before first check (default: 1000ms)
 * @param {number} intervalMs - Interval between checks (default: 60000ms = 1 minute)
 * @returns {object} - Sync check state and control methods
 */
export const useSyncCheck = (initialDelayMs = 1000, intervalMs = 60000) => {
  const { checkForSharedPositionUpdates } = usePortfolio();
  const { currentUser } = useUser();
  const [positionsNeedingUpdate, setPositionsNeedingUpdate] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);
  const [error, setError] = useState(null);

  // Perform a check
  const performCheck = useCallback(async () => {
    // Don't run if no user logged in
    if (!currentUser?.id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const updates = await checkForSharedPositionUpdates();
      setPositionsNeedingUpdate(updates);
      setLastChecked(new Date());
      return updates;
    } catch (err) {
      setError(err.message || 'Error checking for updates');
      console.error('Sync check error:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, checkForSharedPositionUpdates]);

  // Initial check on login + periodic checks
  // Memoize the performCheck function to avoid dependency issues
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