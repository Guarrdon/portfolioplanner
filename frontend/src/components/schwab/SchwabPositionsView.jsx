/**
 * Schwab Positions View - Compact Data Grid
 * Dense, application-style interface for managing 100+ positions
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchActualPositions, syncSchwabPositions } from '../../services/schwab';
import { RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';

export const SchwabPositionsView = () => {
  const queryClient = useQueryClient();
  const [expandedRows, setExpandedRows] = useState(new Set());
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

  const toggleRow = (id) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const formatQuantity = (value) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const formatDate = (date) => {
    if (!date) return '-';
    const d = new Date(date);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear().toString().slice(-2)}`;
  };

  const getStrategyLabel = (strategyType) => {
    const labels = {
      covered_call: 'Covered Call',
      put_spread: 'Put Spread',
      call_spread: 'Call Spread',
      big_option: 'Option',
      dividend: 'Dividend',
      short_stock: 'Short Stock'
    };
    return labels[strategyType] || strategyType.replace(/_/g, ' ');
  };

  const positions = data?.positions || [];

  // Group positions by account
  const groupedByAccount = positions.reduce((acc, position) => {
    const accountKey = position.account_number || 'Unknown';
    if (!acc[accountKey]) {
      acc[accountKey] = [];
    }
    acc[accountKey].push(position);
    return acc;
  }, {});

  const formatOptionSymbol = (leg) => {
    if (leg.asset_type !== 'option' || !leg.expiration) return leg.symbol;
    
    // Parse expiration date
    const expDate = new Date(leg.expiration);
    const day = expDate.getDate();
    const month = expDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const year = expDate.getFullYear().toString().slice(-2);
    
    // Format: "SYMBOL DDMMMYY STRIKE C/P"
    const underlying = leg.symbol.split(' ')[0]; // Extract underlying from OCC symbol
    const strike = leg.strike ? Math.round(parseFloat(leg.strike)) : '';
    const type = leg.option_type ? leg.option_type.charAt(0).toUpperCase() : '';
    
    return `${underlying} ${day}${month}${year} ${strike} ${type}`;
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Compact Toolbar */}
      <div className="bg-white border-b shadow-sm">
        <div className="px-3 py-2 flex items-center justify-between">
          <h1 className="text-base font-bold text-gray-900">Schwab Positions</h1>
          
          <div className="flex items-center gap-2">
            {/* Compact Filters */}
            <input
              type="text"
              value={filters.symbol}
              onChange={(e) => setFilters({ ...filters, symbol: e.target.value })}
              placeholder="Symbol..."
              className="px-2 py-1 text-xs border border-gray-300 rounded w-20 focus:w-32 transition-all focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
            </select>
            
            {/* Actions */}
            <div className="border-l pl-2 flex gap-1">
              <button
                onClick={() => refetch()}
                disabled={isLoading}
                className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 transition-colors"
                title="Refresh"
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {syncMutation.isPending ? 'Syncing...' : 'Sync'}
              </button>
            </div>
          </div>
        </div>

        {/* Status Messages */}
        {syncMutation.isSuccess && (
          <div className="px-3 py-1 bg-green-50 border-t border-green-100 text-green-700 text-xs">
            ✓ Synced {syncMutation.data.synced_count} positions
          </div>
        )}
        {syncMutation.isError && (
          <div className="px-3 py-1 bg-red-50 border-t border-red-100 text-red-700 text-xs">
            ✗ Sync failed: {syncMutation.error.message}
          </div>
        )}
        {error && (
          <div className="px-3 py-1 bg-red-50 border-t border-red-100 text-red-700 text-xs">
            Error: {error.message}
          </div>
        )}
      </div>

      {/* Data Grid */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
              <p className="text-xs text-gray-600">Loading...</p>
            </div>
          </div>
        ) : positions.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500">
              <p className="text-sm">No positions found</p>
              <button
                onClick={() => syncMutation.mutate()}
                className="mt-2 text-xs text-blue-600 hover:underline"
              >
                Click Sync to fetch positions
              </button>
            </div>
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="bg-gray-100 sticky top-0 z-10 border-b">
              <tr>
                <th className="text-left px-2 py-1.5 font-semibold w-6"></th>
                <th className="text-left px-2 py-1.5 font-semibold w-16">Symbol</th>
                <th className="text-left px-2 py-1.5 font-semibold w-32">Strategy</th>
                <th className="text-right px-2 py-1.5 font-semibold w-14">Qty</th>
                <th className="text-right px-2 py-1.5 font-semibold w-20">Cost</th>
                <th className="text-right px-2 py-1.5 font-semibold w-20">Value</th>
                <th className="text-right px-2 py-1.5 font-semibold w-20">P&L</th>
                <th className="text-right px-2 py-1.5 font-semibold w-14">P&L %</th>
                <th className="text-center px-2 py-1.5 font-semibold w-16">Status</th>
                <th className="text-right px-2 py-1.5 font-semibold w-16">Entry</th>
                <th className="text-center px-2 py-1.5 font-semibold w-10">Legs</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {Object.entries(groupedByAccount).map(([accountNumber, accountPositions]) => (
                <React.Fragment key={accountNumber}>
                  {/* Account Section Header */}
                  <tr className="bg-gray-200 border-y border-gray-300">
                    <td colSpan="11" className="px-2 py-1.5 font-semibold text-gray-900">
                      Account: {accountNumber}
                      <span className="ml-3 text-gray-600 font-normal">
                        {accountPositions.length} position{accountPositions.length !== 1 ? 's' : ''}
                      </span>
                    </td>
                  </tr>
                  
                  {/* Positions for this account */}
                  {accountPositions.map((position) => {
                const isExpanded = expandedRows.has(position.id);
                const pnlPercent = position.cost_basis && position.cost_basis !== 0
                  ? ((position.unrealized_pnl / Math.abs(position.cost_basis)) * 100).toFixed(1)
                  : null;
                
                return (
                  <React.Fragment key={position.id}>
                    {/* Main Position Row */}
                    <tr 
                      className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
                      onClick={() => position.legs && position.legs.length > 0 && toggleRow(position.id)}
                    >
                      <td className="px-2 py-1.5">
                        {position.legs && position.legs.length > 0 ? (
                          isExpanded ? 
                            <ChevronDown className="w-3 h-3 text-gray-400" /> : 
                            <ChevronRight className="w-3 h-3 text-gray-400" />
                        ) : (
                          <span className="w-3 inline-block"></span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 font-semibold text-gray-900">{position.symbol}</td>
                      <td className="px-2 py-1.5 text-gray-700">
                        {getStrategyLabel(position.strategy_type)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-gray-900">
                        {formatQuantity(position.quantity)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-gray-700">
                        {formatCurrency(position.cost_basis)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold text-gray-900">
                        {formatCurrency(position.current_value)}
                      </td>
                      <td className={`px-2 py-1.5 text-right font-semibold ${
                        position.unrealized_pnl > 0 ? 'text-green-600' : 
                        position.unrealized_pnl < 0 ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {formatCurrency(position.unrealized_pnl)}
                      </td>
                      <td className={`px-2 py-1.5 text-right ${
                        pnlPercent > 0 ? 'text-green-600' : 
                        pnlPercent < 0 ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {pnlPercent !== null ? `${pnlPercent}%` : '-'}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                          position.status === 'active' 
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {position.status === 'active' ? 'ACT' : 'CLS'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right text-gray-600">
                        {formatDate(position.entry_date)}
                      </td>
                      <td className="px-2 py-1.5 text-center text-gray-600">
                        {position.legs?.length || 0}
                      </td>
                    </tr>

                    {/* Expanded Legs Rows */}
                    {isExpanded && position.legs && position.legs.length > 0 && (
                      <tr className="bg-gray-50">
                        <td colSpan="11" className="px-0 py-0">
                          <div className="px-8 py-2">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-600 border-b border-gray-200">
                                  <th className="text-left px-2 py-1 font-medium w-48">Option/Stock</th>
                                  <th className="text-right px-2 py-1 font-medium w-16">Qty</th>
                                  <th className="text-right px-2 py-1 font-medium w-20">Premium</th>
                                  <th className="text-right px-2 py-1 font-medium w-20">Current</th>
                                  <th className="text-right px-2 py-1 font-medium w-20">P&L</th>
                                </tr>
                              </thead>
                              <tbody>
                                {position.legs.map((leg, index) => {
                                  const legPnL = leg.current_price && leg.premium 
                                    ? (parseFloat(leg.current_price) - parseFloat(leg.premium)) * parseFloat(leg.quantity)
                                    : null;
                                  
                                  return (
                                    <tr key={index} className="border-b border-gray-200 last:border-0">
                                      <td className="px-2 py-1.5">
                                        {leg.asset_type === 'stock' ? (
                                          <span className="font-semibold text-gray-900">
                                            {leg.symbol} <span className="text-gray-600 font-normal ml-1">(Stock)</span>
                                          </span>
                                        ) : (
                                          <span className="font-mono text-gray-900">
                                            {formatOptionSymbol(leg)}
                                          </span>
                                        )}
                                      </td>
                                      <td className={`px-2 py-1.5 text-right font-semibold ${
                                        leg.quantity < 0 ? 'text-red-600' : 'text-green-600'
                                      }`}>
                                        {leg.quantity < 0 ? '' : '+'}{formatQuantity(leg.quantity)}
                                      </td>
                                      <td className="px-2 py-1.5 text-right text-gray-700">
                                        {formatCurrency(leg.premium)}
                                      </td>
                                      <td className="px-2 py-1.5 text-right text-gray-900">
                                        {formatCurrency(leg.current_price)}
                                      </td>
                                      <td className={`px-2 py-1.5 text-right font-semibold ${
                                        legPnL > 0 ? 'text-green-600' : legPnL < 0 ? 'text-red-600' : 'text-gray-600'
                                      }`}>
                                        {legPnL !== null ? formatCurrency(legPnL) : '-'}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Compact Status Bar */}
      <div className="bg-white border-t px-3 py-1 text-xs text-gray-600 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="font-medium">{positions.length} position{positions.length !== 1 ? 's' : ''}</span>
          {positions.length > 0 && (
            <>
              <span className="text-gray-400">|</span>
              <span>
                Total Value: <span className="font-semibold text-gray-900">
                  {formatCurrency(positions.reduce((sum, p) => sum + (p.current_value || 0), 0))}
                </span>
              </span>
              <span className="text-gray-400">|</span>
              <span>
                Total P&L: <span className={`font-semibold ${
                  positions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0) >= 0
                    ? 'text-green-600'
                    : 'text-red-600'
                }`}>
                  {formatCurrency(positions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0))}
                </span>
              </span>
            </>
          )}
        </div>
        {positions.length > 0 && positions[0].last_synced && (
          <span className="text-gray-500">
            Last sync: {formatDate(positions[0].last_synced)} {new Date(positions[0].last_synced).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  );
};

export default SchwabPositionsView;
