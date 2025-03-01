import React from 'react';
import { useUser } from '../../contexts/UserContext';
import BaseStrategyForm from './BaseStrategyForm';
import DividendMetricsCalculator from '../metrics/DividendMetricsCalculator';
import { validateDividendPosition } from '../../utils/validation';

const DividendForm = ({ onSubmit, onCancel, existingPosition = null }) => {
  const { currentUser } = useUser();

  const generateLeg = (formData) => {
    // Generate stock leg only if all required fields are present
    if (formData.symbol && formData.shares && formData.costBasis) {
      return [
        {
          id: `dividend-stock-leg-${Date.now()}`,
          type: 'stock',
          shares: parseInt(formData.shares),
          costBasis: parseFloat(formData.costBasis),
          side: 'long'
        }
      ];
    }
    return [];
  };

  const initialData = existingPosition || {
    strategy: 'dividends',
    userId: currentUser?.id,
    ownerId: currentUser?.id,
    account: '',
    symbol: '',
    shares: 100,
    costBasis: '',
    currentDividend: '',
    dividendFrequency: 'quarterly',
    nextExDate: '',
    nextPayDate: '',
    annualDividend: '',
    totalCost: '',
    yearlyIncome: '',
    divYield: '',
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
    validateDividendPosition(formData);
  };

  const renderFormFields = ({ formData, handleChange, setFormData }) => (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Symbol
            <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            name="symbol"
            value={formData.symbol}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="KO"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Number of Shares
            <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            name="shares"
            value={formData.shares}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            min="1"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Cost Basis Per Share
            <span className="text-red-500">*</span>
          </label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="number"
              name="costBasis"
              value={formData.costBasis}
              onChange={handleChange}
              className="pl-7 block w-full rounded border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              placeholder="0.00"
              step="0.01"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Current Dividend Per Share
            <span className="text-red-500">*</span>
          </label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="number"
              name="currentDividend"
              value={formData.currentDividend}
              onChange={handleChange}
              className="pl-7 block w-full rounded border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              placeholder="0.00"
              step="0.01"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Dividend Frequency
            <span className="text-red-500">*</span>
          </label>
          <select
            name="dividendFrequency"
            value={formData.dividendFrequency}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            required
          >
            <option value="quarterly">Quarterly</option>
            <option value="monthly">Monthly</option>
            <option value="semi-annual">Semi-Annual</option>
            <option value="annual">Annual</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Next Ex-Dividend Date
          </label>
          <input
            type="date"
            name="nextExDate"
            value={formData.nextExDate}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Next Payment Date
          </label>
          <input
            type="date"
            name="nextPayDate"
            value={formData.nextPayDate}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
      </div>

      <DividendMetricsCalculator formData={formData} setFormData={setFormData} />
    </>
  );

  return (
    <BaseStrategyForm
      strategy="dividends"
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

export default DividendForm;