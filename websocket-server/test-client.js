const WebSocket = require('ws');
const readline = require('readline');

// Configuration
const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:8080';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'your-secure-token-here-change-this-in-production';

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Test as forwarder
function testAsForwarder() {
  log('\n=== Testing as FORWARDER ===', 'bright');
  log(`Connecting to ${SERVER_URL}...`, 'cyan');
  
  const ws = new WebSocket(SERVER_URL);
  
  ws.on('open', () => {
    log('Connected! Authenticating as forwarder...', 'green');
    
    // Authenticate
    ws.send(JSON.stringify({
      type: 'auth',
      clientType: 'forwarder',
      token: AUTH_TOKEN
    }));
  });
  
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    log(`Received: ${JSON.stringify(message, null, 2)}`, 'yellow');
    
    if (message.type === 'auth_success') {
      log('Authentication successful! Sending test notification...', 'green');
      
      // Send test notification
      setTimeout(() => {
        const notification = {
          type: 'notification',
          id: Date.now().toString(),
          data: {
            title: 'Test Notification',
            message: 'This is a test notification from the test client',
            icon: '',
            domain: 'test-client.local',
            sourceUrl: 'http://test-client.local',
            type: 'test'
          },
          metadata: {
            timestamp: Date.now(),
            userAgent: 'Test Client/1.0'
          }
        };
        
        ws.send(JSON.stringify(notification));
        log('Test notification sent!', 'green');
        
        // Send another notification after 2 seconds
        setTimeout(() => {
          const notification2 = {
            type: 'notification',
            id: Date.now().toString(),
            data: {
              title: 'Second Test',
              message: 'This is another test with more details and a longer message to test how it appears',
              icon: '',
              domain: 'example.com',
              sourceUrl: 'https://example.com',
              type: 'test'
            },
            metadata: {
              timestamp: Date.now(),
              userAgent: 'Test Client/1.0'
            }
          };
          
          ws.send(JSON.stringify(notification2));
          log('Second notification sent!', 'green');
        }, 2000);
      }, 1000);
    }
  });
  
  ws.on('error', (error) => {
    log(`Error: ${error.message}`, 'red');
  });
  
  ws.on('close', () => {
    log('Connection closed', 'yellow');
    askForNextAction();
  });
  
  // Keep connection alive
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 25000);
  
  // Handle user input to send custom notifications
  setTimeout(() => {
    log('\nYou can now type notification titles to send (or "quit" to exit):', 'cyan');
    rl.on('line', (input) => {
      if (input.toLowerCase() === 'quit') {
        ws.close();
        return;
      }
      
      if (ws.readyState === WebSocket.OPEN) {
        const notification = {
          type: 'notification',
          id: Date.now().toString(),
          data: {
            title: input,
            message: `Custom message sent at ${new Date().toLocaleTimeString()}`,
            icon: '',
            domain: 'test-input',
            sourceUrl: 'http://test-client.local',
            type: 'custom'
          },
          metadata: {
            timestamp: Date.now(),
            userAgent: 'Test Client/1.0'
          }
        };
        
        ws.send(JSON.stringify(notification));
        log(`Sent notification: "${input}"`, 'green');
      } else {
        log('WebSocket is not connected', 'red');
      }
    });
  }, 5000);
}

