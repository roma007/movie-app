import { NavLink, Outlet } from 'react-router-dom';
import {
  Home,
  Settings,
  Film,
  Tv,
  Music,
  BookOpen,
  Camera,
  X,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect, createContext, useContext, useCallback, type ReactNode } from 'react';

const navItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/?type=MOVIE', label: '电影', icon: Film },
  { to: '/?type=TV', label: '电视剧', icon: Tv },
  { to: '/?type=VARIETY', label: '综艺', icon: Music },
  { to: '/?type=ANIME', label: '动漫', icon: BookOpen },
  { to: '/?type=DOCUMENTARY', label: '纪录片', icon: Camera },
  { to: '/settings', label: '设置', icon: Settings },
];

interface ToastMessage {
  message: string;
  type: 'success' | 'error';
}

type ToastFn = (message: string, type?: 'success' | 'error') => void;

const ToastContext = createContext<ToastFn | null>(null);

export function useToast(): ToastFn {
  const fn = useContext(ToastContext);
  if (!fn) {
    return (message, type) => console.log(`[${type}] ${message}`);
  }
  return fn;
}

function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const showToast = useCallback<ToastFn>((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[100] flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg ${
            toast.type === 'success'
              ? 'bg-green-500 text-white'
              : 'bg-red-500 text-white'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle className="size-4" />
          ) : (
            <AlertCircle className="size-4" />
          )}
          <span className="text-sm">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 hover:opacity-70 transition-opacity"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function Layout() {
  return (
    <ToastProvider>
      <div className="flex h-full">
        <aside className="w-56 shrink-0 flex flex-col border-r border-border bg-sidebar">
          <div className="flex items-center gap-2 px-5 h-14 border-b border-border">
            <Film className="size-5 text-primary" />
            <span className="font-semibold tracking-tight text-lg">Movie App</span>
          </div>
          <nav className="flex-1 py-3">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive, isPending }) => {
                  if (isPending) return cn('flex items-center gap-3 px-5 py-2.5 text-sm transition-all duration-200 text-muted-foreground hover:text-foreground hover:bg-hover border-l-2 border-transparent');
                  const isExactMatch = window.location.pathname + window.location.search === to;
                  return cn(
                    'flex items-center gap-3 px-5 py-2.5 text-sm transition-all duration-200',
                    isExactMatch
                      ? 'bg-primary-light text-primary border-l-2 border-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-hover border-l-2 border-transparent'
                  );
                }}
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="px-5 py-3 text-xs text-muted-foreground border-t border-border">
            版本 1.0.0
          </div>
        </aside>

        <div className="flex-1 flex flex-col overflow-hidden">
          <main id="main-content" className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
          <footer className="shrink-0 border-t border-border px-6 py-3 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <a href="https://www.mdzyapi.com/caiji/" target="_blank" className="hover:text-foreground transition-colors">帮助中心</a>
                <span className="text-border">|</span>
                <span>关于我们</span>
                <span className="text-border">|</span>
                <span>版权声明</span>
              </div>
              <div>Copyright ©2020-2026 All Rights Reserved moduzy.vip</div>
            </div>
          </footer>
        </div>
      </div>
    </ToastProvider>
  );
}