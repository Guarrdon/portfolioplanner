import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { userStorage } from '../utils/storage/storage';

const UserContext = createContext();

// Initial users - only used if no users exist in storage
const INITIAL_USERS = [
  {
    id: '1',
    username: 'matt',
    displayName: 'Matt Lyons',
    email: 'matt@optionsquared.com',
    profilePicture: null,
    preferences: {
      defaultView: 'portfolio',
      theme: 'light',
      dateFormat: 'MM/dd/yyyy',
      timezone: 'America/New_York'
    },
    createdAt: new Date().toISOString(),
    role: 'admin'
  },
  {
    id: '2',
    username: 'jason',
    displayName: 'Jason Hall',
    email: 'sneaksoft@gmail.com',
    profilePicture: null,
    preferences: {
      defaultView: 'calendar',
      theme: 'light',
      dateFormat: 'MM/dd/yyyy',
      timezone: 'America/Los_Angeles'
    },
    createdAt: new Date().toISOString(),
    role: 'admin'
  }
];

const defaultPreferences = {
  defaultView: 'portfolio',
  theme: 'light',
  dateFormat: 'MM/dd/yyyy',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  notifications: {
    email: true,
    push: true,
    expirations: true,
    comments: true
  },
  display: {
    compactView: false,
    showTags: true,
    showMetrics: true
  }
};

export function UserProvider({ children }) {
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);


  // Ensure initial users are added to localStorage
  const initializeUsers = useCallback(() => {
    try {
      const storedUsersJson = localStorage.getItem(userStorage.STORAGE_KEYS.USERS);
      let initialUsers = storedUsersJson ? JSON.parse(storedUsersJson) : [];

      // If no users exist, add initial users
      if (initialUsers.length === 0) {
        initialUsers = INITIAL_USERS;
        localStorage.setItem(userStorage.STORAGE_KEYS.USERS, JSON.stringify(initialUsers));
      }

      return initialUsers;
    } catch (err) {
      console.error('Error initializing users:', err);
      return INITIAL_USERS;
    }
  }, []);
  
    // Load user preferences
    const loadUserPreferences = useCallback((userId) => {
      try {
        // Ensure STORAGE_KEYS exists and has USER_PREFERENCES
        if (!userStorage.STORAGE_KEYS || !userStorage.STORAGE_KEYS.USER_PREFERENCES) {
          console.error('Storage keys are not properly configured');
          return defaultPreferences;
        }
  
        const preferencesKey = `${userStorage.STORAGE_KEYS.USER_PREFERENCES}_${userId}`;
        const storedPreferences = localStorage.getItem(preferencesKey);
        
        if (storedPreferences) {
          const parsedPreferences = JSON.parse(storedPreferences);
          setPreferences({
            ...defaultPreferences,
            ...parsedPreferences
          });
        } else {
          setPreferences(defaultPreferences);
          // Save default preferences for the user
          localStorage.setItem(preferencesKey, JSON.stringify(defaultPreferences));
        }
      } catch (error) {
        console.error('Error loading preferences:', error);
        setPreferences(defaultPreferences);
      }
    }, []);  

  // Memoize handleUserLogin to prevent unnecessary recreation
  const handleUserLogin = useCallback((user) => {
    setCurrentUser(user);
    loadUserPreferences(user.id);
    
    // Ensure CURRENT_USER key exists before setting
    if (userStorage.STORAGE_KEYS && userStorage.STORAGE_KEYS.CURRENT_USER) {
      localStorage.setItem(userStorage.STORAGE_KEYS.CURRENT_USER, user.id);
    } else {
      console.error('CURRENT_USER storage key is not configured');
    }

    // Initialize user's data stores if they don't exist
    userStorage.initializeUserStorage(user.id);
  }, [loadUserPreferences]);
  
  // Load users and check for existing session on mount
  useEffect(() => {
    try {
      // Initialize users and get the list
      const initialUsers = initializeUsers();
      setUsers(initialUsers);

      // Check for existing user session
      const savedUserId = localStorage.getItem(userStorage.STORAGE_KEYS.CURRENT_USER);
      if (savedUserId) {
        const user = initialUsers.find(u => u.id === savedUserId);
        if (user) {
          handleUserLogin(user);
        } else {
          localStorage.removeItem(userStorage.STORAGE_KEYS.CURRENT_USER);
        }
      }
    } catch (err) {
      console.error('Error loading user data:', err);
      setError('Error loading user data');
    } finally {
      setLoading(false);
    }
  }, [initializeUsers, handleUserLogin]);


  // Save user preferences
  const saveUserPreferences = async (userId, newPreferences) => {
    try {
      const updatedPreferences = {
        ...preferences,
        ...newPreferences
      };

      localStorage.setItem(
        `${userStorage.STORAGE_KEYS.USER_PREFERENCES}_${userId}`,
        JSON.stringify(updatedPreferences)
      );

      setPreferences(updatedPreferences);
      return true;
    } catch (error) {
      console.error('Error saving preferences:', error);
      return false;
    }
  };

  const login = (userId) => {
    try {
      const user = users.find(u => u.id === userId);
      if (!user) {
        throw new Error('Invalid user');
      }
      handleUserLogin(user);
      setError(null);
    } catch (err) {
      setError('Login failed');
      console.error('Login error:', err);
    }
  };

  const logout = async () => {
    try {
      // Clear user-specific data
      if (currentUser?.id) {
        await saveUserPreferences(currentUser.id, preferences);
      }

      setCurrentUser(null);
      setPreferences(defaultPreferences);
      localStorage.removeItem(userStorage.STORAGE_KEYS.CURRENT_USER);
      setError(null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const updateUser = async (userId, updates) => {
    try {
      // Validate updates
      if (updates.email && !/\S+@\S+\.\S+/.test(updates.email)) {
        throw new Error('Invalid email format');
      }

      if (updates.username) {
        const existingUser = users.find(u =>
          u.id !== userId && u.username.toLowerCase() === updates.username.toLowerCase()
        );
        if (existingUser) {
          throw new Error('Username already taken');
        }
      }

      // Get existing user data to preserve other fields
      const updatedUsers = users.map(user =>
        user.id === userId
          ? {
            ...user,
            ...updates,
            updatedAt: new Date().toISOString()
          }
          : user
      );

      setUsers(updatedUsers);
      localStorage.setItem(userStorage.STORAGE_KEYS.USERS, JSON.stringify(updatedUsers));

      // Update current user if it's the user being modified
      if (currentUser?.id === userId) {
        const updatedUser = updatedUsers.find(u => u.id === userId);
        setCurrentUser(updatedUser);
      }

      return true;
    } catch (err) {
      console.error('Error updating user:', err);
      setError(err.message);
      return false;
    }
  };

  const updateProfilePicture = async (userId, pictureData) => {
    try {
      // Get the existing user data first
      const existingUser = users.find(u => u.id === userId);
      if (!existingUser) {
        throw new Error('User not found');
      }

      // Create update with only profile picture change
      const updates = {
        ...existingUser,
        profilePicture: pictureData || null
      };

      // Use updateUser to ensure all validations and updates are handled consistently
      return updateUser(userId, updates);
    } catch (err) {
      console.error('Error updating profile picture:', err);
      setError(err.message);
      return false;
    }
  };

  const updatePreferences = async (newPreferences) => {
    if (!currentUser) return false;
    return saveUserPreferences(currentUser.id, newPreferences);
  };

const value = {
    users,
    currentUser,
    preferences,
    loading,
    error,
    login,
    logout,
    updateUser,
    updateProfilePicture,
    updatePreferences,
    clearError: () => setError(null)
  };

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}

export default UserContext;