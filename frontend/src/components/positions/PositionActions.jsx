import React, { useState } from 'react';
import { MessageSquare, Edit, Trash2, Share2 } from 'lucide-react';
import SharePositionModal from '../modals/SharePositionModal';
import { useUser } from '../../contexts/UserContext';

const PositionActions = ({
  position,
  onToggleComments,
  onEdit,
  onDelete,
  commentCount = 0
}) => {
  const [showShareModal, setShowShareModal] = useState(false);
  const { currentUser } = useUser();

  // Determine if this position is owned by current user and can be shared
  const canShare = position.ownerId === currentUser?.id;
  const sharedWithCount = position.sharedWith?.length || 0;

  // Debug position sharing state with more detailed logging
  console.log('Position sharing state:', {
    positionId: position.id,
    ownerId: position.ownerId,
    currentUserId: currentUser?.id,
    isOwner: position.ownerId === currentUser?.id,
    shared: position.shared,
    sharedWith: position.sharedWith,
    sharedCount: sharedWithCount,
    positionKeys: Object.keys(position)
  });

  // Ensure commentCount comes from position.comments length if available
  const totalComments = position?.comments?.length || commentCount;

  // Add additional type checking
  const isShared = position.shared === true ||
    (Array.isArray(position.sharedWith) && position.sharedWith.length > 0);

  return (
    <>
      <div className="flex items-center space-x-2">
        <button
          onClick={onToggleComments}
          className={`flex items-center space-x-1 px-2 py-1 text-sm rounded-md hover:bg-gray-50 
            ${totalComments > 0
              ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
              : 'text-gray-500 hover:text-gray-700'
            }`}
          title={`${totalComments} comment${totalComments !== 1 ? 's' : ''}`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>{totalComments}</span>
        </button>

        {/* Only show share button if user owns the position */}
        {canShare && (
          <button
            onClick={() => setShowShareModal(true)}
            className={`flex items-center space-x-1 px-2 py-1 text-sm rounded-md 
              ${isShared && sharedWithCount > 0
                ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            title={isShared ? `Shared with ${sharedWithCount} user${sharedWithCount !== 1 ? 's' : ''}` : "Share position"}
          >
            <Share2 className="w-4 h-4" />
            {sharedWithCount > 0 && <span>{sharedWithCount}</span>}
          </button>
        )}

        {/* Only show edit/delete if user owns the position */}
        {position.ownerId === currentUser?.id && (
          <>
            <button
              onClick={() => onEdit(position)}
              className="p-2 text-gray-400 hover:text-blue-600 rounded-full hover:bg-gray-100"
              title="Edit position"
            >
              <Edit className="h-5 w-5" />
            </button>

            <button
              onClick={() => onDelete(position)}
              className="p-2 text-gray-400 hover:text-red-600 rounded-full hover:bg-gray-100"
              title="Delete position"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {/* Share Modal */}
      <SharePositionModal
        position={position}
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
      />
    </>
  );
};

export default PositionActions;