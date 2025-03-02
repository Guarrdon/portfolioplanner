// frontend/src/components/common/SyncAllButton.jsx
import React, { useState, useEffect } from 'react';
import { RefreshCw, Check } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { getPositionsWithChanges } from '../../utils/optimisticUpdates';

const SyncAllButton = () => {
  const { sharedStrategies, syncSharedPosition } = usePortfolio();
  const [hasUpdates, setHasUpdates] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncComplete, setSyncComplete] = useState(false);
  const [positionsToSync, setPositionsToSync] = useState([]);

  // Check if there are any updates available
  useEffect(() => {
    const checkForUpdates = () => {
      // Check for positions with unsaved changes
      const positionsWithChanges = getPositionsWithChanges();
      
      // Check for shared positions that need synchronization
      // (rather than ALL shared positions)
      const sharedPositionsNeedingSync = Object.values(sharedStrategies)
        .flat()
        .filter(position => {
          // Filter for positions that actually need sync
          // 1. Never synced positions (no lastSyncedAt)
          // 2. Positions not synced recently (could add a threshold here)
          return !position.lastSyncedAt;
        })
        .map(position => position.id);
      
      // Combine and deduplicate
      const syncNeeded = [...new Set([...positionsWithChanges, ...sharedPositionsNeedingSync])];
      
      setPositionsToSync(syncNeeded);
      setHasUpdates(syncNeeded.length > 0);
    };

    checkForUpdates();
    
    // Check for updates periodically
    const interval = setInterval(checkForUpdates, 30000);
    return () => clearInterval(interval);
  }, [sharedStrategies]);

  const handleSyncAll = async () => {
    if (syncing || positionsToSync.length === 0) return;
    
    setSyncing(true);
    setSyncComplete(false);
    
    try {
      // Sync each position
      const syncPromises = positionsToSync.map(positionId => 
        syncSharedPosition(positionId)
      );
      
      // Wait for all syncs to complete
      await Promise.all(syncPromises);
      
      // Show success state briefly
      setSyncComplete(true);
      setPositionsToSync([]);
      setTimeout(() => {
        setSyncComplete(false);
        setHasUpdates(false);
      }, 3000);
    } catch (error) {
      console.error('Error syncing all positions:', error);
    } finally {
      setSyncing(false);
    }
  };

  if (!hasUpdates) return null;

  return (
    <button
      onClick={handleSyncAll}
      disabled={syncing}
      className={`
        flex items-center justify-center px-4 py-2 border rounded-md text-sm font-medium
        ${syncComplete 
          ? 'bg-green-100 border-green-300 text-green-800'
          : 'bg-purple-100 border-purple-300 text-purple-800 hover:bg-purple-200'}
        transition-colors duration-300
      `}
    >
      {syncing ? (
        <>
          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          <span>Syncing {positionsToSync.length} {positionsToSync.length === 1 ? 'Position' : 'Positions'}...</span>
        </>
      ) : syncComplete ? (
        <>
          <Check className="w-4 h-4 mr-2" />
          <span>All Synced!</span>
        </>
      ) : (
        <>
          <RefreshCw className="w-4 h-4 mr-2" />
          <span>Sync {positionsToSync.length} {positionsToSync.length === 1 ? 'Position' : 'Positions'}</span>
        </>
      )}
    </button>
  );
};

export default SyncAllButton;