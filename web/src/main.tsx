import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import './styles/game.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root topilmadi.');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
