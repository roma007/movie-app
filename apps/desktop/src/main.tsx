import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import App from './App';
import './index.css';
import './vidstack.css';

import '@tauri-apps/plugin-sql';

async function logToFile(msg: string) {
  try {
    await invoke('log_line', { msg });
  } catch {
    // 日志落盘失败不影响主流程
  }
}

function captureWebviewErrors() {
  let last = '';
  const log = (msg: string) => {
    if (msg === last) return;
    last = msg;
    void logToFile(msg);
  };

  window.addEventListener('error', (e) => {
    log(`[error] ${e.message} @ ${e.filename}:${e.lineno}`);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason =
      e.reason instanceof Error ? `${e.reason.message} (${e.reason.stack ?? ''})` : String(e.reason);
    log(`[unhandledrejection] ${reason}`);
  });

  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    try {
      const text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      if (/hls/i.test(text) || text.startsWith('[VideoPlayer]')) {
        log(`[warn] ${text.slice(0, 2000)}`);
      }
    } catch {
      // ignore
    }
  };

  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    origError(...args);
    try {
      const text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      if (text.startsWith('[VideoPlayer]') || text.startsWith('[Prefetch]') || text.startsWith('[TauriLoader]')) {
        log(text.slice(0, 2000));
      }
    } catch {
      // ignore
    }
  };
}

captureWebviewErrors();

createRoot(document.getElementById('root')!).render(<App />);
