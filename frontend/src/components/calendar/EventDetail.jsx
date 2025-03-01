import React from 'react';
import { format } from 'date-fns';
import { X, Calendar, AlertCircle, Bookmark, Link } from 'lucide-react';

const EventDetail = ({ event, onClose }) => {
  const getEventTypeIcon = (type) => {
    switch (type) {
      case 'earnings':
        return <Calendar className="text-blue-500" size={20} />;
      case 'option_expiry':
        return <AlertCircle className="text-amber-500" size={20} />;
      default:
        return <Bookmark className="text-gray-500" size={20} />;
    }
  };

  const getEventTypeLabel = (type) => {
    switch (type) {
      case 'earnings':
        return 'Earnings Report';
      case 'option_expiry':
        return 'Option Expiration';
      default:
        return 'General Event';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b flex justify-between items-center">
        <div className="flex items-center space-x-3">
          {getEventTypeIcon(event.type)}
          <h2 className="text-lg font-semibold text-gray-900">Event Details</h2>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-500 focus:outline-none"
        >
          <X size={20} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <h3 className="text-xl font-semibold text-gray-900">{event.title}</h3>
          <div className="mt-1 flex items-center space-x-2 text-sm text-gray-500">
            <Calendar size={16} />
            <span>{format(event.date, 'PPPP')}</span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center space-x-2 text-sm">
            <span className="text-gray-500">Type:</span>
            <span className="font-medium">{getEventTypeLabel(event.type)}</span>
          </div>

          {event.symbol && (
            <div className="flex items-center space-x-2 text-sm">
              <span className="text-gray-500">Symbol:</span>
              <span className="font-medium">{event.symbol}</span>
            </div>
          )}

          {event.description && (
            <div className="pt-2">
              <h4 className="text-sm font-medium text-gray-500 mb-1">Description</h4>
              <p className="text-sm text-gray-700">{event.description}</p>
            </div>
          )}
        </div>

        {event.relatedPositions && event.relatedPositions.length > 0 && (
          <div className="pt-2">
            <h4 className="text-sm font-medium text-gray-500 mb-2">Related Positions</h4>
            <div className="space-y-2">
              {event.relatedPositions.map(position => (
                <div 
                  key={position.id}
                  className="flex items-center justify-between p-2 rounded bg-gray-50"
                >
                  <div className="flex items-center space-x-2">
                    <Link size={16} className="text-gray-400" />
                    <span className="text-sm font-medium">{position.symbol}</span>
                  </div>
                  <span className="text-sm text-gray-500">{position.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-4 border-t">
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              Close
            </button>
            <button
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Edit Event
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventDetail;