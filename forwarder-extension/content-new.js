// Content script for Notification Forwarder Extension
console.log('[Notification Forwarder] Content script loaded at:', window.location.href);

// Mark that the extension is active
window.NOTIFICATION_FORWARDER_INJECTED = true;

// Function to inject the notification interceptor script
function injectScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = function() {
    console.log('[Notification Forwarder] Inject script loaded');
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

// Inject the script as soon as possible
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectScript);
} else {
  injectScript();
}

// Also inject immediately for early capture
injectScript();

// Listen for messages from the injected script
window.addEventListener('message', function(event) {
  // Only accept messages from the same window
  if (event.source !== window) return;
  
  // Check if it's our notification message
  if (event.data && event.data.type === 'NOTIFICATION_CREATED') {
    console.log('[Notification Forwarder] Received notification from page:', event.data.data);
    
    // Forward to background script
    chrome.runtime.sendMessage({
      type: 'notification-detected',
      data: {
        title: event.data.data.title,
        message: event.data.data.body,
        icon: event.data.data.icon,
        tag: event.data.data.tag,
        requireInteraction: event.data.data.requireInteraction,
        silent: event.data.data.silent,
        data: event.data.data.data,
        sourceUrl: window.location.href,
        domain: window.location.hostname,
        type: 'web-notification',
        timestamp: event.data.data.timestamp
      }
    }, function(response) {
      if (chrome.runtime.lastError) {
        console.error('[Notification Forwarder] Error sending to background:', chrome.runtime.lastError);
      } else {
        console.log('[Notification Forwarder] Background acknowledged:', response);
      }
    });
  }
});

// Also override Notification in the content script context
(function() {
  if (typeof Notification === 'undefined') return;
  
  const OriginalNotification = Notification;
  
  window.Notification = new Proxy(OriginalNotification, {
    construct(target, args) {
      const [title, options = {}] = args;
      
      console.log('[Notification Forwarder] Content script intercepted:', title);
      
      // Send to background
      chrome.runtime.sendMessage({
        type: 'notification-detected',
        data: {
          title: title,
          message: options.body || '',
          icon: options.icon || '',
          tag: options.tag || '',
          requireInteraction: options.requireInteraction || false,
          silent: options.silent || false,
          data: options.data || {},
          sourceUrl: window.location.href,
          domain: window.location.hostname,
          type: 'web-notification-content'
        }
      }).catch(err => {
        console.error('[Notification Forwarder] Failed to send:', err);
      });
      
      return new target(title, options);
    },
    
    get(target, prop) {
      return target[prop];
    }
  });
})();

console.log('[Notification Forwarder] Content script setup complete');
