/**
 * React hooks for WebSocket real-time collaboration
 */
import { useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { websocketService } from '../services/websocket';
import { useUser } from '../contexts/UserContext';

/**
 * Hook to manage WebSocket connection
 * Automatically connects when user is available and disconnects on unmount
 */
export const useWebSocketConnection = () => {
  const { currentUser } = useUser();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!currentUser?.id) {
      return;
    }

    // Connect to WebSocket
    websocketService.connect(currentUser.id);

    // Listen for connection events
    const unsubscribeConnected = websocketService.on('connected', () => {
      console.log('WebSocket connected');
      setIsConnected(true);
    });

    const unsubscribeDisconnected = websocketService.on('disconnected', () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
    });

    // Cleanup on unmount
    return () => {
      unsubscribeConnected();
      unsubscribeDisconnected();
      // Don't disconnect here - keep connection alive for the session
    };
  }, [currentUser?.id]);

  return { isConnected };
};

/**
 * Hook to listen for position updates
 * Automatically invalidates React Query cache when positions are updated
 */
export const usePositionUpdates = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = websocketService.on('position_updated', (data) => {
      console.log('Position updated:', data);
      
      // Invalidate queries to refetch updated data
      queryClient.invalidateQueries({ queryKey: ['positions', 'ideas'] });
      queryClient.invalidateQueries({ queryKey: ['positions', 'shared'] });
      
      // Optionally show a toast notification
      // toast.info(`Position ${data.position.symbol} was updated`);
    });

    return unsubscribe;
  }, [queryClient]);
};

/**
 * Hook to listen for new comments
 * Automatically invalidates comment queries when new comments are added
 */
export const useCommentUpdates = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = websocketService.on('comment_added', (data) => {
      console.log('Comment added:', data);
      
      // Invalidate comments for this position
      queryClient.invalidateQueries({ 
        queryKey: ['comments', data.position_id] 
      });
      
      // Optionally show a toast notification
      // toast.info(`New comment from ${data.comment.user.display_name}`);
    });

    return unsubscribe;
  }, [queryClient]);
};

/**
 * Hook to listen for share notifications
 * Notifies user when positions are shared with them or revoked
 */
export const useShareNotifications = () => {
  const queryClient = useQueryClient();
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    const unsubscribeShared = websocketService.on('position_shared', (data) => {
      console.log('Position shared with you:', data);
      
      // Invalidate shared positions
      queryClient.invalidateQueries({ queryKey: ['positions', 'shared'] });
      
      // Set notification
      setNotification({
        type: 'shared',
        message: 'A new position was shared with you',
        positionId: data.position_id
      });
      
      // Clear notification after 5 seconds
      setTimeout(() => setNotification(null), 5000);
    });

    const unsubscribeRevoked = websocketService.on('share_revoked', (data) => {
      console.log('Share revoked:', data);
      
      // Invalidate shared positions
      queryClient.invalidateQueries({ queryKey: ['positions', 'shared'] });
      
      // Set notification
      setNotification({
        type: 'revoked',
        message: 'Access to a position was revoked',
        positionId: data.position_id
      });
      
      // Clear notification after 5 seconds
      setTimeout(() => setNotification(null), 5000);
    });

    return () => {
      unsubscribeShared();
      unsubscribeRevoked();
    };
  }, [queryClient]);

  return { notification };
};

/**
 * Combined hook that enables all real-time collaboration features
 * Use this in your main app component or collaboration dashboard
 */
export const useCollaboration = () => {
  const { isConnected } = useWebSocketConnection();
  
  usePositionUpdates();
  useCommentUpdates();
  const { notification } = useShareNotifications();

  return { isConnected, notification };
};

/**
 * Hook to manually listen for specific events
 * Useful for custom event handling
 */
export const useWebSocketEvent = (eventName, callback) => {
  useEffect(() => {
    if (!eventName || !callback) {
      return;
    }

    const unsubscribe = websocketService.on(eventName, callback);
    return unsubscribe;
  }, [eventName, callback]);
};

