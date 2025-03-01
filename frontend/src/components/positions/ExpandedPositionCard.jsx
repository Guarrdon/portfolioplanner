import React from 'react';
import { ChevronDown, ChevronRight, Tag, PlusCircle, Link, RefreshCw } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import Comments from '../common/Comments';
import PositionActions from './PositionActions';
import { useAccounts } from '../../contexts/AccountsContext';
import SharedPositionBadge from '../common/SharedPositionBadge';
import { useUser } from '../../contexts/UserContext';
import SharedUpdatesIndicator from './SharedUpdatesIndicator';

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

  const handleSyncPosition = async () => {
    // Only allow syncing shared positions that the current user doesn't own
    if (position.shared && position.ownerId !== currentUser?.id) {
      const success = await syncSharedPosition(position.id);
      if (success) {
        // You could add a notification here if you want
        console.log('Position synced successfully');
      }
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

  // Add this function to extract hashtags from text
  const extractHashtags = (text) => {
    const hashtagRegex = /#(\w+)/g;
    const matches = text.match(hashtagRegex) || [];
    return matches.map(match => match.slice(1)); // Remove the # character
  };


  // Handle comment adding/editing for this position
  const handleAddComment = (commentText) => {
    // Extract hashtags from the comment
    const extractedTags = extractHashtags(commentText);

    // Get current tags (or empty array if none)
    const currentTags = position.tags || [];

    // Add new unique tags (prevent duplicates)
    const newTags = [...new Set([...currentTags, ...extractedTags])];

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
    const updatedComments = (position.comments || []).filter(
      comment => comment.id !== commentId
    );

    const updatedPosition = {
      ...position,
      comments: updatedComments
    };
    onUpdatePosition(updatedPosition);
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
                      <button
                        onClick={handleSyncPosition}
                        className="inline-flex items-center rounded-full p-1 text-purple-600 hover:bg-purple-100"
                        title="Sync with original position"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    )}
                    {position.shared && position.ownerId === currentUser?.id && (
                      <SharedUpdatesIndicator positionId={position.id} />
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
                              onClick={() => onRemoveTag(position, tag)}
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

            {isExpanded && (
              <div className="mt-6 space-y-4">
                {/* Position Legs Section */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-medium text-gray-700">Position Legs</h4>
                    <button
                      onClick={() => onAddLeg(position)}
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
                            onClick={() => onRemoveLeg(leg.id)}
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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExpandedPositionCard;