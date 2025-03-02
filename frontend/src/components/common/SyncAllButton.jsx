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

  // Check if there are any updates available
  useEffect(() => {
    const checkForUpdates = () => {
      // Check for positions with unsaved changes
      const positionsWithChanges = getPositionsWithChanges();
      
      // Check for any shared positions (for initial sync)
      const sharedPositionCount = Object.values(sharedStrategies)
        .reduce((count, positions) => count + positions.length, 0);
        
      setHasUpdates(positionsWithChanges.length > 0 || sharedPositionCount > 0);
    };

    checkForUpdates();
    
    // Check for updates periodically
    const interval = setInterval(checkForUpdates, 30000);
    return () => clearInterval(interval);
  }, [sharedStrategies]);

  const handleSyncAll = async () => {
    if (syncing) return;
    
    setSyncing(true);
    setSyncComplete(false);
    
    try {
      // Get all positions with unsaved changes
      const positionsWithChanges = getPositionsWithChanges();
      
      // Get all shared positions
      const allSharedPositions = Object.values(sharedStrategies)
        .flat()
        .map(position => position.id);
      
      // Combine and deduplicate
      const positionsToSync = [...new Set([...positionsWithChanges, ...allSharedPositions])];
      
      // Sync each position
      const syncPromises = positionsToSync.map(positionId => 
        syncSharedPosition(positionId)
      );
      
      // Wait for all syncs to complete
      await Promise.all(syncPromises);
      
      // Show success state briefly
      setSyncComplete(true);
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
          <span>Syncing...</span>
        </>
      ) : syncComplete ? (
        <>
          <Check className="w-4 h-4 mr-2" />
          <span>All Synced!</span>
        </>
      ) : (
        <>
          <RefreshCw className="w-4 h-4 mr-2" />
          <span>Sync All Positions</span>
        </>
      )}
    </button>
  );
};

export default SyncAllButton;