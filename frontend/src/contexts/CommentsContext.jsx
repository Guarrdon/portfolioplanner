import React, { createContext, useContext, useReducer } from 'react';
import { useUser } from './UserContext';
import { usePortfolio } from './PortfolioContext';
import { userStorage } from '../utils/storage/storage';

const CommentsContext = createContext();

const initialState = {
  comments: {},  // Keyed by positionId
  loading: true,
  error: null
};

// Comment types
const COMMENT_TYPES = {
  INITIAL_NOTE: 'initial_note',
  POSITION_UPDATE: 'position_update',
  ADJUSTMENT: 'adjustment',
  USER_NOTE: 'user_note'
};

function commentsReducer(state, action) {
  switch (action.type) {
    case 'INITIALIZE_POSITION_COMMENTS': {
      const { positionId, comments } = action.payload;
      return {
        ...state,
        comments: {
          ...state.comments,
          [positionId]: comments
        },
        loading: false
      };
    }

    case 'ADD_COMMENT': {
      const { positionId, comment } = action.payload;
      const currentComments = state.comments[positionId] || [];

      return {
        ...state,
        comments: {
          ...state.comments,
          [positionId]: [...currentComments, comment]
        }
      };
    }

    case 'EDIT_COMMENT': {
      const { positionId, commentId, updates } = action.payload;
      const currentComments = state.comments[positionId] || [];

      return {
        ...state,
        comments: {
          ...state.comments,
          [positionId]: currentComments.map(comment =>
            comment.id === commentId
              ? { ...comment, ...updates, editedAt: new Date().toISOString() }
              : comment
          )
        }
      };
    }

    case 'DELETE_COMMENT': {
      const { positionId, commentId } = action.payload;
      const currentComments = state.comments[positionId] || [];

      return {
        ...state,
        comments: {
          ...state.comments,
          [positionId]: currentComments.filter(comment => comment.id !== commentId)
        }
      };
    }

    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
        loading: false
      };

    case 'CLEAR_ERROR':
      return {
        ...state,
        error: null
      };

    default:
      return state;
  }
}

export function CommentsProvider({ children }) {
  const [state, dispatch] = useReducer(commentsReducer, initialState);
  const { currentUser } = useUser();
  const { getPositionById, isPositionOwner } = usePortfolio();

  // Comment permissions check
  const canModifyComment = (comment) => {
    if (!currentUser) return false;
    // Users can modify their own comments
    if (comment.userId === currentUser.id) return true;
    // Position owners can modify any comment on their positions
    return isPositionOwner(comment.positionId);
  };

  // Load comments for a position
  const loadPositionComments = async (positionId) => {
    if (!currentUser?.id) return;

    try {
      const position = getPositionById(positionId);
      if (!position) return;

      const comments = position.comments || [];
      dispatch({
        type: 'INITIALIZE_POSITION_COMMENTS',
        payload: { positionId, comments }
      });
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload: 'Error loading comments'
      });
    }
  };

  const value = {
    ...state,
    commentTypes: COMMENT_TYPES,
    
    addComment: async (comment) => {
      if (!currentUser?.id) return false;

      try {
        const position = getPositionById(comment.positionId);
        if (!position) throw new Error('Position not found');

        const newComment = {
          ...comment,
          id: comment.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          userId: currentUser.id,
          author: currentUser.displayName || 'User',
          timestamp: new Date().toISOString(),
          type: comment.type || COMMENT_TYPES.USER_NOTE
        };

        const success = await userStorage.saveComment(
          currentUser.id,
          comment.positionId,
          newComment
        );

        if (success) {
          dispatch({
            type: 'ADD_COMMENT',
            payload: { positionId: comment.positionId, comment: newComment }
          });
        }

        return success;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },

    editComment: async (commentId, positionId, updates) => {
      if (!currentUser?.id) return false;

      try {
        const currentComments = state.comments[positionId] || [];
        const comment = currentComments.find(c => c.id === commentId);
        
        if (!comment) throw new Error('Comment not found');
        if (!canModifyComment(comment)) throw new Error('Not authorized to edit this comment');

        const updatedComment = {
          ...comment,
          ...updates,
          editedAt: new Date().toISOString(),
          editedBy: currentUser.id
        };

        const position = getPositionById(positionId);
        const updatedPosition = {
          ...position,
          comments: currentComments.map(c => 
            c.id === commentId ? updatedComment : c
          )
        };

        // Save to appropriate storage based on ownership
        const success = isPositionOwner(positionId)
          ? userStorage.saveOwnedPosition(currentUser.id, updatedPosition)
          : userStorage.saveSharedPosition(currentUser.id, updatedPosition);

        if (success) {
          dispatch({
            type: 'EDIT_COMMENT',
            payload: { positionId, commentId, updates }
          });
        }

        return success;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },

    deleteComment: async (commentId, positionId) => {
      if (!currentUser?.id) return false;

      try {
        const currentComments = state.comments[positionId] || [];
        const comment = currentComments.find(c => c.id === commentId);
        
        if (!comment) throw new Error('Comment not found');
        if (!canModifyComment(comment)) throw new Error('Not authorized to delete this comment');

        const position = getPositionById(positionId);
        const updatedPosition = {
          ...position,
          comments: currentComments.filter(c => c.id !== commentId)
        };

        // Save to appropriate storage based on ownership
        const success = isPositionOwner(positionId)
          ? userStorage.saveOwnedPosition(currentUser.id, updatedPosition)
          : userStorage.saveSharedPosition(currentUser.id, updatedPosition);

        if (success) {
          dispatch({
            type: 'DELETE_COMMENT',
            payload: { positionId, commentId }
          });
        }

        return success;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },

    getCommentsByPosition: (positionId) => {
      if (!state.comments[positionId]) {
        loadPositionComments(positionId);
        return [];
      }
      return state.comments[positionId];
    },

    clearError: () => {
      dispatch({ type: 'CLEAR_ERROR' });
    }
  };

  return (
    <CommentsContext.Provider value={value}>
      {children}
    </CommentsContext.Provider>
  );
}

export function useComments() {
  const context = useContext(CommentsContext);
  if (context === undefined) {
    throw new Error('useComments must be used within a CommentsProvider');
  }
  return context;
}

export default CommentsContext;