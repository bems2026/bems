import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root element not found');

createRoot(container).render(
  <StrictMode>
    {/* Outermost catch. Without it, any render-time throw unmounts the whole tree and
        leaves the office kiosk on a blank white screen with no way back. */}
    <ErrorBoundary scope="The dashboard">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
