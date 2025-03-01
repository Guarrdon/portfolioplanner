import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  PhoneCall, 
  BarChart2, 
  Package, 
  DollarSign,
  Currency,
  Briefcase,
  X 
} from 'lucide-react';

const strategies = [
  {
    id: 'covered-calls',
    name: 'Covered Calls',
    description: 'Stock ownership with call options sold against the position',
    icon: PhoneCall,
    route: '/strategies/covered-calls'
  },
  {
    id: 'put-spreads',
    name: 'Put Option Spreads',
    description: 'Defined risk put option strategies',
    icon: BarChart2,
    route: '/strategies/put-spreads'
  },
  {
    id: 'big-options',
    name: 'Big Options',
    description: 'Significant option positions',
    icon: Package,
    route: '/strategies/big-options'
  },
  {
    id: 'box-spreads',
    name: 'Margin Spreads',
    description: 'Box and Iron Fly spreads for margin efficiency',
    icon: Currency,
    route: '/strategies/box-spreads'
  },
  {
    id: 'dividends',
    name: 'Dividend Positions',
    description: 'Positions held primarily for dividend income',
    icon: DollarSign,
    route: '/strategies/dividends'
  },
  {
    id: 'misc',
    name: 'Miscellaneous',
    description: 'Other trading strategies and positions',
    icon: Briefcase,
    route: '/strategies/misc'
  }
];

const StrategySelector = ({ isOpen, onClose }) => {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleStrategySelect = (route) => {
    onClose();
    navigate(route, { state: { showNewPositionForm: true } });
  };

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Select Strategy Type</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 focus:outline-none"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {strategies.map((strategy) => {
              const Icon = strategy.icon;
              return (
                <button
                  key={strategy.id}
                  className="flex items-start p-4 border rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onClick={() => handleStrategySelect(strategy.route)}
                >
                  <Icon className="h-6 w-6 text-blue-600 mt-1 flex-shrink-0" />
                  <div className="ml-4 text-left">
                    <h3 className="text-base font-medium text-gray-900">{strategy.name}</h3>
                    <p className="mt-1 text-sm text-gray-500">{strategy.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-6 py-4 border-t bg-gray-50 rounded-b-lg">
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StrategySelector;