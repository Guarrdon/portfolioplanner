import React from 'react';
import { useUser } from '../../contexts/UserContext';
import BaseStrategyForm from './BaseStrategyForm';
import MiscMetricsCalculator from '../metrics/MiscMetricsCalculator';
import { validateMiscPosition } from '../../utils/validation/miscValidation';

const MiscForm = ({ onSubmit, onCancel, existingPosition = null }) => {
  const { currentUser } = useUser();

  const generateLeg = (formData) => {
    // Generate leg only if all required fields are present
    if (formData.symbol && formData.quantity && formData.entryPrice) {
      return [
        {
          id: `misc-position-leg-${Date.now()}`,
          type: formData.positionType === 'stock' ? 'stock' : 'other',
          quantity: parseFloat(formData.quantity),
          entryPrice: parseFloat(formData.entryPrice),
          side: 'long'
        }
      ];
    }
    return [];
  };

  const initialData = existingPosition || {
    strategy: 'misc',
    userId: currentUser?.id,
    ownerId: currentUser?.id,
    account: '',
    symbol: '',
    positionType: 'stock',
    quantity: '',
    entryPrice: '',
    targetPrice: '',
    stopLoss: '',
    riskLevel: 'medium',
    totalValue: '',
    potentialProfit: '',
    maxLoss: '',
    tags: [],
    notes: '',
    legs: []
  };

  // Set initial legs if not already present
  if (!initialData.legs || initialData.legs.length === 0) {
    initialData.legs = generateLeg(initialData);
  }

  const validateForm = async (formData) => {
    // Ensure legs are generated
    if (!formData.legs || formData.legs.length === 0) {
      formData.legs = generateLeg(formData);
    }

    // Validate the generated position
    validateMiscPosition(formData);
  };

  const renderFormFields = ({ formData, handleChange, setFormData }) => (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Symbol/Identifier
            <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            name="symbol"
            value={formData.symbol}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="Enter symbol or identifier"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Position Type
            <span className="text-red-500">*</span>
          </label>
          <select
            name="positionType"
            value={formData.positionType}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            required
          >
            <option value="stock">Stock</option>
            <option value="etf">ETF</option>
            <option value="futures">Futures</option>
            <option value="forex">Forex</option>
            <option value="crypto">Cryptocurrency</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Quantity/Units
            <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            name="quantity"
            value={formData.quantity}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="Enter quantity"
            step="any"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Entry Price
            <span className="text-red-500">*</span>
          </label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="number"
              name="entryPrice"
              value={formData.entryPrice}
              onChange={handleChange}
              className="pl-7 block w-full rounded border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              placeholder="0.00"
              step="any"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Target Price
          </label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="number"
              name="targetPrice"
              value={formData.targetPrice}
              onChange={handleChange}
              className="pl-7 block w-full rounded border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              placeholder="0.00"
              step="any"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Stop Loss
          </label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="number"
              name="stopLoss"
              value={formData.stopLoss}
              onChange={handleChange}
              className="pl-7 block w-full rounded border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              placeholder="0.00"
              step="any"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Risk Level
          </label>
          <select
            name="riskLevel"
            value={formData.riskLevel}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>

      <MiscMetricsCalculator formData={formData} setFormData={setFormData} />
    </>
  );

  return (
    <BaseStrategyForm
      strategy="misc"
      initialData={initialData}
      onSubmit={onSubmit}
      onCancel={onCancel}
      existingPosition={existingPosition}
      validate={validateForm}
    >
      {renderFormFields}
    </BaseStrategyForm>
  );
};

export default MiscForm;