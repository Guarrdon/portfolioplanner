// File path: src/components/positions/SharedUpdatesIndicator.jsx
// New component to show when friends have made updates to shared positions

import React, { useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { MessageSquare, Bell, AlertCircle } from 'lucide-react';

const SharedUpdatesIndicator = ({ positionId }) => {
  const { getSharedPositionUpdates } = usePortfolio();
  const [showDetails, setShowDetails] = useState(false);

  // Get updates from friends
  const updates = getSharedPositionUpdates(positionId);

  if (updates.length === 0) return null;

  const totalComments = updates.reduce((sum, update) => sum + update.comments.length, 0);

  return (
    <div className="relative">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center px-2 py-1 bg-amber-50 text-amber-700 rounded-md hover:bg-amber-100"
        title="Updates from friends"
      >
        <Bell className="w-4 h-4 mr-1" />
        <span>{totalComments} update{totalComments !== 1 ? 's' : ''} from friends</span>
      </button>

      {showDetails && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-md shadow-lg z-10 border border-gray-200">
          <div className="p-3 border-b">
            <h4 className="text-sm font-medium text-gray-900">Updates from Friends</h4>
          </div>

          <div className="max-h-60 overflow-y-auto">
            {updates.map((update) => (
              <div key={update.userId} className="p-3 border-b">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">{update.userName}</span>
                  <span className="text-xs text-gray-500">
                    {update.comments.length} comment{update.comments.length !== 1 ? 's' : ''}
                  </span>
                </div>

                <div className="space-y-2">
                  {update.comments.slice(0, 2).map((comment) => (
                    <div key={comment.id} className="text-xs text-gray-700 bg-gray-50 p-2 rounded">
                      <div className="flex items-center">
                        <MessageSquare className="w-3 h-3 mr-1 text-amber-500" />
                        <span className="truncate">{comment.text}</span>
                      </div>
                      {comment.extractedTags && comment.extractedTags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {comment.extractedTags.map(tag => (
                            <span key={tag} className="px-1 py-0.5 bg-amber-100 text-amber-800 text-xs rounded-full">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {update.comments.length > 2 && (
                    <div className="text-xs text-center text-amber-600">
                      + {update.comments.length - 2} more
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 bg-gray-50">
            <div className="flex items-center text-xs text-gray-500">
              <AlertCircle className="w-3 h-3 mr-1" />
              <span>Sync position to include these updates</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SharedUpdatesIndicator;