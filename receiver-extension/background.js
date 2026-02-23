// Background script for Notification Receiver Extension

let ws = null;
let reconnectTimeout = null;
let notificationQueue = [];

// Track processed notification IDs to prevent duplicates (by message ID)
const processedNotificationIds = new Set();
const DEDUP_WINDOW = 60000; // 60 seconds window for deduplication

let config = {
  serverUrl: 'ws://localhost:8080',
  authToken: 'your-secure-token-here-change-this-in-production', // Default token
  enabled: true,
  soundEnabled: true,
  persistentNotifications: true // Default to true
};

// Load configuration from storage
chrome.storage.local.get(['serverUrl', 'authToken', 'enabled', 'soundEnabled', 'persistentNotifications'], (result) => {
  config.serverUrl = result.serverUrl || 'ws://localhost:8080';
  config.authToken = result.authToken || 'your-secure-token-here-change-this-in-production';
  config.enabled = result.enabled !== false;
  config.soundEnabled = result.soundEnabled !== false;
  config.persistentNotifications = result.persistentNotifications !== false; // Default to true
  
  if (config.enabled) {
    connectWebSocket();
  }
});

// Listen for configuration changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.serverUrl) {
      config.serverUrl = changes.serverUrl.newValue;
      reconnectWebSocket();
    }
    if (changes.authToken) {
      config.authToken = changes.authToken.newValue;
      reconnectWebSocket();
    }
    if (changes.enabled) {
      config.enabled = changes.enabled.newValue;
      if (config.enabled) {
        connectWebSocket();
      } else {
        disconnectWebSocket();
      }
    }
    if (changes.soundEnabled) {
      config.soundEnabled = changes.soundEnabled.newValue;
    }
    if (changes.persistentNotifications) {
      config.persistentNotifications = changes.persistentNotifications.newValue;
    }
  }
});

// Reconnect WebSocket with new configuration
function reconnectWebSocket() {
  disconnectWebSocket();
  if (config.enabled) {
    setTimeout(() => connectWebSocket(), 500);
  }
}

// Connect to WebSocket server
function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('WebSocket already connected');
    return;
  }

  console.log('Connecting to WebSocket server:', config.serverUrl);
  
  try {
    ws = new WebSocket(config.serverUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      clearTimeout(reconnectTimeout);
      
      // Make sure WebSocket is really open before sending
      if (ws.readyState === WebSocket.OPEN) {
        // Authenticate
        const authMessage = {
          type: 'auth',
          clientType: 'receiver',
          token: config.authToken
        };
        console.log('Sending auth message:', authMessage);
        try {
          ws.send(JSON.stringify(authMessage));
        } catch (error) {
          console.error('Error sending auth message:', error);
          return;
        }
        
        // Update extension icon to show connected status
        chrome.action.setIcon({
          path: {
            "16": "icon-16-connected.png",
            "48": "icon-48-connected.png",
            "128": "icon-128-connected.png"
          }
        });
        
        // Process any queued notifications
        processNotificationQueue();
      } else {
        console.error('WebSocket not in OPEN state in onopen handler. State:', ws.readyState);
      }
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Received message:', message);
        
        if (message.type === 'connection') {
          console.log('Connection established:', message.message);
        } else if (message.type === 'auth_success') {
          console.log('Authentication successful');
          chrome.storage.local.set({ 
            connectionStatus: 'connected',
            lastConnected: Date.now()
          });
        } else if (message.type === 'notification') {
          handleReceivedNotification(message);
        } else if (message.type === 'test_response') {
          console.log('Test response:', message.message);
          createNotification({
            title: 'Test Successful',
            message: message.message,
            icon: '',
            type: 'test'
          });
        } else if (message.type === 'error') {
          console.error('Server error:', message.message);
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error occurred');
      console.error('Error type:', error.type);
      console.error('Error target:', error.target);
      console.error('WebSocket readyState:', ws.readyState);
      console.error('WebSocket URL:', config.serverUrl);
      chrome.storage.local.set({ connectionStatus: 'error' });
    };
    
    ws.onclose = (event) => {
      console.log('WebSocket disconnected');
      console.log('Close code:', event.code);
      console.log('Close reason:', event.reason || 'No reason provided');
      console.log('Was clean close:', event.wasClean);
      
      chrome.storage.local.set({ connectionStatus: 'disconnected' });
      
      // Update extension icon to show disconnected status
      chrome.action.setIcon({
        path: {
          "16": "icon-16.png",
          "48": "icon-48.png",
          "128": "icon-128.png"
        }
      });
      
      // Attempt to reconnect if enabled
      if (config.enabled) {
        const reconnectDelay = event.code === 1006 ? 10000 : 5000; // Longer delay for abnormal closure
        console.log(`Will reconnect in ${reconnectDelay/1000} seconds...`);
        reconnectTimeout = setTimeout(() => {
          console.log('Attempting to reconnect...');
          connectWebSocket();
        }, reconnectDelay);
      }
    };
  } catch (error) {
    console.error('Error creating WebSocket:', error);
    chrome.storage.local.set({ connectionStatus: 'error' });
  }
}

