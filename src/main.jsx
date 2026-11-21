import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Offline support: in production builds a service worker caches the app shell,
// so FloSchmo keeps working without a network connection once it has loaded.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./sw.js');
      const reg = await navigator.serviceWorker.ready;
      // Hand the worker everything this page already loaded, so the very first
      // visit is enough to make the app available offline.
      const urls = [
        location.href,
        ...performance.getEntriesByType('resource')
          .map(e => e.name)
          .filter(u => u.startsWith(location.origin)),
      ];
      reg.active?.postMessage({ type: 'CACHE_URLS', urls });
    } catch (err) {
      console.warn('Offline support unavailable:', err);
    }
  });
}
