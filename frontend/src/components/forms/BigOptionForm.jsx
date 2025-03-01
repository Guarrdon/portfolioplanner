import React from 'react';
import { useUser } from '../../contexts/UserContext';
import BaseStrategyForm from './BaseStrategyForm';
import BigOptionsMetricsCalculator from '../metrics/BigOptionsMetricsCalculator';
import { validateBigOptionPosition } from '../../utils/validation';

const BigOptionForm = ({ onSubmit, onCancel, existingPosition = null }) => {
  const { currentUser } = useUser();

  const generateLeg = (formData) => {
    // Generate leg only if all required fields are present
    if (formData.symbol && formData.strike && formData.expiration && formData.contracts && formData.premium) {
      return [
        {
          id: `big-option-leg-${Date.now()}`,
          type: 'option',
          optionType: formData.optionType || 'call',
          contracts: formData.contracts,
          strike: formData.strike,
          premium: formData.premium,
          expiration: formData.expiration,
          side: formData.side || 'long'
        }
      ];
    }
    return [];
  };

  const initialData = existingPosition || {
    strategy: 'bigOptions',
    userId: currentUser?.id,
    ownerId: currentUser?.id,
    account: '',
    symbol: '',
    optionType: 'call',
    side: 'long',
    contracts: 1,
    strike: '',
    expiration: '',
    premium: '',
    totalCost: '',
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
    validateBigOptionPosition(formData);
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
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="SPY"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Option Type
            <span className="text-red-500">*</span>
          </label>
          <select
            name="optionType"
            value={formData.optionType}
            onChange={handleChange}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            required
          >
            <option value="call">Call</option>
            <option value="put">Put</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Option Side
            <span className="text-red-500">*</span>
          </label>
          <select
            name="side"
            value={formData.side}
            onChange={handleChange}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            required
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Strike Price
            <span className="text-red-500">*</span>
          </label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="number"
              name="strike"
              value={formData.strike}
              onChange={handleChange}
              className="pl-7 block w-full rounded-md border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              placeholder="0.00"
              step="0.01"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Number of Contracts
            <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            name="contracts"
            value={formData.contracts}
            onChange={handleChange}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            min="1"
            step="1"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Premium Per Contract
            <span className="text-red-500">*</span>
          </label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="number"
              name="premium"
              value={formData.premium}
              onChange={handleChange}
              className="pl-7 block w-full rounded-md border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              placeholder="0.00"
              step="0.01"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Expiration Date
            <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            name="expiration"
            value={formData.expiration}
            onChange={handleChange}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            required
          />
        </div>
      </div>

      <BigOptionsMetricsCalculator formData={formData} />
    </>
  );

  return (
    <BaseStrategyForm
      strategy="bigOptions"
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

export default BigOptionForm;