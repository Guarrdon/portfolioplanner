import React, { useState } from 'react';
import { useUser } from '../../contexts/UserContext';
import { userStorage } from '../../utils/storage/storage';
import { Wallet, PlusCircle, X, AlertTriangle } from 'lucide-react';

const AccountManagement = () => {
  const { currentUser } = useUser();
  const [newAccount, setNewAccount] = useState('');
  const [error, setError] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [accounts, setAccounts] = useState(() => {
    return userStorage.getAccounts(currentUser?.id);
  });

  const validateAccountName = (name) => {
    return accounts.every(acc => 
      acc.name.toLowerCase() !== name.toLowerCase().trim()
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!currentUser?.id) {
      setError('User not authenticated');
      return;
    }

    const trimmedName = newAccount.trim();

    if (!trimmedName) {
      setError('Account name cannot be empty');
      return;
    }

    if (!validateAccountName(trimmedName)) {
      setError('Account name must be unique');
      return;
    }

    const newAccountData = {
      id: `acc_${Date.now()}`,
      name: trimmedName,
      userId: currentUser.id,
      createdAt: new Date().toISOString()
    };

    const success = userStorage.saveAccounts(
      currentUser.id, 
      [...accounts, newAccountData]
    );

    if (success) {
      setAccounts([...accounts, newAccountData]);
      setNewAccount('');
      setIsAdding(false);
    } else {
      setError('Failed to save account');
    }
  };

  const handleDelete = (accountId) => {
    if (!currentUser?.id) return;

    const updatedAccounts = accounts.filter(acc => acc.id !== accountId);
    
    const success = userStorage.saveAccounts(currentUser.id, updatedAccounts);
    
    if (success) {
      setAccounts(updatedAccounts);
    } else {
      setError('Failed to delete account');
    }
  };

  return (
    <div className="space-y-6 bg-white shadow rounded-lg p-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Wallet className="h-6 w-6 text-gray-400" />
          <h3 className="text-lg font-medium text-gray-900">Accounts</h3>
        </div>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <PlusCircle className="h-4 w-4 mr-2" />
            Add Account
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center space-x-2 text-red-600 bg-red-50 p-3 rounded-md">
          <AlertTriangle className="h-5 w-5" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {isAdding && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="newAccount" className="block text-sm font-medium text-gray-700">
              Account Name
            </label>
            <div className="mt-1">
              <input
                type="text"
                id="newAccount"
                value={newAccount}
                onChange={(e) => setNewAccount(e.target.value)}
                className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md"
                placeholder="Enter account name"
                autoFocus
              />
            </div>
          </div>
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => {
                setIsAdding(false);
                setNewAccount('');
                setError('');
              }}
              className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Add Account
            </button>
          </div>
        </form>
      )}

      <div className="mt-6">
        <div className="divide-y divide-gray-200">
          {accounts.map(account => (
            <div
              key={account.id}
              className="flex justify-between items-center py-3"
            >
              <div className="flex items-center space-x-3">
                <span className="text-gray-900">{account.name}</span>
              </div>
              <button
                onClick={() => handleDelete(account.id)}
                className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-red-500"
                title="Delete account"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          ))}

          {accounts.length === 0 && !isAdding && (
            <p className="text-gray-500 text-center py-4">
              No accounts added yet
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountManagement;