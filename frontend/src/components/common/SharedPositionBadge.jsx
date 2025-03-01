import React from 'react';
import { Share2, UserCircle, Users, Clock } from 'lucide-react'; // Added Clock icon
import { useUser } from '../../contexts/UserContext';
import { useFriends } from '../../contexts/FriendsContext';
import { formatDistanceToNow } from 'date-fns'; // Import from date-fns

const SharedPositionBadge = ({ position }) => {
  const { currentUser } = useUser();
  const { getFriendDetails } = useFriends();
  
  // Not shared at all
  if (!position.shared) {
    return null;
  }

  // console.log('Badge Display Data:', {
  //   shared: position.shared,
  //   ownerId: position.ownerId,
  //   currentUserId: currentUser?.id,
  //   sharedWith: position.sharedWith,
  //   sharedCount: position.sharedWith?.length || 0
  // });

  const isOwner = position.ownerId === currentUser?.id;
  
  // Format the time since last sync
  const formatTimeAgo = (dateString) => {
    if (!dateString) return 'Never';
    try {
      return formatDistanceToNow(new Date(dateString), { addSuffix: true });
    } catch (e) {
      return 'Unknown';
    }
  };


  // Position owner viewing their shared position
  if (isOwner) {
    const sharedWithCount = position.sharedWith?.length || 0;
    return (
      <div className="relative inline-flex items-center px-2.5 py-0.5 rounded-full text-sm bg-amber-50 text-amber-700 group">
        <Share2 className="w-3.5 h-3.5 mr-1" />
        <span>Shared</span>
        {sharedWithCount > 0 && (
          <span className="ml-1 flex items-center">
            <Users className="w-3.5 h-3.5 mr-1" />
            {sharedWithCount}
          </span>
        )}
        
        {/* Hover tooltip */}
        <div className="hidden group-hover:block absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap z-10">
          <div>Owner: {position.sharedBy?.name || currentUser.displayName}</div>
          <div>Shared: {formatTimeAgo(position.sharedAt)}</div>
          {position.sharedWith && (
            <div>
              Shared with:
              <ul className="mt-1">
                {position.sharedWith.slice(0, 3).map(userId => {
                  const friend = getFriendDetails(userId);
                  return (
                    <li key={userId}>{friend?.displayName || 'Unknown User'}</li>
                  );
                })}
                {position.sharedWith.length > 3 && <li>...</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  // User viewing a position shared with them
  return (
    <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm bg-purple-100 text-purple-800 group relative">
      <UserCircle className="w-3.5 h-3.5 mr-1" />
      <span>
        Shared by {position.sharedBy?.name || 'Unknown'}
      </span>
      
      {/* Add last synced indicator */}
      <div className="ml-2 text-xs flex items-center text-purple-600">
        <Clock className="w-3 h-3 mr-1" />
        <span>Synced {formatTimeAgo(position.lastSyncedAt || position.sharedAt)}</span>
      </div>
      
      <div className="hidden group-hover:block absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap z-10">
        <div>Shared on {new Date(position.sharedAt || position.createdAt).toLocaleDateString()}</div>
        <div>Last synced {new Date(position.lastSyncedAt || position.sharedAt).toLocaleDateString()}</div>
        <div>Original owner: {position.sharedBy?.name || 'Unknown'}</div>
      </div>
    </div>
  );
};

export default SharedPositionBadge;