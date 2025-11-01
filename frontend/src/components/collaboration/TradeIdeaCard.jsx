/**
 * TradeIdeaCard - Compact, functional card for trade ideas with chat panel
 * 
 * Features:
 * - Compact collapsed view with key metrics
 * - Expandable to show details + discussion panel on right
 * - Chat-style discussion thread (not editable notes)
 * - Inline tag management
 * - Share with friends
 * - Reactions on messages
 */
import React, { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { 
  ChevronDown,
  ChevronRight,
  Tag,
  Share2,
  Trash2,
  Send,
  ThumbsUp,
  Heart,
  Lightbulb,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Clock,
  Target,
  Zap,
  X
} from 'lucide-react';
import { 
  updateTradeIdea,
  updateTradeIdeaTags,
  deleteTradeIdea,
  unshareFromMe,
  getPositionComments,
  addPositionComment,
  shareTradeIdea
} from '../../services/collaboration';
import { useFriends } from '../../contexts/FriendsContext';
import { useUser } from '../../contexts/UserContext';

export const TradeIdeaCard = ({ position, isOwner, highlightId }) => {
  const queryClient = useQueryClient();
  const { getActiveFriends } = useFriends();
  const { currentUser, users } = useUser();
  const friends = getActiveFriends();

  // Get creator info for shared positions
  const creator = !isOwner && position.user_id 
    ? users.find(u => u.id === position.user_id)
    : null;

  const [isExpanded, setIsExpanded] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedFriends, setSelectedFriends] = useState(new Set());
  
  // Initialize selected friends when opening share modal
  useEffect(() => {
    if (showShareModal && position.shared_with) {
      setSelectedFriends(new Set(position.shared_with));
    }
  }, [showShareModal, position.shared_with]);
  
  // Tag management
  const [tagInput, setTagInput] = useState('');
  
  // Discussion
  const [messageInput, setMessageInput] = useState('');
  const discussionRef = useRef(null);
  
  // Auto-expand if this is the highlighted position
  useEffect(() => {
    if (highlightId === position.id) {
      setIsExpanded(true);
      // Scroll into view after a brief delay
      setTimeout(() => {
        document.getElementById(`trade-idea-${position.id}`)?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }, 300);
    }
  }, [highlightId, position.id]);

  // Fetch comments/discussion
  const { data: commentsData } = useQuery({
    queryKey: ['comments', position.id],
    queryFn: () => getPositionComments(position.id),
    enabled: isExpanded
  });

  const comments = commentsData?.comments || [];

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (updates) => updateTradeIdea(position.id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions', 'ideas'] });
    }
  });

  // Tag mutation (for both owners and recipients)
  const tagMutation = useMutation({
    mutationFn: (tags) => updateTradeIdeaTags(position.id, tags),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions', 'ideas'] });
      queryClient.invalidateQueries({ queryKey: ['positions', 'shared'] });
    }
  });

  // Delete mutation (for owners only)
  const deleteMutation = useMutation({
    mutationFn: () => deleteTradeIdea(position.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions', 'ideas'] });
    }
  });

  // Unshare mutation (for recipients)
  const unshareMutation = useMutation({
    mutationFn: () => unshareFromMe(position.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions', 'shared'] });
    }
  });

  // Add comment mutation
  const addCommentMutation = useMutation({
    mutationFn: (text) => addPositionComment(position.id, text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', position.id] });
      setMessageInput('');
      // Scroll to top of discussion panel to see new comment
      setTimeout(() => {
        if (discussionRef.current) {
          discussionRef.current.scrollTop = 0;
        }
      }, 100);
    }
  });

  // Share mutation
  const shareMutation = useMutation({
    mutationFn: (friendIds) => shareTradeIdea(position.id, friendIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions', 'ideas'] });
      queryClient.invalidateQueries({ queryKey: ['positions', 'shared'] });
      setShowShareModal(false);
      setSelectedFriends(new Set());
    }
  });

  const handleAddTag = () => {
    if (!tagInput.trim()) return;
    const currentTags = position.tags || [];
    if (!currentTags.includes(tagInput.trim())) {
      tagMutation.mutate([...currentTags, tagInput.trim()]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove) => {
    const currentTags = position.tags || [];
    tagMutation.mutate(currentTags.filter(t => t !== tagToRemove));
  };

  const handleSendMessage = () => {
    if (!messageInput.trim()) return;
    addCommentMutation.mutate(messageInput);
  };

  const handleShare = () => {
    // Convert Set to Array of friend IDs
    // Empty array means unshare from all (remove all shares)
    const friendIds = Array.from(selectedFriends);
    console.log('Updating shares - friend IDs:', friendIds);
    shareMutation.mutate(friendIds);
  };

  const handleDelete = () => {
    if (isOwner) {
      if (window.confirm('Are you sure you want to delete this trade idea? This will remove it for everyone.')) {
        deleteMutation.mutate();
      }
    } else {
      if (window.confirm('Remove this trade idea from your view?')) {
        unshareMutation.mutate();
      }
    }
  };

  const formatCurrency = (value) => {
    if (!value) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getStatusIcon = (status) => {
    const icons = {
      planned: Clock,
      watching: Target,
      active: Zap,
      executed: CheckCircle2,
      closed: AlertCircle,
      cancelled: X
    };
    return icons[status] || Clock;
  };

  const getStatusColor = (status) => {
    const colors = {
      planned: 'bg-blue-100 text-blue-700',
      watching: 'bg-yellow-100 text-yellow-700',
      active: 'bg-green-100 text-green-700',
      executed: 'bg-purple-100 text-purple-700',
      closed: 'bg-gray-100 text-gray-700',
      cancelled: 'bg-red-100 text-red-700'
    };
    return colors[status] || colors.active;
  };

  const StatusIcon = getStatusIcon(position.status);
  const isHighlighted = highlightId === position.id;

  return (
    <div 
      id={`trade-idea-${position.id}`}
      className={`bg-white rounded-lg border transition-all ${
        isHighlighted 
          ? 'border-blue-500 shadow-lg ring-2 ring-blue-200' 
          : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
      }`}
    >
      {/* Compact Header - Always Visible */}
      <div className="p-3">
        <div className="flex items-center justify-between">
          {/* Left: Symbol, Status, Strategy */}
          <div className="flex items-center gap-3 flex-1">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </button>
            
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-gray-900">{position.symbol}</h3>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(position.status)}`}>
                <StatusIcon className="w-3 h-3" />
                {position.status || 'active'}
              </span>
              {/* Show creator for shared positions */}
              {creator && (
                <span className="text-xs text-gray-500 italic">
                  by {creator.displayName || creator.username}
                </span>
              )}
            </div>

            <span className="text-xs text-gray-500">
              {position.strategy_type?.replace(/_/g, ' ')}
            </span>
          </div>

          {/* Center: Key Metrics */}
          <div className="hidden md:flex items-center gap-4 text-xs">
            {position.target_quantity && (
              <div className="text-gray-600">
                Qty: <span className="font-semibold text-gray-900">{position.target_quantity}</span>
              </div>
            )}
            {position.max_profit && (
              <div className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-green-600" />
                <span className="font-semibold text-green-600">{formatCurrency(position.max_profit)}</span>
              </div>
            )}
            {position.max_loss && (
              <div className="flex items-center gap-1">
                <TrendingDown className="w-3 h-3 text-red-600" />
                <span className="font-semibold text-red-600">{formatCurrency(Math.abs(position.max_loss))}</span>
              </div>
            )}
            <div className="text-gray-600">
              {position.legs?.length || 0} legs
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 ml-3">
            {/* Discussion comment count */}
            {comments.length > 0 && (
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                {comments.length}
              </span>
            )}
            
            {/* Shared indicator with count */}
            {position.shared_with && position.shared_with.length > 0 && (
              <div className="flex items-center gap-1 px-2 py-0.5 bg-green-50 border border-green-200 rounded-full">
                <Share2 className="w-3 h-3 text-green-600" />
                <span className="text-xs font-medium text-green-700">
                  {position.shared_with.length}
                </span>
              </div>
            )}
            
            {isOwner && (
              <button
                onClick={() => setShowShareModal(true)}
                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                title="Share with friends"
              >
                <Share2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={handleDelete}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              title={isOwner ? "Delete" : "Remove from my view"}
            >
              {isOwner ? <Trash2 className="w-4 h-4" /> : <X className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Tags - Always visible if present */}
        {position.tags && position.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {position.tags.map((tag, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs group"
              >
                {tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove tag"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-200">
          <div className="flex">
            {/* Left Side: Details - 50% */}
            <div className="w-1/2 p-4 space-y-4 border-r border-gray-200">
              {/* Additional Metrics */}
              <div className="grid grid-cols-3 gap-3 text-sm">
                {position.target_entry_price && (
                  <div>
                    <span className="text-gray-600">Target Entry:</span>
                    <div className="font-semibold text-gray-900">{formatCurrency(position.target_entry_price)}</div>
                  </div>
                )}
                <div>
                  <span className="text-gray-600">Created:</span>
                  <div className="font-semibold text-gray-900">{formatDate(position.created_at)}</div>
                </div>
                {position.shared_with && position.shared_with.length > 0 && (
                  <div>
                    <span className="text-gray-600">Shared with:</span>
                    <div className="font-semibold text-gray-900">{position.shared_with.length} friends</div>
                  </div>
                )}
              </div>

              {/* Position Legs */}
              {position.legs && position.legs.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Position Legs</h4>
                  <div className="space-y-1.5">
                    {position.legs.map((leg, idx) => {
                      const isStock = leg.asset_type === 'EQUITY' || !leg.option_type;
                      
                      return (
                        <div key={idx} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            {isStock ? (
                              <>
                                <span className="px-1.5 py-0.5 rounded font-medium bg-blue-100 text-blue-700">
                                  STOCK
                                </span>
                                <span className="font-medium">{leg.symbol}</span>
                              </>
                            ) : (
                              <>
                                <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                                  leg.option_type === 'call' 
                                    ? 'bg-blue-600 text-white' 
                                    : 'bg-purple-600 text-white'
                                }`}>
                                  {leg.option_type === 'call' ? 'C' : 'P'}
                                </span>
                                <span className="font-medium">${leg.strike}</span>
                                <span className="text-gray-600">{formatDate(leg.expiration)}</span>
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-gray-600">
                            <span>Qty: {leg.quantity}</span>
                            {leg.premium && <span>Premium: {formatCurrency(leg.premium)}</span>}
                            {isStock && leg.current_price && <span>Price: {formatCurrency(leg.current_price)}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Add Tags */}
              {isOwner && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Tags</h4>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                      placeholder="Add a tag..."
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <button
                      onClick={handleAddTag}
                      disabled={!tagInput.trim()}
                      className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm flex items-center gap-1"
                    >
                      <Tag className="w-3 h-3" />
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Right Side: Discussion Panel - 50% */}
            <div className="w-1/2 flex flex-col bg-gray-50">
              {/* Discussion Header */}
              <div className="p-3 border-b border-gray-200 bg-white">
                <h4 className="text-sm font-semibold text-gray-900">Discussion</h4>
                <p className="text-xs text-gray-600">{comments.length} messages</p>
              </div>

              {/* Messages Thread */}
              <div ref={discussionRef} className="flex-1 overflow-y-auto p-3 space-y-3 max-h-96">
                {comments.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-gray-500">No messages yet</p>
                    <p className="text-xs text-gray-400 mt-1">Start the discussion!</p>
                  </div>
                ) : (
                  comments.map((comment) => (
                    <div key={comment.id} className="bg-white rounded-lg p-2.5 shadow-sm">
                      <div className="flex items-start justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                            <span className="text-xs font-medium text-blue-700">
                              {comment.user?.display_name?.[0] || 'U'}
                            </span>
                          </div>
                          <span className="text-xs font-medium text-gray-900">
                            {comment.user?.display_name || 'User'}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {formatDateTime(comment.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 ml-8">{comment.text}</p>
                      
                      {/* Quick Reactions */}
                      <div className="flex items-center gap-2 mt-2 ml-8">
                        <button className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full hover:bg-gray-100 transition-colors">
                          <ThumbsUp className="w-3 h-3 text-gray-400" />
                          <span className="text-xs text-gray-600">{comment.reactions?.thumbsup || 0}</span>
                        </button>
                        <button className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full hover:bg-gray-100 transition-colors">
                          <Heart className="w-3 h-3 text-gray-400" />
                          <span className="text-xs text-gray-600">{comment.reactions?.heart || 0}</span>
                        </button>
                        <button className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full hover:bg-gray-100 transition-colors">
                          <Lightbulb className="w-3 h-3 text-gray-400" />
                          <span className="text-xs text-gray-600">{comment.reactions?.idea || 0}</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Message Input */}
              <div className="p-3 border-t border-gray-200 bg-white">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Add to discussion..."
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!messageInput.trim() || addCommentMutation.isPending}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowShareModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Share2 className="w-5 h-5 text-gray-400" />
                <h3 className="text-lg font-medium text-gray-900">Share Trade Idea</h3>
              </div>
              <button onClick={() => setShowShareModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 max-h-96 overflow-y-auto">
              {friends.length === 0 ? (
                <p className="text-center text-gray-500 py-4">No friends available</p>
              ) : (
                <div className="space-y-2">
                  {friends.map((friend) => {
                    const alreadyShared = position.shared_with && position.shared_with.includes(friend.id);
                    return (
                      <div key={friend.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                            <span className="text-gray-500 font-medium">{friend.displayName?.[0] || 'F'}</span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {friend.displayName}
                              {alreadyShared && (
                                <span className="ml-2 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                                  Shared
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500">{friend.username}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            const newSelection = new Set(selectedFriends);
                            if (newSelection.has(friend.id)) {
                              newSelection.delete(friend.id);
                            } else {
                              newSelection.add(friend.id);
                            }
                            setSelectedFriends(newSelection);
                          }}
                          className={`p-2 rounded-full transition-colors ${
                            selectedFriends.has(friend.id)
                              ? 'bg-blue-100 text-blue-600'
                              : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                          }`}
                        >
                          <CheckCircle2 className="w-5 h-5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowShareModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleShare}
                disabled={shareMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {shareMutation.isPending ? 'Updating...' : 
                 selectedFriends.size === 0 ? 'Remove All Shares' :
                 `Update (${selectedFriends.size} selected)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
