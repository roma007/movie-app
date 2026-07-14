import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { initApp, testCollect } from './init';
import { Layout } from './components/Layout';
import { AnnouncementDialog } from './components/AnnouncementDialog';
import { ContextMenu } from './components/ContextMenu';
import { ThemeProvider } from './themes/ThemeProvider';
import { FontSizeProvider } from './themes/FontSizeProvider';
import { ConfirmProvider } from './components/ConfirmProvider';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import DetailPage from './pages/DetailPage';
import PlayPage from './pages/PlayPage';
import FavoritesPage from './pages/FavoritesPage';
import HistoryPage from './pages/HistoryPage';
import SourceManagerPage from './pages/SourceManagerPage';
import TaskListPage from './pages/TaskListPage';
import SettingsPage from './pages/SettingsPage';
import CollectConfigPage from './pages/CollectConfigPage';
import CollectGuidePage from './pages/CollectGuidePage';
import VideoManagementPage from './pages/VideoManagementPage';
import TestCollectPage from './pages/TestCollectPage';
import HelpCenterPage from './pages/HelpCenterPage';

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState('开始初始化...');

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (!ready) {
        console.error(`初始化超时，当前步骤: ${loadingStep}`);
        setError(`初始化超时，当前步骤: ${loadingStep}`);
        setReady(true);
      }
    }, 60000);

    initApp((step) => {
        setLoadingStep(step);
      })
      .then(() => {
        console.log('初始化成功');
        setReady(true);
      })
      .catch((err) => {
        console.error('初始化失败:', err);
        setError(err?.message || String(err));
        setReady(true);
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });

    const logInterval = setInterval(() => {
      if (!ready) {
        console.log(`[APP] 等待初始化完成，当前步骤: ${loadingStep}`);
      } else {
        clearInterval(logInterval);
      }
    }, 2000);

    return () => {
      clearInterval(logInterval);
    };
  }, [ready, loadingStep]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="text-lg">正在加载...</div>
          <div className="text-sm mt-2 opacity-60">{loadingStep}</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-2">
        <div className="text-destructive">初始化失败</div>
        <div className="text-muted-foreground text-sm">{error}</div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <FontSizeProvider>
        <ConfirmProvider>
          <BrowserRouter>
            <AnnouncementDialog />
            <ContextMenu />
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/media/:id" element={<DetailPage />} />
                <Route path="/play/:episodeId" element={<PlayPage />} />
                <Route path="/favorites" element={<FavoritesPage />} />
                <Route path="/history" element={<HistoryPage />} />
                <Route path="/sources" element={<SourceManagerPage />} />
                <Route path="/tasks" element={<TaskListPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/settings/collect" element={<CollectConfigPage />} />
                <Route path="/settings/guide" element={<CollectGuidePage />} />
                <Route path="/settings/video" element={<VideoManagementPage />} />
                <Route path="/test-collect" element={<TestCollectPage />} />
                <Route path="/help" element={<HelpCenterPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ConfirmProvider>
      </FontSizeProvider>
    </ThemeProvider>
  );
}