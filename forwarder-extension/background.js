// Background script for Notification Forwarder Extension
// ALWAYS ACTIVE - Automatically captures and forwards all browser notifications

// Initialize on install to ensure always active
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Notification Forwarder installed/updated:', details.reason);
  
  // Set defaults on first install
  if (details.reason === 'install') {
    chrome.storage.local.set({
      enabled: true,
      serverUrl: 'ws://localhost:8080',
      authToken: 'your-secure-token-here-change-this-in-production'
    }, () => {
      console.log('Forwarder Extension: Default settings applied - ALWAYS ACTIVE');
    });
  }
  
  // Ensure enabled on update
  if (details.reason === 'update') {
    chrome.storage.local.get(['enabled'], (result) => {
      if (result.enabled === undefined) {
        chrome.storage.local.set({ enabled: true });
      }
    });
  }
});

// Track which tabs have had successful injections to prevent duplicates
const injectedTabs = new Set();

// Fallback injection using Scripting API ONLY for CSP-strict sites
// This is a backup - content-simple.js should handle most cases
chrome.webNavigation.onCommitted.addListener(async (details) => {
  // Skip if not main frame, not enabled, or already injected
  if (details.frameId !== 0 || !config.enabled || injectedTabs.has(details.tabId)) {
    return;
  }
  
  // Skip chrome:// and extension:// pages
  if (details.url.startsWith('chrome://') || details.url.startsWith('extension://')) {
    return;
  }
  
  // Wait a bit to let content-simple.js try first
  setTimeout(async () => {
    try {
      // Check if content script already injected successfully
      const results = await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        func: () => window.NOTIFICATION_FORWARDER_ACTIVE === true
      });
      
      // If already active, don't inject again
      if (results && results[0] && results[0].result === true) {
        console.log('[Background] Content script already active on tab:', details.tabId);
        injectedTabs.add(details.tabId);
        return;
      }
      
      // Only inject if content script failed (CSP-strict sites)
      console.log('[Background] Content script not active, trying Scripting API injection');
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        world: 'MAIN',
        files: ['inject.js']
      });
      console.log('[Background] Scripting API injection successful for tab:', details.tabId);
      injectedTabs.add(details.tabId);
    } catch (e) {
      // Injection failed, which is fine for some pages
      console.log('[Background] Scripting API injection skipped/failed:', e.message);
    }
  }, 500); // 500ms delay to let content script inject first
});

// Clean up injected tabs tracking when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

let ws = null;
let reconnectTimeout = null;

// Track sent notifications to prevent duplicates
const sentNotifications = new Set();
const DEDUP_WINDOW = 3000; // 3 seconds window for deduplication

let config = {
  serverUrl: 'ws://localhost:8080', // Default to localhost
  authToken: 'your-secure-token-here-change-this-in-production', // Default token
  enabled: true // Default to enabled - ALWAYS ACTIVE
};

// Load configuration from storage
chrome.storage.local.get(['serverUrl', 'authToken', 'enabled'], (result) => {
  config.serverUrl = result.serverUrl || 'ws://localhost:8080'; // Default to localhost
  config.authToken = result.authToken || 'your-secure-token-here-change-this-in-production';
  config.enabled = result.enabled !== false; // Default to true
  
  // Always try to connect if enabled (even without explicit serverUrl)
  if (config.enabled) {
    connectWebSocket();
  }
  
  console.log('Forwarder Extension initialized:', {
    enabled: config.enabled,
    serverUrl: config.serverUrl,
    hasToken: !!config.authToken
  });
});

// Listen for configuration changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.serverUrl) {
      config.serverUrl = changes.serverUrl.newValue;
    }
    if (changes.authToken) {
      config.authToken = changes.authToken.newValue;
    }
    if (changes.enabled) {
      config.enabled = changes.enabled.newValue;
      if (config.enabled && config.serverUrl) {
        connectWebSocket();
      } else {
        disconnectWebSocket();
      }
    }
  }
});

