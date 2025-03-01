import React, { useMemo } from 'react';

const MaxProfitCalculator = ({ legs = [] }) => {
  const metrics = useMemo(() => {
    // If legs are not fully configured, return a default metrics object
    if (!Array.isArray(legs) || legs.length < 2) {
      return {
        maxProfit: 0,
        maxProfitPercent: 0,
        premiumReceived: 0,
        stockAppreciation: 0,
        positionCost: 0,
        daysToExpiry: 0,
        annualizedReturn: 0
      };
    }
    
    const stockLeg = legs.find(leg => leg.type === 'stock');
    const callLeg = legs.find(leg => leg.type === 'option' && leg.optionType === 'call');

    // If either leg is missing, return default metrics
    if (!stockLeg || !callLeg) {
      return {
        maxProfit: 0,
        maxProfitPercent: 0,
        premiumReceived: 0,
        stockAppreciation: 0,
        positionCost: 0,
        daysToExpiry: 0,
        annualizedReturn: 0
      };
    }

    // Safely parse numeric values with default to 0
    const shares = stockLeg.shares || 0;
    const stockCostBasis = stockLeg.costBasis || 0;
    const callStrike = callLeg.strike || 0;
    const callPremium = callLeg.premium || 0;
    const callContracts = callLeg.contracts || 0;

    // Calculate maximum profit components
    const stockAppreciation = (callStrike - stockCostBasis) * shares;
    const premiumReceived = callPremium * callContracts * 100;
    const maxProfit = stockAppreciation + premiumReceived;

    // Calculate position cost and returns
    const positionCost = shares * stockCostBasis;
    const maxProfitPercent = positionCost > 0 ? (maxProfit / positionCost) * 100 : 0;

    // Calculate time to expiration
    const daysToExpiry = callLeg.expiration 
      ? Math.max(0, Math.ceil((new Date(callLeg.expiration) - new Date()) / (1000 * 60 * 60 * 24)))
      : 0;

    // Calculate annualized return if held to expiration
    const annualizedReturn = daysToExpiry > 0 
      ? (maxProfitPercent * 365) / daysToExpiry 
      : 0;

    return {
      maxProfit,
      maxProfitPercent,
      premiumReceived,
      stockAppreciation,
      positionCost,
      daysToExpiry,
      annualizedReturn
    };
  }, [legs]);

  const formatCurrency = (value) => {
    return (value || 0).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  const formatPercent = (value) => {
    return `${(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}%`;
  };

  return (
    <div className="bg-gray-50 p-4 rounded-lg mt-4 space-y-3">
      {/* Primary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-500">Max Profit</label>
          <p className="text-lg font-semibold text-green-600">
            {formatCurrency(metrics.maxProfit)}
          </p>
        </div>
        
        <div>
          <label className="text-sm font-medium text-gray-500">Return</label>
          <p className="text-lg font-semibold text-blue-600">
            {formatPercent(metrics.maxProfitPercent)}
          </p>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-500">Days to Expiry</label>
          <p className="text-lg font-semibold text-gray-900">
            {metrics.daysToExpiry}
          </p>
        </div>
      </div>

      {/* Detailed Breakdown */}
      <div className="pt-3 border-t border-gray-200">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-500">Premium Received</label>
            <p className="text-sm text-gray-900">{formatCurrency(metrics.premiumReceived)}</p>
          </div>
          
          <div>
            <label className="text-sm font-medium text-gray-500">Stock Appreciation</label>
            <p className="text-sm text-gray-900">{formatCurrency(metrics.stockAppreciation)}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-500">Position Cost</label>
            <p className="text-sm text-gray-900">{formatCurrency(metrics.positionCost)}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-500">Annualized Return</label>
            <p className="text-sm text-gray-900">{formatPercent(metrics.annualizedReturn)}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MaxProfitCalculator;