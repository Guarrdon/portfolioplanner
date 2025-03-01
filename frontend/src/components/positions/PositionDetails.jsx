import React from 'react';
import { useUser } from '../../contexts/UserContext';
import { useFriends } from '../../contexts/FriendsContext';
import { Share2, UserCircle, Calendar, Users } from 'lucide-react';

const PositionDetails = ({ position }) => {
  const { currentUser } = useUser();
  const { getFriendDetails } = useFriends();

  const isOwner = position.ownerId === currentUser?.id;

  const formatValue = (key, value) => {
    if (value === null || value === undefined) return '-';
    
    if (typeof value === 'number') {
      if (['contracts', 'shares', 'quantity'].includes(key)) {
        return Math.round(value).toLocaleString();
      }
      
      if (key.toLowerCase().includes('strike')) {
        return value.toFixed(1);
      }
      
      return value.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD'
      });
    }

    if (key === 'sharedWith') {
      return Array.isArray(value) ? value.length : 0;
    }
    
    return value;
  };

  // Function to render the sharing section based on position ownership
  const renderSharingDetails = () => {
    if (!position.shared) return null;

    if (isOwner) {
      const sharedWithCount = position.sharedWith?.length || 0;
      return (
        <div className="col-span-2 border-t mt-4 pt-4">
          <h4 className="text-sm font-medium text-gray-900 mb-2 flex items-center">
            <Share2 className="h-4 w-4 text-gray-400 mr-2" />
            Sharing Details
          </h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Shared With</span>
              <span className="text-gray-900">{sharedWithCount} users</span>
            </div>
            {position.sharedWith?.map(userId => {
              const friend = getFriendDetails(userId);
              return (
                <div key={userId} className="flex items-center text-sm text-gray-600">
                  <UserCircle className="h-4 w-4 mr-2" />
                  {friend?.displayName || 'Unknown User'}
                </div>
              );
            })}
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Shared On</span>
              <span className="text-gray-900">
                {new Date(position.sharedAt || position.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      );
    } else {
      // Viewing a shared position
      return (
        <div className="col-span-2 border-t mt-4 pt-4">
          <h4 className="text-sm font-medium text-gray-900 mb-2 flex items-center">
            <Share2 className="h-4 w-4 text-gray-400 mr-2" />
            Shared Position
          </h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Shared By</span>
              <span className="text-gray-900">
                {position.sharedBy?.name || 'Unknown'}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Shared On</span>
              <span className="text-gray-900">
                {new Date(position.sharedAt || position.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Original Creation</span>
              <span className="text-gray-900">
                {new Date(position.originalCreatedAt || position.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      );
    }
  };

  return (
    <div className="mt-4">
      {/* Position Data Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {Object.entries(position)
          .filter(([key]) => !['id', 'createdAt', 'symbol', 'strategy', 'notes', 'tags', 'shared', 'sharedBy', 'sharedWith', 'ownerId', 'originalId', 'sharedAt', 'originalCreatedAt'].includes(key))
          .map(([key, value]) => (
            <div key={key} className="space-y-1">
              <dt className="text-xs font-medium text-gray-500 capitalize">
                {key.replace(/([A-Z])/g, ' $1').trim()}
              </dt>
              <dd className="text-sm font-medium text-gray-900">
                {formatValue(key, value)}
              </dd>
            </div>
          ))}
      </div>

      {/* Sharing Details Section */}
      {renderSharingDetails()}
    </div>
  );
};

export default PositionDetails;