import { NavLink, Link, Outlet } from 'react-router-dom';
import { UsageGuideDialog } from './UsageGuideDialog';
import { AiSourceImportDialog } from './AiSourceImportDialog';
import { CollectProgressDialog } from './CollectProgressDialog';
import { BackgroundLayer } from './BackgroundLayer';
import { PlayerHost } from './player/PlayerHost';
import { useImportDialogStore } from '../themes/importDialogStore';
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
import { getVersion } from '@tauri-apps/api/app';
import { useAppStore } from '../useAppStore';

const navItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/movie', label: '电影', icon: Film },
  { to: '/tv', label: '电视剧', icon: Tv },
  { to: '/variety', label: '综艺', icon: Music },
  { to: '/anime', label: '动漫', icon: BookOpen },
  { to: '/documentary', label: '纪录片', icon: Camera },
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
  const [appVersion, setAppVersion] = useState('1.0.93');
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [showUsageGuide, setShowUsageGuide] = useState(false);
  const aiImportOpen = useImportDialogStore((s) => s.aiImportOpen);
  const closeAiImport = useImportDialogStore((s) => s.closeAiImport);
  const { loadVideoSources, videoSources } = useAppStore();

  const USAGE_GUIDE_KEY = 'movie_app_usage_guide_seen';

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    loadVideoSources().then(() => setSourcesLoaded(true));
  }, []);

  useEffect(() => {
    if (!sourcesLoaded) return;
    const guideSeen = localStorage.getItem(USAGE_GUIDE_KEY);
    if (guideSeen) return;

    if (videoSources.length === 0) {
      useImportDialogStore.getState().openAiImport();
    } else {
      setShowUsageGuide(true);
    }
  }, [sourcesLoaded, videoSources.length]);

  const handleImportClosed = (open: boolean) => {
    if (!open) {
      closeAiImport();
      loadVideoSources();
      const guideSeen = localStorage.getItem(USAGE_GUIDE_KEY);
      if (!guideSeen) {
        setTimeout(() => setShowUsageGuide(true), 300);
      }
    }
  };

  return (
    <ToastProvider>
      <BackgroundLayer />
      <UsageGuideDialog
        open={showUsageGuide}
        onOpenChange={(v) => {
          if (!v) {
            localStorage.setItem(USAGE_GUIDE_KEY, '1');
          }
          setShowUsageGuide(v);
        }}
      />
      <AiSourceImportDialog
        open={aiImportOpen}
        onOpenChange={handleImportClosed}
      />
      <CollectProgressDialog />
      <PlayerHost />
      <div className="flex h-full">
        <aside className="w-56 shrink-0 flex flex-col bg-[var(--color-sidebar-alpha)] backdrop-blur-md">
          <div className="flex items-center gap-2 px-5 h-14">
            <Film className="size-5 text-muted-foreground" />
            <span className="font-semibold tracking-tight text-lg">Movie App</span>
          </div>
          <nav className="flex-1 py-3">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => cn(
                  'flex items-center gap-3 px-5 py-2.5 text-sm transition-all duration-200',
                  isActive
                    ? 'bg-muted-foreground/20 text-text'
                    : 'text-text-secondary hover:text-text hover:bg-hover'
                )}
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="px-5 py-3 text-xs text-muted-foreground">
            版本 {appVersion}
          </div>
        </aside>

        <div className="flex-1 flex flex-col overflow-hidden">
          <main id="main-content" className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
          <footer className="shrink-0 px-6 py-3 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link to="/help" className="hover:text-text transition-colors">帮助中心</Link>
                <span className="text-muted-foreground">|</span>
                <span>关于我们</span>
                <span className="text-muted-foreground">|</span>
                <span>版权声明</span>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </ToastProvider>
  );
}