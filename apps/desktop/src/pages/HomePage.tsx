import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Media } from '@movie-app/core';
import { useAppStore, getProvider } from '../useAppStore';
import { MediaGrid, MediaCard } from '@/components/MediaCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Heart, Clock, ChevronRight as ChevronRightIcon } from 'lucide-react';

export default function HomePage() {
  const { mediaList, isLoading, searchMedia, favorites, watchHistory, loadFavorites, loadWatchHistory } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [mediaMap, setMediaMap] = useState<Record<string, Media | null>>({});
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);

  useEffect(() => {
    const state = location.state as { searchKeyword?: string } | undefined;
    if (state?.searchKeyword) {
      const kw = state.searchKeyword.trim();
      if (kw) {
        setSearchKeyword(kw);
        setIsSearching(true);
        searchMedia(kw).catch(() => {});
        window.history.replaceState({}, document.title);
      }
    }
  }, []);

  useEffect(() => {
    loadFavorites();
    loadWatchHistory();
  }, []);

  useEffect(() => {
    (async () => {
      const provider = getProvider();
      const ids = [...new Set([...favorites.map((f) => f.mediaId), ...watchHistory.map((h) => h.mediaId)])];
      if (ids.length === 0) { setMediaMap({}); return; }
      const entries = await Promise.all(
        ids.map(async (id) => [id, await provider.getMediaById(id)] as const)
      );
      setMediaMap(Object.fromEntries(entries));
    })();
  }, [favorites, watchHistory]);

  const handleSearch = async () => {
    const kw = searchKeyword.trim();
    if (!kw) return;
    setIsSearching(true);
    setIsSearchLoading(true);
    try {
      await searchMedia(kw);
    } finally {
      setIsSearchLoading(false);
    }
  };

  const handleClearSearch = () => {
    setSearchKeyword('');
    setIsSearching(false);
    setIsSearchLoading(false);
  };

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 bg-background -mx-6 px-6 pb-4 border-b border-border">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">首页</h1>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="搜索电影、电视剧、综艺..."
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1 bg-card border-border"
        />
        {isSearching ? (
          <Button variant="outline" onClick={handleClearSearch} className="bg-secondary">清除搜索</Button>
        ) : (
          <Button onClick={handleSearch} className="bg-primary hover:bg-primary-hover"><Search className="size-4" />搜索</Button>
        )}
      </div>

      {isSearching ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">搜索结果："{searchKeyword}"</h2>
          </div>
          {isSearchLoading ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">搜索中...</div>
          ) : mediaList.length > 0 ? (
            <MediaGrid items={mediaList} />
          ) : (
            <div className="text-center text-muted-foreground py-8">未找到相关内容</div>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-primary" />
                <span className="font-medium">观看历史</span>
                <span className="text-xs text-muted-foreground">({watchHistory.length})</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/history')} className="text-primary">
                更多 <ChevronRightIcon className="size-3" />
              </Button>
            </div>
            {watchHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">暂无观看历史</p>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {watchHistory.slice(0, 10).map((history, idx) => {
                  const media = mediaMap[history.mediaId];
                  if (!media) return null;
                  return (
                    <div key={`${history.mediaId}-${idx}`} className="shrink-0 w-24">
                      <MediaCard media={media} navigateState={{}} onBeforeNavigate={() => {}} size="small" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Heart className="size-4 text-favorite" />
                <span className="font-medium">我的收藏</span>
                <span className="text-xs text-muted-foreground">({favorites.length})</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/favorites')} className="text-primary">
                更多 <ChevronRightIcon className="size-3" />
              </Button>
            </div>
            {favorites.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">暂无收藏</p>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {favorites.slice(0, 10).map((fav) => {
                  const media = mediaMap[fav.mediaId];
                  if (!media) return null;
                  return (
                    <div key={fav.mediaId} className="shrink-0 w-24">
                      <MediaCard media={media} navigateState={{}} onBeforeNavigate={() => {}} size="small" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
