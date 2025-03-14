import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Tag,
  PlusCircle,
  Link,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import Comments from '../common/Comments';
import PositionActions from './PositionActions';
import ActivityLog from './ActivityLog';
import { useAccounts } from '../../contexts/AccountsContext';
import SharedPositionBadge from '../common/SharedPositionBadge';
import SyncStatusBadge from './SyncStatusBadge';
import { useUser } from '../../contexts/UserContext';
import {
  hasUnsavedChanges,
  getUnsavedChanges,
  recordChange,
  clearChanges
} from '../../utils/optimisticUpdates';
import { userStorage } from '../../utils/storage/storage';

const ExpandedPositionCard = ({
  position,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onRemoveTag,
  onAddLeg,
  onRemoveLeg,
  onUpdatePosition
}) => {
  const { accounts } = useAccounts();
  const { currentUser } = useUser();
  const { syncSharedPosition } = usePortfolio();
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [syncError, setSyncError] = useState(null);

  // Check for local unsaved changes
  const hasLocalChanges = hasUnsavedChanges(position.id);
  const unsavedChanges = hasLocalChanges ? getUnsavedChanges(position.id) : null;

  // Add this function to extract hashtags from text
  const extractHashtags = (text) => {
    const hashtagRegex = /#(\w+)/g;
    const matches = text.match(hashtagRegex) || [];
    return matches.map(match => match.slice(1));
  };

  const handleSyncPosition = async () => {
    // Only allow syncing shared positions that the current user doesn't own
    if (!position.shared || position.ownerId === currentUser?.id) return;

    setSyncInProgress(true);
    setSyncError(null);

    try {
      // Check for local changes that might need conflict resolution
      if (hasLocalChanges) {
        // Get the original position for conflict resolution
        const originalOwnerId = position.ownerId;
        const ownerPositions = userStorage.getOwnedPositions(originalOwnerId);
        const originalPosition = ownerPositions.find(p => p.id === position.originalId);

        if (originalPosition) {
          // Show conflict resolution with actual remote data
          setSyncInProgress(false);
          return;
        } else {
          // Original position no longer exists
          throw new Error('Original position not found. It may have been deleted by the owner.');
        }
      }

      // No conflicts, proceed with sync
      const success = await syncSharedPosition(position.id);

      if (success) {
        // Clear any existing local changes
        clearChanges(position.id);
      } else {
        setSyncError('Failed to sync position. Please try again.');
      }
    } catch (error) {
      console.error('Error syncing position:', error);
      setSyncError(error.message || 'Sync failed. Please try again.');
    } finally {
      setSyncInProgress(false);
    }
  };

  // Get account name from ID
  const getAccountName = (accountId) => {
    if (position.shared && position.ownerId !== currentUser?.id) {
      return "Account Hidden";
    }
    const account = accounts.find(acc => acc.id === accountId);
    return account ? account.name : accountId;
  };

  const formatCurrency = (value) => {
    if (!value || isNaN(value)) return '$0.00';
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD'
    });
  };

  // Calculate metrics from legs without strategy-specific logic
  const calculateMetrics = () => {
    if (!position.legs || position.legs.length === 0) return {};

    // Calculate total values from all legs
    const totalValues = position.legs.reduce((acc, leg) => {
      if (leg.type === 'stock') {
        const stockValue = leg.shares * leg.costBasis;
        return {
          ...acc,
          totalValue: (acc.totalValue || 0) + stockValue,
          stockValue: (acc.stockValue || 0) + stockValue
        };
      } else if (leg.type === 'option') {
        const optionValue = leg.contracts * leg.premium * 100;
        const multiplier = leg.side === 'long' ? -1 : 1; // Long pays premium, short receives
        return {
          ...acc,
          totalValue: (acc.totalValue || 0) + (optionValue * multiplier),
          optionValue: (acc.optionValue || 0) + optionValue,
          nextExpiration: !acc.nextExpiration || new Date(leg.expiration) < new Date(acc.nextExpiration)
            ? leg.expiration
            : acc.nextExpiration
        };
      }
      return acc;
    }, {});

    return totalValues;
  };

  const metrics = calculateMetrics();

  // Helper function to render leg details
  const renderLegDetails = (leg) => {
    if (leg.type === 'stock') {
      return (
        <>
          <span className="text-sm font-medium text-gray-900">
            {leg.side === 'long' ? 'Long' : 'Short'} Stock
          </span>
          <span className="text-xs text-gray-500">
            {`${leg.shares} shares @ ${formatCurrency(leg.costBasis)}`}
          </span>
        </>
      );
    } else if (leg.type === 'option') {
      return (
        <>
          <span className="text-sm font-medium text-gray-900">
            {`${leg.side === 'long' ? 'Long' : 'Short'} ${leg.optionType.toUpperCase()}`}
          </span>
          <span className="text-xs text-gray-500">
            {`${leg.contracts} contract${leg.contracts > 1 ? 's' : ''} @ ${formatCurrency(leg.premium)} - Strike ${formatCurrency(leg.strike)}`}
          </span>
          <span className="text-xs text-gray-400 ml-2">
            Expires: {new Date(leg.expiration).toLocaleDateString()}
          </span>
        </>
      );
    }
    return null;
  };

  // Render metrics without strategy-specific logic
  const renderMetrics = () => {
    return (
      <>
        {metrics.totalValue !== undefined && (
          <div>
            <span className="text-sm text-gray-500">Total Value</span>
            <p className="text-sm font-medium text-gray-900">
              {formatCurrency(metrics.totalValue)}
            </p>
          </div>
        )}
        {metrics.optionValue !== undefined && (
          <div>
            <span className="text-sm text-gray-500">Option Premium Value</span>
            <p className="text-sm font-medium text-blue-600">
              {formatCurrency(metrics.optionValue)}
            </p>
          </div>
        )}
        {metrics.nextExpiration && (
          <div>
            <span className="text-sm text-gray-500">Next Expiration</span>
            <p className="text-sm font-medium text-gray-900">
              {new Date(metrics.nextExpiration).toLocaleDateString()}
            </p>
          </div>
        )}
      </>
    );
  };

  // Handle comment adding/editing for this position
  const handleAddComment = (commentText) => {
    // Extract hashtags from the comment
    const extractedTags = extractHashtags(commentText);

    // Create a properly attributed comment
    const newComment = {
      id: `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      text: commentText,
      timestamp: new Date().toISOString(),
      author: currentUser.displayName || 'User',
      userId: currentUser.id,
      // Add extra metadata for syncing
      isSharedComment: position.ownerId !== currentUser?.id,
      extractedTags: extractedTags.length > 0 ? extractedTags : undefined
    };

    // Record change for optimistic updates
    if (position.shared) {
      recordChange(position.id, 'comments', {
        action: 'add',
        comment: newComment
      });

      // If tags were extracted, record those changes too
      if (extractedTags.length > 0) {
        recordChange(position.id, 'tags', {
          action: 'add',
          tags: extractedTags
        });
      }
    }

    // Get current tags (or empty array if none)
    const currentTags = position.tags || [];

    // Add new unique tags (prevent duplicates)
    const newTags = [...new Set([...currentTags, ...extractedTags])];

    const updatedPosition = {
      ...position,
      comments: [...(position.comments || []), newComment],
      tags: newTags,
      // Add activity tracking
      lastActivity: {
        type: 'comment_added',
        timestamp: new Date().toISOString(),
        userId: currentUser.id,
        userName: currentUser.displayName || 'User'
      }
    };

    onUpdatePosition(updatedPosition);
  };

  const handleEditComment = (commentId, updates) => {
    // For optimistic updates
    if (position.shared) {
      recordChange(position.id, 'comments', {
        action: 'edit',
        commentId,
        updates
      });
    }

    // Find the comment and update it
    const updatedComments = (position.comments || []).map(comment =>
      comment.id === commentId
        ? { ...comment, ...updates, editedAt: new Date().toISOString() }
        : comment
    );

    const updatedPosition = {
      ...position,
      comments: updatedComments
    };

    onUpdatePosition(updatedPosition);
  };

  const handleDeleteComment = (commentId) => {
    // For optimistic updates
    if (position.shared) {
      recordChange(position.id, 'comments', {
        action: 'delete',
        commentId
      });
    }

    // Filter out the deleted comment
    const updatedComments = (position.comments || []).filter(
      comment => comment.id !== commentId
    );

    const updatedPosition = {
      ...position,
      comments: updatedComments
    };

    onUpdatePosition(updatedPosition);
  };

  const handleAddLeg = () => {
    // We'll track the change when the leg is actually added in the parent
    onAddLeg(position);
  };

  const handleRemoveLeg = (legId) => {
    // Record change for optimistic updates if this is a shared position
    if (position.shared) {
      recordChange(position.id, 'legs', {
        action: 'remove',
        legId
      });
    }

    // Call the original onRemoveLeg prop
    onRemoveLeg(legId);
  };

  // Create wrapped version of onRemoveTag
  const handleRemoveTag = (tag) => {
    // Record change for optimistic updates if this is a shared position
    if (position.shared) {
      recordChange(position.id, 'tags', {
        action: 'remove',
        tag
      });
    }

    // Call the original onRemoveTag prop
    onRemoveTag(position, tag);
  };


  return (
    <div className="bg-white shadow rounded-lg hover:shadow-md transition-shadow">
      <div className="p-6">
        <div className="flex justify-between items-start">
          <div className="flex-grow">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-4">
                <button
                  onClick={onToggleExpand}
                  className="text-gray-500 hover:text-gray-700 mt-1"
                >
                  {isExpanded ?
                    <ChevronDown className="h-5 w-5" /> :
                    <ChevronRight className="h-5 w-5" />
                  }
                </button>
                <div className="flex-1">
                  <div className="flex items-center gap-4">
                    <h3 className="text-lg font-medium text-gray-900">{position.symbol}</h3>
                    <SharedPositionBadge position={position} />

                    {position.shared && position.ownerId !== currentUser?.id && (
                      <SyncStatusBadge
                        position={position}
                        onSync={handleSyncPosition}
                      />
                    )}

                    {position.tags && position.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {position.tags.map(tag => (
                          <span
                            key={tag}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
                          >
                            <Tag className="h-3.5 w-3.5 mr-1" />
                            {tag}
                            <button
                              onClick={() => handleRemoveTag(tag)}
                              className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-blue-400 hover:bg-blue-200 hover:text-blue-600 focus:outline-none"
                            >
                              <span className="sr-only">Remove tag</span>
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {getAccountName(position.account)}
                  </div>
                </div>
              </div>

              <PositionActions
                position={position}
                onToggleComments={onToggleExpand}
                onEdit={onEdit}
                onDelete={onDelete}
                commentCount={(position.comments || []).length}
              />
            </div>

            {/* Position Metrics */}
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4">
              {renderMetrics()}
            </div>

            {/* Sync error message */}
            {syncError && (
              <div className="mt-4 p-2 bg-red-50 text-red-600 text-sm rounded border border-red-200">
                <AlertCircle className="inline-block h-4 w-4 mr-1" />
                {syncError}
              </div>
            )}

            {isExpanded && (
              <div className="mt-6 space-y-4">
                {/* Activity Log Section */}
                {position.activityLog && position.activityLog.length > 0 && (
                  <div className="border-t pt-4">
                    <ActivityLog activities={position.activityLog} />
                  </div>
                )}

                {/* Position Legs Section */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-medium text-gray-700">Position Legs</h4>
                    <button
                      onClick={handleAddLeg}
                      className="inline-flex items-center px-2 py-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                    >
                      <PlusCircle className="h-4 w-4 mr-1" />
                      Add Leg
                    </button>
                  </div>

                  <div className="space-y-3">
                    {position.legs && position.legs.length > 0 ? (
                      position.legs.map((leg) => (
                        <div
                          key={leg.id}
                          className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"
                        >
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <Link className="h-4 w-4 text-gray-400" />
                              {renderLegDetails(leg)}
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveLeg(leg.id)}
                            className="p-1 text-gray-400 hover:text-red-500 rounded-full hover:bg-gray-100"
                          >
                            <span className="sr-only">Remove leg</span>
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-4 text-sm text-gray-500">
                        No legs added yet
                      </div>
                    )}
                  </div>
                </div>

                {/* Comments Section */}
                <div className="mt-6 pt-6 border-t">
                  <Comments
                    comments={position.comments || []}
                    onAddComment={handleAddComment}
                    onEditComment={handleEditComment}
                    onDeleteComment={handleDeleteComment}
                  />
                </div>
                {syncInProgress && (
                  <div className="flex items-center mt-2 text-blue-600">
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    <span className="text-sm">Syncing changes...</span>
                  </div>
                )}
                {hasLocalChanges && (
                  <div className="mt-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-md">
                    <div className="flex items-center text-yellow-700">
                      <AlertCircle className="w-4 h-4 mr-2" />
                      <span className="text-sm font-medium">You have unsaved changes</span>
                    </div>
                    <div className="mt-1 text-xs text-yellow-600">
                      Last modified: {new Date(unsavedChanges.timestamp).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
};

export default ExpandedPositionCard;