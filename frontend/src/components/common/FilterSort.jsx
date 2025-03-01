// src/components/common/FilterSort.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { SortAsc, SortDesc, Search, X } from 'lucide-react';
import { useAccounts } from '../../contexts/AccountsContext';

// Move constants to the top of the file
const SORT_OPTIONS = [
  { id: 'expiration-asc', label: 'Expiration (Nearest)', field: 'expiration' },
  { id: 'expiration-desc', label: 'Expiration (Furthest)', field: 'expiration', reverse: true },
  { id: 'risk-desc', label: 'Highest Risk', field: 'risk', reverse: true },
  { id: 'risk-asc', label: 'Lowest Risk', field: 'risk' },
  { id: 'profit-desc', label: 'Highest Profit', field: 'profit', reverse: true },
  { id: 'profit-asc', label: 'Lowest Profit', field: 'profit' },
  { id: 'created-desc', label: 'Most Recent', field: 'createdAt', reverse: true },
  { id: 'created-asc', label: 'Oldest', field: 'createdAt' }
];

const FILTER_KEYWORDS = {
  '>': '> profit',
  '<': '< loss',
  'exp:': 'expiration:',
  'tag:': 'tag:',
  'risk:': 'risk:',
  'acc:': 'account:',
  'credit:': 'credit:',
  'strike:': 'strike:'
};

