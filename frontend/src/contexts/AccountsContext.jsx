import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { useUser } from './UserContext';
import { userStorage } from '../utils/storage/storage';

const AccountsContext = createContext();

const initialState = {
  accounts: {},  // Keep object structure for efficient lookups
  loading: true,
  error: null
};

function accountsReducer(state, action) {
  switch (action.type) {
    case 'INITIALIZE': {
      // Filter accounts for current user
      const { accounts, userId } = action.payload;
      const userAccounts = Object.entries(accounts).reduce((acc, [id, account]) => {
        if (account.userId === userId) {
          acc[id] = account;
        }
        return acc;
      }, {});

      return {
        ...state,
        accounts: userAccounts,
        loading: false,
        error: null
      };
    }

    case 'ADD_ACCOUNT': {
      const { id, account } = action.payload;
      return {
        ...state,
        accounts: {
          ...state.accounts,
          [id]: {
            ...account,
            createdAt: new Date().toISOString()
          }
        },
        error: null
      };
    }

    case 'UPDATE_ACCOUNT': {
      const { id, updates } = action.payload;
      return {
        ...state,
        accounts: {
          ...state.accounts,
          [id]: {
            ...state.accounts[id],
            ...updates,
            updatedAt: new Date().toISOString()
          }
        },
        error: null
      };
    }

    case 'DELETE_ACCOUNT': {
      const { [action.payload]: deletedAccount, ...remainingAccounts } = state.accounts;
      return {
        ...state,
        accounts: remainingAccounts,
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

export function AccountsProvider({ children }) {
  const [state, dispatch] = useReducer(accountsReducer, initialState);
  const { currentUser } = useUser();

  // Convert to useCallback to avoid infinite loop
  const loadUserAccounts = useCallback(async () => {
    if (!currentUser?.id) return;

    try {
      const accounts = userStorage.getAccounts(currentUser.id);
      
      // Convert array to object format for state
      const accountsObj = accounts.reduce((acc, account) => {
        acc[account.id] = account;
        return acc;
      }, {});

      dispatch({
        type: 'INITIALIZE',
        payload: { accounts: accountsObj, userId: currentUser.id }
      });
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload: 'Failed to load accounts'
      });
    }
  }, [currentUser?.id]);

  // Load accounts when user changes
  useEffect(() => {
    if (currentUser?.id) {
      loadUserAccounts();
    }
  }, [currentUser?.id, loadUserAccounts]);

  const validateAccountName = (name, excludeId = null) => {
    return Object.entries(state.accounts).every(([id, account]) =>
      id === excludeId ||
      account.userId !== currentUser?.id ||
      account.name.toLowerCase() !== name.toLowerCase()
    );
  };

  const value = {
    // List of all accounts for the current user
    accounts: Object.values(state.accounts).filter(account =>
      account.userId === currentUser?.id
    ),

    loading: state.loading,
    error: state.error,

    // Add a new account
    addAccount: (accountData) => {
      if (!currentUser?.id) return false;

      try {
        if (!accountData.name?.trim()) {
          throw new Error('Account name is required');
        }

        if (!validateAccountName(accountData.name)) {
          throw new Error('Account name must be unique');
        }

        const id = `acc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newAccount = {
          id,
          userId: currentUser.id,
          ...accountData
        };

        const allAccounts = [...Object.values(state.accounts), newAccount];
        const saved = userStorage.saveAccounts(currentUser.id, allAccounts);

        if (saved) {
          dispatch({
            type: 'ADD_ACCOUNT',
            payload: { id, account: newAccount }
          });
        }

        return saved ? id : false;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },

    // Update an existing account
    updateAccount: (accountId, updates) => {
      if (!currentUser?.id) return false;

      try {
        const account = state.accounts[accountId];
        if (!account || account.userId !== currentUser.id) {
          throw new Error('Account not found or access denied');
        }

        if (updates.name && !validateAccountName(updates.name, accountId)) {
          throw new Error('Account name must be unique');
        }

        const updatedAccount = {
          ...account,
          ...updates,
          updatedAt: new Date().toISOString()
        };

        const allAccounts = Object.values(state.accounts).map(acc =>
          acc.id === accountId ? updatedAccount : acc
        );

        const saved = userStorage.saveAccounts(currentUser.id, allAccounts);
        if (saved) {
          dispatch({
            type: 'UPDATE_ACCOUNT',
            payload: { id: accountId, updates }
          });
        }

        return saved;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },

    // Delete an account
    deleteAccount: (accountId) => {
      if (!currentUser?.id) return false;

      try {
        const account = state.accounts[accountId];
        if (!account || account.userId !== currentUser.id) {
          throw new Error('Account not found or access denied');
        }

        const allAccounts = Object.values(state.accounts)
          .filter(acc => acc.id !== accountId);

        const saved = userStorage.saveAccounts(currentUser.id, allAccounts);

        if (saved) {
          dispatch({ type: 'DELETE_ACCOUNT', payload: accountId });
        }

        return saved;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },

    // Get an account by ID
    getAccount: (accountId) => {
      const account = state.accounts[accountId];
      return account?.userId === currentUser?.id ? account : null;
    },

    // Check if current user owns an account
    isAccountOwner: (accountId) => {
      const account = state.accounts[accountId];
      return account?.userId === currentUser?.id;
    },

    // Get number of positions for an account
    getAccountPositionCount: (accountId) => {
      // This will need to be implemented once we have the portfolio context updated
      // It should count positions across both owned and shared positions
      return 0; // Placeholder
    },

    clearError: () => {
      dispatch({ type: 'CLEAR_ERROR' });
    }
  };

  return (
    <AccountsContext.Provider value={value}>
      {children}
    </AccountsContext.Provider>
  );
}

export function useAccounts() {
  const context = useContext(AccountsContext);
  if (context === undefined) {
    throw new Error('useAccounts must be used within an AccountsProvider');
  }
  return context;
}

export default AccountsContext;