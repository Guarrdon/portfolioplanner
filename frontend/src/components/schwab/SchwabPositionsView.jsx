/**
 * Schwab Positions View
 * 
 * Displays actual positions synced from Schwab API
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchActualPositions, syncSchwabPositions } from '../../services/schwab';
import { RefreshCw, Lock, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';

export const SchwabPositionsView = () => {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    status: 'active',
    account_id: '',
    symbol: ''
  });

  // Fetch positions
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['positions', 'actual', filters],
    queryFn: () => fetchActualPositions(filters)
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: syncSchwabPositions,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions', 'actual'] });
    }
  });

  const handleSync = () => {
    syncMutation.mutate();
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(value);
  };

  const formatQuantity = (value) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4
    }).format(value);
  };

  const getStrategyLabel = (strategyType) => {
    const labels = {
      covered_call: 'Covered Call',
      put_spread: 'Put Spread',
      call_spread: 'Call Spread',
      big_option: 'Option',
      dividend: 'Dividend Stock',
      short_stock: 'Short Stock'
    };
    return labels[strategyType] || strategyType;
  };

  const getPnLColor = (pnl) => {
    if (!pnl) return 'text-gray-600';
    return pnl >= 0 ? 'text-green-600' : 'text-red-600';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-600" />
          <p className="text-gray-600">Loading positions...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">
          Error loading positions: {error.message}
        </p>
        <button
          onClick={() => refetch()}
          className="mt-2 text-red-600 hover:text-red-800 underline"
        >
          Try Again
        </button>
      </div>
    );
  }

  const positions = data?.positions || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schwab Positions</h1>
          <p className="text-gray-600 mt-1">
            Your actual positions synced from Schwab
          </p>
        </div>
        
        <button
          onClick={handleSync}
          disabled={syncMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
          {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {/* Sync Status */}
      {syncMutation.isSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-800">
            ✓ Successfully synced {syncMutation.data.synced_count} positions
          </p>
        </div>
      )}

      {syncMutation.isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">
            ✗ Sync failed: {syncMutation.error.message}
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Symbol
            </label>
            <input
              type="text"
              value={filters.symbol}
              onChange={(e) => setFilters({ ...filters, symbol: e.target.value })}
              placeholder="Filter by symbol..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={() => setFilters({ status: 'active', account_id: '', symbol: '' })}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Positions List */}
      {positions.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <Lock className="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No Positions Found
          </h3>
          <p className="text-gray-600 mb-4">
            Click "Sync Now" to fetch your positions from Schwab
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {positions.map((position) => (
            <PositionCard key={position.id} position={position} />
          ))}
        </div>
      )}

      {/* Summary Stats */}
      {positions.length > 0 && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <StatCard
              label="Total Positions"
              value={positions.length}
              icon={<DollarSign className="w-5 h-5" />}
            />
            <StatCard
              label="Total Value"
              value={formatCurrency(
                positions.reduce((sum, p) => sum + (p.current_value || 0), 0)
              )}
              icon={<TrendingUp className="w-5 h-5" />}
            />
            <StatCard
              label="Total Cost"
              value={formatCurrency(
                positions.reduce((sum, p) => sum + (p.cost_basis || 0), 0)
              )}
              icon={<DollarSign className="w-5 h-5" />}
            />
            <StatCard
              label="Total P/L"
              value={formatCurrency(
                positions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0)
              )}
              valueClass={getPnLColor(
                positions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0)
              )}
              icon={<TrendingUp className="w-5 h-5" />}
            />
          </div>
        </div>
      )}
    </div>
  );
};

const PositionCard = ({ position }) => {
  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(value);
  };

  const formatQuantity = (value) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4
    }).format(value);
  };

  const getStrategyLabel = (strategyType) => {
    const labels = {
      covered_call: 'Covered Call',
      put_spread: 'Put Spread',
      call_spread: 'Call Spread',
      big_option: 'Option',
      dividend: 'Dividend Stock',
      short_stock: 'Short Stock'
    };
    return labels[strategyType] || strategyType;
  };

  const getPnLColor = (pnl) => {
    if (!pnl) return 'text-gray-600';
    return pnl >= 0 ? 'text-green-600' : 'text-red-600';
  };

  const getPnLIcon = (pnl) => {
    if (!pnl) return null;
    return pnl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />;
  };

  return (
    <div className="bg-white rounded-lg shadow hover:shadow-md transition-shadow p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-xl font-bold text-gray-900">{position.symbol}</h3>
            <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">
              {getStrategyLabel(position.strategy_type)}
            </span>
            <span className="flex items-center gap-1 text-gray-500">
              <Lock className="w-3 h-3" />
              <span className="text-xs">Read Only</span>
            </span>
          </div>
          <p className="text-sm text-gray-600">
            Account: {position.account_number || 'N/A'}
          </p>
        </div>
        
        <div className="text-right">
          <div className={`flex items-center justify-end gap-1 text-lg font-bold ${getPnLColor(position.unrealized_pnl)}`}>
            {getPnLIcon(position.unrealized_pnl)}
            {formatCurrency(position.unrealized_pnl)}
          </div>
          <p className="text-sm text-gray-500">P/L</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100">
        <div>
          <p className="text-xs text-gray-500 mb-1">Quantity</p>
          <p className="font-medium">{formatQuantity(position.quantity)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Cost Basis</p>
          <p className="font-medium">{formatCurrency(position.cost_basis)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Current Value</p>
          <p className="font-medium">{formatCurrency(position.current_value)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Status</p>
          <p className="font-medium capitalize">{position.status}</p>
        </div>
      </div>

      {/* Legs */}
      {position.legs && position.legs.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-sm font-medium text-gray-700 mb-2">Position Legs:</p>
          <div className="space-y-2">
            {position.legs.map((leg, index) => (
              <div key={index} className="flex items-center justify-between text-sm bg-gray-50 rounded p-2">
                <span>
                  {leg.asset_type === 'stock' ? (
                    <span className="font-medium">{leg.symbol} Stock</span>
                  ) : (
                    <span>
                      <span className="font-medium">{leg.symbol}</span>
                      <span className="text-gray-600 ml-2">
                        {leg.option_type?.toUpperCase()} ${leg.strike} {leg.expiration}
                      </span>
                    </span>
                  )}
                </span>
                <span className={leg.quantity < 0 ? 'text-red-600' : 'text-green-600'}>
                  {formatQuantity(leg.quantity)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, valueClass = 'text-gray-900', icon }) => {
  return (
    <div className="flex items-center gap-3">
      <div className="p-3 bg-white rounded-lg">
        {icon}
      </div>
      <div>
        <p className="text-sm text-gray-600">{label}</p>
        <p className={`text-lg font-bold ${valueClass}`}>{value}</p>
      </div>
    </div>
  );
};

export default SchwabPositionsView;

