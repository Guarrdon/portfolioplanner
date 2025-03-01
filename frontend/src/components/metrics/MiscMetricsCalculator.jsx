import React from 'react';

const MiscMetricsCalculator = ({ formData, setFormData }) => {
  React.useEffect(() => {
    if (!formData.quantity || !formData.entryPrice) {
      return;
    }

    const quantity = parseFloat(formData.quantity);
    const entryPrice = parseFloat(formData.entryPrice);
    const targetPrice = parseFloat(formData.targetPrice);
    const stopLoss = parseFloat(formData.stopLoss);
    
    if (isNaN(quantity) || isNaN(entryPrice)) {
      return;
    }

    const totalValue = (quantity * entryPrice).toFixed(2);
    const updates = { totalValue };

    if (!isNaN(targetPrice)) {
      updates.potentialProfit = ((targetPrice - entryPrice) * quantity).toFixed(2);
    }

    if (!isNaN(stopLoss)) {
      updates.maxLoss = ((entryPrice - stopLoss) * quantity).toFixed(2);
    }

    setFormData(prev => ({
      ...prev,
      ...updates
    }));
  }, [formData.quantity, formData.entryPrice, formData.targetPrice, formData.stopLoss, setFormData]);

  if (!formData.totalValue) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg mt-4">
      <div>
        <label className="text-sm font-medium text-gray-500">Total Position Value</label>
        <p className="text-lg font-semibold text-gray-900">
          ${parseFloat(formData.totalValue).toLocaleString()}
        </p>
      </div>
      {formData.targetPrice && (
        <div>
          <label className="text-sm font-medium text-gray-500">Potential Profit/Loss</label>
          <p className={`text-lg font-semibold ${
            parseFloat(formData.potentialProfit) > 0 
              ? 'text-green-600' 
              : 'text-red-600'
          }`}>
            ${parseFloat(formData.potentialProfit).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
};

export default MiscMetricsCalculator;