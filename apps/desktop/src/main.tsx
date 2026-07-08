import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// 确保 tauri-plugin-sql 被打包（即便不直接调用，也会触发 plugin 初始化注册）
import '@tauri-apps/plugin-sql';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
