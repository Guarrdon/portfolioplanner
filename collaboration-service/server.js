/**
 * Portfolio Planner - Collaboration Service
 * 
 * Central message broker for distributed backend instances.
 * Routes collaboration events between independent user instances.
 * 
 * Architecture:
 * - Each user backend connects via Socket.io
 * - Service maintains user registry (in-memory)
 * - Routes events to appropriate recipients
 * - No data storage - pure message routing
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'collaboration-service.log' })
  ]
});

// Express app setup
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Socket.io server with CORS
const io = new Server(server, {
  cors: {
    origin: '*', // In production, restrict this to known domains
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// In-memory user registry
// Structure: Map<user_id, { socket, backend_url, display_name, connected_at }>
const activeUsers = new Map();

// Reverse lookup: socket.id -> user_id
const socketToUser = new Map();

// Statistics
let stats = {
  total_connections: 0,
  total_events_routed: 0,
  uptime_start: new Date()
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: Math.floor((Date.now() - stats.uptime_start.getTime()) / 1000),
    active_users: activeUsers.size,
    total_connections: stats.total_connections,
    total_events_routed: stats.total_events_routed
  });
});

// Get active users endpoint
app.get('/api/users/online', (req, res) => {
  const users = Array.from(activeUsers.entries()).map(([user_id, info]) => ({
    user_id,
    display_name: info.display_name || 'Unknown',
    backend_url: info.backend_url,
    connected_at: info.connected_at,
    status: 'online'
  }));
  
  res.json({
    users,
    count: users.length
  });
});

// Register user endpoint (REST API for initial registration)
app.post('/api/register', (req, res) => {
  const { user_id, backend_url, display_name } = req.body;
  
  if (!user_id || !backend_url) {
    return res.status(400).json({ error: 'user_id and backend_url are required' });
  }
  
  logger.info('User registration requested', { user_id, backend_url, display_name });
  
  res.json({
    success: true,
    collab_ws_url: `ws://localhost:9000`,
    message: 'Connect via WebSocket with user_id and backend_url in handshake query'
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  const userId = socket.handshake.query.user_id;
  const backendUrl = socket.handshake.query.backend_url;
  const displayName = socket.handshake.query.display_name || 'Unknown User';
  
  // Validate required parameters
  if (!userId || !backendUrl) {
    logger.warn('Connection rejected: missing user_id or backend_url', { socketId: socket.id });
    socket.emit('error', { message: 'user_id and backend_url are required' });
    socket.disconnect();
    return;
  }
  
  // Register user
  activeUsers.set(userId, {
    socket,
    backend_url: backendUrl,
    display_name: displayName,
    connected_at: new Date().toISOString()
  });
  
  socketToUser.set(socket.id, userId);
  stats.total_connections++;
  
  logger.info('Backend connected', {
    user_id: userId,
    backend_url: backendUrl,
    display_name: displayName,
    total_active: activeUsers.size
  });
  
  // Confirm connection
  socket.emit('connected', {
    user_id: userId,
    message: 'Connected to collaboration service',
    active_users: activeUsers.size
  });
  
  // Broadcast to all other backends that a new user is online
  socket.broadcast.emit('user_online', {
    user_id: userId,
    display_name: displayName
  });
  
  // Handle collaboration events from backends
  socket.on('collab_event', (event) => {
    try {
      const { type, from_user, to_users, data } = event;
      
      if (!type || !from_user || !to_users || !Array.isArray(to_users)) {
        logger.warn('Invalid event format', { event });
        socket.emit('error', { message: 'Invalid event format' });
        return;
      }
      
      logger.info('Routing event', {
        type,
        from: from_user,
        to: to_users,
        data_keys: Object.keys(data || {})
      });
      
      // Route to recipient backends
      let delivered_count = 0;
      to_users.forEach(recipientId => {
        const recipient = activeUsers.get(recipientId);
        
        if (recipient) {
          recipient.socket.emit('collab_event', event);
          delivered_count++;
          logger.debug('Event delivered', { recipient_id: recipientId, type });
        } else {
          logger.debug('Recipient not online', { recipient_id: recipientId });
        }
      });
      
      stats.total_events_routed++;
      
      // Send acknowledgment back to sender
      socket.emit('event_ack', {
        event_type: type,
        delivered_to: delivered_count,
        total_recipients: to_users.length
      });
      
    } catch (error) {
      logger.error('Error routing event', { error: error.message, stack: error.stack });
      socket.emit('error', { message: 'Failed to route event', error: error.message });
    }
  });
  
  // Handle ping (heartbeat)
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    const userId = socketToUser.get(socket.id);
    
    if (userId) {
      activeUsers.delete(userId);
      socketToUser.delete(socket.id);
      
      logger.info('Backend disconnected', {
        user_id: userId,
        total_active: activeUsers.size
      });
      
      // Broadcast to all other backends that user is offline
      socket.broadcast.emit('user_offline', {
        user_id: userId
      });
    }
  });
  
  // Handle errors
  socket.on('error', (error) => {
    logger.error('Socket error', {
      user_id: userId,
      error: error.message
    });
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  // Notify all connected backends
  io.emit('service_shutdown', {
    message: 'Collaboration service is shutting down',
    timestamp: new Date().toISOString()
  });
  
  // Close server
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    logger.warn('Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
});

// Start server
const PORT = process.env.PORT || 9000;
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Collaboration Service running on port ${PORT}`);
  logger.info('Ready to accept backend connections');
});

