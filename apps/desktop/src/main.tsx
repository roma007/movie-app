import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './vidstack.css';

import '@tauri-apps/plugin-sql';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
