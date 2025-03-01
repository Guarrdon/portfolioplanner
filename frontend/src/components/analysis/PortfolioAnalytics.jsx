import React, { useMemo } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { BarChart2, AlertTriangle, PieChart, DollarSign } from 'lucide-react';

const PortfolioAnalytics = () => {
  const { strategies } = usePortfolio();

  const analytics = useMemo(() => {
    // Initialize metrics
    const metrics = {
      totalPositions: 0,
      totalExposure: 0,
      strategyAllocation: {},
      riskLevels: {
        high: 0,
        medium: 0,
        low: 0
      },
      largestPositions: [],
      symbolConcentration: {}
    };

    // Process all positions
    Object.entries(strategies).forEach(([strategyType, positions]) => {
      metrics.totalPositions += positions.length;
      metrics.strategyAllocation[strategyType] = positions.length;

      positions.forEach(position => {
        // Calculate position exposure
        let positionExposure = 0;
        if (position.legs) {
          position.legs.forEach(leg => {
            if (leg.type === 'stock') {
              positionExposure += leg.shares * leg.costBasis;
            } else if (leg.type === 'option') {
              positionExposure += leg.contracts * leg.strike * 100;
            }
          });
        }
        metrics.totalExposure += positionExposure;

        // Track position sizes
        metrics.largestPositions.push({
          symbol: position.symbol,
          strategy: strategyType,
          exposure: positionExposure,
          account: position.account
        });

        // Track symbol concentration
        if (position.symbol) {
          metrics.symbolConcentration[position.symbol] = 
            (metrics.symbolConcentration[position.symbol] || 0) + 1;
        }

        // Track risk levels from tags
        const riskTag = position.tags?.find(tag => 
          tag.toLowerCase().includes('risk')
        );
        if (riskTag) {
          if (riskTag.toLowerCase().includes('high')) {
            metrics.riskLevels.high++;
          } else if (riskTag.toLowerCase().includes('med') || riskTag.toLowerCase().includes('mid')) {
            metrics.riskLevels.medium++;
          } else if (riskTag.toLowerCase().includes('low')) {
            metrics.riskLevels.low++;
          }
        }
      });
    });

    // Sort largest positions
    metrics.largestPositions.sort((a, b) => b.exposure - a.exposure);
    metrics.largestPositions = metrics.largestPositions.slice(0, 5);

    // Calculate concentration risks (symbols in 2 or more positions)
    metrics.highConcentrationSymbols = Object.entries(metrics.symbolConcentration)
      .filter(([_, count]) => count >= 2) // Changed to 2 for testing
      .map(([symbol, count]) => ({ symbol, count }))
      .sort((a, b) => b.count - a.count);
    
    return metrics;
  }, [strategies]);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  return (
    <div className="space-y-6">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Portfolio Analytics</h1>
        <p className="text-gray-600">Overview of your portfolio metrics and exposure</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <BarChart2 className="h-8 w-8 text-blue-500" />
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Positions</p>
              <p className="text-2xl font-semibold text-gray-900">{analytics.totalPositions}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <DollarSign className="h-8 w-8 text-green-500" />
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Exposure</p>
              <p className="text-2xl font-semibold text-gray-900">
                {formatCurrency(analytics.totalExposure)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <PieChart className="h-8 w-8 text-purple-500" />
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Strategy Types</p>
              <p className="text-2xl font-semibold text-gray-900">
                {Object.keys(analytics.strategyAllocation).filter(s => 
                  analytics.strategyAllocation[s] > 0
                ).length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">High Risk Positions</p>
              <p className="text-2xl font-semibold text-gray-900">{analytics.riskLevels.high}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Concentration Risks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Largest Positions</h3>
          <div className="space-y-4">
            {analytics.largestPositions.map((position, index) => (
              <div key={index} className="flex justify-between items-center">
                <div>
                  <p className="font-medium text-gray-900">{position.symbol}</p>
                  <p className="text-sm text-gray-500">{position.strategy} - {position.account}</p>
                </div>
                <span className="font-medium text-gray-900">
                  {formatCurrency(position.exposure)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Symbol Concentration</h3>
          <div className="space-y-4">
            {analytics.highConcentrationSymbols.map((item, index) => (
              <div key={index} className="flex justify-between items-center">
                <div>
                  <p className="font-medium text-gray-900">{item.symbol}</p>
                  <p className="text-sm text-gray-500">{item.count} positions</p>
                </div>
                <span className="px-2 py-1 bg-amber-100 text-amber-800 rounded-full text-sm">
                  Higher Exposure
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Strategy Distribution */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Strategy Distribution</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Object.entries(analytics.strategyAllocation).map(([strategy, count]) => (
            <div key={strategy} className="text-center">
              <div className="text-2xl font-semibold text-gray-900">{count}</div>
              <div className="text-sm text-gray-500 capitalize">
                {strategy.replace(/([A-Z])/g, ' $1').trim()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PortfolioAnalytics;