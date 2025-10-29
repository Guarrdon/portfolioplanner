/**
 * CollaborationModal - Simple confirmation modal for converting positions to trade ideas
 * 
 * After conversion, navigates to Collaboration Dashboard for editing, tagging, and sharing
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Share2, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { convertActualToTradeIdea } from '../../services/collaboration';

export const CollaborationModal = ({ position, onClose, onSuccess }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Convert mutation - on success, navigate to collaboration dashboard with the new idea ID
  const convertMutation = useMutation({
    mutationFn: () => convertActualToTradeIdea(position.id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['positions', 'ideas'] });
      if (onSuccess) {
        onSuccess(data);
      }
      // Navigate to collaboration dashboard after brief delay to show success
      // Pass the new trade idea ID so it can be auto-expanded
      setTimeout(() => {
        onClose();
        navigate(`/collaboration?highlight=${data.id}`);
      }, 800);
    }
  });

  const handleConvert = () => {
    convertMutation.mutate();
  };

  const formatCurrency = (value) => {
    if (!value) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const getStrategyLabel = (strategyType) => {
    const labels = {
      covered_call: 'Covered Call',
      vertical_spread: 'Vertical Spread',
      box_spread: 'Box Spread',
      big_option: 'Big Options',
      single_option: 'Single Option',
      long_stock: 'Long Stock',
      dividend: 'Dividends',
      short_stock: 'Short Stock'
    };
    return labels[strategyType] || strategyType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Calculate the display value based on strategy type
  // For spreads, use cost - value (which represents the value captured)
  // For other strategies, use the current_value as-is
  const getDisplayValue = (position) => {
    const spreadStrategies = ['vertical_spread', 'box_spread'];
    
    if (spreadStrategies.includes(position.strategy_type)) {
      // For spreads: cost - value = captured value
      // This matches the user's expectation that cost - value represents profit
      return (position.cost_basis || 0) - (position.current_value || 0);
    }
    
    // For other strategies, return current_value as-is
    return position.current_value || 0;
  };

  return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Share2 className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-xl font-bold text-gray-900">Create Trade Idea</h2>
              <p className="text-sm text-gray-600">Convert this position for collaboration</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={convertMutation.isPending}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {/* Position Summary */}
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-semibold text-gray-900 mb-3 text-sm">Position Details</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-600">Symbol:</span>{' '}
                <span className="font-semibold text-gray-900">{position.symbol}</span>
              </div>
              <div>
                <span className="text-gray-600">Strategy:</span>{' '}
                <span className="font-semibold text-gray-900">{getStrategyLabel(position.strategy_type)}</span>
              </div>
              <div>
                <span className="text-gray-600">Quantity:</span>{' '}
                <span className="font-semibold text-gray-900">{position.quantity}</span>
              </div>
              <div>
                <span className="text-gray-600">Current Value:</span>{' '}
                <span className="font-semibold text-gray-900">
                  {formatCurrency(getDisplayValue(position))}
                </span>
              </div>
              <div>
                <span className="text-gray-600">P&L:</span>{' '}
                <span className={`font-semibold ${position.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(position.unrealized_pnl)}
                </span>
              </div>
              <div>
                <span className="text-gray-600">Legs:</span>{' '}
                <span className="font-semibold text-gray-900">{position.legs?.length || 0}</span>
              </div>
            </div>
          </div>

          {/* Conversion Info */}
          {!convertMutation.isSuccess && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                This will create an editable trade idea based on this position. You'll be able to:
              </p>
              
              <ul className="space-y-2 text-sm text-gray-700">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <span>Add notes and context about your strategy</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <span>Tag it for organization</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <span>Share with friends for collaboration</span>
                </li>
              </ul>

              {convertMutation.isError && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-900">Conversion Failed</p>
                    <p className="text-sm text-red-700">{convertMutation.error?.message || 'An error occurred'}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Success Message */}
          {convertMutation.isSuccess && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-600 mb-2">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-semibold">Trade idea created successfully!</span>
              </div>
              
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <ArrowRight className="w-4 h-4" />
                <span>Taking you to the Collaboration Dashboard...</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={convertMutation.isPending || convertMutation.isSuccess}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 border border-gray-300 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          {!convertMutation.isSuccess && (
            <button
              onClick={handleConvert}
              disabled={convertMutation.isPending}
              className="px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {convertMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Converting...
                </>
              ) : (
                <>
                  <Share2 className="w-4 h-4" />
                  Create Trade Idea
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CollaborationModal;

