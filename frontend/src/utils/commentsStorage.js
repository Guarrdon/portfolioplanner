const COMMENTS_STORAGE_KEY = 'portfolio_planner_comments';

const commentsStorage = {
  getAllComments: () => {
    try {
      const comments = localStorage.getItem(COMMENTS_STORAGE_KEY);
      if (!comments) return [];
      
      // Remove duplicates by ID when retrieving
      const parsed = JSON.parse(comments);
      const uniqueComments = Array.from(
        new Map(parsed.map(item => [item.id, item])).values()
      );
      return uniqueComments;
    } catch (error) {
      console.error('Error retrieving comments:', error);
      return [];
    }
  },

  addComment: (comment) => {
    try {
      // Ensure we have all required fields
      if (!comment.id || !comment.positionId || !comment.text) {
        console.error('Missing required comment fields:', comment);
        return false;
      }
  
      const currentComments = commentsStorage.getAllComments();
      
      // Check if comment already exists
      const exists = currentComments.some(c => c.id === comment.id);
      if (exists) {
        // Return true since it's already stored successfully
        return true;
      }
  
      const updatedComments = [...currentComments, comment];
      localStorage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify(updatedComments));
      
      // Verify the comment was saved
      const savedComments = commentsStorage.getAllComments();
      const commentSaved = savedComments.some(c => c.id === comment.id);
      
      if (commentSaved) {
        console.log('Comment saved successfully:', {
          commentId: comment.id,
          positionId: comment.positionId,
          totalComments: savedComments.length
        });
      }
      
      return commentSaved;
    } catch (error) {
      console.error('Error adding comment:', error);
      return false;
    }
  },

  getCommentsByPosition: (positionId) => {
    try {
      if (!positionId) {
        console.warn('No positionId provided to getCommentsByPosition');
        return [];
      }

      const allComments = commentsStorage.getAllComments();
      const positionComments = allComments.filter(comment => comment.positionId === positionId);
      
      return positionComments;
    } catch (error) {
      console.error('Error retrieving comments for position:', error);
      return [];
    }
  },

  editComment: (commentId, updates) => {
    try {
      const comments = commentsStorage.getAllComments();
      const updatedComments = comments.map(comment =>
        comment.id === commentId
          ? { ...comment, ...updates }
          : comment
      );
      localStorage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify(updatedComments));
      return true;
    } catch (error) {
      console.error('Error editing comment:', error);
      return false;
    }
  },

  deleteComment: (commentId) => {
    try {
      const comments = commentsStorage.getAllComments();
      const updatedComments = comments.filter(comment => comment.id !== commentId);
      localStorage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify(updatedComments));
      return true;
    } catch (error) {
      console.error('Error deleting comment:', error);
      return false;
    }
  },

  deletePositionComments: (positionId) => {
    try {
      const comments = commentsStorage.getAllComments();
      const updatedComments = comments.filter(comment => comment.positionId !== positionId);
      localStorage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify(updatedComments));
      return true;
    } catch (error) {
      console.error('Error deleting position comments:', error);
      return false;
    }
  }
};

export default commentsStorage;