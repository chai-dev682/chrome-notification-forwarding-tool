// Popup script for Notification Forwarder Extension

document.addEventListener('DOMContentLoaded', async () => {
  const serverUrlInput = document.getElementById('serverUrl');
  const authTokenInput = document.getElementById('authToken');
  const enabledToggle = document.getElementById('enabled');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const statusText = document.getElementById('statusText');
  const statusIndicator = document.getElementById('statusIndicator');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const notificationList = document.getElementById('notificationList');
  const capturedCount = document.getElementById('capturedCount');
  const forwardedCount = document.getElementById('forwardedCount');
  const failedCount = document.getElementById('failedCount');
  
  // Load saved configuration
  const config = await chrome.storage.local.get(['serverUrl', 'authToken', 'enabled', 'connectionStatus']);
  serverUrlInput.value = config.serverUrl || 'ws://localhost:8080'; // Default server
  authTokenInput.value = config.authToken || 'your-secure-token-here-change-this-in-production';
  // ALWAYS ACTIVE BY DEFAULT
  enabledToggle.checked = config.enabled !== false; // Always true by default
  
  // Show that extension is always active
  if (config.enabled !== false) {
    const activeIndicator = document.createElement('div');
    activeIndicator.style.cssText = 'background: #28a745; color: white; padding: 5px 10px; border-radius: 5px; text-align: center; margin-bottom: 10px;';
    activeIndicator.textContent = '✅ ALWAYS ACTIVE - Auto-Capturing All Notifications';
    statusText.parentElement.insertBefore(activeIndicator, statusText);
  }
  
  // Update status display
  updateStatus();
  
  // Load and display notification history
  loadNotificationHistory();
  
  // Update stats
  updateStats();
  
  // Save configuration
  saveBtn.addEventListener('click', async () => {
    const serverUrl = serverUrlInput.value.trim();
    const authToken = authTokenInput.value.trim();
    const enabled = enabledToggle.checked;
    
    if (enabled && !serverUrl) {
      alert('Please enter a WebSocket server URL');
      return;
    }
    
    if (enabled && !authToken) {
      alert('Please enter an authentication token');
      return;
    }
    
    // Validate WebSocket URL format
    if (serverUrl && !serverUrl.match(/^wss?:\/\/.+/)) {
      alert('Invalid WebSocket URL. It should start with ws:// or wss://');
      return;
    }
    
    // Save to storage
    await chrome.storage.local.set({
      serverUrl: serverUrl,
      authToken: authToken,
      enabled: enabled
    });
    
    statusText.textContent = 'Configuration saved!';
    statusText.style.background = '#d4edda';
    statusText.style.color = '#155724';
    
    setTimeout(() => {
      updateStatus();
    }, 2000);
  });
  
  // Test notification
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Sending...';
    
    try {
      const response = await chrome.runtime.sendMessage({ type: 'test-notification' });
      
      if (response.sent) {
        // Create a test notification that should be captured
        // Since we're in the extension popup, we need to create it in a content context
        // So we'll manually send it to the background script
        chrome.runtime.sendMessage({
          type: 'notification-detected',
          data: {
            title: 'Test Notification',
            message: 'This is a test notification from the forwarder extension',
            icon: '',
            tag: 'test-' + Date.now(),
            requireInteraction: false,
            silent: false,
            data: {},
            sourceUrl: 'chrome-extension://' + chrome.runtime.id + '/popup.html',
            domain: 'forwarder-extension',
            type: 'test-notification'
          }
        });
        
        statusText.textContent = 'Test notification sent successfully!';
        statusText.style.background = '#d4edda';
        statusText.style.color = '#155724';
      } else {
        statusText.textContent = response.error || 'Failed to send test notification';
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
      testBtn.textContent = 'Send Test Notification';
      updateStatus();
    }, 2000);
  });
  
  // Update status periodically
  async function updateStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'get-status' });
      const connectionStatus = await chrome.storage.local.get(['connectionStatus']);
      
      if (response.connected) {
        statusIndicator.className = 'status-indicator connected';
        statusText.textContent = `Connected to ${response.serverUrl}`;
        statusText.style.background = '#d4edda';
        statusText.style.color = '#155724';
      } else if (response.enabled) {
        statusIndicator.className = 'status-indicator disconnected';
        statusText.textContent = 'Disconnected - Attempting to connect...';
        statusText.style.background = '#fff3cd';
        statusText.style.color = '#856404';
      } else {
        statusIndicator.className = 'status-indicator disconnected';
        statusText.textContent = 'Forwarding disabled';
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
  
  // Clear history button
  clearHistoryBtn.addEventListener('click', async () => {
    if (confirm('Clear all notification history?')) {
      await chrome.runtime.sendMessage({ type: 'clear-history' });
      loadNotificationHistory();
      updateStats();
    }
  });
  
  // Function to load and display notification history
  async function loadNotificationHistory() {
    const result = await chrome.storage.local.get(['notificationHistory']);
    const history = result.notificationHistory || [];
    
    if (history.length === 0) {
      notificationList.innerHTML = '<div class="empty-state">No notifications captured yet</div>';
      return;
    }
    
    notificationList.innerHTML = '';
    history.forEach(item => {
      const notifDiv = document.createElement('div');
      notifDiv.className = 'notification-item';
      
      const statusClass = item.status === 'forwarded' ? 'status-forwarded' : 
                          item.status === 'failed' ? 'status-failed' : 
                          item.status === 'disabled' ? 'status-failed' : 'status-captured';
      
      const statusText = item.status === 'disabled' ? 'Not Forwarded (Disabled)' : item.status;
      
      const time = new Date(item.timestamp).toLocaleTimeString();
      const domain = item.data?.domain || 'Unknown';
      
      notifDiv.innerHTML = `
        <div class="notification-title">${escapeHtml(item.data?.title || 'No Title')}</div>
        <div class="notification-message">${escapeHtml(item.data?.message || item.data?.body || '')}</div>
        <div class="notification-meta">
          <span>${domain} • ${time}</span>
          <span class="notification-status ${statusClass}">${statusText}</span>
        </div>
        ${item.error ? `<div style="color: red; font-size: 11px; margin-top: 5px;">Error: ${escapeHtml(item.error)}</div>` : ''}
      `;
      
      notificationList.appendChild(notifDiv);
    });
  }
  
  // Function to update stats
  async function updateStats() {
    const result = await chrome.storage.local.get(['stats']);
    const stats = result.stats || { captured: 0, forwarded: 0, failed: 0 };
    
    capturedCount.textContent = stats.captured || 0;
    forwardedCount.textContent = stats.forwarded || 0;
    failedCount.textContent = stats.failed || 0;
  }
  
  // Helper function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
  
  // Update status every 2 seconds
  setInterval(() => {
    updateStatus();
    loadNotificationHistory();
    updateStats();
  }, 2000);
  
  // Toggle enable state
  let isToggling = false; // Prevent recursive toggles
  enabledToggle.addEventListener('change', async () => {
    if (isToggling) return; // Prevent recursive calls
    
    // If enabling, check if required fields are filled
    if (enabledToggle.checked) {
      const serverUrl = serverUrlInput.value.trim();
      const authToken = authTokenInput.value.trim();
      
      if (!serverUrl) {
        alert('Please enter a WebSocket server URL first');
        isToggling = true;
        enabledToggle.checked = false;
        isToggling = false;
        return;
      }
      
      if (!authToken) {
        alert('Please enter an authentication token first');
        isToggling = true;
        enabledToggle.checked = false;
        isToggling = false;
        return;
      }
      
      // Validate WebSocket URL format
      if (!serverUrl.match(/^wss?:\/\/.+/)) {
        alert('Invalid WebSocket URL. It should start with ws:// or wss://');
        isToggling = true;
        enabledToggle.checked = false;
        isToggling = false;
        return;
      }
      
      // Save all configuration when enabling
      await chrome.storage.local.set({
        serverUrl: serverUrl,
        authToken: authToken,
        enabled: true
      });
      
      statusText.textContent = 'Forwarding enabled!';
      statusText.style.background = '#d4edda';
      statusText.style.color = '#155724';
    } else {
      // Just save the disabled state
      await chrome.storage.local.set({ enabled: false });
      statusText.textContent = 'Forwarding disabled';
      statusText.style.background = '#f5f5f5';
      statusText.style.color = '#666';
    }
    
    updateStatus();
  });
});