// Disconnect WebSocket
function disconnectWebSocket() {
  if (ws) {
    ws.close();
    ws = null;
  }
  clearTimeout(reconnectTimeout);
}

// Handle received notification
function handleReceivedNotification(message) {
  console.log('=== RECEIVED NOTIFICATION ===');
  console.log('Full message:', JSON.stringify(message, null, 2));
  console.log('Title:', message.data?.title);
  console.log('Message:', message.data?.message);
  console.log('Icon:', message.data?.icon);
  console.log('Domain:', message.data?.domain);
  
  // Check if we have the required data
  if (!message.data) {
    console.error('No data in notification message');
    return;
  }
  
  // DEDUPLICATION BY MESSAGE ID
  // The server includes the original notification ID from the forwarder
  // Each unique notification has a unique ID, ensuring 1:N delivery without duplicates
  const messageId = message.id;
  
  if (!messageId) {
    console.error('⚠️ WARNING: Notification has no ID! Using fallback deduplication');
    // Fallback: create ID from content
    const fallbackId = `${message.data.title}_${message.data.message}_${message.timestamp}`;
    
    if (processedNotificationIds.has(fallbackId)) {
      console.log('⚠️ DUPLICATE (fallback) - SKIPPING');
      return;
    }
    
    processedNotificationIds.add(fallbackId);
    setTimeout(() => processedNotificationIds.delete(fallbackId), DEDUP_WINDOW);
  } else {
    console.log('Checking notification ID:', messageId);
    
    // Check if we've already processed this notification ID
    if (processedNotificationIds.has(messageId)) {
      console.log('⚠️ DUPLICATE NOTIFICATION ID DETECTED - SKIPPING:', messageId);
      console.log('This notification was already displayed. Ignoring duplicate.');
      return;
    }
    
    // Mark this notification ID as processed
    processedNotificationIds.add(messageId);
    console.log('✅ New notification ID (not duplicate), processing...');
    
    // Remove from processed set after dedup window (allows same notification after 60s)
    setTimeout(() => {
      processedNotificationIds.delete(messageId);
      console.log('Dedup window expired for notification ID:', messageId);
    }, DEDUP_WINDOW);
  }
  
  // Store notification in history
  chrome.storage.local.get(['notificationHistory'], (result) => {
    const history = result.notificationHistory || [];
    history.unshift({
      ...message,
      receivedAt: Date.now()
    });
    // Keep only last 50 notifications
    chrome.storage.local.set({ 
      notificationHistory: history.slice(0, 50)
    }, () => {
      console.log('Notification saved to history');
    });
  });
  
  // Check notification permission before creating
  chrome.notifications.getPermissionLevel((level) => {
    console.log('Current notification permission level:', level);
    if (level === 'granted') {
      // Create the notification
      createNotification(message.data);
    } else {
      console.error('Cannot create notification: Permission not granted');
      console.error('Permission level:', level);
      // Still update badge even if we can't show notification
      chrome.storage.local.get(['unreadCount'], (result) => {
        const unreadCount = (result.unreadCount || 0) + 1;
        chrome.storage.local.set({ unreadCount });
        chrome.action.setBadgeText({ text: unreadCount.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });
      });
    }
  });
}

