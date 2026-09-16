import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { initApp, testCollect } from './init';
import { Layout } from './components/Layout';
import { PipWindow } from './pip/PipWindow';
import { SplashOverlay } from './components/SplashOverlay';

import { ContextMenu } from './components/ContextMenu';
import { ThemeProvider } from './themes/ThemeProvider';
import { FontSizeProvider } from './themes/FontSizeProvider';
import { ConfirmProvider } from './components/ConfirmProvider';
import HomePage from './pages/HomePage';
import MoviePage from './pages/MoviePage';
import TVPage from './pages/TVPage';
import VarietyPage from './pages/VarietyPage';
import AnimePage from './pages/AnimePage';
import DocumentaryPage from './pages/DocumentaryPage';
import SearchPage from './pages/SearchPage';
import SubtypePage from './pages/SubtypePage';
import PlayPage from './pages/PlayPage';
import FavoritesPage from './pages/FavoritesPage';
import HistoryPage from './pages/HistoryPage';
import SourceManagerPage from './pages/SourceManagerPage';
import TaskListPage from './pages/TaskListPage';
import SettingsPage from './pages/SettingsPage';
import CollectConfigPage from './pages/CollectConfigPage';
import CollectGuidePage from './pages/CollectGuidePage';
import AppearanceSettingsPage from './pages/AppearanceSettingsPage';
import UsagePreferencesPage from './pages/UsagePreferencesPage';
import RecommendationSettingsPage from './pages/RecommendationSettingsPage';
import KidLockPage from './pages/KidLockPage';
import VideoManagementPage from './pages/VideoManagementPage';
import TestCollectPage from './pages/TestCollectPage';
import HelpCenterPage from './pages/HelpCenterPage';

export default function App() {
  const isPip =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('view') === 'pip';
  if (isPip) return <PipWindow />;
  return <MainApp />;
}

function MainApp() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (!ready) {
        console.error('初始化超时');
        setError('初始化超时');
        setReady(true);
      }
    }, 120000);

    // 静默初始化：不再显示「正在加载/数据库步骤」文字，由欢迎页覆盖层承接
    initApp()
      .then(() => {
        clearTimeout(timeoutId);
        console.log('初始化成功');
        setReady(true);
        setError(null);
      })
      .catch((err) => {
        console.error('初始化失败:', err);
        setError(err?.message || String(err));
        setReady(true);
      });

    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-2">
        <div className="text-destructive">初始化失败</div>
        <div className="text-muted-foreground text-sm">{error}</div>
      </div>
    );
  }

  return (
    <>
      <div className="h-full">
        {ready && (
          <ThemeProvider>
            <FontSizeProvider>
              <ConfirmProvider>
                <BrowserRouter>
                  <ContextMenu />
                  <Routes>
                    <Route element={<Layout />}>
                      <Route path="/" element={<HomePage />} />
                      <Route path="/movie" element={<MoviePage />} />
                      <Route path="/tv" element={<TVPage />} />
                      <Route path="/variety" element={<VarietyPage />} />
                      <Route path="/anime" element={<AnimePage />} />
                      <Route path="/documentary" element={<DocumentaryPage />} />
                      <Route path="/search" element={<SearchPage />} />
                      <Route path="/subtype/:type/:subType" element={<SubtypePage />} />
                      <Route path="/play/:episodeId" element={<PlayPage />} />
                      <Route path="/favorites" element={<FavoritesPage />} />
                      <Route path="/history" element={<HistoryPage />} />
                      <Route path="/sources" element={<SourceManagerPage />} />
                      <Route path="/tasks" element={<TaskListPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/settings/appearance" element={<AppearanceSettingsPage />} />
                      <Route path="/settings/preferences" element={<UsagePreferencesPage />} />
                      <Route path="/settings/recommendation" element={<RecommendationSettingsPage />} />
                      <Route path="/settings/kids" element={<KidLockPage />} />
                      <Route path="/settings/collect" element={<CollectConfigPage />} />
                      <Route path="/help/guide" element={<CollectGuidePage />} />
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
        )}
      </div>
      <SplashOverlay ready={ready} />
    </>
  );
}