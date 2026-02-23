const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const PORT = process.env.PORT || 8080;
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'your-secure-token-here-change-this-in-production';

// Store connected clients
const clients = {
  forwarders: new Map(),
  receivers: new Map()
};

// Create WebSocket server
const wss = new WebSocket.Server({ 
  port: PORT,
  verifyClient: (info, cb) => {
    // Allow all connections for now, auth will be handled after connection
    cb(true);
  }
});

console.log(`WebSocket server running on port ${PORT}`);
console.log(`Local receivers connect to: ws://localhost:${PORT}`);
console.log(`Remote forwarders connect via ngrok tunnel to this server`);
console.log('');
console.log('To expose this server via ngrok, run:');
console.log(`  ngrok http ${PORT}`);
console.log('');

// Handle new connections
wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  let clientType = null;
  let authenticated = false;

  console.log(`New connection attempt from ${req.socket.remoteAddress}`);

  // Send initial connection message
  ws.send(JSON.stringify({
    type: 'connection',
    clientId: clientId,
    message: 'Connected to sync server. Please authenticate.'
  }));

  // Set up ping/pong for connection health
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      // Handle authentication
      if (message.type === 'auth') {
        if (message.token !== AUTH_TOKEN) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Authentication failed'
          }));
          ws.close();
          return;
        }

        authenticated = true;
        clientType = message.clientType; // 'forwarder' or 'receiver'

        if (clientType === 'forwarder') {
          clients.forwarders.set(clientId, ws);
          console.log(`Forwarder authenticated: ${clientId}`);
        } else if (clientType === 'receiver') {
          clients.receivers.set(clientId, ws);
          console.log(`Receiver authenticated: ${clientId}`);
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid client type'
          }));
          ws.close();
          return;
        }

        ws.send(JSON.stringify({
          type: 'auth_success',
          message: `Authenticated as ${clientType}`,
          clientId: clientId
        }));

        // Log current connections
        console.log(`Active connections - Forwarders: ${clients.forwarders.size}, Receivers: ${clients.receivers.size}`);
        return;
      }

      // Reject messages from unauthenticated clients
      if (!authenticated) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Please authenticate first'
        }));
        return;
      }

      // Handle notification forwarding
      if (message.type === 'notification' && clientType === 'forwarder') {
        console.log(`Received notification from forwarder ${clientId}:`, message.data.title);
        console.log(`Notification ID: ${message.id}`);
        
        // Forward to all connected receivers (1:N architecture)
        // Include the original notification ID so receivers can deduplicate
        const notificationMessage = JSON.stringify({
          type: 'notification',
          id: message.id,  // IMPORTANT: Include original ID for deduplication
          timestamp: Date.now(),
          forwarderId: clientId,
          data: message.data,
          metadata: message.metadata || {}
        });

        let sentCount = 0;
        clients.receivers.forEach((receiverWs, receiverId) => {
          if (receiverWs.readyState === WebSocket.OPEN) {
            receiverWs.send(notificationMessage);
            sentCount++;
            console.log(`  -> Forwarded to receiver ${receiverId} with ID: ${message.id}`);
          }
        });

        console.log(`Total receivers notified: ${sentCount}`);
        
        // Acknowledge receipt to forwarder
        ws.send(JSON.stringify({
          type: 'ack',
          message: `Notification forwarded to ${sentCount} receiver(s)`,
          originalId: message.id
        }));
      }

      // Handle heartbeat
      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }

      // Handle test messages
      if (message.type === 'test') {
        console.log(`Test message from ${clientType} ${clientId}: ${message.message}`);
        ws.send(JSON.stringify({
          type: 'test_response',
          message: `Server received: ${message.message}`
        }));
      }

    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected: ${clientId} (${clientType})`);
    
    // Remove from appropriate client list
    if (clientType === 'forwarder') {
      clients.forwarders.delete(clientId);
    } else if (clientType === 'receiver') {
      clients.receivers.delete(clientId);
    }
    
    console.log(`Active connections - Forwarders: ${clients.forwarders.size}, Receivers: ${clients.receivers.size}`);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for client ${clientId}:`, error.message);
  });
});

// Heartbeat interval to detect stale connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log('Terminating stale connection');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000); // 30 seconds

// Cleanup on server shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  clearInterval(heartbeatInterval);
  wss.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
