import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Tag, CalendarClock } from 'lucide-react';

const StrategyCard = ({ title, description, positions, strategyType }) => {
  // Helper function to calculate total notional value based on strategy type
  const calculateTotalValue = () => {
    return positions.reduce((acc, pos) => {
      switch (strategyType) {
        case 'Covered Call':
          return acc + (pos.shares * pos.stockCost || 0);
        case 'putSpreads':
          return acc + (parseFloat(pos.maxRisk) || 0);
        case 'bigOptions':
          return acc + (parseFloat(pos.totalCost) || 0);
        case 'boxSpreads':
          return acc + (parseFloat(pos.notionalValue) || 0);
        case 'dividends':
          return acc + (pos.shares * pos.costBasis || 0);
        case 'misc':
          return acc + (pos.quantity * pos.entryPrice || 0);
        default:
          return acc;
      }
    }, 0);
  };

  // Get upcoming events (expirations within next 30 days)
  const getUpcomingEvents = () => {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    
    return positions.filter(pos => {
      const expirationDate = new Date(
        pos.expiration || 
        pos.callExpiration || 
        pos.nextExDate
      );
      return expirationDate && expirationDate <= thirtyDaysFromNow;
    }).slice(0, 3); // Show max 3 upcoming events
  };

  // Get positions with alert tags
  const getAlertPositions = () => {
    return positions.filter(pos => 
      pos.tags && pos.tags.some(tag => 
        tag.toLowerCase().includes('alert') || 
        tag.toLowerCase().includes('watch') ||
        tag.toLowerCase().includes('close')
      )
    ).slice(0, 3); // Show max 3 alerts
  };

  const upcomingEvents = getUpcomingEvents();
  const alertPositions = getAlertPositions();
  const totalValue = calculateTotalValue();

  return (
    <div className="bg-white rounded-lg shadow hover:shadow-md transition-shadow grid grid-rows-[1fr_auto]">
      <div className="p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <p className="text-sm text-gray-500">{description}</p>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Active Positions</span>
            <span className="text-sm font-medium text-gray-900">{positions.length}</span>
          </div>

          {totalValue > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Total Exposure</span>
              <span className="text-sm font-medium text-gray-900">
                {totalValue.toLocaleString('en-US', { 
                  style: 'currency', 
                  currency: 'USD',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0
                })}
              </span>
            </div>
          )}

          {alertPositions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Tag className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-medium text-gray-500">Watch List</span>
              </div>
              {alertPositions.map((position) => (
                <div 
                  key={position.id}
                  className="flex justify-between items-center text-sm bg-amber-50 p-2 rounded"
                >
                  <span className="font-medium text-gray-900">{position.symbol}</span>
                  <div className="flex flex-wrap gap-1">
                    {position.tags.map(tag => (
                      <span 
                        key={tag}
                        className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {upcomingEvents.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <CalendarClock className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-medium text-gray-500">Upcoming Events</span>
              </div>
              {upcomingEvents.map((position) => (
                <div 
                  key={position.id}
                  className="flex justify-between items-center text-sm bg-blue-50 p-2 rounded"
                >
                  <span className="font-medium text-gray-900">{position.symbol}</span>
                  <span className="text-blue-600">
                    {new Date(
                      position.expiration || 
                      position.callExpiration || 
                      position.nextExDate
                    ).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Link
        to={`/strategies/${strategyType === 'coveredCalls' ? 'covered-calls' : 
                         strategyType === 'putSpreads' ? 'put-spreads' :
                         strategyType === 'bigOptions' ? 'big-options' :
                         strategyType === 'boxSpreads' ? 'box-spreads' :
                         strategyType}`}
        className="block px-6 py-4 bg-gray-50 rounded-b-lg"
      >
        <div className="flex justify-between items-center text-sm font-medium text-blue-600 hover:text-blue-800">
          View All Positions
          <ChevronRight size={16} />
        </div>
      </Link>
    </div>
  );
};

export default StrategyCard;