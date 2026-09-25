import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Media, Episode, UserUsageType, WatchHistory } from '@movie-app/core';
import { getSplashStore } from '@movie-app/core';
import { useAppStore, getProvider } from '../useAppStore';
import { openMediaPlay } from '../utils/openMediaPlay';
import { useBackgroundStore } from '../themes/backgroundStore';
import { useImportDialogStore } from '../themes/importDialogStore';
import { MediaCard } from '@/components/MediaCard';
import { PosterImage } from '@/components/PosterImage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { KeywordCollectDialog } from '@/components/KeywordCollectDialog';
import { Search, X, Heart, Clock, ChevronRight as ChevronRightIcon, Film, Tv, Sparkles, Download, Database } from 'lucide-react';
import { useToast } from '@/components/Layout';

const USAGE_LABELS: Record<UserUsageType, string> = {
  SEARCH_FIRST: '搜索优先',
  NEW_MOVIES: '追新电影',
  TV_SERIES: '追剧/综艺',
};

export default function HomePage() {
  const {
    favorites, watchHistory,
    watchHistoryCount,
    loadFavorites, loadWatchHistory,
    removeHistoryItem,
    userUsageTypes, loadUserUsageTypes,
    collectLatest, isCollecting, collectSourceProgress,
    videoSources,
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
  const [relaxYear, setRelaxYear] = useState(false);
  const [showKeywordDialog, setShowKeywordDialog] = useState(false);
  const [latestMedia, setLatestMedia] = useState<Media[]>([]);

  const provider = getProvider();

  // 首页四大板块数据加载完成标记（决定欢迎页全屏广告消失时机）
  const homeReadyLatestRef = useRef(false);
  const homeReadyFavRef = useRef(false);
  const homeReadyHistoryRef = useRef(false);
  const homeReadyTvDetailRef = useRef(false);
  const homeSignaledRef = useRef(false);

  const maybeSignalHomeReady = () => {
    if (homeSignaledRef.current) return;
    if (
      homeReadyLatestRef.current &&
      homeReadyFavRef.current &&
      homeReadyHistoryRef.current &&
      homeReadyTvDetailRef.current
    ) {
      homeSignaledRef.current = true;
      // 图片渲染缓冲：四大板块数据就绪后再等 800ms（首页图片在此期间渲染）
      setTimeout(() => getSplashStore().getState().setHomeReady(true), 800);
    }
  };

  useEffect(() => {
    loadUserUsageTypes();
  }, []);

  useEffect(() => {
    loadFavorites().then(() => { homeReadyFavRef.current = true; maybeSignalHomeReady(); });
    loadWatchHistory().then(() => { homeReadyHistoryRef.current = true; maybeSignalHomeReady(); });
  }, []);

  useEffect(() => {
    (async () => {
      const p = getProvider();
      const ids = [...new Set([...favorites.map((f) => f.mediaId), ...watchHistory.map((h) => h.mediaId)])];
      if (ids.length === 0) { setMediaMap({}); setEpisodeMap({}); setWatchedHistoryMap({}); setEpisodeTotalMap({}); setSourceTotalMap({}); homeReadyTvDetailRef.current = true; maybeSignalHomeReady(); return; }
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
      const allEpIds = [...new Set(historyEntries.flatMap((h) => h.history.map((wh) => wh.episodeId).filter(Boolean)))] as number[];
      const epEntries = await Promise.all(allEpIds.map(async (id) => [id, await p.getEpisodeById(id)] as const));
      setEpisodeMap(Object.fromEntries(epEntries));
      homeReadyTvDetailRef.current = true;
      maybeSignalHomeReady();
    })();
  }, [favorites, watchHistory]);

  useEffect(() => {
    if (userUsageTypes.includes('NEW_MOVIES')) {
      provider.listMedia({ type: 'MOVIE', page: 1, pageSize: 10, sort: 'latest' })
        .then((r) => { setLatestMedia(r.items); homeReadyLatestRef.current = true; maybeSignalHomeReady(); })
        .catch(() => { homeReadyLatestRef.current = true; maybeSignalHomeReady(); });
    } else {
      homeReadyLatestRef.current = true;
      maybeSignalHomeReady();
    }
  }, [userUsageTypes, provider]);

  useEffect(() => {
    const candidates: { id: number; posterUrl: string }[] = [];
    const push = (m?: { id?: number; posterUrl?: string | null }) => {
      if (m?.id && m.posterUrl) candidates.push({ id: m.id, posterUrl: m.posterUrl });
    };

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
  }, [latestMedia, watchHistory, favorites, mediaMap, userUsageTypes, setBgImage, clearBgImage]);

  const handleSearch = () => {
    const kw = searchKeyword.trim();
    if (!kw) return;
    navigate(`/search?q=${encodeURIComponent(kw)}`);
  };

  const handleQuickPreview = useCallback(() => {
    if (!quickKeyword.trim()) return;
    setShowKeywordDialog(true);
  }, [quickKeyword]);

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
        <Button onClick={handleQuickPreview} variant="default">
          <Search className="size-4 mr-1" />搜索采集
        </Button>
      </div>
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
    await openMediaPlay(navigate, m);
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
    <>
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
      </div>
      <KeywordCollectDialog
        open={showKeywordDialog}
        onOpenChange={setShowKeywordDialog}
        initialKeyword={quickKeyword}
        initialRelaxYear={relaxYear}
      />
    </>
    );
  }
