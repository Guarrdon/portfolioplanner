// frontend/src/components/positions/SyncStatusBadge.jsx
import React from 'react';
import { RefreshCw, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { hasUnsavedChanges } from '../../utils/optimisticUpdates';

/**
 * Displays the sync status of a shared position
 * @param {Object} props
 * @param {Object} props.position - The position to display status for
 */
const SyncStatusBadge = ({ position }) => {
  // Return early if this isn't a shared position
  if (!position || !position.shared) {
    return null;
  }

  // Check for local changes
  const hasLocalChanges = hasUnsavedChanges(position.id);
  
  // Calculate sync status
  const getSyncStatus = () => {
    if (hasLocalChanges) {
      return { 
        status: 'unsynced',
        label: 'Unsynced Changes',
        Icon: AlertTriangle,
        className: 'bg-amber-100 text-amber-800'
      };
    }
    
    if (!position.lastSyncedAt) {
      return {
        status: 'never',
        label: 'Never Synced',
        Icon: Clock,
        className: 'bg-gray-100 text-gray-800'
      };
    }
    
    // Check how recent the sync is
    const lastSync = new Date(position.lastSyncedAt);
    const now = new Date();
    const hoursSinceSync = (now - lastSync) / (1000 * 60 * 60);
    
    if (hoursSinceSync < 24) {
      return {
        status: 'recent',
        label: 'Recently Synced',
        Icon: CheckCircle,
        className: 'bg-green-100 text-green-800'
      };
    }
    
    if (hoursSinceSync < 168) { // 7 days
      return {
        status: 'stale',
        label: 'Sync Needed',
        Icon: RefreshCw,
        className: 'bg-blue-100 text-blue-800'
      };
    }
    
    return {
      status: 'old',
      label: 'Outdated',
      Icon: AlertTriangle,
      className: 'bg-red-100 text-red-800'
    };
  };
  
  const { status, label, Icon, className } = getSyncStatus();
  
  return (
    <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      <Icon className="w-3 h-3 mr-1" />
      <span>{label}</span>
    </div>
  );
};

export default SyncStatusBadge;