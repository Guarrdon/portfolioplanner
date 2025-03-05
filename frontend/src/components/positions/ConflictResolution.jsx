import React, { useState, useMemo, useEffect } from 'react';
import { AlertTriangle, Tag, MessageSquare, Clock, Check, ArrowRight, ArrowLeft } from 'lucide-react';

/**
 * Enhanced modal component for resolving conflicts during position synchronization
 */
const ConflictResolution = ({ isOpen, onClose, localPosition, remotePosition, onResolve }) => {
  const [resolution, setResolution] = useState({
    tags: 'merge', // 'local', 'remote', 'merge', or 'custom' 
    comments: 'merge', // 'local', 'remote', or 'merge'
    details: 'remote' // 'local' or 'remote'
  });
  
  // Add preview state to show what the resolved position will look like
  const [showPreview, setShowPreview] = useState(false);
  
  // Add state for individual tag resolutions
  const [tagResolutions, setTagResolutions] = useState({});
  
  // Calculate conflicts
  const conflicts = useMemo(() => {
    if (!localPosition || !remotePosition) {
      return {
        tags: { added: [], removed: [] },
        comments: { added: [], removed: [] },
        details: { changed: false, changes: {} }
      };
    }
    
    return {
      tags: compareArrays(localPosition.tags || [], remotePosition.tags || []),
      comments: compareComments(
        localPosition.comments || [], 
        remotePosition.comments || []
      ),
      details: compareObjects(
        { symbol: localPosition.symbol, account: localPosition.account },
        { symbol: remotePosition.symbol, account: remotePosition.account }
      )
    };
  }, [localPosition, remotePosition]);

  // Calculate if there are conflicts
  const hasConflicts = useMemo(() => {
    if (!localPosition || !remotePosition) return false;
    
    return Object.values(conflicts).some(conflict =>
      conflict.added?.length > 0 || conflict.removed?.length > 0 || conflict.changed
    );
  }, [conflicts, localPosition, remotePosition]);
  
  // Reset tag resolutions when positions change
  useEffect(() => {
    if (localPosition && remotePosition) {
      // Initialize with all tags set to "keep"
      const newTagResolutions = {};
      
      // Get all tags from both positions
      const localTags = localPosition.tags || [];
      const remoteTags = remotePosition.tags || [];
      
      // Initialize decisions for added tags (default to keep)
      remoteTags.forEach(tag => {
        if (!localTags.includes(tag)) {
          newTagResolutions[tag] = 'keep';
        }
      });
      
      // Initialize decisions for removed tags (default to remove)
      localTags.forEach(tag => {
        if (!remoteTags.includes(tag)) {
          newTagResolutions[tag] = 'remove';
        }
      });
      
      setTagResolutions(newTagResolutions);
    }
  }, [localPosition, remotePosition]);

  // Calculate the preview of the resolved position
  const previewResolution = useMemo(() => {
    if (!localPosition || !remotePosition) return null;
    
    // Start with remote position as base
    const resolvedPosition = { ...remotePosition };
    
    // Handle tag resolution
    if (resolution.tags === 'local') {
      resolvedPosition.tags = localPosition.tags || [];
    } else if (resolution.tags === 'merge') {
      // Merge all tags
      resolvedPosition.tags = Array.from(new Set([
        ...(localPosition.tags || []),
        ...(remotePosition.tags || [])
      ]));
    } else if (resolution.tags === 'custom') {
      // Apply individual tag decisions
      resolvedPosition.tags = [];
      
      // Include all uncontested tags from remote
      const remoteTags = remotePosition.tags || [];
      const localTags = localPosition.tags || [];
      
      // Keep uncontested remote tags
      remoteTags.forEach(tag => {
        if (localTags.includes(tag) || tagResolutions[tag] === 'keep') {
          resolvedPosition.tags.push(tag);
        }
      });
      
      // Add local tags that were removed in remote but decided to keep
      localTags.forEach(tag => {
        if (!remoteTags.includes(tag) && tagResolutions[tag] !== 'remove') {
          resolvedPosition.tags.push(tag);
        }
      });
    }
    
    // Handle comment resolution
    if (resolution.comments === 'local') {
      resolvedPosition.comments = localPosition.comments || [];
    } else if (resolution.comments === 'merge') {
      // Create a map to handle duplicates
      const commentMap = new Map();
      
      // First add all remote comments
      (remotePosition.comments || []).forEach(comment => {
        commentMap.set(comment.id, comment);
      });
      
      // Then add local comments that don't exist in remote
      (localPosition.comments || []).forEach(comment => {
        if (!commentMap.has(comment.id)) {
          commentMap.set(comment.id, comment);
        }
      });
      
      resolvedPosition.comments = Array.from(commentMap.values());
      
      // Sort comments by timestamp
      resolvedPosition.comments.sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
      );
    }
    
    // Handle detail conflicts
    if (resolution.details === 'local') {
      resolvedPosition.symbol = localPosition.symbol;
      resolvedPosition.account = localPosition.account;
    }
    
    // Add sync metadata
    resolvedPosition.lastSyncedAt = new Date().toISOString();
    resolvedPosition.syncHistory = resolvedPosition.syncHistory || [];
    resolvedPosition.syncHistory.push({
      timestamp: new Date().toISOString(),
      conflicts: hasConflicts,
      resolutionMethod: {
        tags: resolution.tags,
        comments: resolution.comments,
        details: resolution.details
      }
    });
    
    return resolvedPosition;
  }, [localPosition, remotePosition, resolution, tagResolutions, hasConflicts]);

  // Format date helper function
  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    try {
      return new Date(dateString).toLocaleString();
    } catch (e) {
      return 'Unknown date';
    }
  };

  const handleResolve = () => {
    // Create resolved position
    if (!previewResolution) return;
    
    // Add additional sync metadata
    const resolvedPosition = {
      ...previewResolution,
      syncResolution: {
        resolvedAt: new Date().toISOString(),
        conflicts: {
          tagConflicts: conflicts.tags.added.length + conflicts.tags.removed.length,
          commentConflicts: conflicts.comments.added.length + conflicts.comments.removed.length,
          detailConflicts: conflicts.details.changed ? Object.keys(conflicts.details.changes).length : 0
        }
      }
    };

    onResolve(resolvedPosition);
  };
  
  const toggleTagResolution = (tag) => {
    setTagResolutions(prev => ({
      ...prev,
      [tag]: prev[tag] === 'keep' ? 'remove' : 'keep'
    }));
    
    // Switch to custom tag resolution mode
    if (resolution.tags !== 'custom') {
      setResolution(prev => ({
        ...prev,
        tags: 'custom'
      }));
    }
  };

  // Helper functions
  function compareArrays(localArray, remoteArray) {
    const added = remoteArray.filter(item => !localArray.includes(item));
    const removed = localArray.filter(item => !remoteArray.includes(item));
    return { added, removed };
  }
  
  function compareComments(localComments, remoteComments) {
    const localCommentMap = new Map(localComments.map(comment => [comment.id, comment]));
    const remoteCommentMap = new Map(remoteComments.map(comment => [comment.id, comment]));
    
    const added = remoteComments.filter(comment => !localCommentMap.has(comment.id));
    const removed = localComments.filter(comment => !remoteCommentMap.has(comment.id));
    
    const modified = localComments
      .filter(localComment => {
        const remoteComment = remoteCommentMap.get(localComment.id);
        return remoteComment && localComment.text !== remoteComment.text;
      })
      .map(localComment => {
        const remoteComment = remoteCommentMap.get(localComment.id);
        return {
          id: localComment.id,
          local: localComment,
          remote: remoteComment
        };
      });
    
    return { added, removed, modified };
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

  // Now we can do the conditional return for rendering
  if (!isOpen || !localPosition || !remotePosition) return null;

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center space-x-3 mb-4">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          <h2 className="text-xl font-semibold text-gray-900">
            {showPreview ? "Preview Resolution" : "Resolve Sync Conflicts"}
          </h2>
        </div>

        {!hasConflicts ? (
          <div className="py-4 text-center">
            <p className="text-gray-700">No conflicts detected. Safe to continue.</p>
            {remotePosition && (
              <div className="mt-4 text-sm text-gray-500">
                <p>Last updated by owner: {formatDate(remotePosition.updatedAt || remotePosition.createdAt)}</p>
                <p>Your last sync: {formatDate(localPosition.lastSyncedAt || localPosition.sharedAt)}</p>
              </div>
            )}
          </div>
        ) : showPreview ? (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <button
                onClick={() => setShowPreview(false)}
                className="flex items-center text-blue-600 hover:text-blue-800"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back to Conflicts
              </button>
              
              <div className="text-sm text-gray-500">
                Preview of resolved position
              </div>
            </div>
            
            {/* Preview Tags Section */}
            <div className="border-t border-b py-4">
              <h3 className="text-lg font-medium text-gray-900 mb-3">Tags</h3>
              {previewResolution?.tags?.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {previewResolution.tags.map(tag => (
                    <span key={tag} className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 text-sm">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">No tags</p>
              )}
            </div>
            
            {/* Preview Comments Section */}
            <div className="border-t border-b py-4">
              <h3 className="text-lg font-medium text-gray-900 mb-3">Comments</h3>
              {previewResolution?.comments?.length > 0 ? (
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {previewResolution.comments.map(comment => (
                    <div key={comment.id} className="p-3 bg-gray-50 rounded-lg">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{comment.author}</span>
                        <span className="text-gray-500">{formatDate(comment.timestamp)}</span>
                      </div>
                      <p className="mt-1 text-sm">{comment.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">No comments</p>
              )}
            </div>
            
            {/* Preview Details Section */}
            <div className="border-t border-b py-4">
              <h3 className="text-lg font-medium text-gray-900 mb-3">Position Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Symbol</p>
                  <p className="text-lg font-medium">{previewResolution?.symbol}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Account</p>
                  <p className="text-lg font-medium">{previewResolution?.account}</p>
                </div>
              </div>
            </div>
            
            <div className="border-t pt-4">
              <h3 className="text-lg font-medium text-gray-900 mb-3">Sync Metadata</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Last Synced:</span>
                  <span>{formatDate(previewResolution?.lastSyncedAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Conflicts Resolved:</span>
                  <span>{hasConflicts ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Resolution Method:</span>
                  <span>
                    Tags: {resolution.tags}, 
                    Comments: {resolution.comments}, 
                    Details: {resolution.details}
                  </span>
                </div>
              </div>
            </div>
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
                          <button
                            key={tag}
                            onClick={() => toggleTagResolution(tag)}
                            className={`px-2 py-0.5 rounded-full text-xs flex items-center space-x-1 ${
                              resolution.tags === 'custom' && tagResolutions[tag] === 'remove'
                                ? 'bg-gray-200 text-gray-500 line-through'
                                : 'bg-green-100 text-green-800'
                            }`}
                          >
                            <span>{tag}</span>
                            <Check className={`w-3.5 h-3.5 ${
                              resolution.tags === 'custom' && tagResolutions[tag] === 'remove'
                                ? 'text-gray-400'
                                : 'text-green-600'
                            }`} />
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Click on tags to include/exclude them individually
                      </p>
                    </div>
                  )}
                  
                  {conflicts.tags.removed.length > 0 && (
                    <div>
                      <p className="text-sm text-gray-500">Tags removed in remote version:</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {conflicts.tags.removed.map(tag => (
                          <button
                            key={tag}
                            onClick={() => toggleTagResolution(tag)}
                            className={`px-2 py-0.5 rounded-full text-xs flex items-center space-x-1 ${
                              resolution.tags === 'custom' && tagResolutions[tag] === 'keep'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-red-100 text-red-800 line-through'
                            }`}
                          >
                            <span>{tag}</span>
                            {resolution.tags === 'custom' && tagResolutions[tag] === 'keep' && (
                              <Check className="w-3.5 h-3.5 text-blue-600" />
                            )}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Click on tags to keep tags that were removed
                      </p>
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
                      Merge All
                    </button>
                    <button
                      className={`px-3 py-1 text-xs rounded-full border ${
                        resolution.tags === 'custom'
                          ? 'bg-blue-100 border-blue-300 text-blue-800'
                          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                      onClick={() => setResolution(prev => ({ ...prev, tags: 'custom' }))}
                    >
                      Custom
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
                
                <div className="space-y-4">
                  {conflicts.comments.added.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-gray-700">New Comments in Remote Version</p>
                      <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                        {conflicts.comments.added.map(comment => (
                          <div key={comment.id} className="p-3 bg-green-50 rounded-lg">
                            <div className="flex justify-between text-sm">
                              <span className="font-medium">{comment.author}</span>
                              <span className="text-gray-500">{formatDate(comment.timestamp)}</span>
                            </div>
                            <p className="mt-1 text-sm">{comment.text}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {conflicts.comments.removed.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-gray-700">Comments Not Present in Remote</p>
                      <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                        {conflicts.comments.removed.map(comment => (
                          <div key={comment.id} className="p-3 bg-red-50 rounded-lg">
                            <div className="flex justify-between text-sm">
                              <span className="font-medium">{comment.author}</span>
                              <span className="text-gray-500">{formatDate(comment.timestamp)}</span>
                            </div>
                            <p className="mt-1 text-sm">{comment.text}</p>
                          </div>
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
                      Merge All
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
            
            {/* Sync History */}
            <div className="border-t pt-4">
              <div className="flex items-center mb-3">
                <Clock className="h-5 w-5 text-gray-400 mr-2" />
                <h3 className="text-lg font-medium text-gray-900">Sync History</h3>
              </div>
              
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Local Last Updated:</span>
                  <span className="font-medium">{formatDate(localPosition.updatedAt || localPosition.createdAt)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Remote Last Updated:</span>
                  <span className="font-medium">{formatDate(remotePosition.updatedAt || remotePosition.createdAt)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Last Synced:</span>
                  <span className="font-medium">{formatDate(localPosition.lastSyncedAt || 'Never')}</span>
                </div>
                
                {/* Previous sync history if available */}
                {localPosition.syncHistory && localPosition.syncHistory.length > 0 && (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-gray-700">Previous Syncs</p>
                    <div className="mt-1 max-h-24 overflow-y-auto">
                      {localPosition.syncHistory.map((sync, index) => (
                        <div key={index} className="flex justify-between text-xs text-gray-500">
                          <span>{formatDate(sync.timestamp)}</span>
                          <span>{sync.conflicts ? 'Conflicts Resolved' : 'Clean Sync'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          
          {!showPreview && hasConflicts && (
            <button
              onClick={() => setShowPreview(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <span className="flex items-center">
                Preview
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </span>
            </button>
          )}
          
          {showPreview && (
            <button
              onClick={handleResolve}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
            >
              <span className="flex items-center">
                <Check className="mr-1.5 h-4 w-4" />
                Apply Resolution
              </span>
            </button>
          )}
          
          {!hasConflicts && (
            <button
              onClick={handleResolve}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Apply Resolution
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConflictResolution;