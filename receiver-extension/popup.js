// Popup script for Notification Receiver Extension

document.addEventListener('DOMContentLoaded', async () => {
  const serverUrlInput = document.getElementById('serverUrl');
  const authTokenInput = document.getElementById('authToken');
  const enabledToggle = document.getElementById('enabled');
  const soundEnabledToggle = document.getElementById('soundEnabled');
  const persistentToggle = document.getElementById('persistentNotifications');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusText = document.getElementById('statusText');
  const statusIndicator = document.getElementById('statusIndicator');
  const notificationHistory = document.getElementById('notificationHistory');
  const unreadBadge = document.getElementById('unreadBadge');
  
  // Load saved configuration
  const config = await chrome.storage.local.get([
    'serverUrl', 
    'authToken', 
    'enabled', 
    'soundEnabled',
    'persistentNotifications',
    'notificationHistory',
    'unreadCount'
  ]);
  
  serverUrlInput.value = config.serverUrl || 'ws://localhost:8080';
  authTokenInput.value = config.authToken || 'your-secure-token-here-change-this-in-production';
  enabledToggle.checked = config.enabled !== false;
  soundEnabledToggle.checked = config.soundEnabled !== false;
  persistentToggle.checked = config.persistentNotifications !== false; // Default to true
  
  // Display unread count
  if (config.unreadCount && config.unreadCount > 0) {
    unreadBadge.textContent = config.unreadCount;
    unreadBadge.style.display = 'inline-block';
  }
  
  // Clear unread count when popup opens
  chrome.storage.local.set({ unreadCount: 0 });
  chrome.action.setBadgeText({ text: '' });
  
  // Update status display
  updateStatus();
  
  // Display notification history
  displayNotificationHistory(config.notificationHistory || []);
  
  // Save configuration
  saveBtn.addEventListener('click', async () => {
    const serverUrl = serverUrlInput.value.trim();
    const authToken = authTokenInput.value.trim();
    const enabled = enabledToggle.checked;
    const soundEnabled = soundEnabledToggle.checked;
    const persistentNotifications = persistentToggle.checked;
    
    if (!serverUrl) {
      alert('Please enter a WebSocket server URL');
      return;
    }
    
    if (!authToken) {
      alert('Please enter an authentication token');
      return;
    }
    
    // Validate WebSocket URL format
    if (!serverUrl.match(/^wss?:\/\/.+/)) {
      alert('Invalid WebSocket URL. It should start with ws:// or wss://');
      return;
    }
    
    // Save to storage
    await chrome.storage.local.set({
      serverUrl: serverUrl,
      authToken: authToken,
      enabled: enabled,
      soundEnabled: soundEnabled,
      persistentNotifications: persistentNotifications
    });
    
    statusText.textContent = 'Settings saved successfully!';
    statusText.style.background = '#d4edda';
    statusText.style.color = '#155724';
    
    setTimeout(() => {
      updateStatus();
    }, 2000);
  });
  
  // Test connection
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    
    try {
      const response = await chrome.runtime.sendMessage({ type: 'test-connection' });
      
      if (response.sent) {
        statusText.textContent = 'Test message sent successfully!';
        statusText.style.background = '#d4edda';
        statusText.style.color = '#155724';
      } else {
        statusText.textContent = response.error || 'Failed to send test message';
        statusText.style.background = '#f8d7da';
        statusText.style.color = '#721c24';
      }
    } catch (error) {
      statusText.textContent = 'Error: ' + error.message;
      statusText.style.background = '#f8d7da';
      statusText.style.color = '#721c24';
    }
    
    setTimeout(() => {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
      updateStatus();
    }, 2000);
  });
  
  // Clear history
  clearBtn.addEventListener('click', async () => {
    if (confirm('Clear all notification history?')) {
      await chrome.runtime.sendMessage({ type: 'clear-history' });
      displayNotificationHistory([]);
      unreadBadge.style.display = 'none';
    }
  });
  
  // Update status periodically
  async function updateStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'get-status' });
      
      if (response.connected) {
        statusIndicator.className = 'status-indicator connected';
        statusText.textContent = `Connected to ${response.serverUrl}`;
        statusText.style.background = '#d4edda';
        statusText.style.color = '#155724';
      } else if (response.enabled) {
        statusIndicator.className = 'status-indicator disconnected';
        statusText.textContent = 'Connecting to server...';
        statusText.style.background = '#fff3cd';
        statusText.style.color = '#856404';
      } else {
        statusIndicator.className = 'status-indicator disconnected';
        statusText.textContent = 'Receiving disabled';
        statusText.style.background = '#f5f5f5';
        statusText.style.color = '#666';
      }
    } catch (error) {
      statusIndicator.className = 'status-indicator disconnected';
      statusText.textContent = 'Unable to get status';
      statusText.style.background = '#f8d7da';
      statusText.style.color = '#721c24';
    }
  }
  
  // Display notification history
  function displayNotificationHistory(history) {
    if (history.length === 0) {
      notificationHistory.innerHTML = '<div class="empty-state">No notifications received yet</div>';
      return;
    }
    
    notificationHistory.innerHTML = '';
    history.forEach(item => {
      const notificationDiv = document.createElement('div');
      notificationDiv.className = 'notification-item';
      
      const time = new Date(item.receivedAt || item.timestamp).toLocaleString();
      const domain = item.data.domain || 'Unknown source';
      
      notificationDiv.innerHTML = `
        <div class="notification-title">${escapeHtml(item.data.title || 'No title')}</div>
        <div class="notification-message">${escapeHtml(item.data.message || '')}</div>
        <div class="notification-meta">${domain} • ${time}</div>
      `;
      
      // Click to open source URL if available
      if (item.data.sourceUrl) {
        notificationDiv.style.cursor = 'pointer';
        notificationDiv.addEventListener('click', () => {
          chrome.tabs.create({ url: item.data.sourceUrl });
        });
      }
      
      notificationHistory.appendChild(notificationDiv);
    });
  }
  
  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Update status every 2 seconds
  setInterval(updateStatus, 2000);
  
  // Refresh notification history every 5 seconds
  setInterval(async () => {
    const result = await chrome.storage.local.get(['notificationHistory']);
    displayNotificationHistory(result.notificationHistory || []);
  }, 5000);
  
  // Toggle enable state
  enabledToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ enabled: enabledToggle.checked });
    updateStatus();
  });
  
  // Toggle sound
  soundEnabledToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ soundEnabled: soundEnabledToggle.checked });
  });
  
  // Toggle persistent notifications
  persistentToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ persistentNotifications: persistentToggle.checked });
  });
});
