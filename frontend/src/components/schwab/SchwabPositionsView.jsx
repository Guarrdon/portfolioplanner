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

  // Calculate days until expiration
  const daysUntilExpiration = (expirationDate) => {
    if (!expirationDate) return null;
    const exp = new Date(expirationDate);
    const today = new Date();
    const diffTime = exp - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // Render strategy-specific details
  const renderStrategyDetails = (position) => {
    const strategyType = position.strategy_type;
    
    // Covered Call specific details
    if (strategyType === 'covered_call') {
      const callLeg = position.legs?.find(l => l.option_type === 'call');
      if (!callLeg) return null;
      
      const daysLeft = daysUntilExpiration(callLeg.expiration);
      const stockLeg = position.legs?.find(l => l.asset_type === 'stock');
      const protection = stockLeg && callLeg ? 
        ((parseFloat(callLeg.premium) / parseFloat(stockLeg.current_price || stockLeg.premium)) * 100).toFixed(2) : null;
      
      return (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="grid grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-gray-600">Days to Expiration</span>
              <div className={`font-semibold mt-0.5 ${daysLeft < 7 ? 'text-red-600' : daysLeft < 30 ? 'text-orange-600' : 'text-gray-900'}`}>
                {daysLeft !== null ? `${daysLeft} days` : '-'}
              </div>
            </div>
            <div>
              <span className="text-gray-600">Premium Collected</span>
              <div className="font-semibold text-green-600 mt-0.5">
                {formatCurrency(callLeg.premium * Math.abs(callLeg.quantity))}
              </div>
            </div>
            <div>
              <span className="text-gray-600">Downside Protection</span>
              <div className="font-semibold text-gray-900 mt-0.5">
                {protection ? `${protection}%` : '-'}
              </div>
            </div>
            <div>
              <span className="text-gray-600">Strike</span>
              <div className="font-semibold text-gray-900 mt-0.5">
                ${callLeg.strike}
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    // Vertical Spread (Put Spread or Call Spread) details
    if (strategyType === 'put_spread' || strategyType === 'call_spread') {
      const legs = position.legs || [];
      const shortLeg = legs.find(l => l.quantity < 0);
      const longLeg = legs.find(l => l.quantity > 0);
      
      if (!shortLeg || !longLeg) return null;
      
      const width = Math.abs(parseFloat(shortLeg.strike) - parseFloat(longLeg.strike));
      const netCredit = (Math.abs(parseFloat(shortLeg.premium)) - Math.abs(parseFloat(longLeg.premium))) * Math.abs(shortLeg.quantity);
      const maxProfit = netCredit;
      const maxLoss = (width * 100 * Math.abs(shortLeg.quantity)) - maxProfit;
      const daysLeft = daysUntilExpiration(shortLeg.expiration);
      
      return (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="grid grid-cols-5 gap-4 text-xs">
            <div>
              <span className="text-gray-600">Width</span>
              <div className="font-semibold text-gray-900 mt-0.5">
                ${width.toFixed(0)}
              </div>
            </div>
            <div>
              <span className="text-gray-600">Net Credit</span>
              <div className="font-semibold text-green-600 mt-0.5">
                {formatCurrency(netCredit)}
              </div>
            </div>
            <div>
              <span className="text-gray-600">Max Profit</span>
              <div className="font-semibold text-green-600 mt-0.5">
                {formatCurrency(maxProfit)}
              </div>
            </div>
            <div>
              <span className="text-gray-600">Max Loss</span>
              <div className="font-semibold text-red-600 mt-0.5">
                {formatCurrency(maxLoss)}
              </div>
            </div>
            <div>
              <span className="text-gray-600">Days Left</span>
              <div className={`font-semibold mt-0.5 ${daysLeft < 7 ? 'text-red-600' : daysLeft < 30 ? 'text-orange-600' : 'text-gray-900'}`}>
                {daysLeft !== null ? `${daysLeft}` : '-'}
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    // Dividend Stock details
    if (strategyType === 'dividend') {
      // TODO: Add dividend-specific data from API (ex-div date, yield, frequency)
      return (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="grid grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-gray-600">Dividend Yield</span>
              <div className="font-semibold text-gray-900 mt-0.5">
                Coming Soon
              </div>
            </div>
            <div>
              <span className="text-gray-600">Next Ex-Div</span>
              <div className="font-semibold text-gray-900 mt-0.5">
                -
              </div>
            </div>
            <div>
              <span className="text-gray-600">Dividend Amount</span>
              <div className="font-semibold text-gray-900 mt-0.5">
                -
              </div>
            </div>
            <div>
              <span className="text-gray-600">Frequency</span>
              <div className="font-semibold text-gray-900 mt-0.5">
                -
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    // Single Option (Big Option) details
    if (strategyType === 'big_option') {
      const optionLeg = position.legs?.[0];
      if (!optionLeg || optionLeg.asset_type !== 'option') return null;
      
      const daysLeft = daysUntilExpiration(optionLeg.expiration);
      // TODO: Add Greeks when available from API
      
      return (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="grid grid-cols-5 gap-4 text-xs">
            <div>
              <span className="text-gray-600">Days to Expiration</span>
              <div className={`font-semibold mt-0.5 ${daysLeft < 7 ? 'text-red-600' : daysLeft < 30 ? 'text-orange-600' : 'text-gray-900'}`}>
                {daysLeft !== null ? `${daysLeft}` : '-'}
              </div>
            </div>
            <div>
              <span className="text-gray-600">Delta (Δ)</span>
              <div className="font-semibold text-gray-900 mt-0.5">
                Coming Soon
              </div>
            </div>
            <div>
              <span className="text-gray-600">Theta (Θ)</span>
              <div className="font-semibold text-gray-900 mt-0.5">
                -
              </div>
            </div>
            <div>
              <span className="text-gray-600">Vega (V)</span>
              <div className="font-semibold text-gray-900 mt-0.5">
                -
              </div>
            </div>
            <div>
              <span className="text-gray-600">Gamma (Γ)</span>
              <div className="font-semibold text-gray-900 mt-0.5">
                -
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    return null;
  };

  // Multi-level grouping: Account -> Strategy -> Symbol
  const groupedData = positions.reduce((acc, position) => {
    const accountKey = position.account_number || 'Unknown';
    const strategyKey = position.strategy_type || 'unknown';
    const symbolKey = position.symbol || 'Unknown';
    
    if (!acc[accountKey]) {
      acc[accountKey] = {};
    }
    if (!acc[accountKey][strategyKey]) {
      acc[accountKey][strategyKey] = {};
    }
    if (!acc[accountKey][strategyKey][symbolKey]) {
      acc[accountKey][strategyKey][symbolKey] = [];
    }
    
    acc[accountKey][strategyKey][symbolKey].push(position);
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
              {Object.entries(groupedData).map(([accountNumber, strategies]) => (
                <React.Fragment key={accountNumber}>
                  {/* Account Section Header */}
                  <tr className="bg-gray-200 border-y border-gray-300">
                    <td colSpan="11" className="px-2 py-1.5 font-semibold text-gray-900">
                      Account: {accountNumber}
                      <span className="ml-3 text-gray-600 font-normal">
                        {Object.values(strategies).reduce((sum, symbols) => 
                          sum + Object.values(symbols).reduce((s, positions) => s + positions.length, 0), 0
                        )} position{Object.values(strategies).reduce((sum, symbols) => 
                          sum + Object.values(symbols).reduce((s, positions) => s + positions.length, 0), 0) !== 1 ? 's' : ''}
                      </span>
                    </td>
                  </tr>
                  
                  {/* Strategy Groups */}
                  {Object.entries(strategies).map(([strategyType, symbols]) => (
                    <React.Fragment key={`${accountNumber}-${strategyType}`}>
                      {/* Strategy Section Header */}
                      <tr className="bg-gray-100 border-b border-gray-200">
                        <td colSpan="11" className="px-4 py-1 font-medium text-gray-800 text-xs">
                          {getStrategyLabel(strategyType)}
                          <span className="ml-2 text-gray-600 font-normal">
                            ({Object.values(symbols).reduce((sum, positions) => sum + positions.length, 0)})
                          </span>
                        </td>
                      </tr>
                      
                      {/* Symbol Groups */}
                      {Object.entries(symbols).map(([symbol, symbolPositions]) => (
                        <React.Fragment key={`${accountNumber}-${strategyType}-${symbol}`}>
                          {/* Positions for this symbol */}
                          {symbolPositions.map((position) => {
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
                                          <div className="flex items-center gap-2">
                                            <span className="font-mono font-bold text-gray-900">
                                              {formatOptionSymbol(leg)}
                                            </span>
                                            <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                                              leg.option_type === 'call' 
                                                ? 'bg-blue-600 text-white' 
                                                : 'bg-purple-600 text-white'
                                            }`}>
                                              {leg.option_type === 'call' ? 'C' : 'P'}
                                            </span>
                                          </div>
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
                            
                            {/* Strategy-Specific Details */}
                            {renderStrategyDetails(position)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
                        </React.Fragment>
                      ))}
                    </React.Fragment>
                  ))}
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
