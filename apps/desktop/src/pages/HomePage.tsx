import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Media, UserUsageType } from '@movie-app/core';
import { useAppStore, getProvider } from '../useAppStore';
import { MediaGrid, MediaCard } from '@/components/MediaCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Search, X, Heart, Clock, ChevronRight as ChevronRightIcon, Film, Tv, Sparkles, Download, Plus, Database, Loader2 } from 'lucide-react';
import { CollectProgressDialog } from '@/components/CollectProgressDialog';
import { useToast } from '@/components/Layout';

const USAGE_LABELS: Record<UserUsageType, string> = {
  SEARCH_FIRST: '搜索优先',
  NEW_MOVIES: '新片追逐',
  TV_SERIES: '追剧/综艺',
};

export default function HomePage() {
  const {
    mediaList, searchMedia, favorites, watchHistory,
    loadFavorites, loadWatchHistory,
    userUsageTypes, loadUserUsageTypes,
    collectLatest, searchKeywordPreview, previewResults, previewLoading,
    saveSelectedPreviewItems, clearPreviewResults, isLoading, collectSourceProgress,
  } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [mediaMap, setMediaMap] = useState<Record<string, Media | null>>({});
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);

  const [quickKeyword, setQuickKeyword] = useState('');
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(new Set());
  const [relaxBlacklist, setRelaxBlacklist] = useState(false);
  const [relaxYear, setRelaxYear] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasQuickSearched, setHasQuickSearched] = useState(false);
  const [quickCollectCount, setQuickCollectCount] = useState(0);
  const [latestMedia, setLatestMedia] = useState<Media[]>([]);

  const provider = getProvider();

  useEffect(() => {
    loadUserUsageTypes();
  }, []);

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

  useEffect(() => {
    if (userUsageTypes.includes('NEW_MOVIES')) {
      provider.listMedia({ type: 'MOVIE', page: 1, pageSize: 5, sort: 'latest' })
        .then((r) => setLatestMedia(r.items))
        .catch(() => {});
    }
  }, [userUsageTypes, provider]);

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

  const getOverrides = useCallback(() => {
    const overrides: { ignoreBlacklist?: boolean; unlimitedYear?: boolean } = {};
    if (relaxBlacklist) overrides.ignoreBlacklist = true;
    if (relaxYear) overrides.unlimitedYear = true;
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }, [relaxBlacklist, relaxYear]);

  const handleQuickPreview = useCallback(async () => {
    const kw = quickKeyword.trim();
    if (!kw) return;
    setHasQuickSearched(true);
    setQuickCollectCount(0);
    setSelectedPreviewIds(new Set());
    clearPreviewResults();
    await searchKeywordPreview(kw, getOverrides());
  }, [quickKeyword, searchKeywordPreview, clearPreviewResults, getOverrides]);

  const handleQuickCollect = useCallback(async () => {
    if (selectedPreviewIds.size === 0) {
      toast('请至少勾选一个视频', 'error');
      return;
    }
    setIsSaving(true);
    const items = previewResults.filter((p) => selectedPreviewIds.has(p.fingerprint));
    const count = await saveSelectedPreviewItems(items, getOverrides());
    setIsSaving(false);
    if (count > 0) {
      toast(`成功采集 ${count} 部视频`);
      setQuickCollectCount(count);
      clearPreviewResults();
      setQuickKeyword('');
      setRelaxBlacklist(false);
      setRelaxYear(false);
    } else {
      toast('采集失败，请重试', 'error');
    }
  }, [previewResults, selectedPreviewIds, saveSelectedPreviewItems, clearPreviewResults, toast, getOverrides]);

  const handleCollectLatest = useCallback(async () => {
    toast('开始增量采集...');
    await collectLatest();
    toast('增量采集完成');
    if (userUsageTypes.includes('NEW_MOVIES')) {
      provider.listMedia({ type: 'MOVIE', page: 1, pageSize: 5, sort: 'latest' })
        .then((r) => setLatestMedia(r.items))
        .catch(() => {});
    }
  }, [collectLatest, provider, toast, userUsageTypes]);

  const togglePreviewItem = (fingerprint: string) => {
    setSelectedPreviewIds((prev) => {
      const next = new Set(prev);
      if (next.has(fingerprint)) next.delete(fingerprint);
      else next.add(fingerprint);
      return next;
    });
  };

  const renderSearchFirstCard = () => (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="size-5 text-primary" />
        <span className="font-medium text-lg">快速搜索采集</span>
      </div>
      <p className="text-sm text-muted-foreground mb-3">输入关键词搜索并一键采集你想看的视频</p>
      <div className="flex gap-2 mb-3">
        <Input
          placeholder="输入电影/电视剧名称..."
          value={quickKeyword}
          onChange={(e) => setQuickKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleQuickPreview()}
          className="flex-1 bg-background border-border"
        />
        <Button onClick={handleQuickPreview} disabled={previewLoading} variant="default">
          <Search className="size-4 mr-1" />搜索采集
        </Button>
      </div>
      {previewLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="size-4 animate-spin" />
          <span>正在搜索...</span>
        </div>
      )}
      {hasQuickSearched && !previewLoading && quickCollectCount > 0 && (
        <div className="flex items-center gap-2 text-green-500 bg-green-500/10 rounded-lg px-4 py-3 mb-3">
          <span className="text-lg">✓</span>
          <span className="text-sm font-medium">成功采集 {quickCollectCount} 部视频</span>
        </div>
      )}
      {hasQuickSearched && !previewLoading && quickCollectCount === 0 && previewResults.length === 0 && (
        <div className="text-center text-muted-foreground py-6 space-y-2">
          <p>未找到相关视频</p>
          <p className="text-xs">请尝试更改关键词或放宽搜索条件</p>
        </div>
      )}
      {hasQuickSearched && !previewLoading && quickCollectCount === 0 && previewResults.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-y-auto border border-border rounded-lg p-2">
          {previewResults.map((item) => (
            <label
              key={item.fingerprint}
              className="flex items-center gap-3 p-2 rounded hover:bg-secondary/50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedPreviewIds.has(item.fingerprint)}
                onChange={() => togglePreviewItem(item.fingerprint)}
                className="accent-primary"
              />
              {item.posterUrl && (
                <img src={item.posterUrl} alt="" className="size-10 object-cover rounded" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.title}</div>
                <div className="text-xs text-muted-foreground">{item.year} · {item.type} · {item.sourceName}</div>
              </div>
            </label>
          ))}
        </div>
      )}
      {hasQuickSearched && !previewLoading && quickCollectCount === 0 && previewResults.length > 0 && (
        <>
          <Separator className="my-3" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">放宽搜索条件</span>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Switch checked={relaxBlacklist} onCheckedChange={setRelaxBlacklist} />
                忽略黑名单
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Switch checked={relaxYear} onCheckedChange={setRelaxYear} />
                不限年份
              </label>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              已选 {selectedPreviewIds.size} / 共 {previewResults.length} 个
            </span>
            <Button size="sm" onClick={handleQuickCollect} disabled={isSaving} variant="default">
              {isSaving ? <><Loader2 className="size-3 mr-1 animate-spin" /> 保存中...</> : <><Plus className="size-3 mr-1" />一键采集</>}
            </Button>
          </div>
        </>
      )}
    </div>
  );

  const renderNewMoviesCard = () => (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Film className="size-5 text-primary" />
          <span className="font-medium text-lg">新片增量采集</span>
        </div>
        <Button onClick={handleCollectLatest} disabled={isLoading} variant="default">
          <Download className="size-4 mr-1" />
          {isLoading ? '采集中...' : '开始增量采集'}
        </Button>
      </div>
      <div className="bg-secondary/30 rounded-lg p-4 mb-4">
        <p className="text-sm text-muted-foreground">一键从所有视频源采集最新内容</p>
      </div>
      {latestMedia.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">最新入库</span>
            <Button variant="ghost" size="sm" onClick={() => navigate('/movie')} className="text-primary text-xs">
              更多 <ChevronRightIcon className="size-3" />
            </Button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {latestMedia.map((m) => (
              <div key={m.id} className="shrink-0 w-24">
                <MediaCard media={m} navigateState={{}} onBeforeNavigate={() => {}} size="small" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );

  const renderTvSeriesCard = () => {
    const tvWatchHistory = watchHistory.filter((h) => {
      const media = mediaMap[h.mediaId];
      return media && (media.type === 'TV' || media.type === 'VARIETY');
    });

    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Tv className="size-5 text-primary" />
            <span className="font-medium text-lg">我的追剧</span>
          </div>
          <Button onClick={handleCollectLatest} disabled={isLoading} variant="default">
            <Download className="size-4 mr-1" />
            {isLoading ? '采集中...' : '增量采集新剧集'}
          </Button>
        </div>
        {tvWatchHistory.length === 0 ? (
          <div className="bg-secondary/30 rounded-lg p-4 text-center">
            <p className="text-sm text-muted-foreground">暂无追剧记录</p>
            <p className="text-xs text-muted-foreground mt-1">观看电视剧或综艺后会显示在这里</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tvWatchHistory.slice(0, 5).map((h) => {
              const media = mediaMap[h.mediaId];
              if (!media) return null;
              const progressPct = h.duration > 0 ? Math.min(Math.round((h.progress / h.duration) * 100), 100) : 0;
              return (
                <div
                  key={h.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 cursor-pointer"
                  onClick={() => navigate(`/media/${media.id}`)}
                >
                  <div className="size-10 bg-secondary rounded overflow-hidden shrink-0">
                    {media.posterUrl ? (
                      <img src={media.posterUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="size-full flex items-center justify-center text-xs text-muted-foreground">无</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{media.title}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{media.type === 'VARIETY' ? '综艺' : '电视剧'}</span>
                      <span className="text-primary">{progressPct}%</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-1 mt-1">
                      <div className="bg-primary h-1 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="shrink-0 text-primary">
                    续看
                  </Button>
                </div>
              );
            })}
            {tvWatchHistory.length > 5 && (
              <Button variant="ghost" size="sm" onClick={() => navigate('/history')} className="text-primary mt-1">
                查看全部追剧 <ChevronRightIcon className="size-3" />
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <CollectProgressDialog />
      <div className="sticky top-0 z-10 bg-background -mx-6 px-6 pb-4 border-b border-border">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">首页</h1>
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-muted-foreground pointer-events-none">
            <Database className="size-3" />
            <span>本地</span>
          </div>
          <Input
            placeholder="搜索电影、电视剧、综艺..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
              if (e.key === 'Escape' && isSearching) handleClearSearch();
            }}
            className="flex-1 bg-card border-border pl-14 pr-8"
          />
          {searchKeyword && (
            <button
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        {isSearching ? (
          <Button variant="secondary" onClick={handleClearSearch}>清除搜索</Button>
        ) : (
          <Button onClick={handleSearch} variant="outline"><Search className="size-4" />本地搜索</Button>
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
          {userUsageTypes.includes('SEARCH_FIRST') && renderSearchFirstCard()}
          {userUsageTypes.includes('NEW_MOVIES') && renderNewMoviesCard()}
          {userUsageTypes.includes('TV_SERIES') && renderTvSeriesCard()}

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
