import React, { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday } from 'date-fns';
import EventList from './EventList';
import EventDetail from './EventDetail';

const CalendarView = () => {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Generate days for the current month
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Mock events - would come from CalendarContext in real implementation
  const events = [
    {
      id: 1,
      title: 'AAPL Earnings',
      date: new Date(2025, 0, 25),
      type: 'earnings',
      description: 'Apple Q4 2024 Earnings Release'
    },
    {
      id: 2,
      title: 'SPY Put Expiration',
      date: new Date(2025, 0, 20),
      type: 'option_expiry',
      description: 'SPY Put Credit Spread Expiration'
    }
  ];

  return (
    <div className="flex h-screen-navbar gap-4">
      {/* Calendar Section */}
      <div className="w-2/3 bg-white rounded-lg shadow p-6">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-900">
            {format(selectedDate, 'MMMM yyyy')}
          </h2>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {/* Day headers */}
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div 
              key={day} 
              className="h-8 flex items-center justify-center text-sm font-medium text-gray-500"
            >
              {day}
            </div>
          ))}

          {/* Calendar days */}
          {daysInMonth.map(day => {
            const dayEvents = events.filter(event => 
              format(event.date, 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd')
            );
            
            return (
              <div
                key={day.toString()}
                className={`
                  min-h-24 p-2 border border-gray-200 hover:bg-gray-50 cursor-pointer
                  ${isToday(day) ? 'bg-blue-50' : 'bg-white'}
                `}
                onClick={() => setSelectedDate(day)}
              >
                <div className="flex justify-between">
                  <span className={`
                    text-sm ${isToday(day) ? 'font-bold text-blue-600' : 'text-gray-700'}
                  `}>
                    {format(day, 'd')}
                  </span>
                  {dayEvents.length > 0 && (
                    <span className="text-xs bg-blue-100 text-blue-800 px-1.5 rounded-full">
                      {dayEvents.length}
                    </span>
                  )}
                </div>

                {/* Event indicators */}
                <div className="mt-1 space-y-1">
                  {dayEvents.map(event => (
                    <div
                      key={event.id}
                      className="text-xs truncate p-1 rounded bg-blue-50 text-blue-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEvent(event);
                      }}
                    >
                      {event.title}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Event List Section */}
      <div className="w-1/3 space-y-4">
        <EventList 
          events={events} 
          selectedDate={selectedDate}
          onEventClick={setSelectedEvent}
        />
        
        {selectedEvent && (
          <EventDetail 
            event={selectedEvent} 
            onClose={() => setSelectedEvent(null)}
          />
        )}
      </div>
    </div>
  );
};

export default CalendarView;