// Create browser notification
function createNotification(data) {
  console.log('Creating notification with data:', data);
  
  // Use a simple data URL icon as fallback to avoid file loading issues
  const DEFAULT_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAALEwAACxMBAJqcGAAAAdJJREFUeJztm7FqwzAQhj9B6OAH6NDRg4e+QYY+Qd6gb9ChQ4Y+QYY+Qd+gQ4c+QYY+QYYMGfoEGTx0sAehg6FDB3dw5SSy5eTOUhr+D4RxLOn+O91Jlu6ApKGUegRuAaXHBvgA3p1z31Kb/yRJ8gbcT3x9dM69pCq8JkkeBid/AQ+x7QFgZmaZmVlmZp5tMDN7GtdAqloXQgghhBBCCCGEEAfw4hbsIElqAlZwds5tbpEgFfwAiIknRbgHJEm9vb39xtz9UxDSoW8A5s65i/LfpxfnDcDb2tPqdLsA3AMx8QQMdOgbgJhYxvnQx/C2tNF1q9UEjAR0AtahbwBWoW8A1qJtAG5C3gCYmd0PTW6VBzLf3OaJt6M8EB+xzKhvAETGLdMHDAJiYoL4iGVGfQO42FfgLBRqQV1v+vb3kaxDl4AV8Al8ANvw3Q5oO+fOvBNzLvR9xL5i9PEVo5S6Av5NbRMA59zPqBZKqRawiZyq/N3MKu7YNS5+hOd5Huc+xlwD1VQTfgvsC1g5qfCnqAFZTB8AvgEYEdOHhhYiZvqiVxGzfXFrYqYPjS1FzPTdBaiFrhPMIZtOWJz7Xg/wD8CtU+ow4Re7s3X4fYZ9lgAAAABJRU5ErkJggg==';
  
  let iconUrl = DEFAULT_ICON;
  
  if (data.icon && data.icon.length > 0) {
    // If it's a data URL or absolute URL, use it directly
    if (data.icon.startsWith('data:') || data.icon.startsWith('http')) {
      iconUrl = data.icon;
    } else if (data.icon.startsWith('chrome-extension://')) {
      iconUrl = data.icon;
    } else {
      // For file paths, use the default icon to avoid loading issues
      iconUrl = DEFAULT_ICON;
    }
  }
  
  const notificationOptions = {
    type: 'basic',
    iconUrl: iconUrl,
    title: data.title || 'Forwarded Notification',
    message: data.message || '',
    priority: 2,
    requireInteraction: config.persistentNotifications || data.requireInteraction || false,
    silent: !config.soundEnabled || data.silent || false
  };
  
  // Add context message if available
  if (data.domain) {
    notificationOptions.contextMessage = `From: ${data.domain}`;
  }
  
  // Add buttons if supported
  if (chrome.notifications && chrome.notifications.create) {
    const notificationId = `notification-${Date.now()}`;
    
    chrome.notifications.create(notificationId, notificationOptions, (id) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to create notification:', chrome.runtime.lastError.message || chrome.runtime.lastError);
        console.error('Notification options:', JSON.stringify(notificationOptions, null, 2));
        
        // Fallback: Try creating notification with simple data URL icon
        const SIMPLE_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        const fallbackOptions = {
          type: 'basic',
          iconUrl: SIMPLE_ICON,
          title: String(data.title || 'Forwarded Notification'),
          message: String(data.message || 'Notification from remote browser')
        };
        
        console.log('Trying fallback notification with simple icon');
        
        chrome.notifications.create(`fallback-${Date.now()}`, fallbackOptions, (fallbackId) => {
          if (chrome.runtime.lastError) {
            console.error('Fallback notification also failed:', chrome.runtime.lastError.message || chrome.runtime.lastError);
          } else {
            console.log('Fallback notification created:', fallbackId);
            // Update badge even with fallback
            chrome.storage.local.get(['unreadCount'], (result) => {
              const unreadCount = (result.unreadCount || 0) + 1;
              chrome.storage.local.set({ unreadCount });
              chrome.action.setBadgeText({ text: unreadCount.toString() });
              chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });
            });
          }
        });
      } else {
        console.log('Notification created successfully:', id);
        
        // Store notification data for click handling
        chrome.storage.local.set({
          [`notification-${id}`]: data
        });
        
        // Update badge for successful notification
        chrome.storage.local.get(['unreadCount'], (result) => {
          const unreadCount = (result.unreadCount || 0) + 1;
          chrome.storage.local.set({ unreadCount });
          chrome.action.setBadgeText({ text: unreadCount.toString() });
          chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });
        });
      }
    });
    
    // Auto-clear notification after 10 seconds if not persistent
    if (!config.persistentNotifications && !data.requireInteraction) {
      setTimeout(() => {
        chrome.notifications.clear(notificationId);
      }, 10000);
    }
  } else {
    console.error('chrome.notifications API not available');
  }
}

