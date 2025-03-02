// frontend/src/components/common/SyncNotification.jsx
import React, { useState, useEffect } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { RefreshCw, X, ArrowRight } from 'lucide-react';

const SyncNotification = () => {
  const { checkForSharedPositionUpdates, syncSharedPosition } = usePortfolio();
  const [showNotification, setShowNotification] = useState(false);
  const [positionsNeedingUpdate, setPositionsNeedingUpdate] = useState([]);
  const [dismissed, setDismissed] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    // Check for positions that need sync
    const checkForUpdates = async () => {
      // Get positions that need updates
      const updates = await checkForSharedPositionUpdates();
      setPositionsNeedingUpdate(updates);
      
      // Only show notification if:
      // 1. There are positions needing updates
      // 2. User hasn't dismissed it
      setShowNotification(updates.length > 0 && !dismissed);
    };

    // Wait a moment after component mount to check (gives time for data to load)
    const timer = setTimeout(checkForUpdates, 3000);
    return () => clearTimeout(timer);
  }, [checkForSharedPositionUpdates, dismissed]);

  // Handle sync all action
  const handleSyncAll = async () => {
    if (processing) return;
    
    setProcessing(true);
    try {
      // Get all position IDs that need updates
      const positionIds = positionsNeedingUpdate.map(p => p.id);
      
      // Sync each position
      let successCount = 0;
      for (const positionId of positionIds) {
        const success = await syncSharedPosition(positionId);
        if (success) successCount++;
      }
      
      // Close notification after sync
      setDismissed(true);
      setShowNotification(false);
      
      // Show success feedback (in a real app, this would be a toast notification)
      console.log(`Successfully synced ${successCount} of ${positionIds.length} positions`);
    } catch (error) {
      console.error('Error syncing all positions:', error);
    } finally {
      setProcessing(false);
    }
  };

  // Don't render if there's nothing to show
  if (!showNotification) return null;

  return (
    <div className="fixed bottom-4 right-4 max-w-md bg-white rounded-lg shadow-lg border border-blue-200 p-4 z-50 animate-fade-in">
      <div className="flex items-start">
        <div className="flex-shrink-0 pt-0.5">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-500">
            <RefreshCw className="h-5 w-5" />
          </div>
        </div>
        
        <div className="ml-3 flex-1">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Updates Available
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {positionsNeedingUpdate.length} shared {positionsNeedingUpdate.length === 1 ? 'position has' : 'positions have'} updates available
              </p>
            </div>
            
            <button
              onClick={() => {
                setDismissed(true);
                setShowNotification(false);
              }}
              className="bg-white rounded-md text-gray-400 hover:text-gray-500 focus:outline-none"
            >
              <span className="sr-only">Dismiss</span>
              <X className="h-5 w-5" />
            </button>
          </div>
          
          <div className="mt-3 flex justify-end space-x-3">
            <button
              onClick={handleSyncAll}
              disabled={processing}
              className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  Sync All
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SyncNotification;