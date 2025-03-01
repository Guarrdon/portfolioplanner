import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { useUser } from './UserContext';
import { userStorage } from '../utils/storage/storage';

const CalendarContext = createContext();

const initialState = {
  events: [],
  loading: true,
  error: null
};

function calendarReducer(state, action) {
  switch (action.type) {
    case 'INITIALIZE_EVENTS': {
      return {
        ...state,
        events: action.payload,
        loading: false
      };
    }

    case 'ADD_EVENT': {
      return {
        ...state,
        events: [...state.events, action.payload]
      };
    }

    case 'UPDATE_EVENT': {
      return {
        ...state,
        events: state.events.map(event =>
          event.id === action.payload.id ? action.payload : event
        )
      };
    }

    case 'DELETE_EVENT': {
      return {
        ...state,
        events: state.events.filter(event => event.id !== action.payload)
      };
    }

    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
        loading: false
      };

    case 'CLEAR_ERROR':
      return {
        ...state,
        error: null
      };

    default:
      return state;
  }
}

export function CalendarProvider({ children }) {
  const [state, dispatch] = useReducer(calendarReducer, initialState);
  const { currentUser } = useUser();

  // Memoize loadUserEvents with useCallback
  const loadUserEvents = useCallback(async () => {
    if (!currentUser?.id) return;

    try {
      const events = userStorage.getEvents(currentUser.id);
      dispatch({ type: 'INITIALIZE_EVENTS', payload: events || [] });
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload: 'Error loading calendar events'
      });
    }
  }, [currentUser?.id]); // Add currentUser.id as dependency

  // Load user's events on mount or user change
  useEffect(() => {
    if (currentUser?.id) {
      loadUserEvents();
    }
  }, [currentUser?.id, loadUserEvents]); // Add both dependencies


  const value = {
    ...state,

    addEvent: async (event) => {
      if (!currentUser?.id) return false;

      try {
        const newEvent = {
          ...event,
          id: event.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          userId: currentUser.id,
          createdAt: new Date().toISOString(),
          createdBy: currentUser.displayName || 'User'
        };

        const success = userStorage.saveEvent(currentUser.id, newEvent);
        
        if (success) {
          dispatch({ type: 'ADD_EVENT', payload: newEvent });
        }

        return success;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },

    updateEvent: async (event) => {
      if (!currentUser?.id) return false;

      try {
        // Verify event ownership
        if (event.userId !== currentUser.id) {
          throw new Error('Not authorized to update this event');
        }

        const updatedEvent = {
          ...event,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.displayName || 'User'
        };

        const success = userStorage.saveEvent(currentUser.id, updatedEvent);

        if (success) {
          dispatch({ type: 'UPDATE_EVENT', payload: updatedEvent });
        }

        return success;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },

    deleteEvent: async (eventId) => {
      if (!currentUser?.id) return false;

      try {
        // Verify event ownership
        const event = state.events.find(e => e.id === eventId);
        if (!event) {
          throw new Error('Event not found');
        }

        if (event.userId !== currentUser.id) {
          throw new Error('Not authorized to delete this event');
        }

        const success = userStorage.deleteEvent(currentUser.id, eventId);

        if (success) {
          dispatch({ type: 'DELETE_EVENT', payload: eventId });
        }

        return success;
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error.message });
        return false;
      }
    },

    // Helper methods for event querying
    getEventsByDateRange: (startDate, endDate) => {
      return state.events.filter(event => {
        const eventDate = new Date(event.date);
        return eventDate >= startDate && eventDate <= endDate;
      });
    },

    getEventsByType: (type) => {
      return state.events.filter(event => event.type === type);
    },

    getEventsByPosition: (positionId) => {
      return state.events.filter(event => 
        event.relatedPositions?.includes(positionId)
      );
    },

    clearError: () => {
      dispatch({ type: 'CLEAR_ERROR' });
    }
  };

  return (
    <CalendarContext.Provider value={value}>
      {children}
    </CalendarContext.Provider>
  );
}

export function useCalendar() {
  const context = useContext(CalendarContext);
  if (context === undefined) {
    throw new Error('useCalendar must be used within a CalendarProvider');
  }
  return context;
}

export default CalendarContext;