import React, { useState } from 'react';
import { Share2, X, Check, Search } from 'lucide-react';
import { useFriends } from '../../contexts/FriendsContext';
import { useUser } from '../../contexts/UserContext';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { userStorage } from '../../utils/storage/storage';

const SharePositionModal = ({ position, isOpen, onClose }) => {
  const { getActiveFriends } = useFriends();
  const { currentUser } = useUser();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFriends, setSelectedFriends] = useState(new Set());
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const { updatePosition, loadPositions } = usePortfolio();  // Add loadPositions here

  const friends = getActiveFriends();


  // Add function to check if already shared
  const isAlreadySharedWith = (friendId) => {
    // Get recipient's shared positions
    const recipientSharedPositions = userStorage.getSharedPositions(friendId);
    // Check if this position is already shared with them
    return recipientSharedPositions.some(p => p.originalId === position.id);
  };



  const handleShare = async () => {
    if (selectedFriends.size === 0) {
      setError('Please select at least one friend to share with');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      // Update original owner's position to mark as shared
      const currentTimestamp = new Date().toISOString();
      const updatedPosition = {
        ...position,
        shared: true,
        sharedWith: Array.from(selectedFriends),
        sharedAt: currentTimestamp, // Ensure we always use a fresh timestamp
        sharedBy: {
          id: currentUser.id,
          name: currentUser.displayName
        }
      };

      // Update original position in owner's storage
      const originalUpdateSuccess = await updatePosition(updatedPosition);
      if (!originalUpdateSuccess) {
        throw new Error('Failed to update original position');
      }

      // Share with each selected friend by saving to their storage
      const sharePromises = Array.from(selectedFriends).map(async (friendId) => {
        // Create the shared copy for this recipient
        const sharedPosition = {
          ...position, // Start with original position
          id: `shared_${position.id}_${friendId}_${Date.now()}`,
          userId: friendId, // Set to recipient's userId
          originalId: position.id, // Keep track of original position
          ownerId: currentUser.id, // Keep track of original owner
          shared: true,
          sharedAt: currentTimestamp, // Use the same timestamp for consistency
          lastSyncedAt: currentTimestamp, // Add a new field for tracking sync status
          sharedBy: {
            id: currentUser.id,
            name: currentUser.displayName
          }
        };

        // Get recipient's current shared positions
        const recipientSharedPositions = userStorage.getSharedPositions(friendId) || [];

        // Add new shared position to recipient's storage
        const updatedSharedPositions = [...recipientSharedPositions, sharedPosition];
        return userStorage.saveSharedPositions(friendId, updatedSharedPositions);
      });

      // Wait for all shares to complete
      const results = await Promise.all(sharePromises);
      if (results.some(success => !success)) {
        throw new Error('Failed to share with some recipients');
      }
      await loadPositions();

      onClose();
    } catch (err) {
      setError('Failed to share position. Please try again.');
      console.error('Share position error:', err);
    } finally {
      setProcessing(false);
    }
  };

  if (!isOpen) return null;

  const filteredFriends = friends.filter(friend =>
    friend.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    friend.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleFriendSelection = (friendId) => {
    const newSelection = new Set(selectedFriends);
    if (newSelection.has(friendId)) {
      newSelection.delete(friendId);
    } else {
      newSelection.add(friendId);
    }
    setSelectedFriends(newSelection);
  };


  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <div className="flex items-center space-x-2">
            <Share2 className="h-5 w-5 text-gray-400" />
            <h3 className="text-lg font-medium text-gray-900">Share Position</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4">
          {/* Search Box */}
          <div className="mb-4">
            <div className="relative">
              <Search className="h-5 w-5 text-gray-400 absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search friends..."
                className="pl-10 w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
              {error}
            </div>
          )}

          {/* Friends List */}
          <div className="max-h-64 overflow-y-auto">
            {filteredFriends.length === 0 ? (
              <p className="text-center text-gray-500 py-4">
                {searchQuery ? 'No friends found' : 'No friends available'}
              </p>
            ) : (
              <div className="space-y-2">
                {filteredFriends.map((friend) => {
                  const alreadyShared = isAlreadySharedWith(friend.id);

                  return (
                    <div
                      key={friend.id}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50"
                    >
                      <div className="flex items-center">
                        {friend.profilePicture ? (
                          <img
                            src={friend.profilePicture}
                            alt={friend.displayName}
                            className="h-8 w-8 rounded-full"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center">
                            <span className="text-gray-500 font-medium">
                              {friend.displayName[0]}
                            </span>
                          </div>
                        )}
                        <div className="ml-3">
                          <p className="text-sm font-medium text-gray-900">
                            {friend.displayName}
                            {alreadyShared && (
                              <span className="ml-2 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                                Already shared
                              </span>
                            )}
                          </p>
                          <p className="text-sm text-gray-500">{friend.username}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => toggleFriendSelection(friend.id)}
                        className={`p-2 rounded-full ${alreadyShared
                          ? 'bg-blue-100 text-blue-600 cursor-not-allowed'
                          : selectedFriends.has(friend.id)
                            ? 'bg-blue-100 text-blue-600'
                            : 'bg-gray-100 text-gray-400'
                          }`}
                        disabled={alreadyShared}
                      >
                        <Check className="h-5 w-5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleShare}
            disabled={selectedFriends.size === 0 || processing}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md ${selectedFriends.size === 0 || processing
              ? 'bg-blue-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700'
              }`}
          >
            {processing ? 'Sharing...' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SharePositionModal;