// frontend/src/components/positions/SharedPositionBadge.jsx
import React from 'react';
import { Share2, UserCircle } from 'lucide-react';
import { useUser } from '../../contexts/UserContext';

const SharedPositionBadge = ({ position }) => {
  const { currentUser } = useUser();
  
  // Not shared at all
  if (!position.shared) {
    return null;
  }

  const isOwner = position.ownerId === currentUser?.id;
  
  // Position owner viewing their shared position
  if (isOwner) {
    return (
      <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">
        <Share2 className="w-3.5 h-3.5 mr-1" />
        <span>Shared</span>
      </div>
    );
  } 
  
  // User viewing a position shared with them
  return (
    <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800">
      <UserCircle className="w-3.5 h-3.5 mr-1" />
      <span>
        Shared by {position.sharedBy?.name || 'Unknown'}
      </span>
    </div>
  );
};

export default SharedPositionBadge;