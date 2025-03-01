// src/components/settings/FriendManagement.jsx

import React, { useState } from 'react';
import { useUser } from '../../contexts/UserContext';
import { useFriends } from '../../contexts/FriendsContext';
import { UserCircle2, UserPlus2, X } from 'lucide-react';

const FriendManagement = () => {
  const { users, currentUser } = useUser();
  const { 
    relationships, 
    hasRelationship, 
    addRelationship, 
    removeRelationship, 
    error: friendsError, 
    clearError 
  } = useFriends();
  
  const [error, setError] = useState(null);

  const handleAddFriend = async (friendId) => {
    try {
      setError(null);
      clearError();
      
      const success = await addRelationship(friendId);
      if (!success) {
        setError('Failed to add friend');
      }
    } catch (error) {
      setError(error.message || 'Error adding friend');
    }
  };

  const handleRemoveFriend = async (friendId) => {
    try {
      setError(null);
      clearError();
      
      const success = await removeRelationship(friendId);
      if (!success) {
        setError('Failed to remove friend');
      }
    } catch (error) {
      setError(error.message || 'Error removing friend');
    }
  };

  return (
    <div className="space-y-6 bg-white shadow rounded-lg p-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <UserCircle2 className="h-6 w-6 text-gray-400" />
          <h3 className="text-lg font-medium text-gray-900">Friends</h3>
        </div>
      </div>

      {(error || friendsError) && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
          {error || friendsError}
        </div>
      )}

      {/* Available Users List */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-500">Available Users</h4>
        <div className="divide-y divide-gray-200">
          {users
            .filter(user => 
              user.id !== currentUser.id && !hasRelationship(user.id)
            )
            .map(user => (
              <div
                key={user.id}
                className="flex justify-between items-center py-3"
              >
                <div className="flex items-center space-x-3">
                  {user.profilePicture ? (
                    <img
                      src={user.profilePicture}
                      alt={user.displayName}
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <UserCircle2 className="h-8 w-8 text-gray-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {user.displayName}
                    </p>
                    <p className="text-xs text-gray-500">{user.email}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleAddFriend(user.id)}
                  className="p-2 text-blue-600 hover:text-blue-700 rounded-full hover:bg-blue-50"
                  title="Add friend"
                >
                  <UserPlus2 className="h-5 w-5" />
                </button>
              </div>
            ))}
            
          {users.filter(user => 
            user.id !== currentUser.id && !hasRelationship(user.id)
          ).length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">
              No available users to add
            </p>
          )}
        </div>
      </div>

      {/* Friends List */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-500">Your Friends</h4>
        <div className="divide-y divide-gray-200">
          {relationships
            .filter(rel => rel.status === 'active')
            .map(rel => {
              const user = users.find(u => u.id === rel.userId);
              if (!user) return null;

              return (
                <div
                  key={rel.userId}
                  className="flex justify-between items-center py-3"
                >
                  <div className="flex items-center space-x-3">
                    {user.profilePicture ? (
                      <img
                        src={user.profilePicture}
                        alt={user.displayName}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <UserCircle2 className="h-8 w-8 text-gray-400" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {user.displayName}
                      </p>
                      <div className="flex items-center space-x-2">
                        <p className="text-xs text-gray-500">{user.email}</p>
                        <span className="text-xs text-gray-400">•</span>
                        <p className="text-xs text-gray-500">
                          Friend since {new Date(rel.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveFriend(rel.userId)}
                    className="p-2 text-gray-400 hover:text-red-500 rounded-full hover:bg-gray-100"
                    title="Remove friend"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              );
            })}

          {relationships.filter(rel => rel.status === 'active').length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">
              No friends added yet
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default FriendManagement;