// Test as receiver
function testAsReceiver() {
  log('\n=== Testing as RECEIVER ===', 'bright');
  log(`Connecting to ${SERVER_URL}...`, 'cyan');
  
  const ws = new WebSocket(SERVER_URL);
  
  ws.on('open', () => {
    log('Connected! Authenticating as receiver...', 'green');
    
    // Authenticate
    ws.send(JSON.stringify({
      type: 'auth',
      clientType: 'receiver',
      token: AUTH_TOKEN
    }));
  });
  
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    
    if (message.type === 'notification') {
      log('\n📬 NOTIFICATION RECEIVED:', 'bright');
      log(`  Title: ${message.data.title}`, 'cyan');
      log(`  Message: ${message.data.message}`, 'cyan');
      log(`  From: ${message.data.domain || 'Unknown'}`, 'cyan');
      log(`  Time: ${new Date(message.timestamp).toLocaleString()}`, 'cyan');
      log(`  Forwarder ID: ${message.forwarderId}`, 'yellow');
    } else {
      log(`Received: ${JSON.stringify(message, null, 2)}`, 'yellow');
    }
    
    if (message.type === 'auth_success') {
      log('Authentication successful! Waiting for notifications...', 'green');
      log('(Open another terminal and run this script as forwarder to test)', 'cyan');
    }
  });
  
  ws.on('error', (error) => {
    log(`Error: ${error.message}`, 'red');
  });
  
  ws.on('close', () => {
    log('Connection closed', 'yellow');
    askForNextAction();
  });
  
  // Keep connection alive
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 25000);
}

// Test server connectivity
async function testConnection() {
  log('\n=== Testing Server Connection ===', 'bright');
  log(`Attempting to connect to ${SERVER_URL}...`, 'cyan');
  
  return new Promise((resolve) => {
    const ws = new WebSocket(SERVER_URL);
    let timeout = setTimeout(() => {
      log('Connection timeout!', 'red');
      ws.close();
      resolve(false);
    }, 5000);
    
    ws.on('open', () => {
      clearTimeout(timeout);
      log('✓ Successfully connected to server!', 'green');
      ws.close();
      resolve(true);
    });
    
    ws.on('error', (error) => {
      clearTimeout(timeout);
      log(`✗ Connection failed: ${error.message}`, 'red');
      resolve(false);
    });
  });
}

// Main menu
function showMenu() {
  log('\n=== WebSocket Test Client ===', 'bright');
  log('1. Test as Forwarder (sends notifications)', 'cyan');
  log('2. Test as Receiver (receives notifications)', 'cyan');
  log('3. Test Server Connection', 'cyan');
  log('4. Run Both (forwarder + receiver)', 'cyan');
  log('5. Exit', 'cyan');
  
  rl.question('\nSelect option (1-5): ', (answer) => {
    switch(answer) {
      case '1':
        testAsForwarder();
        break;
      case '2':
        testAsReceiver();
        break;
      case '3':
        testConnection().then((success) => {
          if (success) {
            askForNextAction();
          } else {
            log('\nMake sure the WebSocket server is running:', 'yellow');
            log('  cd websocket-server', 'yellow');
            log('  npm start', 'yellow');
            askForNextAction();
          }
        });
        break;
      case '4':
        log('Starting both forwarder and receiver...', 'cyan');
        // Start receiver first
        testAsReceiver();
        // Start forwarder after a delay
        setTimeout(() => {
          const { spawn } = require('child_process');
          const forwarder = spawn('node', ['test-client.js'], {
            stdio: 'inherit',
            env: { ...process.env, AUTO_MODE: 'forwarder' }
          });
        }, 2000);
        break;
      case '5':
        log('Goodbye!', 'green');
        process.exit(0);
        break;
      default:
        log('Invalid option!', 'red');
        showMenu();
    }
  });
}

function askForNextAction() {
  setTimeout(() => {
    rl.question('\nPress Enter to return to menu...', () => {
      showMenu();
    });
  }, 1000);
}

// Auto-mode for spawned processes
if (process.env.AUTO_MODE === 'forwarder') {
  testAsForwarder();
} else {
  // Show initial connection info
  log('WebSocket Test Client', 'bright');
  log(`Server URL: ${SERVER_URL}`, 'yellow');
  log(`Auth Token: ${AUTH_TOKEN.substring(0, 10)}...`, 'yellow');
  
  showMenu();
}

// Handle process termination
process.on('SIGINT', () => {
  log('\nShutting down...', 'yellow');
  process.exit(0);
});
