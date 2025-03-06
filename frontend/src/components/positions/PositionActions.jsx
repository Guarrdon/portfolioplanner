// frontend/src/components/positions/PositionActions.jsx
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

  // Determine if this position is owned by current user
  const isOwner = position.ownerId === currentUser?.id;
  
  // Get comment count from position if available
  const totalComments = position?.comments?.length || commentCount;

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
        {isOwner && (
          <button
            onClick={() => setShowShareModal(true)}
            className={`flex items-center space-x-1 px-2 py-1 text-sm rounded-md 
              ${position.shared
                ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            title={position.shared ? "Manage sharing" : "Share position"}
          >
            <Share2 className="w-4 h-4" />
          </button>
        )}

        {/* Only show edit/delete if user owns the position */}
        {isOwner && (
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