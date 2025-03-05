// src/components/common/SyncIndicator.jsx
import React from 'react';
import { RefreshCw } from 'lucide-react';

// This component receives position and sync function as props
const SyncIndicator = ({ position, onSync }) => {
  if (!position.hasAvailableUpdates) return null;
  
  return (
    <button
      onClick={() => onSync(position.id)}
      className="inline-flex items-center px-2 py-1 rounded text-xs bg-blue-100 text-blue-700"
    >
      <RefreshCw className="h-3.5 w-3.5 mr-1" />
      <span>Update Available</span>
    </button>
  );
};

export default SyncIndicator;