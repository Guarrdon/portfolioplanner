// frontend/src/components/positions/SyncStatusBadge.jsx
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { hasUpdatesForPosition } from '../../utils/changeConsumer';
import { useUser } from '../../contexts/UserContext';

/**
 * Simplified badge that only shows when updates are available
 */
const SyncStatusBadge = ({ position, onSync }) => {
  const { currentUser } = useUser();
  
  // Only show for shared positions where the current user is NOT the owner
  if (!position.shared || position.ownerId === currentUser?.id) {
    return null;
  }
  
  // Check if there are updates available
  const hasUpdates = hasUpdatesForPosition(currentUser?.id, position.originalId);
  
  if (!hasUpdates) {
    return null;
  }
  
  return (
    <button
      onClick={onSync}
      className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
    >
      <RefreshCw className="w-3.5 h-3.5 mr-1" />
      <span>Update Available</span>
    </button>
  );
};

export default SyncStatusBadge;