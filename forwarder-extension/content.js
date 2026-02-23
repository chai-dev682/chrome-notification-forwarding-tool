// Content script to detect web notifications

console.log('Notification Forwarder: Content script loaded at', window.location.href);

// Log current notification permission
if (window.Notification) {
  console.log('Notification permission:', window.Notification.permission);
}

// Store the original Notification constructor
const OriginalNotification = window.Notification;

// Override the Notification constructor
if (OriginalNotification) {
  window.Notification = function(title, options = {}) {
    console.log('Notification constructor called:', title, options);
    
    // Create the original notification
    const notification = new OriginalNotification(title, options);
    
    // Forward notification data to background script
    const notificationData = {
      title: title,
      message: options.body || '',
      icon: options.icon || '',
      tag: options.tag || '',
      requireInteraction: options.requireInteraction || false,
      silent: options.silent || false,
      data: options.data || {},
      sourceUrl: window.location.href,
      domain: window.location.hostname,
      type: 'web-notification'
    };
    
    console.log('Sending notification to background:', notificationData);
    
    try {
      chrome.runtime.sendMessage({
        type: 'notification-detected',
        data: notificationData
      }).then(response => {
        console.log('Background response:', response);
      }).catch(error => {
        console.error('Failed to send notification to background:', error);
      });
    } catch (error) {
      console.error('Error sending message:', error);
    }
    
    console.log('Notification intercepted and forwarded:', title);
    return notification;
  };
  
  // Copy static properties and methods
  Object.setPrototypeOf(window.Notification, OriginalNotification);
  Object.setPrototypeOf(window.Notification.prototype, OriginalNotification.prototype);
  
  // Copy static properties
  Object.getOwnPropertyNames(OriginalNotification).forEach(prop => {
    if (prop !== 'length' && prop !== 'name' && prop !== 'prototype') {
      Object.defineProperty(window.Notification, prop, {
        value: OriginalNotification[prop],
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  });
}

// Also intercept the permission request
const originalRequestPermission = window.Notification?.requestPermission;
if (originalRequestPermission) {
  window.Notification.requestPermission = function() {
    console.log('Notification permission requested');
    return originalRequestPermission.apply(this, arguments);
  };
}

// Monitor for dynamically created notifications via other methods
// Listen for Push API notifications
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'push-notification') {
      chrome.runtime.sendMessage({
        type: 'notification-detected',
        data: {
          title: event.data.title || 'Push Notification',
          message: event.data.body || '',
          icon: event.data.icon || '',
          sourceUrl: window.location.href,
          domain: window.location.hostname,
          type: 'push-notification'
        }
      }).catch(error => {
        console.error('Failed to forward push notification:', error);
      });
    }
  });
}

// Inject a script to capture notifications created in the page context
const script = document.createElement('script');
script.textContent = `
  (function() {
    console.log('[Injected Script] Running notification interceptor');
    
    // Store original Notification
    const OriginalNotification = window.Notification;
    
    if (!OriginalNotification) {
      console.log('[Injected Script] No Notification API available');
      return;
    }
    
    console.log('[Injected Script] Original Notification found, overriding...');
    
    // Custom event to communicate with content script
    function sendNotificationEvent(data) {
      console.log('[Injected Script] Sending notification event:', data);
      window.dispatchEvent(new CustomEvent('notification-created', {
        detail: data
      }));
    }
    
    // Override Notification constructor in page context
    window.Notification = function(title, options = {}) {
      console.log('[Injected Script] Notification created:', title, options);
      sendNotificationEvent({
        title: title,
        body: options.body || '',
        icon: options.icon || '',
        tag: options.tag || '',
        requireInteraction: options.requireInteraction || false,
        silent: options.silent || false,
        data: options.data || {}
      });
      return new OriginalNotification(title, options);
    };
      
      // Copy properties
      Object.setPrototypeOf(window.Notification, OriginalNotification);
      Object.setPrototypeOf(window.Notification.prototype, OriginalNotification.prototype);
      
      // Copy static properties
      ['permission', 'maxActions'].forEach(prop => {
        if (prop in OriginalNotification) {
          Object.defineProperty(window.Notification, prop, {
            get: () => OriginalNotification[prop],
            configurable: true
          });
        }
      });
      
      // Copy static methods
      if (OriginalNotification.requestPermission) {
        window.Notification.requestPermission = OriginalNotification.requestPermission.bind(OriginalNotification);
      }
    }
  })();
`;
script.id = 'notification-interceptor';
(document.head || document.documentElement).appendChild(script);
script.remove();

// Listen for notification events from the injected script
window.addEventListener('notification-created', (event) => {
  console.log('Content script received notification event from injected script:', event.detail);
  
  const notificationData = {
    title: event.detail.title,
    message: event.detail.body,
    icon: event.detail.icon,
    tag: event.detail.tag,
    requireInteraction: event.detail.requireInteraction,
    silent: event.detail.silent,
    data: event.detail.data,
    sourceUrl: window.location.href,
    domain: window.location.hostname,
    type: 'web-notification-injected'
  };
  
  console.log('Forwarding injected notification to background:', notificationData);
  
  try {
    chrome.runtime.sendMessage({
      type: 'notification-detected',
      data: notificationData
    }).then(response => {
      console.log('Background response for injected notification:', response);
    }).catch(error => {
      console.error('Failed to forward notification from injected script:', error);
    });
  } catch (error) {
    console.error('Error sending injected notification message:', error);
  }
});