// Connect to WebSocket server
function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('WebSocket already connected');
    return;
  }

  if (!config.serverUrl) {
    console.error('No server URL configured');
    return;
  }

  console.log('Connecting to WebSocket server:', config.serverUrl);
  
  try {
    ws = new WebSocket(config.serverUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      clearTimeout(reconnectTimeout);
      
      // Authenticate
      ws.send(JSON.stringify({
        type: 'auth',
        clientType: 'forwarder',
        token: config.authToken
      }));
      
      // Update extension icon to show connected status
      chrome.action.setIcon({
        path: {
          "16": "icon-16-connected.png",
          "48": "icon-48-connected.png",
          "128": "icon-128-connected.png"
        }
      });
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Received message:', message);
        
        if (message.type === 'auth_success') {
          console.log('Authentication successful');
          chrome.storage.local.set({ connectionStatus: 'connected' });
        } else if (message.type === 'error') {
          console.error('Server error:', message.message);
        } else if (message.type === 'ack') {
          console.log('Notification acknowledged:', message.message);
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      chrome.storage.local.set({ connectionStatus: 'error' });
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
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
        reconnectTimeout = setTimeout(() => {
          console.log('Attempting to reconnect...');
          connectWebSocket();
        }, 5000); // Reconnect after 5 seconds
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

// Intercept and forward notifications
function forwardNotification(notificationData) {
  console.log('[ALWAYS ACTIVE] Auto-capturing notification:', notificationData.title);
  
  // DEDUPLICATION: Create unique key for this notification
  const dedupKey = `${notificationData.title}_${notificationData.message}_${notificationData.sourceUrl}`;
  
  // Check if we've already sent this notification recently
  if (sentNotifications.has(dedupKey)) {
    console.log('⚠️ DUPLICATE NOTIFICATION DETECTED - SKIPPING:', dedupKey);
    console.log('This notification was already sent within the last', DEDUP_WINDOW/1000, 'seconds');
    return;
  }
  
  // Mark as sent
  sentNotifications.add(dedupKey);
  console.log('✅ New notification (not duplicate), forwarding...');
  
  // Remove from sent set after dedup window
  setTimeout(() => {
    sentNotifications.delete(dedupKey);
  }, DEDUP_WINDOW);
  
  const notificationId = Date.now().toString();
  const timestamp = Date.now();
  
  // ALWAYS store notification in history
  const notificationRecord = {
    id: notificationId,
    data: notificationData,
    timestamp: timestamp,
    status: 'captured'
  };
  
  // Save to storage - ALWAYS CAPTURE
  chrome.storage.local.get(['notificationHistory', 'stats'], (result) => {
    const history = result.notificationHistory || [];
    const stats = result.stats || { captured: 0, forwarded: 0, failed: 0 };
    
    // Always update captured count
    stats.captured++;
    
    // Always add to history (keep last 50)
    history.unshift(notificationRecord);
    if (history.length > 50) {
      history.pop();
    }
    
    chrome.storage.local.set({ 
      notificationHistory: history,
      stats: stats 
    });
  });
  
  // Try to forward to WebSocket (but still capture if not connected)
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log('[ALWAYS ACTIVE] WebSocket not ready - notification captured locally');
    
    // Update status to failed
    chrome.storage.local.get(['notificationHistory', 'stats'], (result) => {
      const history = result.notificationHistory || [];
      const stats = result.stats || { captured: 0, forwarded: 0, failed: 0 };
      
      const index = history.findIndex(n => n.id === notificationId);
      if (index !== -1) {
        history[index].status = 'failed';
        history[index].error = 'WebSocket not connected';
      }
      
      stats.failed++;
      chrome.storage.local.set({ notificationHistory: history, stats: stats });
    });
    
    return;
  }
  
  const message = {
    type: 'notification',
    id: notificationId,
    data: notificationData,
    metadata: {
      timestamp: timestamp,
      userAgent: navigator.userAgent,
      url: notificationData.sourceUrl || ''
    }
  };
  
  try {
    ws.send(JSON.stringify(message));
    console.log('Forwarded notification:', notificationData.title);
    
    // Update status to forwarded
    chrome.storage.local.get(['notificationHistory', 'stats'], (result) => {
      const history = result.notificationHistory || [];
      const stats = result.stats || { captured: 0, forwarded: 0, failed: 0 };
      
      const index = history.findIndex(n => n.id === notificationId);
      if (index !== -1) {
        history[index].status = 'forwarded';
        history[index].forwardedAt = Date.now();
      }
      
      stats.forwarded++;
      chrome.storage.local.set({ notificationHistory: history, stats: stats });
    });
  } catch (error) {
    console.error('Failed to send notification:', error);
    
    // Update status to failed
    chrome.storage.local.get(['notificationHistory', 'stats'], (result) => {
      const history = result.notificationHistory || [];
      const stats = result.stats || { captured: 0, forwarded: 0, failed: 0 };
      
      const index = history.findIndex(n => n.id === notificationId);
      if (index !== -1) {
        history[index].status = 'failed';
        history[index].error = error.message;
      }
      
      stats.failed++;
      chrome.storage.local.set({ notificationHistory: history, stats: stats });
    });
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.type, 'from:', sender.tab?.url || sender.url);
  
  if (message.type === 'notification-detected') {
    console.log('Notification detected from content script:', message.data);
    if (config.enabled) {
      console.log('Forwarding is enabled, sending notification...');
      forwardNotification(message.data);
    } else {
      console.log('Forwarding is disabled, not sending notification');
      // Still store it as captured but not forwarded
      const notificationRecord = {
        id: Date.now().toString(),
        data: message.data,
        timestamp: Date.now(),
        status: 'disabled'
      };
      
      chrome.storage.local.get(['notificationHistory'], (result) => {
        const history = result.notificationHistory || [];
        history.unshift(notificationRecord);
        if (history.length > 50) {
          history.pop();
        }
        chrome.storage.local.set({ notificationHistory: history });
      });
    }
    sendResponse({ received: true });
  } else if (message.type === 'clear-history') {
    chrome.storage.local.set({ 
      notificationHistory: [],
      stats: { captured: 0, forwarded: 0, failed: 0 }
    });
    sendResponse({ cleared: true });
  } else if (message.type === 'get-status') {
    sendResponse({
      enabled: config.enabled,
      connected: ws && ws.readyState === WebSocket.OPEN,
      serverUrl: config.serverUrl
    });
  } else if (message.type === 'test-notification') {
    // Send a test notification
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Send as a proper notification that will be forwarded
      const testNotification = {
        type: 'notification',
        id: Date.now().toString(),
        data: {
          title: 'Test Notification',
          message: 'This is a test notification from the forwarder extension',
          icon: '',
          domain: 'forwarder-extension',
          sourceUrl: 'chrome-extension://' + chrome.runtime.id,
          type: 'test'
        },
        metadata: {
          timestamp: Date.now(),
          userAgent: navigator.userAgent
        }
      };
      ws.send(JSON.stringify(testNotification));
      sendResponse({ sent: true });
    } else {
      sendResponse({ sent: false, error: 'Not connected' });
    }
  }
  return true; // Keep message channel open for async response
});

// Monitor browser notifications (if supported by the browser)
if (chrome.notifications && chrome.notifications.onShown) {
  chrome.notifications.onShown.addListener((notificationId) => {
    chrome.notifications.getAll((notifications) => {
      if (notifications[notificationId] && config.enabled) {
        forwardNotification({
          id: notificationId,
          title: notifications[notificationId].title || '',
          message: notifications[notificationId].message || '',
          iconUrl: notifications[notificationId].iconUrl || '',
          type: 'browser-notification'
        });
      }
    });
  });
}

// Keep service worker alive
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 25000); // Send ping every 25 seconds
