import React from 'react';
import { format, isToday, isTomorrow, isThisWeek, isThisMonth } from 'date-fns';
import { Calendar, Bookmark, AlertCircle } from 'lucide-react';

const EventList = ({ events, selectedDate, onEventClick }) => {
  // Sort events by date
  const sortedEvents = [...events].sort((a, b) => a.date - b.date);

  // Group events by time period
  const groupedEvents = {
    today: sortedEvents.filter(event => isToday(event.date)),
    tomorrow: sortedEvents.filter(event => isTomorrow(event.date)),
    thisWeek: sortedEvents.filter(event => 
      isThisWeek(event.date) && !isToday(event.date) && !isTomorrow(event.date)
    ),
    thisMonth: sortedEvents.filter(event => 
      isThisMonth(event.date) && !isThisWeek(event.date)
    ),
    future: sortedEvents.filter(event => 
      event.date > selectedDate && !isThisMonth(event.date)
    )
  };

  const getEventTypeIcon = (type) => {
    switch (type) {
      case 'earnings':
        return <Calendar className="text-blue-500" size={16} />;
      case 'option_expiry':
        return <AlertCircle className="text-amber-500" size={16} />;
      default:
        return <Bookmark className="text-gray-500" size={16} />;
    }
  };

  const renderEventGroup = (title, events) => {
    if (!events.length) return null;

    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-500 px-2">{title}</h3>
        <div className="space-y-1">
          {events.map(event => (
            <button
              key={event.id}
              className="w-full px-3 py-2 text-left rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onClick={() => onEventClick(event)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  {getEventTypeIcon(event.type)}
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {event.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {format(event.date, 'MMM d, yyyy')}
                    </p>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const groupTitles = {
    today: 'Today',
    tomorrow: 'Tomorrow',
    thisWeek: 'This Week',
    thisMonth: 'This Month',
    future: 'Future Events'
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b">
        <h2 className="text-lg font-semibold text-gray-900">Upcoming Events</h2>
      </div>
      <div className="p-4 space-y-6">
        {Object.entries(groupedEvents).map(([group, events]) => (
          <React.Fragment key={group}>
            {renderEventGroup(groupTitles[group], events)}
          </React.Fragment>
        ))}
        
        {!Object.values(groupedEvents).some(group => group.length > 0) && (
          <div className="text-center py-6">
            <p className="text-gray-500">No upcoming events</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default EventList;