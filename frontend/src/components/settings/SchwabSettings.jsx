/**
 * Schwab Settings Component
 * 
 * Allows users to manage Schwab API connection and account sync settings
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSchwabAccounts, updateSchwabAccountSettings } from '../../services/schwab';
import { Building2, RefreshCw, CheckCircle, XCircle } from 'lucide-react';

export const SchwabSettings = () => {
  const queryClient = useQueryClient();

  // Fetch Schwab accounts
  const { data: accounts = [], isLoading, error } = useQuery({
    queryKey: ['schwab', 'accounts'],
    queryFn: getSchwabAccounts,
    // Mock data for development
    placeholderData: [
      {
        id: '1',
        account_hash: 'E5B3F89A2C1D4E6F7A8B9C0D',
        account_number: '****5678',
        account_type: 'MARGIN',
        sync_enabled: true,
        last_synced: '2025-10-25T14:30:00Z'
      },
      {
        id: '2',
        account_hash: 'F9C2A8D5E4B6F1A3C7E9D2B4',
        account_number: '****4321',
        account_type: 'IRA',
        sync_enabled: false,
        last_synced: null
      }
    ]
  });

  // Toggle sync mutation
  const toggleSyncMutation = useMutation({
    mutationFn: ({ accountId, enabled }) => 
      updateSchwabAccountSettings(accountId, { sync_enabled: enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schwab', 'accounts'] });
    }
  });

  const handleToggleSync = (accountId, currentlyEnabled) => {
    toggleSyncMutation.mutate({
      accountId,
      enabled: !currentlyEnabled
    });
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(dateString));
  };

  if (isLoading) {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Error loading Schwab accounts: {error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Building2 className="w-6 h-6 text-blue-600" />
              Schwab Integration
            </h2>
            <p className="text-gray-600 mt-2">
              Manage your Schwab account connections and sync settings
            </p>
          </div>
        </div>
      </div>

      {/* Connection Status */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Connection Status</h3>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-green-800">
            <CheckCircle className="w-5 h-5" />
            <span className="font-medium">Connected to Schwab API</span>
          </div>
          <p className="text-sm text-green-700 mt-2">
            Your account is successfully connected and ready to sync positions.
          </p>
        </div>
      </div>

      {/* Account Selection */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Account Selection</h3>
        <p className="text-gray-600 mb-6">
          Choose which Schwab accounts you want to sync positions from. Only enabled accounts 
          will be included when you click "Sync Now" on the Schwab Positions page.
        </p>

        {accounts.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
            <p className="text-gray-600">No Schwab accounts found</p>
          </div>
        ) : (
          <div className="space-y-4">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onToggle={() => handleToggleSync(account.id, account.sync_enabled)}
                isToggling={toggleSyncMutation.isPending}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sync Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h4 className="text-sm font-medium text-blue-900 mb-2">About Syncing</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Positions are synced on-demand when you click "Sync Now"</li>
          <li>• Synced positions are read-only and cannot be edited</li>
          <li>• Disable sync for accounts you don't want to track</li>
          <li>• Your credentials are stored securely and encrypted</li>
        </ul>
      </div>

      {/* Development Mode Notice */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <h4 className="text-sm font-medium text-yellow-900 mb-2">Development Mode</h4>
        <p className="text-sm text-yellow-800">
          Currently using mock Schwab data for development. Real API integration will be 
          enabled once you configure your Schwab API credentials.
        </p>
      </div>
    </div>
  );
};

const AccountCard = ({ account, onToggle, isToggling, formatDate }) => {
  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <Building2 className="w-5 h-5 text-gray-400" />
            <div>
              <h4 className="font-medium text-gray-900">
                Account {account.account_number}
              </h4>
              <p className="text-sm text-gray-600">{account.account_type}</p>
            </div>
          </div>
          
          <div className="ml-8 text-sm text-gray-600">
            Last synced: {formatDate(account.last_synced)}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {account.sync_enabled ? (
            <div className="flex items-center gap-1 text-green-600 text-sm">
              <CheckCircle className="w-4 h-4" />
              <span>Enabled</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-gray-400 text-sm">
              <XCircle className="w-4 h-4" />
              <span>Disabled</span>
            </div>
          )}

          <button
            onClick={onToggle}
            disabled={isToggling}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              account.sync_enabled
                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {account.sync_enabled ? 'Disable Sync' : 'Enable Sync'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SchwabSettings;

