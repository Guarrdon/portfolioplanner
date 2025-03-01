import React, { useEffect } from 'react';

const DividendMetricsCalculator = ({ formData, setFormData }) => {
  useEffect(() => {
    if (!formData.shares || !formData.costBasis || !formData.currentDividend || !formData.dividendFrequency) {
      return;
    }

    const shares = parseInt(formData.shares);
    const costBasis = parseFloat(formData.costBasis);
    const currentDividend = parseFloat(formData.currentDividend);
    
    if (isNaN(shares) || isNaN(costBasis) || isNaN(currentDividend)) {
      return;
    }

    const multiplier = {
      monthly: 12,
      quarterly: 4,
      'semi-annual': 2,
      annual: 1
    }[formData.dividendFrequency];

    const annualDividend = (currentDividend * multiplier).toFixed(2);
    const totalCost = (shares * costBasis).toFixed(2);
    const yearlyIncome = (shares * currentDividend * multiplier).toFixed(2);
    const divYield = ((currentDividend * multiplier / costBasis) * 100).toFixed(2);

    setFormData(prev => ({
      ...prev,
      annualDividend,
      totalCost,
      yearlyIncome,
      divYield
    }));
  }, [
    formData.shares, 
    formData.costBasis, 
    formData.currentDividend, 
    formData.dividendFrequency, 
    setFormData
  ]);

  // Only render when metrics are available
  if (!formData.annualDividend) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50 p-4 rounded-lg mt-4">
      <div>
        <label className="text-sm font-medium text-gray-500">Annual Dividend</label>
        <p className="text-lg font-semibold text-gray-900">
          ${formData.annualDividend}
        </p>
      </div>
      <div>
        <label className="text-sm font-medium text-gray-500">Annual Income</label>
        <p className="text-lg font-semibold text-green-600">
          ${parseFloat(formData.yearlyIncome).toLocaleString()}
        </p>
      </div>
      <div>
        <label className="text-sm font-medium text-gray-500">Dividend Yield</label>
        <p className="text-lg font-semibold text-blue-600">
          {formData.divYield}%
        </p>
      </div>
    </div>
  );
};

export default DividendMetricsCalculator;