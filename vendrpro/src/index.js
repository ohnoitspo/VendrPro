import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Capture before registration — if there's already a controller this is an update, not first install
    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Ignore first-install takeover (no previous controller)
      if (!hadController || refreshing) return;
      refreshing = true;
      localStorage.setItem('app_updated', '1');
      window.location.reload();
    });

    navigator.serviceWorker.register('/sw.js').then(reg => {
      // Force an update check on every page load (browser default is 24 h)
      reg.update().catch(() => {});
    }).catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
