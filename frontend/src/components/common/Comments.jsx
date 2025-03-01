import React, { useState, useCallback } from 'react';
import { format } from 'date-fns';
import { MessageSquare, Edit2, Trash2, Send } from 'lucide-react';

const Comments = ({ 
  comments = [], 
  onAddComment, 
  onEditComment, 
  onDeleteComment 
}) => {
  const [newComment, setNewComment] = useState('');
  const [editingComment, setEditingComment] = useState(null);
  const [editedText, setEditedText] = useState('');

  const handleSubmitComment = useCallback((e) => {
    e.preventDefault();
    const trimmedComment = newComment.trim();
    if (!trimmedComment) return;

    onAddComment(trimmedComment);
    setNewComment(''); // Only clear the comment input, not the whole form
  }, [newComment, onAddComment]);

  const handleStartEdit = useCallback((comment) => {
    setEditingComment(comment.id);
    setEditedText(comment.text);
  }, []);

  const handleSaveEdit = useCallback((commentId) => {
    const trimmedText = editedText.trim();
    if (!trimmedText) return;

    onEditComment(commentId, {
      text: trimmedText
    });

    setEditingComment(null);
    setEditedText('');
  }, [editedText, onEditComment]);

  const handleCancelEdit = useCallback(() => {
    setEditingComment(null);
    setEditedText('');
  }, []);

  const sortedComments = [...comments].sort((a, b) => 
    new Date(b.timestamp) - new Date(a.timestamp)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2 text-gray-700">
        <MessageSquare className="w-5 h-5" />
        <h3 className="text-lg font-medium">Comments</h3>
      </div>

      {/* Add Comment Form */}
      <form onSubmit={handleSubmitComment} className="mb-4">
        <div className="flex space-x-2">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            rows={1}
          />
          <button
            type="submit"
            disabled={!newComment.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>

      {/* Comments List */}
      <div className="space-y-3">
        {sortedComments.map((comment) => (
          <div 
            key={comment.id}
            className="bg-white rounded-lg shadow-sm border p-3 space-y-2"
          >
            {editingComment === comment.id ? (
              <div className="space-y-2">
                <textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                  rows={3}
                />
                <div className="flex justify-end space-x-2">
                  <button
                    onClick={handleCancelEdit}
                    className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleSaveEdit(comment.id)}
                    disabled={!editedText.trim()}
                    className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-medium text-gray-900">
                        {comment.author || 'User'}
                      </span>
                      <span className="text-sm text-gray-500">
                        {format(new Date(comment.timestamp), 'MMM d, yyyy h:mm a')}
                      </span>
                    </div>
                    <p className="text-gray-700 whitespace-pre-wrap">{comment.text}</p>
                    {comment.editedAt && (
                      <span className="text-xs text-gray-500 italic">
                        Edited {format(new Date(comment.editedAt), 'MMM d, yyyy h:mm a')}
                      </span>
                    )}
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleStartEdit(comment)}
                      className="p-1 text-gray-400 hover:text-blue-500 rounded-full hover:bg-gray-100"
                      title="Edit comment"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDeleteComment(comment.id)}
                      className="p-1 text-gray-400 hover:text-red-500 rounded-full hover:bg-gray-100"
                      title="Delete comment"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}

        {sortedComments.length === 0 && (
          <div className="text-center py-4 text-sm text-gray-500">
            No comments yet
          </div>
        )}
      </div>
    </div>
  );
};

export default Comments;