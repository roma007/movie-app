import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Media, Episode, UserUsageType, WatchHistory, HiddenCollectItem } from '@movie-app/core';
import { resolveDefaultPlayTarget } from '@movie-app/core';
import { useAppStore, getProvider } from '../useAppStore';
import { useBackgroundStore } from '../themes/backgroundStore';
import { useImportDialogStore } from '../themes/importDialogStore';
import { MediaCard } from '@/components/MediaCard';
import { PosterImage } from '@/components/PosterImage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Search, X, Heart, Clock, ChevronRight as ChevronRightIcon, Film, Tv, Sparkles, Download, Plus, Database, Loader2, Check } from 'lucide-react';
import { useToast } from '@/components/Layout';

const USAGE_LABELS: Record<UserUsageType, string> = {
  SEARCH_FIRST: '搜索优先',
  NEW_MOVIES: '追新电影',
  TV_SERIES: '追剧/综艺',
};

const MAX_DISPLAY_TITLES = 8;

export default function HomePage() {
  const {
    favorites, watchHistory,
    watchHistoryCount,
    loadFavorites, loadWatchHistory,
    removeHistoryItem,
    userUsageTypes, loadUserUsageTypes,
    collectLatest, searchKeywordPreview, previewResults, previewLoading,
    saveSelectedPreviewItems, clearPreviewResults, isCollecting, collectSourceProgress,
    videoSources, unhideMediaByGenres,
  } = useAppStore();
  const openAiImport = useImportDialogStore((s) => s.openAiImport);
  const navigate = useNavigate();
  const toast = useToast();
  const setBgImage = useBackgroundStore((s) => s.setBgImage);
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);
  const [mediaMap, setMediaMap] = useState<Record<string, Media | null>>({});
  const [episodeMap, setEpisodeMap] = useState<Record<string, Episode | null>>({});
  const [watchedHistoryMap, setWatchedHistoryMap] = useState<Record<string, WatchHistory[]>>({});
  const [episodeTotalMap, setEpisodeTotalMap] = useState<Record<string, number>>({});
  const [sourceTotalMap, setSourceTotalMap] = useState<Record<string, Record<string, number>>>({});
  const [searchKeyword, setSearchKeyword] = useState('');

  const [quickKeyword, setQuickKeyword] = useState('');
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(new Set());
  const [relaxYear, setRelaxYear] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasQuickSearched, setHasQuickSearched] = useState(false);
  const [quickCollectCount, setQuickCollectCount] = useState(0);
  const [latestMedia, setLatestMedia] = useState<Media[]>([]);
  const [hiddenCollect, setHiddenCollect] = useState<HiddenCollectItem[] | null>(null);

  const provider = getProvider();

  useEffect(() => {
    loadUserUsageTypes();
  }, []);

  useEffect(() => {
    loadFavorites();
    loadWatchHistory();
  }, []);

  useEffect(() => {
    (async () => {
      const p = getProvider();
      const ids = [...new Set([...favorites.map((f) => f.mediaId), ...watchHistory.map((h) => h.mediaId)])];
      if (ids.length === 0) { setMediaMap({}); setEpisodeMap({}); setWatchedHistoryMap({}); setEpisodeTotalMap({}); setSourceTotalMap({}); return; }
      const [mediaEntries, historyEntries] = await Promise.all([
        Promise.all(ids.map(async (id) => [id, await p.getMediaById(id)] as const)),
        Promise.all(ids.map(async (id) => {
          const media = await p.getMediaById(id);
          const history = media ? await p.getAllWatchHistoryByMediaId(id) : [];
          let total: number | undefined;
          const sourceCounts: Record<string, number> = {};
          if (media && (media.type === 'TV' || media.type === 'VARIETY')) {
            const eps = await p.getEpisodesByMediaId(id);
            const seenBySource: Record<string, Set<string>> = {};
            for (const e of eps) {
              if (!e.sourceId) continue;
              (seenBySource[e.sourceId] ??= new Set()).add(`${e.seasonNumber}:${e.episodeNumber}`);
            }
            for (const [sid, set] of Object.entries(seenBySource)) sourceCounts[sid] = set.size;
            if (media.totalEpisodes == null && media.currentEpisodes == null) {
              total = new Set(eps.map((e) => `${e.seasonNumber}:${e.episodeNumber}`)).size;
            }
          }
          return { id, history, total, sourceCounts } as const;
        })),
      ]);
      setMediaMap(Object.fromEntries(mediaEntries));
      setWatchedHistoryMap(Object.fromEntries(historyEntries.map((h) => [h.id, h.history])));
      setEpisodeTotalMap(Object.fromEntries(historyEntries.filter((h) => h.total != null).map((h) => [h.id, h.total as number])));
      setSourceTotalMap(Object.fromEntries(historyEntries.map((h) => [h.id, h.sourceCounts])));
      const allEpIds = [...new Set(historyEntries.flatMap((h) => h.history.map((wh) => wh.episodeId).filter(Boolean)))] as string[];
      const epEntries = await Promise.all(allEpIds.map(async (id) => [id, await p.getEpisodeById(id)] as const));
      setEpisodeMap(Object.fromEntries(epEntries));
    })();
  }, [favorites, watchHistory]);

  useEffect(() => {
    if (userUsageTypes.includes('NEW_MOVIES')) {
      provider.listMedia({ type: 'MOVIE', page: 1, pageSize: 10, sort: 'latest' })
        .then((r) => setLatestMedia(r.items))
        .catch(() => {});
    }
  }, [userUsageTypes, provider]);

  useEffect(() => {
    const candidates: { id: string; posterUrl: string }[] = [];
    const push = (m?: { id?: string; posterUrl?: string | null }) => {
      if (m?.id && m.posterUrl) candidates.push({ id: m.id, posterUrl: m.posterUrl });
    };

    if (userUsageTypes.includes('SEARCH_FIRST') && previewResults.length > 0) {
      push(previewResults[0]);
    }

    if (userUsageTypes.includes('NEW_MOVIES') && latestMedia.length > 0) {
      push(latestMedia[0]);
    }

    for (const h of watchHistory) {
      const m = mediaMap[h.mediaId];
      if (m) { push(m); break; }
    }

    for (const f of favorites) {
      const m = mediaMap[f.mediaId];
      if (m) { push(m); break; }
    }

    const first = candidates[0];
    if (!first) {
      setBgImage(null);
      return () => clearBgImage();
    }

    setBgImage(first.posterUrl);
    return () => clearBgImage();
  }, [latestMedia, watchHistory, favorites, mediaMap, userUsageTypes, previewResults, setBgImage, clearBgImage]);

  const handleSearch = () => {
    const kw = searchKeyword.trim();
    if (!kw) return;
    navigate(`/search?q=${encodeURIComponent(kw)}`);
  };

  const getOverrides = useCallback(() => {
    const overrides: { unlimitedYear?: boolean } = {};
    if (relaxYear) overrides.unlimitedYear = true;
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }, [relaxYear]);

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
    const items = previewResults.filter((p) => selectedPreviewIds.has(p.previewId));
    const result = await saveSelectedPreviewItems(items, getOverrides());
    setIsSaving(false);
    const count = result.saved;
    if (count > 0) {
      toast(`成功采集 ${count} 部视频`);
      setQuickCollectCount(count);
      clearPreviewResults();
      setQuickKeyword('');
      setRelaxYear(false);
      if (result.hiddenItems.length > 0) {
        setHiddenCollect(result.hiddenItems);
      }
    } else {
      toast('采集失败，请重试', 'error');
    }
  }, [previewResults, selectedPreviewIds, saveSelectedPreviewItems, clearPreviewResults, toast, getOverrides]);

  const handleCollectLatest = useCallback(async () => {
    if (videoSources.length === 0) {
      toast('暂无视频源，请先添加', 'error');
      openAiImport();
      return;
    }
    toast('开始增量采集...');
    await collectLatest();
    toast('增量采集完成');
    if (userUsageTypes.includes('NEW_MOVIES')) {
      provider.listMedia({ type: 'MOVIE', page: 1, pageSize: 10, sort: 'latest' })
        .then((r) => setLatestMedia(r.items))
        .catch(() => {});
    }
  }, [collectLatest, provider, toast, userUsageTypes, videoSources.length, openAiImport]);

  const togglePreviewItem = (previewId: string) => {
    setSelectedPreviewIds((prev) => {
      const next = new Set(prev);
      if (next.has(previewId)) next.delete(previewId);
      else next.add(previewId);
      return next;
    });
  };

  const renderSearchFirstCard = () => (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="size-5 text-muted-foreground" />
        <span className="font-medium text-lg">快速搜索采集</span>
      </div>
      <p className="text-sm text-muted-foreground mb-3">输入关键词搜索并一键采集你想看的视频</p>
      <div className="flex gap-2 mb-3 items-center">
        <Input
          placeholder="输入电影/电视剧名称..."
          value={quickKeyword}
          onChange={(e) => setQuickKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleQuickPreview()}
          className="flex-1"
        />
        <label className="flex items-center gap-1.5 text-xs whitespace-nowrap cursor-pointer select-none">
          <Switch checked={relaxYear} onCheckedChange={setRelaxYear} />
          不限年份
        </label>
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
        <div className="grid grid-cols-[repeat(auto-fill,6rem)] gap-3 max-h-[32rem] overflow-y-auto pr-1">
          {previewResults.map((item) => {
            const checked = selectedPreviewIds.has(item.previewId);
            return (
              <div
                key={item.previewId}
                className={`group cursor-pointer transition-all ${checked ? 'opacity-100' : ''}`}
                onClick={() => togglePreviewItem(item.previewId)}
              >
                <div className="aspect-[2/3] bg-[var(--color-secondary-alpha)] overflow-hidden rounded-lg relative">
                  {item.posterUrl && (
                    <PosterImage src={item.posterUrl} alt="" className="size-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  )}
                  <div className={`absolute top-1 left-1 z-10 flex items-center justify-center size-5 rounded-md border-2 transition-colors ${checked ? 'bg-primary border-primary text-white' : 'bg-black/40 border-white/70'}`}>
                    {checked && <Check className="size-3.5" />}
                  </div>
                </div>
                <div className="px-1.5 py-1 space-y-0.5">
                  <div className="text-xs font-medium truncate">{item.title}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{item.year} · {item.sourceName}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {hasQuickSearched && !previewLoading && quickCollectCount === 0 && previewResults.length > 0 && (
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              已选 {selectedPreviewIds.size} / 共 {previewResults.length} 个
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedPreviewIds(new Set(previewResults.map((p) => p.previewId)))}
            >
              全选
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSelectedPreviewIds((prev) => {
                  const next = new Set(previewResults.filter((p) => !prev.has(p.previewId)).map((p) => p.previewId));
                  return next;
                });
              }}
            >
              反选
            </Button>
          </div>
          <Button size="sm" onClick={handleQuickCollect} disabled={isSaving} variant="default">
            {isSaving ? <><Loader2 className="size-3 mr-1 animate-spin" /> 保存中...</> : <><Plus className="size-3 mr-1" />一键采集</>}
          </Button>
        </div>
      )}
    </Card>
  );

  const renderNewMoviesCard = () => (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Film className="size-5 text-muted-foreground" />
          <span className="font-medium text-lg">追新电影</span>
        </div>
        <Button onClick={handleCollectLatest} disabled={isCollecting} variant="default">
          <Download className="size-4 mr-1" />
          {isCollecting ? '采集中' : '增量采集'}
        </Button>
      </div>
      {latestMedia.length > 0 && (
        <>
          <div className="flex items-center justify-end mb-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/movie')} className="text-text-secondary text-xs">
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
    </Card>
  );

  const playMedia = useCallback(async (m: Media) => {
    const provider = getProvider();
    const target = await resolveDefaultPlayTarget(provider, m);
    if (target) {
      navigate(`/play/${target.episodeId}?sourceId=${encodeURIComponent(target.sourceId)}`);
    } else {
      navigate(`/media/${m.id}`);
    }
  }, [navigate]);

  const renderTvSeriesCard = () => {
    const tvWatchHistory = watchHistory.filter((h) => {
      const media = mediaMap[h.mediaId];
      return media && (media.type === 'TV' || media.type === 'VARIETY');
    });

    return (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Tv className="size-5 text-muted-foreground" />
            <span className="font-medium text-lg">我的追剧</span>
          </div>
          <Button onClick={handleCollectLatest} disabled={isCollecting} variant="default">
            <Download className="size-4 mr-1" />
            {isCollecting ? '采集中' : '增量采集'}
          </Button>
        </div>
        {tvWatchHistory.length === 0 ? (
          <div className="bg-secondary/30 rounded-lg p-4 text-center">
            <p className="text-sm text-muted-foreground">暂无追剧记录</p>
            <p className="text-xs text-muted-foreground mt-1">观看电视剧或综艺后会显示在这里</p>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {tvWatchHistory.slice(0, 10).map((h) => {
              const media = mediaMap[h.mediaId];
              if (!media) return null;
              const history = watchedHistoryMap[media.id] ?? [];
              let recentSourceId: string | null = null;
              for (const wh of history) {
                if (wh.episodeId) {
                  const e = episodeMap[wh.episodeId];
                  if (e?.sourceId) { recentSourceId = e.sourceId; break; }
                }
              }
              const sourceCount = recentSourceId ? (sourceTotalMap[media.id]?.[recentSourceId] ?? 0) : 0;
              const recentWh = history[0];
              const recentEp = recentWh?.episodeId ? episodeMap[recentWh.episodeId] : null;
              const watchedCount = recentEp ? recentEp.episodeNumber : 0;
              const totalCount = sourceCount > 0 ? sourceCount : (media.totalEpisodes ?? media.currentEpisodes ?? episodeTotalMap[media.id] ?? 0);
              const progressPct = totalCount > 0
                ? Math.min(Math.round((watchedCount / totalCount) * 100), 100)
                : (h.duration > 0 ? Math.min(Math.round((h.progress / h.duration) * 100), 100) : 0);
              const ep = h.episodeId ? episodeMap[h.episodeId] : null;
              const epLabel = ep ? (ep.title || `第${ep.episodeNumber}集`) : null;
              return (
                <div
                  key={h.id}
                  className="group w-24 shrink-0 cursor-pointer"
                  onClick={() => playMedia(media)}
                >
                  <div className="aspect-[2/3] bg-[var(--color-secondary-alpha)] overflow-hidden rounded-lg relative">
                    <PosterImage
                      src={media.posterUrl}
                      alt={media.title}
                      className="size-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeHistoryItem(media.id);
                      }}
                      className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full bg-error hover:bg-error/90 text-white"
                      title="删除追剧记录"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <div className="px-1.5 py-1">
                    <div className="text-xs truncate">{media.title}</div>
                    {epLabel && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground truncate">{epLabel}</div>
                    )}
                    <div className="w-full bg-[var(--color-secondary-alpha)] rounded-full h-1 mt-1">
                      <div className="bg-muted-foreground h-1 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {tvWatchHistory.length > 10 && (
          <Button variant="ghost" size="sm" onClick={() => navigate('/history')} className="text-text-secondary mt-1">
            查看全部追剧 <ChevronRightIcon className="size-3" />
          </Button>
        )}
      </Card>
    );
  };

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
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
            }}
            className="flex-1 pl-14 pr-8"
          />
          {searchKeyword && (
            <button
              onClick={() => setSearchKeyword('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-text transition-colors"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button onClick={handleSearch} variant="outline"><Search className="size-4" />本地搜索</Button>
      </div>

      <>
        {userUsageTypes.includes('SEARCH_FIRST') && renderSearchFirstCard()}
        {userUsageTypes.includes('NEW_MOVIES') && renderNewMoviesCard()}
        {userUsageTypes.includes('TV_SERIES') && renderTvSeriesCard()}

          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <span className="font-medium">观看历史</span>
                <span className="text-xs text-muted-foreground">({watchHistoryCount})</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/history')} className="text-text-secondary">
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
                      <MediaCard media={media} navigateState={{}} onBeforeNavigate={() => {}} size="small" onDelete={(m) => removeHistoryItem(m.id)} />
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Heart className="size-4 text-favorite" />
                <span className="font-medium">我的收藏</span>
                <span className="text-xs text-muted-foreground">({favorites.length})</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/favorites')} className="text-text-secondary">
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
          </Card>
        </>

      <Dialog open={!!hiddenCollect} onOpenChange={(open) => { if (!open) setHiddenCollect(null); }}>
        <DialogContent className="w-full max-w-md">
          <DialogHeader>
            <DialogTitle>部分视频已被隐藏</DialogTitle>
            <DialogDescription>
              {hiddenCollect && (() => {
                const titles = hiddenCollect.map((h) => h.title);
                const titleText = titles.length > MAX_DISPLAY_TITLES
                  ? `${titles.slice(0, MAX_DISPLAY_TITLES).join('、')}等${titles.length}部`
                  : titles.join('、');
                const genres = [...new Set(hiddenCollect.flatMap((h) => h.genres))];
                return `「${titleText}」视频名被隐藏，恢复显示「${genres.join('、')}」类视频后就可以找到。`;
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="default"
              size="sm"
              onClick={async () => {
                const genres = hiddenCollect ? [...new Set(hiddenCollect.flatMap((h) => h.genres))] : [];
                setHiddenCollect(null);
                if (genres.length === 0) return;
                try {
                  const res = await unhideMediaByGenres(genres);
                  toast(`已取消隐藏「${genres.join('、')}」，恢复显示 ${res.unhidden} 部视频`);
                } catch (err: any) {
                  toast('取消隐藏失败', 'error');
                  console.error('[HOME] 取消隐藏子类型失败:', err);
                }
              }}
            >
              取消隐藏
            </Button>
            <DialogClose asChild>
              <Button variant="outline" size="sm" onClick={() => setHiddenCollect(null)}>知道了</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
