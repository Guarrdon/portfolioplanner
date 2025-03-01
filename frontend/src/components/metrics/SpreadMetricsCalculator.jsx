import React from 'react';

const SpreadMetricsCalculator = ({ legs }) => {
  if (!legs || legs.length < 1) return null;

  const shortPut = legs.find(leg => leg.type === 'option' && leg.side === 'short');
  const longPut = legs.find(leg => leg.type === 'option' && leg.side === 'long');

  // Calculate metrics based on whether it's a naked put or spread
  const calculateMetrics = () => {
    if (!shortPut) return null;
    
    const shortStrike = parseFloat(shortPut.strike);
    const shortPremium = parseFloat(shortPut.premium);
    const contracts = parseInt(shortPut.contracts);

    // For naked put
    if (!longPut) {
      const maxProfit = (shortPremium * contracts * 100).toFixed(2);
      const maxRisk = ((shortStrike - shortPremium) * contracts * 100).toFixed(2);
      return { maxProfit, maxRisk };
    }

    // For put spread
    const longStrike = parseFloat(longPut.strike);
    const longPremium = parseFloat(longPut.premium);
    const width = shortStrike - longStrike;
    const netCredit = shortPremium - longPremium;

    const maxProfit = (netCredit * contracts * 100).toFixed(2);
    const maxRisk = ((width - netCredit) * contracts * 100).toFixed(2);

    return { maxProfit, maxRisk };
  };

  const metrics = calculateMetrics();
  if (!metrics) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg mt-4">
      <div>
        <label className="text-sm font-medium text-gray-500">Max Risk</label>
        <p className="text-lg font-semibold text-red-600">
          ${parseFloat(metrics.maxRisk).toLocaleString()}
        </p>
      </div>
      <div>
        <label className="text-sm font-medium text-gray-500">Max Profit</label>
        <p className="text-lg font-semibold text-green-600">
          ${parseFloat(metrics.maxProfit).toLocaleString()}
        </p>
      </div>
    </div>
  );
};

export default SpreadMetricsCalculator;