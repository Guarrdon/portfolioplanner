// src/components/metrics/BigOptionsMetricsCalculator.jsx
import React, { useMemo } from 'react';

const BigOptionsMetricsCalculator = ({ formData }) => {
  const metrics = useMemo(() => {
    if (!formData.premium || !formData.contracts) return null;

    const premium = parseFloat(formData.premium);
    const contracts = parseInt(formData.contracts);
    
    if (isNaN(premium) || isNaN(contracts)) return null;

    const totalCost = premium * contracts * 100;
    const maxRisk = totalCost;
    let maxProfit;

    // Calculate max profit based on option type
    if (formData.optionType === 'put') {
      // For puts, max profit is the premium received for short puts
      // or max loss is the premium paid for long puts
      maxProfit = formData.side === 'short' ? totalCost : -totalCost;
    } else {
      // For calls, max profit is theoretically unlimited for long calls
      // or limited to premium received for short calls
      maxProfit = formData.side === 'short' ? totalCost : 'Unlimited';
    }

    return {
      totalCost,
      maxRisk,
      maxProfit
    };
  }, [formData.premium, formData.contracts, formData.optionType, formData.side]);

  if (!metrics) return null;

  const formatValue = (value) => {
    if (value === 'Unlimited') return value;
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50 p-4 rounded-lg mt-4">
      <div>
        <label className="text-sm font-medium text-gray-500">Total Cost</label>
        <p className="text-lg font-semibold text-gray-900">
          {formatValue(metrics.totalCost)}
        </p>
      </div>
      <div>
        <label className="text-sm font-medium text-gray-500">Max Risk</label>
        <p className="text-lg font-semibold text-red-600">
          {formatValue(metrics.maxRisk)}
        </p>
      </div>
      <div>
        <label className="text-sm font-medium text-gray-500">Max Profit</label>
        <p className="text-lg font-semibold text-green-600">
          {formatValue(metrics.maxProfit)}
        </p>
      </div>
    </div>
  );
};

export default BigOptionsMetricsCalculator;