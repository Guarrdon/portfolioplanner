// src/contexts/FriendsContext.jsx

import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { useUser } from './UserContext';

const FriendsContext = createContext();

const buildUserRelationshipKey = (userId) => `user_${userId}_relationships`;

const initialState = {
  relationships: [],
  loading: true,
  error: null
};

function friendsReducer(state, action) {
  switch (action.type) {
    case 'INITIALIZE_RELATIONSHIPS': {
      return {
        ...state,
        relationships: action.payload,
        loading: false,
        error: null
      };
    }

    case 'ADD_RELATIONSHIP': {
      if (state.relationships.some(rel => rel.userId === action.payload.userId)) {
        return state;
      }
      return {
        ...state,
        relationships: [...state.relationships, action.payload],
        error: null
      };
    }

    case 'REMOVE_RELATIONSHIP': {
      return {
        ...state,
        relationships: state.relationships.filter(
          rel => rel.userId !== action.payload
        ),
        error: null
      };
    }

    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload
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

export function FriendsProvider({ children }) {
  const [state, dispatch] = useReducer(friendsReducer, initialState);
  const { currentUser, users } = useUser();

  // Load relationships when user changes
  const loadUserRelationships = useCallback(async () => {
    if (!currentUser?.id) return;

    try {
      let storedData = localStorage.getItem(buildUserRelationshipKey(currentUser.id));
      let relationships = storedData ? JSON.parse(storedData) : [];
      
      // MIGRATION: Fix old friend IDs (1, 2) to UUIDs
      const needsMigration = relationships.some(rel => rel.userId === '1' || rel.userId === '2');
      
      if (needsMigration) {
        console.log('🔧 Migrating friend IDs to UUIDs...');
        relationships = relationships.map(rel => {
          if (rel.userId === '1') {
            return { ...rel, userId: '00000000-0000-0000-0000-000000000001' };
          } else if (rel.userId === '2') {
            return { ...rel, userId: '00000000-0000-0000-0000-000000000002' };
          }
          return rel;
        });
        
        // Save migrated relationships
        localStorage.setItem(buildUserRelationshipKey(currentUser.id), JSON.stringify(relationships));
        console.log('✅ Friend IDs migrated');
      }
      
      dispatch({ type: 'INITIALIZE_RELATIONSHIPS', payload: relationships });
    } catch (error) {
      dispatch({ 
        type: 'SET_ERROR', 
        payload: 'Error loading relationships' 
      });
    }
  }, [currentUser?.id]);

  useEffect(() => {
    loadUserRelationships();
  }, [currentUser?.id, loadUserRelationships]);

  const saveRelationships = (relationships) => {
    if (!currentUser?.id) return false;
    
    try {
      localStorage.setItem(
        buildUserRelationshipKey(currentUser.id),
        JSON.stringify(relationships)
      );
      return true;
    } catch (error) {
      console.error('Error saving relationships:', error);
      return false;
    }
  };

  const createReciprocal = (userId, friendId) => {
    try {
      const friendKey = buildUserRelationshipKey(friendId);
      const storedData = localStorage.getItem(friendKey);
      const friendRelationships = storedData ? JSON.parse(storedData) : [];

      if (!friendRelationships.some(rel => rel.userId === userId)) {
        const newRelationship = {
          userId,
          createdAt: new Date().toISOString(),
          status: 'active',
          type: 'individual'
        };
        friendRelationships.push(newRelationship);
        localStorage.setItem(friendKey, JSON.stringify(friendRelationships));
      }
      return true;
    } catch (error) {
      console.error('Error creating reciprocal relationship:', error);
      return false;
    }
  };

  const value = {
    ...state,

    // Add a relationship (bidirectional)
    addRelationship: async (friendId) => {
      if (!currentUser?.id) return false;

      try {
        // Validate friend exists
        const friendUser = users.find(u => u.id === friendId);
        if (!friendUser) {
          throw new Error('User not found');
        }

        if (friendId === currentUser.id) {
          throw new Error('Cannot add yourself as a friend');
        }

        const newRelationship = {
          userId: friendId,
          createdAt: new Date().toISOString(),
          status: 'active',
          type: 'individual'
        };

        // Add relationship to current user's list
        const updatedRelationships = [...state.relationships, newRelationship];
        const saved = saveRelationships(updatedRelationships);

        if (saved) {
          // Create reciprocal relationship
          const reciprocal = createReciprocal(currentUser.id, friendId);
          if (!reciprocal) {
            console.warn('Failed to create reciprocal relationship');
          }

          dispatch({ type: 'ADD_RELATIONSHIP', payload: newRelationship });
          return true;
        }
        return false;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },

    // Remove a relationship (bidirectional)
    removeRelationship: async (friendId) => {
      if (!currentUser?.id) return false;

      try {
        // Remove from current user's list
        const updatedRelationships = state.relationships.filter(
          rel => rel.userId !== friendId
        );
        const saved = saveRelationships(updatedRelationships);

        if (saved) {
          // Remove reciprocal relationship
          const friendKey = buildUserRelationshipKey(friendId);
          const storedData = localStorage.getItem(friendKey);
          if (storedData) {
            const friendRelationships = JSON.parse(storedData);
            const updatedFriendRelationships = friendRelationships.filter(
              rel => rel.userId !== currentUser.id
            );
            localStorage.setItem(friendKey, JSON.stringify(updatedFriendRelationships));
          }

          dispatch({ type: 'REMOVE_RELATIONSHIP', payload: friendId });
          return true;
        }
        return false;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },

    // Check if users have a relationship
    hasRelationship: (userId) => {
      return state.relationships.some(rel => 
        rel.userId === userId && rel.status === 'active'
      );
    },

    // Get friend details with relationship info
    getFriendDetails: (friendId) => {
      const user = users.find(u => u.id === friendId);
      if (!user) return null;

      const relationship = state.relationships.find(rel => rel.userId === friendId);
      return {
        ...user,
        relationship
      };
    },

    // Get all active friends with details
    getActiveFriends: () => {
      return state.relationships
        .filter(rel => rel.status === 'active')
        .map(rel => ({
          ...users.find(u => u.id === rel.userId),
          relationship: rel
        }))
        .filter(Boolean);
    },

    clearError: () => {
      dispatch({ type: 'CLEAR_ERROR' });
    }
  };

  return (
    <FriendsContext.Provider value={value}>
      {children}
    </FriendsContext.Provider>
  );
}

export function useFriends() {
  const context = useContext(FriendsContext);
  if (context === undefined) {
    throw new Error('useFriends must be used within a FriendsProvider');
  }
  return context;
}

export default FriendsContext;