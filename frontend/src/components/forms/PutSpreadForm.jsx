import React from 'react';
import { useUser } from '../../contexts/UserContext';
import BaseStrategyForm from './BaseStrategyForm';
import SpreadMetricsCalculator from '../metrics/SpreadMetricsCalculator';
import { validatePutSpreadPosition } from '../../utils/validation';

const PutSpreadForm = ({ onSubmit, onCancel, existingPosition = null }) => {
  const { currentUser } = useUser();

  const initialData = existingPosition || {
    strategy: 'putSpreads',
    userId: currentUser?.id, // Add userId to initial data
    account: '',
    symbol: '',
    legs: [
      {
        id: 'short-put-leg',
        type: 'option',
        optionType: 'put',
        contracts: 1,
        strike: '',
        premium: '',
        expiration: '',
        side: 'short'
      }
    ],
    tags: []
  };

  const renderFormFields = ({ formData, handleChange, setFormData }) => {
    const shortPut = formData.legs.find(leg => leg.side === 'short');
    const longPut = formData.legs.find(leg => leg.side === 'long');

    const handleLegChange = (legId, field, value) => {
      setFormData(prev => ({
        ...prev,
        legs: prev.legs.map(leg => {
          if (leg.id === legId) {
            // Handle the value based on field type
            let processedValue = value;
            if (field === 'contracts') {
              processedValue = value === '' ? '' : parseInt(value) || 0;
              // Update both legs' contracts to match
              if (leg.side === 'short' && processedValue > 0) {
                const longPut = prev.legs.find(l => l.side === 'long');
                if (longPut) {
                  setTimeout(() => {
                    handleLegChange(longPut.id, 'contracts', processedValue);
                  }, 0);
                }
              }
            } else if (field === 'strike' || field === 'premium') {
              processedValue = value === '' ? '' : parseFloat(value) || 0;
            }
            
            return { ...leg, [field]: processedValue };
          }
          return leg;
        })
      }));
    };

    const addLongPutLeg = () => {
      setFormData(prev => ({
        ...prev,
        legs: [
          ...prev.legs,
          {
            id: 'long-put-leg',
            type: 'option',
            optionType: 'put',
            contracts: shortPut ? shortPut.contracts : 1,
            strike: '',
            premium: '',
            expiration: shortPut ? shortPut.expiration : '',
            side: 'long'
          }
        ]
      }));
    };

    const removeLongPutLeg = () => {
      setFormData(prev => ({
        ...prev,
        legs: prev.legs.filter(leg => leg.side === 'short')
      }));
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
              placeholder="SPY"
              required
            />
          </div>

          {/* Short Put Fields */}
          <div className="col-span-2">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Short Put</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Number of Contracts
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={shortPut?.contracts}
                  onChange={(e) => handleLegChange('short-put-leg', 'contracts', e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  min="1"
                  step="1"
                  required
                />
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
                    value={shortPut?.strike}
                    onChange={(e) => handleLegChange('short-put-leg', 'strike', e.target.value)}
                    className="pl-7 block w-full rounded-md border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                    placeholder="0.00"
                    step="0.01"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Premium Received
                  <span className="text-red-500">*</span>
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
                    <span className="text-gray-500 sm:text-sm">$</span>
                  </div>
                  <input
                    type="number"
                    value={shortPut?.premium}
                    onChange={(e) => handleLegChange('short-put-leg', 'premium', e.target.value)}
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
                  value={shortPut?.expiration}
                  onChange={(e) => handleLegChange('short-put-leg', 'expiration', e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>
            </div>
          </div>

          {/* Long Put Fields */}
          <div className="col-span-2">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Long Put</h3>
              {!longPut ? (
                <button
                  type="button"
                  onClick={addLongPutLeg}
                  className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Add Long Put Leg
                </button>
              ) : (
                <button
                  type="button"
                  onClick={removeLongPutLeg}
                  className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                >
                  Remove Long Put Leg
                </button>
              )}
            </div>

            {longPut && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Number of Contracts
                    <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={longPut.contracts}
                    onChange={(e) => handleLegChange('long-put-leg', 'contracts', e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    min="1"
                    step="1"
                    required
                  />
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
                      value={longPut.strike}
                      onChange={(e) => handleLegChange('long-put-leg', 'strike', e.target.value)}
                      className="pl-7 block w-full rounded-md border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                      placeholder="0.00"
                      step="0.01"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Premium Paid
                    <span className="text-red-500">*</span>
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
                      <span className="text-gray-500 sm:text-sm">$</span>
                    </div>
                    <input
                      type="number"
                      value={longPut.premium}
                      onChange={(e) => handleLegChange('long-put-leg', 'premium', e.target.value)}
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
                    value={longPut.expiration}
                    onChange={(e) => handleLegChange('long-put-leg', 'expiration', e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <SpreadMetricsCalculator legs={formData.legs} />
      </>
    );
  };

  return (
    <BaseStrategyForm
      strategy="putSpreads"
      initialData={initialData}
      onSubmit={onSubmit}
      onCancel={onCancel}
      existingPosition={existingPosition}
      validate={validatePutSpreadPosition}
    >
      {renderFormFields}
    </BaseStrategyForm>
  );
};

export default PutSpreadForm;