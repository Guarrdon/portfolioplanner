// frontend/src/components/positions/UnsyncedChangesBadge.jsx
import React from 'react';
import { AlertCircle, Clock } from 'lucide-react';

/**
 * Displays a badge indicating a position has unsynchronized changes
 * @param {Object} props
 * @param {Object} props.changes - Object containing change information
 * @param {string} props.lastSyncedAt - ISO timestamp of last sync
 * @param {boolean} props.isOwner - Whether current user is position owner
 */
const UnsyncedChangesBadge = ({ changes, lastSyncedAt, isOwner }) => {
  // Don't show anything if no changes
  if (!changes || Object.keys(changes).length === 0) {
    return null;
  }

  // Format the time since last sync
  const getTimeSinceSync = () => {
    if (!lastSyncedAt) return 'Never synced';
    
    const lastSync = new Date(lastSyncedAt);
    const now = new Date();
    const diffInMinutes = Math.floor((now - lastSync) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d ago`;
  };

  // Calculate some metrics about the changes
  const changeCount = Object.values(changes).reduce((sum, val) => 
    sum + (Array.isArray(val) ? val.length : 1), 0);

  return (
    <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium 
      ${isOwner ? 'bg-amber-100 text-amber-800' : 'bg-purple-100 text-purple-800'}`}
    >
      <AlertCircle className="w-3.5 h-3.5 mr-1" />
      <span>{changeCount} unsaved {changeCount === 1 ? 'change' : 'changes'}</span>
      <span className="mx-1 text-gray-400">•</span>
      <Clock className="w-3 h-3 mr-1" />
      <span>{getTimeSinceSync()}</span>
    </div>
  );
};

export default UnsyncedChangesBadge;