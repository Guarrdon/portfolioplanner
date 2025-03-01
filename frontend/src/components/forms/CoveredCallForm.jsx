import React from 'react';
import { useUser } from '../../contexts/UserContext';
import BaseStrategyForm from './BaseStrategyForm';
import MaxProfitCalculator from '../metrics/MaxProfitCalculator';
import { validateCoveredCallPosition } from '../../utils/validation';

const CoveredCallForm = ({ onSubmit, onCancel, existingPosition = null }) => {
  const { currentUser } = useUser();

  const initialData = existingPosition || {
    strategy: 'coveredCalls',
    userId: currentUser?.id, // Add userId to initial data
    ownerId: currentUser?.id, // Add this line to set initial ownerId
    symbol: '',
    account: '',
    tags: [],
    legs: [
      {
        id: 'stock-leg',
        type: 'stock',
        shares: 100,
        costBasis: '',
        side: 'long'
      },
      {
        id: 'call-leg',
        type: 'option',
        optionType: 'call',
        contracts: 1,
        strike: '',
        premium: '',
        expiration: '',
        side: 'short'
      }
    ]
  };

  const renderFormFields = ({ formData, handleChange, setFormData, initialNote, setInitialNote }) => {
    const stockLeg = formData.legs.find(leg => leg.type === 'stock');
    const callLeg = formData.legs.find(leg => leg.type === 'option' && leg.optionType === 'call');

    const handleLegChange = (legId, field, value) => {
      setFormData(prev => {
        const newLegs = prev.legs.map(leg => {
          if (leg.id === legId) {
            // Handle the value based on field type
            let processedValue = value;
            if (field === 'shares' || field === 'contracts') {
              processedValue = value === '' ? '' : parseInt(value) || 0;
            } else if (field === 'costBasis' || field === 'strike' || field === 'premium') {
              processedValue = value === '' ? '' : parseFloat(value) || 0;
            }
            
            return { ...leg, [field]: processedValue };
          }
          return leg;
        });

        // If we're updating shares on the stock leg, update the option contracts
        if (legId === 'stock-leg' && field === 'shares') {
          const stockLeg = newLegs.find(l => l.id === 'stock-leg');
          const callLeg = newLegs.find(l => l.id === 'call-leg');
          if (stockLeg && callLeg) {
            const shares = parseInt(value) || 0;
            callLeg.contracts = Math.floor(shares / 100);
          }
        }

        return {
          ...prev,
          legs: newLegs
        };
      });
    };

    return (
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
              placeholder="AAPL"
              required
            />
          </div>

          {/* Stock Leg Fields */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Number of Shares
              <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              value={stockLeg.shares}
              onChange={(e) => handleLegChange('stock-leg', 'shares', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              min="100"
              step="100"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Stock Cost Basis
              <span className="text-red-500">*</span>
            </label>
            <div className="mt-1 relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
                <span className="text-gray-500 sm:text-sm">$</span>
              </div>
              <input
                type="number"
                value={stockLeg.costBasis}
                onChange={(e) => handleLegChange('stock-leg', 'costBasis', e.target.value)}
                className="pl-7 block w-full rounded-md border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                placeholder="0.00"
                step="0.01"
                required
              />
            </div>
          </div>

          {/* Call Option Leg Fields */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Call Strike Price
              <span className="text-red-500">*</span>
            </label>
            <div className="mt-1 relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
                <span className="text-gray-500 sm:text-sm">$</span>
              </div>
              <input
                type="number"
                value={callLeg.strike}
                onChange={(e) => handleLegChange('call-leg', 'strike', e.target.value)}
                className="pl-7 block w-full rounded-md border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                placeholder="0.00"
                step="0.01"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Call Premium Received
              <span className="text-red-500">*</span>
            </label>
            <div className="mt-1 relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
                <span className="text-gray-500 sm:text-sm">$</span>
              </div>
              <input
                type="number"
                value={callLeg.premium}
                onChange={(e) => handleLegChange('call-leg', 'premium', e.target.value)}
                className="pl-7 block w-full rounded-md border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                placeholder="0.00"
                step="0.01"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Call Expiration Date
              <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={callLeg.expiration}
              onChange={(e) => handleLegChange('call-leg', 'expiration', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              required
            />
          </div>
        </div>

        <MaxProfitCalculator legs={formData.legs} />

      </>
    );
  };

  return (
    <BaseStrategyForm
      strategy="coveredCalls"
      initialData={initialData}
      onSubmit={onSubmit}
      onCancel={onCancel}
      existingPosition={existingPosition}
      validate={validateCoveredCallPosition}
    >
      {renderFormFields}
    </BaseStrategyForm>
  );
};

export default CoveredCallForm;