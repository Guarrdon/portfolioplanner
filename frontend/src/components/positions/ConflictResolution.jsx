// frontend/src/components/positions/ConflictResolution.jsx
import React, { useState } from 'react';
import { AlertTriangle, Check, X, Tag, MessageSquare } from 'lucide-react';

/**
 * Modal component for resolving conflicts during position synchronization
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the modal is open
 * @param {Function} props.onClose - Handler for closing the modal
 * @param {Object} props.localPosition - The local version of the position
 * @param {Object} props.remotePosition - The remote version of the position
 * @param {Function} props.onResolve - Handler for resolving conflicts
 */
const ConflictResolution = ({ isOpen, onClose, localPosition, remotePosition, onResolve }) => {
  const [resolution, setResolution] = useState({
    tags: 'merge', // 'local', 'remote', or 'merge'
    comments: 'merge', // 'local', 'remote', or 'merge'
    details: 'remote' // 'local' or 'remote'
  });

  if (!isOpen || !localPosition || !remotePosition) return null;

  // Extract conflicts
  const conflicts = {
    tags: compareArrays(localPosition.tags || [], remotePosition.tags || []),
    comments: compareArrays(
      (localPosition.comments || []).map(c => c.id),
      (remotePosition.comments || []).map(c => c.id)
    ),
    details: compareObjects(
      { symbol: localPosition.symbol, account: localPosition.account },
      { symbol: remotePosition.symbol, account: remotePosition.account }
    )
  };

  const hasConflicts = Object.values(conflicts).some(conflict =>
    conflict.added.length > 0 || conflict.removed.length > 0
  );

  const handleResolve = () => {
    // Create resolved position
    const resolvedPosition = { ...remotePosition };

    // Resolve tag conflicts
    if (resolution.tags === 'local') {
      resolvedPosition.tags = localPosition.tags || [];
    } else if (resolution.tags === 'merge') {
      resolvedPosition.tags = Array.from(new Set([
        ...(localPosition.tags || []),
        ...(remotePosition.tags || [])
      ]));
    }

    // Resolve comment conflicts
    if (resolution.comments === 'local') {
      resolvedPosition.comments = localPosition.comments || [];
    } else if (resolution.comments === 'merge') {
      // Create a map to handle duplicates
      const commentMap = new Map();
      (remotePosition.comments || []).forEach(comment => {
        commentMap.set(comment.id, comment);
      });
      (localPosition.comments || []).forEach(comment => {
        if (!commentMap.has(comment.id)) {
          commentMap.set(comment.id, comment);
        }
      });
      resolvedPosition.comments = Array.from(commentMap.values());
    }

    // Resolve detail conflicts
    if (resolution.details === 'local') {
      resolvedPosition.symbol = localPosition.symbol;
      resolvedPosition.account = localPosition.account;
    }

    // Always keep other metadata
    resolvedPosition.lastSyncedAt = new Date().toISOString();

    onResolve(resolvedPosition);
  };

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center space-x-3 mb-4">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          <h2 className="text-xl font-semibold text-gray-900">Resolve Sync Conflicts</h2>
        </div>

        {!hasConflicts ? (
          <div className="py-4 text-center">
            <p className="text-gray-700">No conflicts detected. Safe to continue.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Tag Conflicts */}
            {(conflicts.tags.added.length > 0 || conflicts.tags.removed.length > 0) && (
              <div className="border-t border-b py-4">
                <div className="flex items-center mb-3">
                  <Tag className="h-5 w-5 text-amber-500 mr-2" />
                  <h3 className="text-lg font-medium text-gray-900">Tag Conflicts</h3>
                </div>
                <div className="space-y-3">
                  {conflicts.tags.added.length > 0 && (
                    <div>
                      <p className="text-sm text-gray-500">Tags added in remote version:</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {conflicts.tags.added.map(tag => (
                          <span key={tag} className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {conflicts.tags.removed.length > 0 && (
                    <div>
                      <p className="text-sm text-gray-500">Tags removed in remote version:</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {conflicts.tags.removed.map(tag => (
                          <span key={tag} className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex justify-between">
                  <span className="text-sm font-medium text-gray-700">Resolution:</span>
                  <div className="flex space-x-3">
                    <button
                      className={`px-3 py-1 text-xs rounded-full border ${
                        resolution.tags === 'local'
                          ? 'bg-blue-100 border-blue-300 text-blue-800'
                          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                      onClick={() => setResolution(prev => ({ ...prev, tags: 'local' }))}
                    >
                      Keep Local
                    </button>
                    <button
                      className={`px-3 py-1 text-xs rounded-full border ${
                        resolution.tags === 'remote'
                          ? 'bg-blue-100 border-blue-300 text-blue-800'
                          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                      onClick={() => setResolution(prev => ({ ...prev, tags: 'remote' }))}
                    >
                      Use Remote
                    </button>
                    <button
                      className={`px-3 py-1 text-xs rounded-full border ${
                        resolution.tags === 'merge'
                          ? 'bg-blue-100 border-blue-300 text-blue-800'
                          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                      onClick={() => setResolution(prev => ({ ...prev, tags: 'merge' }))}
                    >
                      Merge Both
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Comment Conflicts */}
            {(conflicts.comments.added.length > 0 || conflicts.comments.removed.length > 0) && (
              <div className="border-t border-b py-4">
                <div className="flex items-center mb-3">
                  <MessageSquare className="h-5 w-5 text-amber-500 mr-2" />
                  <h3 className="text-lg font-medium text-gray-900">Comment Changes</h3>
                </div>
                <div className="space-y-2">
                  {conflicts.comments.added.length > 0 && (
                    <p className="text-sm text-gray-700">
                      {conflicts.comments.added.length} new {
                        conflicts.comments.added.length === 1 ? 'comment' : 'comments'
                      } in remote version
                    </p>
                  )}
                  {conflicts.comments.removed.length > 0 && (
                    <p className="text-sm text-gray-700">
                      {conflicts.comments.removed.length} {
                        conflicts.comments.removed.length === 1 ? 'comment' : 'comments'
                      } removed in remote version
                    </p>
                  )}
                </div>
                <div className="mt-3 flex justify-between">
                  <span className="text-sm font-medium text-gray-700">Resolution:</span>
                  <div className="flex space-x-3">
                    <button
                      className={`px-3 py-1 text-xs rounded-full border ${
                        resolution.comments === 'local'
                          ? 'bg-blue-100 border-blue-300 text-blue-800'
                          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                      onClick={() => setResolution(prev => ({ ...prev, comments: 'local' }))}
                    >
                      Keep Local
                    </button>
                    <button
                      className={`px-3 py-1 text-xs rounded-full border ${
                        resolution.comments === 'remote'
                          ? 'bg-blue-100 border-blue-300 text-blue-800'
                          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                      onClick={() => setResolution(prev => ({ ...prev, comments: 'remote' }))}
                    >
                      Use Remote
                    </button>
                    <button
                      className={`px-3 py-1 text-xs rounded-full border ${
                        resolution.comments === 'merge'
                          ? 'bg-blue-100 border-blue-300 text-blue-800'
                          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                      onClick={() => setResolution(prev => ({ ...prev, comments: 'merge' }))}
                    >
                      Merge Both
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Detail Conflicts */}
            {conflicts.details.changed && (
              <div className="border-t border-b py-4">
                <div className="mb-3">
                  <h3 className="text-lg font-medium text-gray-900">Position Details</h3>
                </div>
                <div className="space-y-3">
                  {Object.entries(conflicts.details.changes).map(([field, values]) => (
                    <div key={field} className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900 capitalize">{field}</p>
                        <div className="flex flex-col sm:flex-row sm:space-x-4 text-sm">
                          <div className="text-red-600">
                            <span className="font-medium">Local:</span> {values.local}
                          </div>
                          <div className="text-green-600">
                            <span className="font-medium">Remote:</span> {values.remote}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex justify-between">
                  <span className="text-sm font-medium text-gray-700">Resolution:</span>
                  <div className="flex space-x-3">
                    <button
                      className={`px-3 py-1 text-xs rounded-full border ${
                        resolution.details === 'local'
                          ? 'bg-blue-100 border-blue-300 text-blue-800'
                          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                      onClick={() => setResolution(prev => ({ ...prev, details: 'local' }))}
                    >
                      Keep Local
                    </button>
                    <button
                      className={`px-3 py-1 text-xs rounded-full border ${
                        resolution.details === 'remote'
                          ? 'bg-blue-100 border-blue-300 text-blue-800'
                          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                      onClick={() => setResolution(prev => ({ ...prev, details: 'remote' }))}
                    >
                      Use Remote
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            onClick={handleResolve}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Apply Resolution
          </button>
        </div>
      </div>
    </div>
  );
};

// Helper functions for comparing values
function compareArrays(localArray, remoteArray) {
  const added = remoteArray.filter(item => !localArray.includes(item));
  const removed = localArray.filter(item => !remoteArray.includes(item));
  return { added, removed };
}

function compareObjects(localObj, remoteObj) {
  const changes = {};
  let changed = false;
  
  for (const key in localObj) {
    if (localObj[key] !== remoteObj[key]) {
      changes[key] = {
        local: localObj[key],
        remote: remoteObj[key]
      };
      changed = true;
    }
  }
  
  return { changed, changes };
}

export default ConflictResolution;