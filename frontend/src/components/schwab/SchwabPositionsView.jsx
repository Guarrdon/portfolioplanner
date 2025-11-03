/**
 * Schwab Positions View - Compact Data Grid
 * Dense, application-style interface for managing 100+ positions
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchActualPositions, syncSchwabPositions, updatePositionStrategy, unlockPositionStrategy } from '../../services/schwab';
import { RefreshCw, ChevronRight, ChevronDown, Minimize2, Maximize2, ChevronsRight, ChevronsDown, Share2, Edit2, Lock, Unlock } from 'lucide-react';
import { CollaborationModal } from '../modals/CollaborationModal';

export const SchwabPositionsView = () => {
  const queryClient = useQueryClient();
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [collapsedStrategies, setCollapsedStrategies] = useState(new Set());
  // Expansion states: 0=collapsed, 1=strategies, 2=fully expanded
  const [expansionLevel, setExpansionLevel] = useState(1);
  const [selectedAccount, setSelectedAccount] = useState('all'); // Account selector
  const [filters, setFilters] = useState({
    status: 'active',
    symbol: ''
  });
  const [collaborationModalPosition, setCollaborationModalPosition] = useState(null);
  const [editingStrategyId, setEditingStrategyId] = useState(null); // For inline strategy editing

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

  // Update strategy mutation
  const updateStrategyMutation = useMutation({
    mutationFn: ({ positionId, strategyType }) => 
      updatePositionStrategy(positionId, strategyType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions', 'actual'] });
      setEditingStrategyId(null);
    }
  });

  const unlockStrategyMutation = useMutation({
    mutationFn: (positionId) => unlockPositionStrategy(positionId),
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

  const toggleStrategy = (key) => {
    const newCollapsed = new Set(collapsedStrategies);
    if (newCollapsed.has(key)) {
      newCollapsed.delete(key);
    } else {
      newCollapsed.add(key);
    }
    setCollapsedStrategies(newCollapsed);
  };

  const cycleExpansion = () => {
    // Cycle through: Collapsed (0) → Strategies (1) → Fully Expanded (2) → back to 0
    const nextLevel = (expansionLevel + 1) % 3;
    setExpansionLevel(nextLevel);
    
    const allStrats = new Set(Object.keys(groupedData));
    
    switch (nextLevel) {
      case 0: // Collapsed - only strategy headers visible
        setCollapsedStrategies(allStrats);
        setExpandedRows(new Set());
        break;
      case 1: // Strategies expanded - show positions but keep legs collapsed
        setCollapsedStrategies(new Set());
        setExpandedRows(new Set());
        break;
      case 2: // Fully expanded - show all legs
        setCollapsedStrategies(new Set());
        // Expand all position rows to show legs
        const allPositionIds = new Set();
        Object.values(groupedData).forEach(symbols => {
          Object.values(symbols).forEach(positions => {
            positions.forEach(position => {
              if (position.legs && position.legs.length > 0) {
                allPositionIds.add(position.id);
              }
            });
          });
        });
        setExpandedRows(allPositionIds);
        break;
    }
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined || isNaN(value) || !isFinite(value)) return '-';
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
      vertical_spread: 'Vertical Spread',
      box_spread: 'Box Spread',
      big_option: 'Big Options',
      single_option: 'Single Option',
      long_stock: 'Long Stock',
      dividend: 'Dividends',
      short_stock: 'Short Stock',
      // Legacy support
      put_spread: 'Vertical Spread',
      call_spread: 'Vertical Spread'
    };
    return labels[strategyType] || strategyType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Calculate summary metrics with safety checks
  const calculateSummary = (positions) => {
    if (!positions || positions.length === 0) {
      return { count: 0, value: 0, costBasis: 0, pnl: 0, pnlPercent: '0.0' };
    }
    
    const totals = positions.reduce((acc, pos) => {
      acc.count += 1;
      // Ensure we're working with numbers, not undefined or NaN
      const value = parseFloat(pos.current_value) || 0;
      const cost = parseFloat(pos.cost_basis) || 0;
      const pnl = parseFloat(pos.unrealized_pnl) || 0;
      
      acc.value += value;
      acc.costBasis += cost;
      acc.pnl += pnl;
      return acc;
    }, { count: 0, value: 0, costBasis: 0, pnl: 0 });

    // Calculate P&L percentage with safety check
    const absCostBasis = Math.abs(totals.costBasis);
    totals.pnlPercent = absCostBasis !== 0 && !isNaN(absCostBasis) && isFinite(absCostBasis)
      ? ((totals.pnl / absCostBasis) * 100).toFixed(1)
      : '0.0';
    
    return totals;
  };

  // Helper to render summary cells inline within header rows
  // Strategy rows are intentionally subtle (no bold, no color) to avoid visual clutter
  const renderSummaryCells = (summary, level = 'strategy') => {
    // For strategy level: use subtle styling (no color, no bold)
    // For account level: use bolder styling with color
    const isStrategy = level === 'strategy';
    const pnlColor = isStrategy ? 'text-gray-600' : (summary.pnl >= 0 ? 'text-green-600' : 'text-red-600');
    const fontWeight = isStrategy ? 'font-normal' : 'font-bold';
    const textColor = isStrategy ? 'text-gray-600' : 'text-gray-700';
    
    return (
      <>
        <td className={`px-2 py-1.5 text-right text-xs ${fontWeight} ${textColor}`}>
          {formatCurrency(Math.abs(summary.costBasis))}
        </td>
        <td className={`px-2 py-1.5 text-right text-xs ${fontWeight} ${textColor}`}>
          {formatCurrency(summary.value)}
        </td>
        <td className={`px-2 py-1.5 text-right text-xs ${fontWeight} ${pnlColor}`}>
          {formatCurrency(summary.pnl)}
        </td>
        <td className={`px-2 py-1.5 text-right text-xs ${fontWeight} ${pnlColor}`}>
          {summary.pnlPercent}%
        </td>
        <td colSpan="7" className="px-2 py-1.5"></td>
      </>
    );
  };

  const positions = data?.positions || [];
  const accounts = data?.accounts || [];

  // Set first account as selected if none selected yet (using effect to avoid setState during render)
  React.useEffect(() => {
    if (selectedAccount === 'all' && accounts.length > 0) {
      setSelectedAccount(accounts[0].account_hash);
    }
  }, [accounts, selectedAccount]);

  // Filter positions by selected account (match account_hash to position.account_id)
  const filteredPositions = selectedAccount === 'all' 
    ? positions 
    : positions.filter(p => p.account_id === selectedAccount);
  
  // Find selected account info
  const selectedAccountInfo = accounts.find(acc => acc.account_hash === selectedAccount);


  // Calculate days until expiration
  const daysUntilExpiration = (expirationDate) => {
    if (!expirationDate) return null;
    
    // Parse expiration date (handle both ISO strings and Date objects)
    const expDate = typeof expirationDate === 'string' 
      ? new Date(expirationDate + 'T00:00:00')  // Add time to avoid timezone issues
      : new Date(expirationDate);
    
    // Get today at midnight for accurate day counting
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Calculate difference in days
    const diffTime = expDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
  };

  // Single-level grouping: Strategy -> Symbol (no accounts)
  const groupedData = {};
  
  filteredPositions.forEach((position) => {
    const strategyKey = position.strategy_type || 'unknown';
    const symbolKey = position.symbol || 'Unknown';
    
    if (!groupedData[strategyKey]) {
      groupedData[strategyKey] = {};
    }
    if (!groupedData[strategyKey][symbolKey]) {
      groupedData[strategyKey][symbolKey] = [];
    }
    
    groupedData[strategyKey][symbolKey].push(position);
  });

  const formatOptionSymbol = (leg) => {
    // For non-options or missing data, return as-is
    if (leg.asset_type !== 'option') return leg.symbol || '';
    if (!leg.expiration || !leg.strike) return leg.symbol || '';
    
    // Parse OCC symbol format to extract underlying ticker
    // OCC format: TICKER(variable, padded to 6)YYMMDD(6)P/C(1)STRIKE(8)
    // Examples: "NVDA  251219P00170000", "AAL   260116C00017000"
    
    let underlying = '';
    if (leg.symbol) {
      // Remove all spaces and try to extract ticker
      const noSpaces = leg.symbol.replace(/\s+/g, '');
      // Match: Letters, then 6 digits, then P or C, then 8 digits
      const occMatch = noSpaces.match(/^([A-Z]+)(\d{6})([PC])(\d{8})$/);
      
      if (occMatch) {
        underlying = occMatch[1];
      } else {
        // Fallback: try to extract just the letters at the start
        const tickerMatch = leg.symbol.match(/^([A-Z]+)/);
        underlying = tickerMatch ? tickerMatch[1] : 'UNK';
      }
    } else {
      underlying = 'UNK';
    }
    
    // Format expiration date from leg.expiration (ISO format from backend)
    // Add time component to avoid timezone issues
    const expDate = typeof leg.expiration === 'string'
      ? new Date(leg.expiration + 'T00:00:00')
      : new Date(leg.expiration);
    
    // Validate date
    if (isNaN(expDate.getTime())) {
      return leg.symbol || 'Invalid Date';
    }
    
    const day = expDate.getDate();
    const month = expDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const year = expDate.getFullYear().toString().slice(-2);
    
    // Format strike (round to whole number)
    const strike = Math.round(parseFloat(leg.strike));
    
    // Return formatted: "NVDA 19DEC25 170"
    return `${underlying} ${day}${month}${year} ${strike}`;
  };

  // Format position symbol - just show the underlying ticker
  const formatPositionSymbol = (position) => {
    // Always return the underlying symbol (ticker) for the position row
    // The detailed option formatting is only for the expanded legs
    return position.underlying || position.symbol || 'Unknown';
  };

  // Calculate days to expiration for position
  // For positions with multiple expirations (like calendars), show the shortest
  const getPositionDaysToExpiration = (position) => {
    if (!position.legs || position.legs.length === 0) return null;
    
    const optionLegs = position.legs.filter(l => l.asset_type === 'option' && l.expiration);
    if (optionLegs.length === 0) return null;
    
    // Find the shortest expiration (nearest date)
    const daysToExpArray = optionLegs.map(leg => daysUntilExpiration(leg.expiration)).filter(d => d !== null);
    if (daysToExpArray.length === 0) return null;
    
    return Math.min(...daysToExpArray);
  };

  const handleCollaborate = (position, e) => {
    e.stopPropagation(); // Prevent row expansion
    setCollaborationModalPosition(position);
  };

  const handleCollaborationSuccess = (tradeIdea) => {
    // Show success notification or navigate to the trade idea
    console.log('Trade idea created:', tradeIdea);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Compact Toolbar */}
      <div className="bg-white border-b shadow-sm">
        <div className="px-3 py-2 flex items-center justify-between">
          <h1 className="text-base font-bold text-gray-900">Schwab Positions</h1>
          
          <div className="flex items-center gap-2">
            {/* Compact Filters */}
            {/* Account Selector */}
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="px-2 py-1 text-xs border border-gray-300 rounded font-semibold focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              {accounts.map((account) => (
                <option key={account.account_hash} value={account.account_hash}>
                  Account: {account.account_number}
                </option>
              ))}
            </select>
            
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
                onClick={cycleExpansion}
                className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors flex items-center gap-1.5"
                title={
                  expansionLevel === 0 ? 'Collapsed - Click to expand strategies' :
                  expansionLevel === 1 ? 'Strategies shown - Click to expand all legs' :
                  'Fully expanded - Click to collapse all'
                }
              >
                {expansionLevel === 0 && <ChevronsRight className="w-3.5 h-3.5" />}
                {expansionLevel === 1 && <ChevronDown className="w-3.5 h-3.5" />}
                {expansionLevel === 2 && <ChevronsDown className="w-3.5 h-3.5" />}
                <span className="font-medium">
                  {expansionLevel === 0 ? 'Collapsed' :
                   expansionLevel === 1 ? 'Strategies' :
                   'All Legs'}
                </span>
              </button>
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
        
        {/* Account Summary Card - At Top (Always show, even for empty accounts) */}
        {selectedAccountInfo && (() => {
          const accountSummary = calculateSummary(filteredPositions);
          const strategyCount = Object.keys(groupedData).length;
          const totalMaintenance = filteredPositions.reduce((sum, pos) => 
            sum + (parseFloat(pos.maintenance_requirement) || 0), 0);
          const totalDayPnL = filteredPositions.reduce((sum, pos) => 
            sum + (parseFloat(pos.current_day_pnl) || 0), 0);
          const pnlColor = accountSummary.pnl >= 0 ? 'text-green-600' : 'text-red-600';
          const dayPnlColor = totalDayPnL >= 0 ? 'text-blue-600' : 'text-orange-600';
          
          // Get balance fields from selected account
          const netLiquid = selectedAccountInfo?.liquidation_value || 0;
          const stockBP = selectedAccountInfo?.buying_power || 0;
          const optionsBP = selectedAccountInfo?.buying_power_options || 0;
          const cashBalance = selectedAccountInfo?.cash_balance || 0;
          
          // Check if stock and options BP are the same (Portfolio Margin vs Reg-T)
          const bpSame = Math.abs(stockBP - optionsBP) < 0.01; // Within 1 cent
          
          return (
            <div className="px-4 py-3 border-t border-b border-gray-200 bg-white">
              <div className="border-2 border-gray-300 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200">
                  <span className="text-lg">💼</span>
                  <span className="font-bold text-gray-900 text-base">Account Summary</span>
                  <span className="text-gray-500 text-sm ml-2">
                    {accountSummary.count} position{accountSummary.count !== 1 ? 's' : ''} • {strategyCount} strateg{strategyCount !== 1 ? 'ies' : 'y'}
                  </span>
                </div>
                <div className="grid grid-cols-10 gap-4">
                  {/* Cost Basis */}
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Cost Basis</div>
                    <div className="text-base font-bold text-gray-900">
                      {formatCurrency(Math.abs(accountSummary.costBasis))}
                    </div>
                  </div>
                  
                  {/* Current Value */}
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Current Value</div>
                    <div className="text-base font-bold text-gray-900">
                      {formatCurrency(accountSummary.value)}
                    </div>
                  </div>
                  
                  {/* Unrealized P&L */}
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Unrealized P&L</div>
                    <div className={`text-base font-bold ${pnlColor}`}>
                      {formatCurrency(accountSummary.pnl)}
                    </div>
                  </div>
                  
                  {/* P&L % */}
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">P&L %</div>
                    <div className={`text-base font-bold ${pnlColor}`}>
                      {accountSummary.pnlPercent}%
                    </div>
                  </div>
                  
                  {/* Today's P&L */}
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Today's P&L</div>
                    <div className={`text-base font-bold ${dayPnlColor}`}>
                      {formatCurrency(totalDayPnL)}
                    </div>
                  </div>
                  
                  {/* BP Effect */}
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">BP Effect</div>
                    <div className="text-base font-semibold text-gray-700">
                      {formatCurrency(totalMaintenance)}
                    </div>
                  </div>
                  
                  {/* Net Exposure */}
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Net Exposure</div>
                    <div className="text-base font-semibold text-gray-700">
                      {formatCurrency(accountSummary.value + Math.abs(accountSummary.costBasis))}
                    </div>
                  </div>
                  
                  {/* Net Liquid */}
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Net Liquid</div>
                    <div className="text-base font-semibold text-gray-700">
                      {formatCurrency(netLiquid)}
                    </div>
                  </div>
                  
                  {/* Buying Power - show combined or separate based on account type */}
                  {bpSame ? (
                    // Portfolio Margin or accounts where BP is the same - show one field
                    <div>
                      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Buying Power</div>
                      <div className="text-base font-semibold text-gray-700">
                        {formatCurrency(stockBP)}
                      </div>
                    </div>
                  ) : (
                    // Reg-T account with different BP values - show both
                    <>
                      <div>
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Stock BP</div>
                        <div className="text-base font-semibold text-gray-700">
                          {formatCurrency(stockBP)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Options BP</div>
                        <div className="text-base font-semibold text-gray-700">
                          {formatCurrency(optionsBP)}
                        </div>
                      </div>
                    </>
                  )}
                  
                  {/* Cash Sweep Balance */}
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Cash Sweep</div>
                    <div className="text-base font-semibold text-gray-700">
                      {formatCurrency(cashBalance)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
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
                <th className="text-right px-2 py-1.5 font-semibold w-18 text-blue-600">Day P&L</th>
                <th className="text-right px-2 py-1.5 font-semibold w-12 text-gray-500" title="Delta (Coming Soon)">Δ</th>
                <th className="text-right px-2 py-1.5 font-semibold w-12 text-gray-500" title="Theta (Coming Soon)">Θ</th>
                <th className="text-right px-2 py-1.5 font-semibold w-16 text-gray-600" title="Buying Power Effect">BP Effect</th>
                <th className="text-center px-2 py-1.5 font-semibold w-16">Status</th>
                <th className="text-right px-2 py-1.5 font-semibold w-16" title="Days to Expiration">DTE</th>
                <th className="text-center px-2 py-1.5 font-semibold w-10">Legs</th>
                <th className="text-center px-2 py-1.5 font-semibold w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {/* Strategy Groups - No account-level grouping */}
              {Object.entries(groupedData).map(([strategyType, symbols]) => {
                const strategyKey = strategyType;
                    const isStrategyCollapsed = collapsedStrategies.has(strategyKey);
                    
                    // Calculate strategy summary
                    const strategyPositions = [];
                    Object.values(symbols).forEach(symbolPositions => {
                      strategyPositions.push(...symbolPositions);
                    });
                    const strategySummary = calculateSummary(strategyPositions);
                    
                    return (
                    <React.Fragment key={strategyKey}>
                      {/* Strategy Section Header with inline summary */}
                      <tr 
                        className="bg-gray-50 border-b border-gray-100 cursor-pointer hover:bg-gray-100"
                        onClick={() => toggleStrategy(strategyKey)}
                      >
                        <td colSpan="4" className="px-4 py-1 font-medium text-gray-700 text-xs">
                          <div className="flex items-center gap-2">
                            {isStrategyCollapsed ? (
                              <ChevronRight className="w-3 h-3 text-gray-600" />
                            ) : (
                              <ChevronDown className="w-3 h-3 text-gray-600" />
                            )}
                            <span>{getStrategyLabel(strategyType)}</span>
                            <span className="text-gray-600 font-normal">
                              ({strategySummary.count})
                            </span>
                          </div>
                        </td>
                        {renderSummaryCells(strategySummary, 'strategy')}
                        <td className="px-2 py-1.5"></td>
                      </tr>
                      
                      {!isStrategyCollapsed && (
                      <React.Fragment>
                      
                      {/* Symbol Groups */}
                      {Object.entries(symbols).map(([symbol, symbolPositions]) => (
                        <React.Fragment key={`${strategyType}-${symbol}`}>
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
                      <td className="px-2 py-1.5 font-semibold text-gray-900">{formatPositionSymbol(position)}</td>
                      <td className="px-2 py-1.5 text-gray-700">
                        {editingStrategyId === position.id ? (
                          <select
                            className="text-xs py-0.5 px-1 border rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                            value={position.strategy_type}
                            onChange={(e) => {
                              e.stopPropagation();
                              updateStrategyMutation.mutate({
                                positionId: position.id,
                                strategyType: e.target.value
                              });
                            }}
                            onBlur={() => setEditingStrategyId(null)}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                          >
                            <option value="covered_call">Covered Call</option>
                            <option value="vertical_spread">Vertical Spread</option>
                            <option value="box_spread">Box Spread</option>
                            <option value="long_stock">Long Stock</option>
                            <option value="short_stock">Short Stock</option>
                            <option value="big_option">Big Option</option>
                            <option value="single_option">Single Option</option>
                            <option value="unallocated">Unallocated</option>
                          </select>
                        ) : (
                          <div className="flex items-center gap-1 group">
                            <span className="flex items-center gap-1">
                              {getStrategyLabel(position.strategy_type)}
                              {position.is_manual_strategy && (
                                <Lock className="w-3 h-3 text-blue-500" title="Manual assignment (locked)" />
                              )}
                            </span>
                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingStrategyId(position.id);
                                }}
                                className="p-0.5 hover:bg-gray-100 rounded"
                                title="Change strategy"
                              >
                                <Edit2 className="w-3 h-3 text-gray-400" />
                              </button>
                              {position.is_manual_strategy && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm('Reset to automatic strategy detection?')) {
                                      unlockStrategyMutation.mutate(position.id);
                                    }
                                  }}
                                  className="p-0.5 hover:bg-gray-100 rounded"
                                  title="Unlock - use auto-detection on next sync"
                                >
                                  <Unlock className="w-3 h-3 text-gray-400" />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right text-gray-900">
                        {formatQuantity(position.quantity)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-gray-700">
                        {formatCurrency(Math.abs(position.cost_basis))}
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
                      {/* Day P&L */}
                      <td className={`px-2 py-1.5 text-right text-xs font-semibold ${
                        position.current_day_pnl > 0 ? 'text-blue-600' : 
                        position.current_day_pnl < 0 ? 'text-orange-600' : 'text-gray-600'
                      }`}>
                        {position.current_day_pnl ? formatCurrency(position.current_day_pnl) : '-'}
                      </td>
                      {/* Delta (placeholder) */}
                      <td className="px-2 py-1.5 text-right text-gray-400 text-xs">
                        -
                      </td>
                      {/* Theta (placeholder) */}
                      <td className="px-2 py-1.5 text-right text-gray-400 text-xs">
                        -
                      </td>
                      {/* BP Effect */}
                      <td className="px-2 py-1.5 text-right text-gray-700 text-xs">
                        {position.maintenance_requirement ? formatCurrency(position.maintenance_requirement) : '-'}
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
                        {(() => {
                          const daysLeft = getPositionDaysToExpiration(position);
                          if (daysLeft === null) return '-';
                          return (
                            <span className={`font-medium ${
                              daysLeft < 7 ? 'text-red-600' : 
                              daysLeft < 30 ? 'text-orange-600' : 
                              'text-gray-700'
                            }`}>
                              {daysLeft}d
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-2 py-1.5 text-center text-gray-600">
                        {position.legs?.length || 0}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={(e) => handleCollaborate(position, e)}
                          className="inline-flex items-center justify-center p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                          title="Start collaboration on this position"
                        >
                          <Share2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>

                    {/* Expanded Legs Rows */}
                    {isExpanded && position.legs && position.legs.length > 0 && (
                      <tr className="bg-gray-50">
                        <td colSpan="16" className="px-0 py-0">
                          <div className="px-8 py-2">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-600 border-b border-gray-200">
                                  <th className="text-left px-2 py-1 font-medium w-48">Option/Stock</th>
                                  <th className="text-right px-2 py-1 font-medium w-16">Qty</th>
                                  <th className="text-right px-2 py-1 font-medium w-20">Trade Price</th>
                                  <th className="text-right px-2 py-1 font-medium w-20">Current</th>
                                  <th className="text-right px-2 py-1 font-medium w-20">P&L</th>
                                </tr>
                              </thead>
                              <tbody>
                                {position.legs.map((leg, index) => {
                                  // Calculate P&L: (current - trade) * quantity * multiplier
                                  // For options: multiplier = 100, for stocks: multiplier = 1
                                  const multiplier = leg.asset_type === 'option' ? 100 : 1;
                                  const legPnL = leg.current_price && leg.premium 
                                    ? (parseFloat(leg.current_price) - parseFloat(leg.premium)) * parseFloat(leg.quantity) * multiplier
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
                                            <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                                              leg.option_type === 'call' 
                                                ? 'bg-blue-600 text-white' 
                                                : 'bg-purple-600 text-white'
                                            }`}>
                                              {leg.option_type === 'call' ? 'C' : 'P'}
                                            </span>
                                            <span className="font-mono font-bold text-gray-900">
                                              {formatOptionSymbol(leg)}
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
                      )}
                    </React.Fragment>
                  );
                })}
            
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

      {/* Collaboration Modal */}
      {collaborationModalPosition && (
        <CollaborationModal
          position={collaborationModalPosition}
          onClose={() => setCollaborationModalPosition(null)}
          onSuccess={handleCollaborationSuccess}
        />
      )}
    </div>
  );
};

export default SchwabPositionsView;
