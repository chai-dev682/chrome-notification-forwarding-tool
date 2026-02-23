const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const PORT = parseInt(process.env.PORT, 10) || 8080;
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'your-secure-token-here-change-this-in-production';

// Cloud Run WebSocket idle timeout is up to 3600s (configurable).
// Keepalive must be shorter than the configured request timeout.
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS, 10) || 25000;

const clients = {
  forwarders: new Map(),
  receivers: new Map()
};

// --- HTTP server (required by Cloud Run for health checks & WS upgrade) ---

const httpServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      forwarders: clients.forwarders.size,
      receivers: clients.receivers.size,
      uptime: process.uptime()
    }));
    return;
  }

  if (req.method === 'GET' && req.url === '/readyz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ready');
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// --- WebSocket server attached to the HTTP server ---

const wss = new WebSocket.Server({
  server: httpServer,
  verifyClient: (_info, cb) => {
    cb(true);
  }
});

wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  let clientType = null;
  let authenticated = false;

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`New connection from ${clientIp}`);

  ws.send(JSON.stringify({
    type: 'connection',
    clientId,
    message: 'Connected to sync server. Please authenticate.'
  }));

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'auth') {
        if (message.token !== AUTH_TOKEN) {
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }));
          ws.close();
          return;
        }

        authenticated = true;
        clientType = message.clientType;

        if (clientType === 'forwarder') {
          clients.forwarders.set(clientId, ws);
          console.log(`Forwarder authenticated: ${clientId}`);
        } else if (clientType === 'receiver') {
          clients.receivers.set(clientId, ws);
          console.log(`Receiver authenticated: ${clientId}`);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid client type' }));
          ws.close();
          return;
        }

        ws.send(JSON.stringify({
          type: 'auth_success',
          message: `Authenticated as ${clientType}`,
          clientId
        }));

        console.log(`Active – Forwarders: ${clients.forwarders.size}, Receivers: ${clients.receivers.size}`);
        return;
      }

      if (!authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'Please authenticate first' }));
        return;
      }

      if (message.type === 'notification' && clientType === 'forwarder') {
        console.log(`Notification from ${clientId}: ${message.data?.title} (id=${message.id})`);

        const payload = JSON.stringify({
          type: 'notification',
          id: message.id,
          timestamp: Date.now(),
          forwarderId: clientId,
          data: message.data,
          metadata: message.metadata || {}
        });

        let sentCount = 0;
        clients.receivers.forEach((receiverWs, receiverId) => {
          if (receiverWs.readyState === WebSocket.OPEN) {
            receiverWs.send(payload);
            sentCount++;
            console.log(`  -> Forwarded to ${receiverId}`);
          }
        });

        console.log(`Receivers notified: ${sentCount}`);
        ws.send(JSON.stringify({
          type: 'ack',
          message: `Notification forwarded to ${sentCount} receiver(s)`,
          originalId: message.id
        }));
      }

      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }

      if (message.type === 'test') {
        console.log(`Test from ${clientType} ${clientId}: ${message.message}`);
        ws.send(JSON.stringify({
          type: 'test_response',
          message: `Server received: ${message.message}`
        }));
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log(`Disconnected: ${clientId} (${clientType})`);
    if (clientType === 'forwarder') clients.forwarders.delete(clientId);
    else if (clientType === 'receiver') clients.receivers.delete(clientId);
    console.log(`Active – Forwarders: ${clients.forwarders.size}, Receivers: ${clients.receivers.size}`);
  });

  ws.on('error', (error) => {
    console.error(`WS error for ${clientId}:`, error.message);
  });
});

// --- Heartbeat: detect stale connections ---

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log('Terminating stale connection');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

// --- Graceful shutdown (Cloud Run sends SIGTERM) ---

function shutdown(signal) {
  console.log(`${signal} received – shutting down…`);
  clearInterval(heartbeatInterval);

  wss.clients.forEach((ws) => {
    ws.close(1001, 'Server shutting down');
  });

  wss.close(() => {
    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error('Forceful shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// --- Start listening ---

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/healthz`);
  console.log(`Readiness check: http://localhost:${PORT}/readyz`);
});
