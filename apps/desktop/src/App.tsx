import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { initApp } from './init';
import { Layout } from './components/Layout';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import DetailPage from './pages/DetailPage';
import PlayPage from './pages/PlayPage';
import FavoritesPage from './pages/FavoritesPage';
import HistoryPage from './pages/HistoryPage';
import SourceManagerPage from './pages/SourceManagerPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initApp()
      .then(() => setReady(true))
      .catch((err) => {
        console.error('初始化失败:', err);
        setError(err?.message || String(err));
        setReady(true);
      });
  }, []);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        正在加载...
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
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/media/:id" element={<DetailPage />} />
          <Route path="/play/:episodeId" element={<PlayPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/sources" element={<SourceManagerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
