// src/components/portfolio/PortfolioView.jsx

import React, { useEffect }  from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import StrategyCard from './StrategyCard';

const PortfolioView = () => {
  const { strategies = {}, loading, error } = usePortfolio();

  useEffect(() => {
    //console.log('PortfolioView mounted');
    return () => console.log('PortfolioView unmounted');
  }, []);
  
  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
        <p className="text-sm font-medium">Error loading portfolio data</p>
        <p className="text-xs">{error.message}</p>
      </div>
    );
  }

  const strategyTypes = {
    coveredCalls: {
      title: 'Covered Calls',
      description: 'Stock ownership with call options sold against the position',
      route: 'covered-calls'
    },
    putSpreads: {
      title: 'Put Option Spreads',
      description: 'Defined risk put option strategies',
      route: 'put-spreads'
    },
    bigOptions: {
      title: 'Big Options',
      description: 'Significant option positions',
      route: 'big-options'
    },
    boxSpreads: {
      title: 'Margin Spreads',
      description: 'Box and Iron Fly spreads for margin efficiency',
      route: 'box-spreads'
    },
    dividends: {
      title: 'Dividend Positions',
      description: 'Positions held primarily for dividend income',
      route: 'dividends'
    },
    misc: {
      title: 'Miscellaneous',
      description: 'Other trading strategies and positions',
      route: 'misc'
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Portfolio Overview</h1>
        <p className="text-gray-600">Manage and track your investment strategies</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-fr">
        {Object.entries(strategyTypes).map(([key, { title, description, route }]) => (
          <StrategyCard
            key={key}
            title={title}
            description={description}
            positions={strategies[key] || []} // Add default empty array
            strategyType={key}
          />
        ))}
      </div>
    </div>
  );
};

export default PortfolioView;