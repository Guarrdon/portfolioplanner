import React, { useState } from 'react';
import { X } from 'lucide-react';

const PositionLegForm = ({ position, onAddLeg, onClose }) => {
  const [legType, setLegType] = useState('option');
  const [formData, setFormData] = useState({
    type: 'option',
    shares: '',
    costBasis: '',
    optionType: 'put',
    contracts: '',
    strike: '',
    premium: '',
    expiration: '',
    side: 'long'
  });

  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    setError(null);
  };

  const validateLeg = () => {
    // Basic validation only - ensuring required fields are filled
    if (legType === 'stock') {
      if (!formData.shares || !formData.costBasis) {
        throw new Error('Please fill in all stock fields');
      }
      if (parseInt(formData.shares) <= 0) {
        throw new Error('Number of shares must be positive');
      }
    } else {
      if (!formData.contracts || !formData.strike || !formData.premium || !formData.expiration) {
        throw new Error('Please fill in all option fields');
      }
      if (parseInt(formData.contracts) <= 0) {
        throw new Error('Number of contracts must be positive');
      }
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    try {
      validateLeg();

      // Format leg data
      const legData = {
        id: Date.now().toString(),
        positionId: position.id,
        type: legType,
        side: formData.side
      };

      // Add type-specific fields
      if (legType === 'stock') {
        Object.assign(legData, {
          shares: Math.abs(parseInt(formData.shares)),
          costBasis: parseFloat(formData.costBasis)
        });
      } else {
        Object.assign(legData, {
          optionType: formData.optionType,
          contracts: Math.abs(parseInt(formData.contracts)),
          strike: parseFloat(formData.strike),
          premium: parseFloat(formData.premium),
          expiration: formData.expiration
        });
      }

      onAddLeg(legData);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium text-gray-900">Add Position Leg</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Leg Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Leg Type
            </label>
            <select
              value={legType}
              onChange={(e) => {
                setLegType(e.target.value);
                setFormData(prev => ({
                  ...prev,
                  type: e.target.value
                }));
              }}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="option">Option</option>
              <option value="stock">Stock</option>
            </select>
          </div>

          {/* Side Selection (for both stock and options) */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Side
            </label>
            <select
              name="side"
              value={formData.side}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </div>

          {legType === 'stock' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Number of Shares
                </label>
                <input
                  type="number"
                  name="shares"
                  value={formData.shares}
                  onChange={handleChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Cost Basis
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
                    step="0.01"
                    className="pl-7 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Option Type
                </label>
                <select
                  name="optionType"
                  value={formData.optionType}
                  onChange={handleChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="call">Call</option>
                  <option value="put">Put</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Number of Contracts
                </label>
                <input
                  type="number"
                  name="contracts"
                  value={formData.contracts}
                  onChange={handleChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Strike Price
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
                    step="0.01"
                    className="pl-7 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  {formData.side === 'long' ? 'Premium Paid' : 'Premium Received'}
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
                    step="0.01"
                    className="pl-7 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Expiration Date
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
            </>
          )}

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700"
            >
              Add Leg
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PositionLegForm;