// Process queued notifications
function processNotificationQueue() {
  while (notificationQueue.length > 0) {
    const notification = notificationQueue.shift();
    createNotification(notification);
  }
}

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
  // Clear the notification
  chrome.notifications.clear(notificationId);
  
  // Get stored notification data
  chrome.storage.local.get([`notification-${notificationId}`], (result) => {
    const data = result[`notification-${notificationId}`];
    if (data && data.sourceUrl) {
      // Open the source URL if available
      chrome.tabs.create({ url: data.sourceUrl });
    }
    
    // Clean up stored data
    chrome.storage.local.remove([`notification-${notificationId}`]);
  });
  
  // Reset unread count
  chrome.storage.local.set({ unreadCount: 0 });
  chrome.action.setBadgeText({ text: '' });
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get-status') {
    sendResponse({
      enabled: config.enabled,
      connected: ws && ws.readyState === WebSocket.OPEN,
      serverUrl: config.serverUrl
    });
  } else if (message.type === 'clear-history') {
    chrome.storage.local.set({ 
      notificationHistory: [],
      unreadCount: 0
    });
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ cleared: true });
  } else if (message.type === 'test-connection') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'test',
        message: 'Test from receiver extension'
      }));
      sendResponse({ sent: true });
    } else {
      sendResponse({ sent: false, error: 'Not connected' });
    }
  }
  return true; // Keep message channel open for async response
});

// Keep service worker alive
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: 'ping' }));
      console.log('Ping sent to keep connection alive');
    } catch (error) {
      console.error('Error sending ping:', error);
    }
  }
}, 25000); // Send ping every 25 seconds

// Request notification permission on install
chrome.runtime.onInstalled.addListener(() => {
  // Check notification permission
  chrome.notifications.getPermissionLevel((level) => {
    console.log('Notification permission level:', level);
    if (level !== 'granted') {
      console.log('Notification permission not granted. User needs to grant permission.');
      // Note: We can't request permission programmatically in extensions,
      // user must grant it through browser settings
    }
  });
  
  // Initialize with default config if first install
  chrome.storage.local.get(['configured'], (result) => {
    if (!result.configured) {
      chrome.storage.local.set({
        configured: true,
        serverUrl: 'ws://localhost:8080',
        authToken: 'your-secure-token-here-change-this-in-production',
        enabled: true,
        soundEnabled: true,
        persistentNotifications: true
      }, () => {
        console.log('Initial configuration set');
        // Try to connect immediately after install
        connectWebSocket();
      });
    }
  });
});
