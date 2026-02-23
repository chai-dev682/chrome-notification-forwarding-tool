// This script runs in the page context to intercept notifications
(function() {
  'use strict';
  
  console.log('[Notification Forwarder] Injecting notification interceptor');
  
  // Check if Notification API exists
  if (typeof window.Notification === 'undefined') {
    console.log('[Notification Forwarder] No Notification API available');
    return;
  }
  
  // Store the original Notification constructor
  const OriginalNotification = window.Notification;
  const originalRequestPermission = window.Notification.requestPermission;
  
  // Create a new Notification constructor
  const NotificationProxy = new Proxy(OriginalNotification, {
    construct(target, args) {
      const [title, options = {}] = args;
      
      console.log('[Notification Forwarder] Notification created:', title, options);
      
      // Send the notification data to the content script
      window.postMessage({
        type: 'NOTIFICATION_CREATED',
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
      return new target(title, options);
    },
    
    get(target, prop) {
      if (prop === 'permission') {
        return target.permission;
      }
      if (prop === 'requestPermission') {
        return function(...args) {
          console.log('[Notification Forwarder] Permission requested');
          return originalRequestPermission.apply(target, args);
        };
      }
      if (prop === 'maxActions') {
        return target.maxActions;
      }
      return target[prop];
    }
  });
  
  // Replace the global Notification with our proxy
  window.Notification = NotificationProxy;
  
  // Mark that the forwarder is active
  window.NOTIFICATION_FORWARDER_ACTIVE = true;
  
  // Also intercept ServiceWorker notifications if available
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    console.log('[Notification Forwarder] ServiceWorker detected, setting up listener');
    
    navigator.serviceWorker.addEventListener('message', function(event) {
      if (event.data && event.data.type === 'notification') {
        console.log('[Notification Forwarder] ServiceWorker notification:', event.data);
        
        window.postMessage({
          type: 'NOTIFICATION_CREATED',
          data: {
            title: event.data.title || 'ServiceWorker Notification',
            body: event.data.body || '',
            icon: event.data.icon || '',
            tag: event.data.tag || '',
            requireInteraction: event.data.requireInteraction || false,
            silent: event.data.silent || false,
            data: event.data.data || {},
            timestamp: Date.now(),
            source: 'serviceworker'
          }
        }, '*');
      }
    });
  }
  
  console.log('[Notification Forwarder] Injection complete');
})();
