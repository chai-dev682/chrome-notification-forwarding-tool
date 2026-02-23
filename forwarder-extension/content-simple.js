// Simple content script that directly intercepts notifications
// ALWAYS ACTIVE - Automatically captures all notifications
console.log('[Notification Forwarder] ACTIVE - Auto-capturing notifications at:', window.location.href);

// Inject the interceptor script immediately
(function() {
  // Method 1: Try external script injection (CSP-safe)
  function injectExternalScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = () => {
      console.log('[Notification Forwarder] External inject.js loaded successfully');
      script.remove();
      // Mark as active
      window.NOTIFICATION_FORWARDER_ACTIVE = true;
    };
    script.onerror = (e) => {
      console.error('[Notification Forwarder] Failed to load inject.js, trying inline fallback:', e);
      // Fallback to inline injection
      injectInlineScript();
    };
    (document.head || document.documentElement).appendChild(script);
  }
  
  // Method 2: Fallback inline injection (for local files or if external fails)
  function injectInlineScript() {
    console.log('[Notification Forwarder] Using inline injection fallback');
    const script = document.createElement('script');
    script.textContent = `
    (function() {
      console.log('[Notification Forwarder Injected] Initializing notification interceptor...');
      
      // Check if Notification API exists
      if (typeof window.Notification === 'undefined') {
        console.log('[Notification Forwarder Injected] No Notification API available');
        return;
      }
      
      // Store the original Notification constructor
      const OriginalNotification = window.Notification;
      const originalRequestPermission = window.Notification.requestPermission;
      
      console.log('[Notification Forwarder Injected] Original Notification stored');
      
      // Create a proper constructor wrapper
      class NotificationWrapper {
        constructor(title, options = {}) {
          console.log('[Notification Forwarder Injected] Notification created:', title, options);
          
          // Send message to content script
          window.postMessage({
            type: 'NOTIFICATION_INTERCEPTED',
            data: {
              title: title,
              body: options.body || '',
              icon: options.icon || '',
              tag: options.tag || '',
              requireInteraction: options.requireInteraction || false,
              silent: options.silent || false,
              data: options.data || {},
              timestamp: Date.now()
            }
          }, '*');
          
          // Create the actual notification
          const notification = new OriginalNotification(title, options);
          
          // Copy properties and methods to make it behave like the original
          Object.setPrototypeOf(this, notification);
          return notification;
        }
        
        // Static methods
        static get permission() {
          return OriginalNotification.permission;
        }
        
        static requestPermission(callback) {
          return OriginalNotification.requestPermission(callback);
        }
        
        static get maxActions() {
          return OriginalNotification.maxActions;
        }
      }
      
      // Replace the global Notification
      window.Notification = NotificationWrapper;
      
      // Mark that injection is complete
      window.NOTIFICATION_FORWARDER_ACTIVE = true;
      
      console.log('[Notification Forwarder Injected] Notification API interceptor installed');
    })();
  `;
    
    // Inject as early as possible
    const target = document.head || document.documentElement || document.body;
    if (target) {
      target.appendChild(script);
      script.remove();
      console.log('[Notification Forwarder] Script injected into:', target.nodeName);
      return true;
    }
    return false;
  }
  
  // Try external script injection first (CSP-safe)
  try {
    injectExternalScript();
  } catch (e) {
    console.error('[Notification Forwarder] External injection failed:', e);
    // Fallback to inline injection
    injectInlineScript();
  }
})();

// Listen for messages from the injected script
window.addEventListener('message', function(event) {
  // Only accept messages from the same window
  if (event.source !== window) return;
  
  // Check if it's our notification message (handle both message types)
  if (event.data && (event.data.type === 'NOTIFICATION_INTERCEPTED' || event.data.type === 'NOTIFICATION_CREATED')) {
    console.log('[Notification Forwarder] Captured notification:', event.data.data);
    
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

// Also try to override in content script context (as backup)
if (typeof Notification !== 'undefined') {
  const OriginalNotification = Notification;
  
  try {
    window.Notification = new Proxy(OriginalNotification, {
      construct(target, args) {
        const [title, options = {}] = args;
        
        console.log('[Notification Forwarder Content] Proxy intercepted:', title);
        
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
            type: 'web-notification-proxy'
          }
        }).catch(err => {
          console.error('[Notification Forwarder Content] Failed to send:', err);
        });
        
        return new target(title, options);
      },
      
      get(target, prop) {
        return target[prop];
      }
    });
    
    console.log('[Notification Forwarder] Proxy installed in content script');
  } catch (e) {
    console.log('[Notification Forwarder] Could not install Proxy in content script:', e.message);
  }
}

console.log('[Notification Forwarder] Content script setup complete');
