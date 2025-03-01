import React from 'react';
import { useUser } from '../../contexts/UserContext';
import BaseStrategyForm from './BaseStrategyForm';
import BoxSpreadMetricsCalculator from '../metrics/BoxSpreadMetricsCalculator';
import { useComments } from '../../contexts/CommentsContext';

const BOXSpreadForm = ({ onSubmit, onCancel, existingPosition = null }) => {
  const { currentUser } = useUser();
  const { addComment } = useComments();

  const generateLegs = (formData) => {
    // Generate legs only if all required fields are present
    if (formData.upperStrike && formData.lowerStrike && formData.expiration && formData.contracts) {
      return [
        {
          id: 'short-call-leg',
          type: 'option',
          optionType: 'call',
          contracts: formData.contracts,
          strike: formData.upperStrike,
          premium: formData.debitPaid ? (formData.debitPaid / (formData.contracts * 4)).toFixed(2) : '0',
          expiration: formData.expiration,
          side: 'short'
        },
        {
          id: 'long-call-leg',
          type: 'option',
          optionType: 'call',
          contracts: formData.contracts,
          strike: formData.lowerStrike,
          premium: formData.debitPaid ? (formData.debitPaid / (formData.contracts * 4)).toFixed(2) : '0',
          expiration: formData.expiration,
          side: 'long'
        },
        {
          id: 'short-put-leg',
          type: 'option',
          optionType: 'put',
          contracts: formData.contracts,
          strike: formData.lowerStrike,
          premium: formData.debitPaid ? (formData.debitPaid / (formData.contracts * 4)).toFixed(2) : '0',
          expiration: formData.expiration,
          side: 'short'
        },
        {
          id: 'long-put-leg',
          type: 'option',
          optionType: 'put',
          contracts: formData.contracts,
          strike: formData.upperStrike,
          premium: formData.debitPaid ? (formData.debitPaid / (formData.contracts * 4)).toFixed(2) : '0',
          expiration: formData.expiration,
          side: 'long'
        }
      ];
    }
    return [];
  };

  const initialData = existingPosition || {
    strategy: 'boxSpreads',
    userId: currentUser?.id,
    ownerId: currentUser?.id,
    account: '',
    symbol: 'SPX',
    contracts: 1,
    upperStrike: '',
    lowerStrike: '',
    expiration: '',
    debitPaid: '', 
    notionalValue: '',
    effectiveRate: '',
    tags: [],
    notes: '',
    legs: []
  };

  // Set initial legs if not already present
  if (!initialData.legs || initialData.legs.length === 0) {
    initialData.legs = generateLegs(initialData);
  }

  const validateForm = async (formData) => {
    if (!formData.upperStrike || !formData.lowerStrike || !formData.expiration || !formData.debitPaid) {
      throw new Error('Please fill in all required fields');
    }

    if (parseFloat(formData.upperStrike) <= parseFloat(formData.lowerStrike)) {
      throw new Error('Upper strike must be higher than lower strike');
    }

    // Ensure legs are generated
    formData.legs = generateLegs(formData);
  };

  const handleFormSubmit = async (position) => {
    // Check if this is a new position and there's an initial note
    if (existingPosition) {
      const comment = {
        id: `${position.id}-comment`,
        positionId: position.id,
        text: position.notes || '',
        author: 'user',
        timestamp: new Date().toISOString()
      };

      const commentAdded = await addComment(comment);
      if (!commentAdded) {
        console.error('Failed to add initial comment:', {
          commentId: comment.id,
          positionId: position.id
        });
      }
    }

    onSubmit && onSubmit(position);
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
            placeholder="SPX"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Number of Spreads
            <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            name="contracts"
            value={formData.contracts}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            min="1"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Upper Strike
            <span className="text-red-500">*</span>
          </label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="number"
              name="upperStrike"
              value={formData.upperStrike}
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
            Lower Strike
            <span className="text-red-500">*</span>
          </label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="number"
              name="lowerStrike"
              value={formData.lowerStrike}
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
            Debit Paid
            <span className="text-red-500">*</span>
          </label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="number"
              name="debitPaid"
              value={formData.debitPaid}
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
            Expiration Date
            <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            name="expiration"
            value={formData.expiration}
            onChange={handleChange}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            required
          />
        </div>
      </div>

      <BoxSpreadMetricsCalculator formData={formData} setFormData={setFormData} />
    </>
  );

  return (
    <BaseStrategyForm
      strategy="boxSpreads"
      initialData={initialData}
      onSubmit={handleFormSubmit}
      onCancel={onCancel}
      existingPosition={existingPosition}
      validate={validateForm}
    >
      {renderFormFields}
    </BaseStrategyForm>
  );
};

export default BOXSpreadForm;