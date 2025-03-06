// frontend/src/components/common/SyncAllButton.jsx
import React, { useState, useEffect } from 'react';
import { RefreshCw, Check } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useUser } from '../../contexts/UserContext';

const SyncAllButton = () => {
  const { syncAllSharedPositions } = usePortfolio();
  const [syncing, setSyncing] = useState(false);
  const [syncComplete, setSyncComplete] = useState(false);
  const [hasUpdates, setHasUpdates] = useState(false);
  const { currentUser } = useUser();

  // Check if there are any positions that need syncing
  useEffect(() => {
    const checkForUpdates = async () => {
      if (!currentUser?.id) return;
      
      const updates = await syncAllSharedPositions(true); // Just check, don't sync
      setHasUpdates(updates > 0);
    };
    
    checkForUpdates();
  }, [currentUser?.id, syncAllSharedPositions]);

  const handleSyncAll = async () => {
    if (syncing) return;
    
    setSyncing(true);
    setSyncComplete(false);
    
    try {
      await syncAllSharedPositions();
      
      // Show success state briefly
      setSyncComplete(true);
      setHasUpdates(false);
      setTimeout(() => {
        setSyncComplete(false);
      }, 3000);
    } catch (error) {
      console.error('Error syncing positions:', error);
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
          : 'bg-blue-100 border-blue-300 text-blue-800 hover:bg-blue-200'}
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
          <span>Sync All Updates</span>
        </>
      )}
    </button>
  );
};

export default SyncAllButton;