const FilterSort = ({ positions, onFilteredPositions }) => {
  const { accounts } = useAccounts();
  const [filterText, setFilterText] = useState('');
  const [expandedText, setExpandedText] = useState('');
  const [sortOption, setSortOption] = useState('created-desc');
  const [selectedAccount, setSelectedAccount] = useState('');

  // Keywords expansion effect
  useEffect(() => {
    let newText = filterText;
    Object.entries(FILTER_KEYWORDS).forEach(([key, expansion]) => {
      if (filterText === key) {
        newText = expansion;
        setFilterText(expansion);
      }
    });
    setExpandedText(newText);
  }, [filterText]);

  // Memoize position metrics calculation
  const getPositionMetrics = useCallback((position) => {
    if (!position.legs || position.legs.length === 0) return {};

    switch (position.strategy) {
      case 'coveredCalls': {
        const stockLeg = position.legs.find(leg => leg.type === 'stock');
        const callLeg = position.legs.find(leg => 
          leg.type === 'option' && leg.optionType === 'call');

        if (!stockLeg || !callLeg) return {};

        const totalCost = stockLeg.shares * stockLeg.costBasis;
        const premium = callLeg.contracts * callLeg.premium * 100;
        const maxProfit = ((callLeg.strike - stockLeg.costBasis) * stockLeg.shares) + premium;

        return {
          risk: totalCost,
          profit: maxProfit,
          premium,
          expiration: callLeg.expiration,
          strikePrice: callLeg.strike
        };
      }
      // ... keep other strategy cases as is ...
      default:
        return {};
    }
  }, []);

  // Memoize filter function
  const filterPositions = useCallback((positions, filterText, selectedAccount) => {
    let filtered = [...positions];

    // Apply account filter
    if (selectedAccount) {
      filtered = filtered.filter(p => p.account === selectedAccount);
    }

    // Apply text filters
    if (filterText) {
      const lcFilter = filterText.toLowerCase();
      
      if (lcFilter.startsWith('> profit')) {
        filtered = filtered.filter(p => {
          const metrics = getPositionMetrics(p);
          return metrics.profit > 0;
        });
      } else if (lcFilter.startsWith('< loss')) {
        filtered = filtered.filter(p => {
          const metrics = getPositionMetrics(p);
          return metrics.profit < 0;
        });
      } else if (lcFilter.startsWith('expiration:')) {
        const dateStr = lcFilter.replace('expiration:', '').trim();
        filtered = filtered.filter(p => {
          const metrics = getPositionMetrics(p);
          return metrics.expiration && metrics.expiration.toLowerCase().includes(dateStr);
        });
      } else if (lcFilter.startsWith('credit:')) {
        const creditValue = parseFloat(lcFilter.replace('credit:', ''));
        if (!isNaN(creditValue)) {
          filtered = filtered.filter(p => {
            const metrics = getPositionMetrics(p);
            return metrics.credit >= creditValue;
          });
        }
      } else if (lcFilter.startsWith('strike:')) {
        const strikeValue = parseFloat(lcFilter.replace('strike:', ''));
        if (!isNaN(strikeValue)) {
          filtered = filtered.filter(p => {
            const metrics = getPositionMetrics(p);
            return metrics.strikePrice === strikeValue;
          });
        }
      } else if (lcFilter.startsWith('tag:')) {
        const tag = lcFilter.replace('tag:', '').trim();
        filtered = filtered.filter(p => 
          p.tags && p.tags.some(t => t.toLowerCase().includes(tag))
        );
      } else if (lcFilter.startsWith('account:')) {
        const accountName = lcFilter.replace('account:', '').trim();
        filtered = filtered.filter(p => {
          const account = accounts.find(a => a.id === p.account);
          return account && account.name.toLowerCase().includes(accountName);
        });
      } else if (lcFilter.startsWith('risk:')) {
        const risk = lcFilter.replace('risk:', '').trim();
        filtered = filtered.filter(p => 
          p.riskLevel && p.riskLevel.toLowerCase().includes(risk)
        );
      } else {
        // General text search
        filtered = filtered.filter(p => {
          const matchesSymbol = p.symbol.toLowerCase().includes(lcFilter);
          const matchesNotes = p.notes && p.notes.toLowerCase().includes(lcFilter);
          const matchesTags = p.tags && p.tags.some(tag => 
            tag.toLowerCase().includes(lcFilter)
          );
          const account = accounts.find(a => a.id === p.account);
          const matchesAccount = account && account.name.toLowerCase().includes(lcFilter);
          return matchesSymbol || matchesNotes || matchesTags || matchesAccount;
        });
      }
    }

    return filtered;
  }, [accounts, getPositionMetrics]);

  // Memoize sort function
  const sortPositions = useCallback((positions, sortOption) => {
    const [field, direction] = sortOption.split('-');
    
    return [...positions].sort((a, b) => {
      const metricsA = getPositionMetrics(a);
      const metricsB = getPositionMetrics(b);
      
      let comparison = 0;
      
      switch (field) {
        case 'expiration':
          if (!metricsA.expiration && !metricsB.expiration) return 0;
          if (!metricsA.expiration) return 1;
          if (!metricsB.expiration) return -1;
          comparison = new Date(metricsA.expiration) - new Date(metricsB.expiration);
          break;
        case 'risk':
          comparison = metricsA.risk - metricsB.risk;
          break;
        case 'profit':
          comparison = metricsA.profit - metricsB.profit;
          break;
        case 'created':
          comparison = new Date(a.createdAt) - new Date(b.createdAt);
          break;
        default:
          comparison = 0;
      }
      
      return direction === 'desc' ? -comparison : comparison;
    });
  }, [getPositionMetrics]);

  // Apply filters and sorting when dependencies change
  useEffect(() => {
    const filtered = filterPositions(positions, expandedText, selectedAccount);
    const sorted = sortPositions(filtered, sortOption);
    onFilteredPositions(sorted);
  }, [positions, expandedText, selectedAccount, sortOption, filterPositions, sortPositions, onFilteredPositions]);

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-4">
        {/* Filter Input */}
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="block w-full pl-10 pr-10 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Filter by symbol, account, or type 'credit:', 'exp:', 'strike:' for specific filters..."
          />
          {filterText && (
            <button
              onClick={() => setFilterText('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center"
            >
              <X className="h-4 w-4 text-gray-400 hover:text-gray-500" />
            </button>
          )}
        </div>

        {/* Account Filter */}
        <div className="w-48">
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="block w-full pl-3 pr-10 py-2 text-base border border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 rounded-md"
          >
            <option value="">All Accounts</option>
            {accounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>

        {/* Sort Dropdown */}
        <div className="relative">
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value)}
            className="block w-48 pl-3 pr-10 py-2 text-base border border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 rounded-md"
          >
            {SORT_OPTIONS.map(option => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            {sortOption.endsWith('-desc') ? (
              <SortDesc className="h-4 w-4 text-gray-400" />
            ) : (
              <SortAsc className="h-4 w-4 text-gray-400" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(FilterSort);