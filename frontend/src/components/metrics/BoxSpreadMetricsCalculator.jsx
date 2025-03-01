import React, { useEffect } from 'react';

const BoxSpreadMetricsCalculator = ({ formData, setFormData }) => {
  useEffect(() => {
    const calculateMetrics = (upperStrike, lowerStrike, debitPaid, expiration, contracts) => {
      if (!upperStrike || !lowerStrike || !debitPaid || !expiration) return null;

      const width = parseFloat(upperStrike) - parseFloat(lowerStrike);
      const notionalValue = width * 100 * parseInt(contracts);
      const debit = parseFloat(debitPaid);
      
      const daysToExpiry = (new Date(expiration) - new Date()) / (1000 * 60 * 60 * 24);
      const effectiveRate = ((debit / notionalValue) * (365 / daysToExpiry) * 100).toFixed(2);

      return {
        notionalValue: notionalValue.toFixed(2),
        effectiveRate
      };
    };

    const metrics = calculateMetrics(
      formData.upperStrike,
      formData.lowerStrike,
      formData.debitPaid,
      formData.expiration,
      formData.contracts
    );

    if (metrics) {
      setFormData(prev => ({
        ...prev,
        ...metrics
      }));
    }
  }, [formData.upperStrike, formData.lowerStrike, formData.debitPaid, formData.expiration, formData.contracts, setFormData]);

  if (!formData.notionalValue || !formData.effectiveRate) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg mt-4">
      <div>
        <label className="text-sm font-medium text-gray-500">Notional Value</label>
        <p className="text-lg font-semibold text-gray-900">
          ${parseFloat(formData.notionalValue).toLocaleString()}
        </p>
      </div>
      <div>
        <label className="text-sm font-medium text-gray-500">Effective Annual Rate</label>
        <p className="text-lg font-semibold text-blue-600">
          {formData.effectiveRate}%
        </p>
      </div>
    </div>
  );
};

export default BoxSpreadMetricsCalculator;