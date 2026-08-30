import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAppStore, getStore } from '../useAppStore';
import { useBackgroundStore } from '../themes/backgroundStore';
import { usePlayerStore } from '../stores/playerStore';
import { getProvider } from '../init';
import type { PlaySource } from '@movie-app/core';
import { UNCATEGORIZED_GENRE, VideoDurationService, resolveDefaultPlayTarget } from '@movie-app/core';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ArrowLeft, ChevronRight, Loader2, EyeOff, Heart, ThumbsDown, Star } from 'lucide-react';
import { useToast } from '@/components/Layout';

const typeLabel: Record<string, string> = {
  MOVIE: '电影',
  TV: '电视剧',
  VARIETY: '综艺',
  ANIME: '动漫',
  DOCUMENTARY: '纪录片',
};

export default function PlayPage() {
  const { episodeId } = useParams<{ episodeId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const { episodes, episodesLoading, seasons, episodeSources, seriesMedia, loadSeasons, loadEpisodes, loadEpisodeSources, loadSeriesMedia, loadMediaDetail, currentMedia, isRatingLoading, toggleFav, hideMediaByGenres, fetchMediaRating, toggleDislike, isDisliked: checkDisliked } = useAppStore();

  const session = usePlayerStore((s) => s.session);
  const openPlayback = usePlayerStore((s) => s.openPlayback);
  const switchCmsSource = usePlayerStore((s) => s.switchCmsSource);
  const switchLineWithResume = usePlayerStore((s) => s.switchLineWithResume);
  const setSlotRect = usePlayerStore((s) => s.setSlotRect);
  const updateNextEpisode = usePlayerStore((s) => s.updateNextEpisode);

  const setBgImage = useBackgroundStore((s) => s.setBgImage);
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);
  const toast = useToast();

  const activeSession = session && session.episodeId === episodeId ? session : null;
  const ready = !!activeSession && !activeSession.loading;
  const isLoading = !activeSession || activeSession.loading;
  const media = activeSession?.media ?? null;
  const episode = activeSession?.episode ?? null;
  const sources = activeSession?.sources ?? [];
  const activeSource = sources.find((s) => s.id === activeSession?.playSourceId) ?? null;
  const selectedSourceId = activeSession?.selectedSourceId ?? null;

  const [currentSeason, setCurrentSeason] = useState(1);
  const [slotReady, setSlotReady] = useState(false);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [episodeListSwitching, setEpisodeListSwitching] = useState(false);
  const [movieLines, setMovieLines] = useState<{ episodeId: string; source: PlaySource }[]>([]);
  const [castExpanded, setCastExpanded] = useState(false);
  const [castOverflow, setCastOverflow] = useState(false);
  const castRef = useRef<HTMLDivElement | null>(null);
  const [plotExpanded, setPlotExpanded] = useState(false);
  const [plotOverflow, setPlotOverflow] = useState(false);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const playerSlotRef = useRef<HTMLDivElement | null>(null);
  const [isFav, setIsFav] = useState(false);
  const [isDisliked, setIsDisliked] = useState(false);
  const [hideDialogOpen, setHideDialogOpen] = useState(false);
  const [selectedHideGenres, setSelectedHideGenres] = useState<string[]>([]);
  const [hiding, setHiding] = useState(false);
  const [episodeDurations, setEpisodeDurations] = useState<Record<string, number | null>>({});

  const urlSourceIdRef = useRef<string | null>(null);
  const urlLineIdRef = useRef<string | null>(null);
  const urlSourceAppliedRef = useRef(false);
  const urlEpisodeIdRef = useRef<string | undefined>(undefined);
  if (urlEpisodeIdRef.current !== episodeId) {
    urlEpisodeIdRef.current = episodeId;
    const query = new URLSearchParams(location.search);
    urlSourceIdRef.current = query.get('sourceId');
    urlLineIdRef.current = query.get('line');
    urlSourceAppliedRef.current = false;
  }

  const openingRef = useRef<string | null>(null);
  const prevMediaIdRef = useRef<string | null>(null);
  const pendingLineRef = useRef<{ episodeId: string; playSourceId: string } | null>(null);

  useEffect(() => {
    if (!ready || !media?.id || media.type !== 'MOVIE') {
      setMovieLines([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const provider = getProvider();
        const eps = await provider.getEpisodesByMediaId(media.id);
        if (cancelled) return;
        const lists = await Promise.all(
          eps.map(async (ep) => {
            const ps = await provider.getPlaySourcesByEpisodeId(ep.id);
            return ps.map((s) => ({ episodeId: ep.id, source: s }));
          }),
        );
        if (cancelled) return;
        setMovieLines(lists.flat().filter((l) => !!l.source.url));
      } catch {
        if (!cancelled) setMovieLines([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, media?.id, media?.type]);

  useEffect(() => {
    if (episodes.length === 0) return;
    const durationService = new VideoDurationService();
    const provider = getProvider();
    const CONCURRENCY_LIMIT = 3;

    const missing = episodes.filter((ep: any) => !ep.duration);
    if (missing.length === 0) return;

    const fetchDuration = async (ep: any) => {
      try {
        const srcs = await provider.getPlaySourcesByEpisodeId(ep.id);
        const m3u8Source = srcs.find(s => s.url.endsWith('.m3u8') || s.url.toLowerCase().includes('m3u8'));
        if (m3u8Source) {
          const duration = await durationService.getDurationFromM3U8(m3u8Source.url);
          if (typeof duration === 'number' && duration > 0) {
            await provider.updateEpisodeDuration(ep.id, duration);
          }
          setEpisodeDurations(prev => ({ ...prev, [ep.id]: duration }));
        }
      } catch {
        setEpisodeDurations(prev => ({ ...prev, [ep.id]: null }));
      }
    };

    const runInBatches = async () => {
      for (let i = 0; i < missing.length; i += CONCURRENCY_LIMIT) {
        const batch = missing.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(batch.map(fetchDuration));
      }
    };

    runInBatches();
  }, [episodes]);

  useEffect(() => {
    if (!media?.posterUrl) {
      setBgImage(null);
      return () => clearBgImage();
    }
    setBgImage(media.posterUrl);
    return () => clearBgImage();
  }, [media, setBgImage, clearBgImage]);

  useEffect(() => {
    if (media?.id) loadMediaDetail(media.id);
  }, [media?.id, loadMediaDetail]);

  useEffect(() => {
    if (!episodeId) return;
    if (activeSession) {
      if (!urlSourceAppliedRef.current) {
        const urlSid = urlSourceIdRef.current;
        if (urlSid && urlSid !== activeSession.selectedSourceId) {
          switchCmsSource(urlSid);
        }
        urlSourceAppliedRef.current = true;
      }
      return;
    }
    if (openingRef.current === episodeId) return;
    openingRef.current = episodeId;
    // PIP 存活恢复场景：initApp 已预置 pipActive=true，openPlayback 须保留该状态，
    // 否则主窗口会重播同一集造成双流
    const keepPipActive = usePlayerStore.getState().pipActive;
    void openPlayback(episodeId, {
      sourceId: urlSourceIdRef.current,
      playSourceId: urlLineIdRef.current,
      keepPipActive,
    }).finally(() => {
      if (openingRef.current === episodeId) openingRef.current = null;
    });
  }, [episodeId, activeSession, openPlayback, switchCmsSource]);

  useEffect(() => {
    if (ready && media?.id && prevMediaIdRef.current !== media.id) {
      prevMediaIdRef.current = media.id;
      setCurrentSeason(media.seriesSeason ?? 1);
    }
  }, [ready, media?.id]);

  useEffect(() => {
    if (!ready || !media?.id) return;
    loadSeasons(media.id);
    loadSeriesMedia(media.id);
  }, [ready, media?.id]);

  useEffect(() => {
    if (!ready || !media?.id || currentSeason === 0) return;
    setSourcesLoaded(false);
    loadEpisodeSources(media.id, currentSeason).then(() => setSourcesLoaded(true));
  }, [ready, media?.id, currentSeason, loadEpisodeSources]);

  useEffect(() => {
    if (!ready || !media?.id || currentSeason === 0 || !selectedSourceId) return;
    loadEpisodes(media.id, currentSeason, selectedSourceId);
  }, [ready, media?.id, currentSeason, selectedSourceId]);

  useEffect(() => {
    if (!ready || !media?.id || currentSeason === 0 || episodeSources.length === 0) return;
    if (!selectedSourceId || !episodeSources.find((s) => s.id === selectedSourceId)) {
      switchCmsSource(episodeSources[0].id);
    }
  }, [ready, media?.id, currentSeason, episodeSources, selectedSourceId, switchCmsSource]);

  useEffect(() => {
    if (seasons.length > 0 && !seasons.includes(currentSeason)) {
      setCurrentSeason(seasons[0]);
    }
  }, [seasons]);

  useEffect(() => {
    updateNextEpisode();
  }, [episodes, selectedSourceId, activeSession?.episodeId, activeSession?.media?.type, updateNextEpisode]);

  useEffect(() => {
    const c = castRef.current;
    if (c && !castExpanded) setCastOverflow(c.scrollHeight - c.clientHeight > 1);
    const p = plotRef.current;
    if (p && !plotExpanded) setPlotOverflow(p.scrollHeight - p.clientHeight > 1);
  }, [media?.directors, media?.actors, media?.description, castExpanded, plotExpanded]);

  useEffect(() => {
    if (!media?.id) return;
    fetchMediaRating(media.id);
    getProvider().isFavorite(media.id).then(setIsFav).catch(() => {});
    checkDisliked(media.id).then(setIsDisliked).catch(() => {});
  }, [media?.id]);

  const handleFav = async () => {
    if (!media?.id) return;
    const result = await toggleFav(media.id);
    setIsFav(result);
    getStore().getState().scheduleRecommendationRecompute();
  };

  const handleDislike = async () => {
    if (!media?.id) return;
    const result = await toggleDislike(media.id);
    setIsDisliked(result);
    toast(result ? '已标记为不感兴趣，不再推荐此类内容' : '已取消不感兴趣');
  };

  const openHideDialog = () => {
    if (!media) return;
    setSelectedHideGenres([]);
    setHideDialogOpen(true);
  };

  const handleHide = async () => {
    if (selectedHideGenres.length === 0) return;
    setHiding(true);
    try {
      const result = await hideMediaByGenres(selectedHideGenres);
      toast(`已隐藏 ${result.hidden} 个「${selectedHideGenres.join('/')}」类视频`);
      setHideDialogOpen(false);
    } catch (err: any) {
      toast(`隐藏失败: ${err.message || '未知错误'}`, 'error');
      setHideDialogOpen(false);
    } finally {
      setHiding(false);
    }
  };

  useEffect(() => {
    if (isLoading) return;
    const el = playerSlotRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSlotRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const main = document.getElementById('main-content');
    main?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      main?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [slotReady, isLoading, setSlotRect]);

  useEffect(() => {
    return () => setSlotRect(null);
  }, [setSlotRect]);

  useEffect(() => {
    if (!episodesLoading) setEpisodeListSwitching(false);
  }, [episodesLoading]);

  const watchedEpisodes = useMemo(() => new Set(activeSession?.watchedEpisodes ?? []), [activeSession?.watchedEpisodes]);

  const lineEntries = useMemo(() => {
    if (media?.type === 'MOVIE') {
      if (movieLines.length > 0) return movieLines;
      return activeSession ? sources.map((s) => ({ episodeId: activeSession.episodeId, source: s })) : [];
    }
    return activeSession ? sources.map((s) => ({ episodeId: activeSession.episodeId, source: s })) : [];
  }, [media?.type, movieLines, sources, activeSession]);

  useEffect(() => {
    const pending = pendingLineRef.current;
    if (!pending || !ready || activeSession?.episodeId !== pending.episodeId) return;
    pendingLineRef.current = null;
    const target = sources.find((s) => s.id === pending.playSourceId);
    if (target && target.id !== activeSession?.playSourceId) {
      void switchLineWithResume(target.id);
    }
  }, [ready, activeSession?.episodeId, activeSession?.playSourceId, sources, switchLineWithResume]);

  const seasonToMediaMap = useMemo(() => {
    const map = new Map<number, string>();
    seriesMedia.forEach((m) => {
      if (m.seriesSeason) map.set(m.seriesSeason, m.id);
    });
    return map;
  }, [seriesMedia]);

  const seasonsFromSeries = useMemo(
    () => [...new Set(seriesMedia.map((m) => m.seriesSeason ?? 1))].sort((a, b) => a - b),
    [seriesMedia],
  );
  const displaySeasons = seasonsFromSeries.length > 0 ? seasonsFromSeries : seasons;

  const handleSeasonClick = async (s: number) => {
    const targetId = seasonToMediaMap.get(s);
    if (targetId && targetId !== media?.id) {
      const provider = getProvider();
      const targetMedia = await provider.getMediaById(targetId);
      if (targetMedia) {
        const target = await resolveDefaultPlayTarget(provider, targetMedia);
        if (target) {
          const lineQuery = target.playSourceId ? `&line=${encodeURIComponent(target.playSourceId)}` : '';
          navigate(`/play/${target.episodeId}?sourceId=${encodeURIComponent(target.sourceId)}${lineQuery}`, { replace: true });
          return;
        }
      }
    }
    setCurrentSeason(s);
  };

  const handleLineClick = (entry: { episodeId: string; source: PlaySource }) => {
    if (!activeSession) return;
    if (entry.episodeId === activeSession.episodeId) {
      void switchLineWithResume(entry.source.id);
      return;
    }
    pendingLineRef.current = { episodeId: entry.episodeId, playSourceId: entry.source.id };
    navigate(`/play/${entry.episodeId}?sourceId=${encodeURIComponent(entry.source.sourceId)}&line=${encodeURIComponent(entry.source.id)}`, { replace: true });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-7xl mx-auto">
        <Skeleton className="w-full aspect-video rounded-lg animate-pulse-skeleton" />
      </div>
    );
  }

  if (!episode || sources.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate(-1)} className="hover:text-text shrink-0">
              <ArrowLeft className="size-4 mr-2" /> 返回
            </Button>
          </div>
        </div>
        <div className="text-muted-foreground mt-5">无可播放的剧集或线路</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate(-1)} className="hover:text-text shrink-0">
            <ArrowLeft className="size-4 mr-2" /> 返回
          </Button>

          {media && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0 overflow-hidden flex-1">
              <button type="button" onClick={() => navigate(media.type === 'MOVIE' ? '/movie' : media.type === 'TV' ? '/tv' : media.type === 'VARIETY' ? '/variety' : media.type === 'ANIME' ? '/anime' : '/documentary')} className="hover:text-text transition-colors shrink-0">{typeLabel[media.type] || media.type}</button>
              <ChevronRight className="size-3 shrink-0" />
              <span className="text-text truncate min-w-0">{media.title}{episode ? ` ${episode.title || `第${episode.episodeNumber}集`}` : ''}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6 mt-5">
        <div className="flex gap-6">
          <div className="flex-1 min-w-0">
            <div
              ref={(node) => {
                playerSlotRef.current = node;
                setSlotReady(!!node);
              }}
              className="relative w-full aspect-video rounded-lg overflow-hidden bg-black"
            />
          </div>

          <div className="w-80 shrink-0 space-y-4 max-h-[calc(100vh-120px)] overflow-y-auto">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h1 className="text-xl font-semibold min-w-0 truncate">{media?.title}</h1>
                  {media?.updatedAt && (
                    <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                      更新时间：{new Date(media.updatedAt).toISOString().split('T')[0]}
                    </span>
                  )}
                </div>
                {episode && (
                  <div className="text-sm text-muted-foreground truncate">
                    {episode.title ? episode.title : `第${episode.episodeNumber}集`}
                  </div>
                )}
                  <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    {media?.year} · {media?.area || '未知'}
                  </p>
                </div>
                {media?.alias && (
                  <p className="text-sm"><span className="text-muted-foreground">又名：</span>{media.alias}</p>
                )}
              </div>

            {media && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={openHideDialog} title="将此类子类型视频加入隐藏列表">
                    <EyeOff className="size-4" />
                    隐藏
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFav}
                    className={isFav ? 'bg-muted-foreground/20 text-text' : ''}
                  >
                    <Heart className={`size-4 ${isFav ? 'fill-current' : ''}`} />
                    {isFav ? '已收藏' : '收藏'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDislike}
                    className={isDisliked ? 'bg-destructive/20 text-destructive' : ''}
                    title="标记不感兴趣：降低本片及同类内容推荐权重"
                  >
                    <ThumbsDown className="size-4" />
                    {isDisliked ? '已不感兴趣' : '不感兴趣'}
                  </Button>
                </div>
                {currentMedia && currentMedia.id === media.id && (currentMedia.rating != null && currentMedia.rating > 0 ? (
                  <p className="flex items-center gap-1.5">
                    <Star className="size-4 text-amber-400 fill-current shrink-0" />
                    <span className="text-lg font-semibold text-amber-400 leading-none">{currentMedia.rating.toFixed(1)}</span>
                    {currentMedia.ratingCount != null && currentMedia.ratingCount > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {currentMedia.ratingCount >= 10000 ? `${(currentMedia.ratingCount / 10000).toFixed(1)}万人` : `${currentMedia.ratingCount}人`}评分 (豆瓣)
                      </span>
                    )}
                  </p>
                ) : isRatingLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="inline-block size-3.5 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" />
                    正在获取评分...
                  </p>
                ) : null)}
                <p className="text-sm">
                  <span className="text-muted-foreground">类型：</span>
                  {media.genres.length > 0 ? media.genres.map((g, i) => (
                    <span key={g}>
                      <button
                        type="button"
                        onClick={() => navigate(`/subtype/${media.type}/${encodeURIComponent(g)}`)}
                        className="hover:text-text transition-colors cursor-pointer"
                        title={`浏览「${g}」类视频`}
                      >
                        {g}
                      </button>
                      {i < media.genres.length - 1 && <span>,</span>}
                    </span>
                  )) : '未知'}
                </p>
              </div>
            )}

            {media && (media.directors.length > 0 || media.actors.length > 0) && (
              <div className="flex items-baseline gap-2">
                <div
                  ref={castRef}
                  className={`text-sm space-y-1 text-text flex-1 min-w-0 ${castExpanded ? '' : 'max-h-[2.75rem] overflow-hidden'}`}
                >
                  {media.directors.length > 0 && (
                    <p>
                      <span className="text-muted-foreground">导演：</span>
                      {media.directors.map((d, i) => (
                        <span key={d}>
                          <button
                            type="button"
                            onClick={() => navigate(`/search?q=${encodeURIComponent(d)}`)}
                            className="hover:text-text transition-colors cursor-pointer"
                          >
                            {d}
                          </button>
                          {i < media.directors.length - 1 && <span>,</span>}
                        </span>
                      ))}
                    </p>
                  )}
                  {media.actors.length > 0 && (
                    <p>
                      <span className="text-muted-foreground">主演：</span>
                      {media.actors.map((a, i) => (
                        <span key={a}>
                          <button
                            type="button"
                            onClick={() => navigate(`/search?q=${encodeURIComponent(a)}`)}
                            className="hover:text-text transition-colors cursor-pointer"
                          >
                            {a}
                          </button>
                          {i < media.actors.length - 1 && <span>,</span>}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                {castOverflow && (
                  <button
                    type="button"
                    onClick={() => setCastExpanded((v) => !v)}
                    className="shrink-0 text-xs text-muted-foreground hover:text-text transition-colors whitespace-nowrap"
                  >
                    {castExpanded ? '收起' : '展开'}
                  </button>
                )}
              </div>
            )}

            {media && media.description && (
              <div className="flex items-baseline gap-2">
                <div
                  ref={plotRef}
                  className={`text-sm leading-6 text-text flex-1 min-w-0 ${plotExpanded ? '' : 'max-h-[1.6rem] overflow-hidden'}`}
                >
                  {media.description}
                </div>
                {plotOverflow && (
                  <button
                    type="button"
                    onClick={() => setPlotExpanded((v) => !v)}
                    className="shrink-0 text-xs text-muted-foreground hover:text-text transition-colors whitespace-nowrap"
                  >
                    {plotExpanded ? '收起' : '展开'}
                  </button>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                {lineEntries.length > 0 ? '播放线路' : '暂无播放线路'}
              </div>
              <div className="flex gap-2 flex-wrap">
                {(() => {
                  const sourceKeyMap = new Map<string, number>();
                  lineEntries.forEach(({ source }) => {
                    const key = `${source.sourceName || ''}_${source.quality || ''}`;
                    sourceKeyMap.set(key, (sourceKeyMap.get(key) || 0) + 1);
                  });
                  const keyIndexMap = new Map<string, number>();
                  return lineEntries.map(({ episodeId, source }, i) => {
                    const key = `${source.sourceName || ''}_${source.quality || ''}`;
                    const count = sourceKeyMap.get(key) || 1;
                    const idx = (keyIndexMap.get(key) || 0) + 1;
                    keyIndexMap.set(key, idx);
                    const baseName = source.sourceName || `线路${i + 1}`;
                    const qualityStr = source.quality ? ` · ${source.quality}` : '';
                    const suffix = count > 1 ? ` (${idx})` : '';
                    const isActive = episodeId === activeSession?.episodeId && source.id === activeSource?.id;
                    return (
                      <Button
                        key={`${episodeId}-${source.id}`}
                        variant="outline"
                        size="sm"
                        className={`${isActive ? 'bg-muted-foreground/20 text-text' : ''}`}
                        onClick={() => handleLineClick({ episodeId, source })}
                      >
                        {baseName}{qualityStr}{suffix}
                      </Button>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {displaySeasons.length > 1 && (
            <div className="space-y-1">
              <div className="flex gap-2 flex-wrap">
                {displaySeasons.map((s) => {
                  const isCurrent = seasonToMediaMap.get(s) === media?.id || (!seasonToMediaMap.has(s) && currentSeason === s);
                  return (
                    <Button
                      key={s}
                      variant="outline"
                      size="sm"
                      onClick={() => handleSeasonClick(s)}
                      className={isCurrent ? 'bg-muted-foreground/20 text-text' : ''}
                    >
                      第 {s} 季
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {media?.type !== 'MOVIE' && (
            <div className="rounded-md overflow-hidden">
              <div className="flex">
                {episodeSources.length > 1 && (
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    {episodeSources.map((cms: any) => (
                      <button
                        key={cms.id}
                        type="button"
                        onClick={() => {
                          setEpisodeListSwitching(true);
                          switchCmsSource(cms.id);
                        }}
                        className={`text-left text-xs truncate rounded-l-md rounded-r-none transition-all duration-150 flex-1 ${
                          selectedSourceId === cms.id
                            ? 'w-24 bg-[var(--color-card-accent-alpha)] text-[var(--color-button-primary-text)] py-2.5 px-3 shadow-none'
                            : 'w-20 bg-[var(--color-card-dim-alpha)] text-[var(--color-button-secondary-text)] py-1.5 px-2 hover:text-text'
                        }`}
                      >
                        {cms.name}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex-1 min-w-0 rounded-l-none rounded-r-md bg-[var(--color-card-accent-alpha)] p-4">
                  {episodesLoading || episodeListSwitching || !sourcesLoaded || (episodeSources.length > 0 && !selectedSourceId) ? (
                    <div className="flex items-center gap-2 py-3 text-sm text-text-secondary">
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      剧集加载中...
                    </div>
                  ) : episodes.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {episodes.map((ep: any) => {
                        const dur = episodeDurations[ep.id] ?? ep.duration;
                        return (
                        <button
                          key={ep.id}
                          type="button"
                          onClick={() => {
                            if (ep.id !== activeSession?.episodeId) {
                              navigate(`/play/${ep.id}`, { replace: true });
                            }
                          }}
                          title="点击播放"
                          className={`relative px-3 py-1.5 rounded text-sm font-medium transition-all duration-200 cursor-pointer${
                            ep.id === activeSession?.episodeId
                              ? ' bg-[var(--color-button-primary-text)] text-[var(--color-primary)]'
                              : ` bg-[var(--color-card-dim-alpha)] text-text-secondary hover:text-text hover:bg-[var(--color-hover-alpha)]${watchedEpisodes.has(ep.id) ? ' opacity-50' : ''}`
                          }`}
                        >
                          {ep.title || `第${ep.episodeNumber}集`}
                          {typeof dur === 'number' && dur > 0 && (
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              {Math.floor(dur / 60)}:{String(dur % 60).padStart(2, '0')}
                            </span>
                          )}
                        </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-3 text-sm text-muted-foreground">暂无剧集</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

    <Dialog open={hideDialogOpen} onOpenChange={(open) => { if (!open) setHideDialogOpen(false); }}>
      <DialogContent className="w-full max-w-sm">
        <DialogHeader>
          <DialogTitle>隐藏</DialogTitle>
          <DialogDescription>
            选择要隐藏的子类型，隐藏后此类视频将不再显示。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2 py-2">
          {(media && media.genres.length === 0 ? [UNCATEGORIZED_GENRE] : media ? media.genres : []).map((g) => {
            const selected = selectedHideGenres.includes(g);
            return (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setSelectedHideGenres(prev =>
                    prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]
                  );
                }}
                className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                  selected
                    ? 'bg-muted-foreground text-background border-muted-foreground'
                    : 'bg-card text-text hover:border-muted-foreground/50'
                }`}
              >
                {g}
              </button>
            );
          })}
        </div>
        <DialogFooter className="flex items-center gap-2">
          <DialogClose asChild>
            <Button variant="outline" size="sm" onClick={() => setHideDialogOpen(false)}>取消</Button>
          </DialogClose>
          <Button
            variant="outline"
            size="sm"
            disabled={hiding || selectedHideGenres.length === 0}
            onClick={handleHide}
          >
            <EyeOff className={`size-4 mr-1 ${hiding ? 'animate-spin' : ''}`} />
            {hiding ? '隐藏中...' : `隐藏 (${selectedHideGenres.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  );
}
