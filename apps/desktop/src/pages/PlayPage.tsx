import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '../useAppStore';
import { useBackgroundStore } from '../themes/backgroundStore';
import { usePlayerStore } from '../stores/playerStore';
import { getProvider } from '../init';
import type { PlaySource } from '@movie-app/core';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, ChevronRight, Loader2 } from 'lucide-react';

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

  const { episodes, episodesLoading, seasons, episodeSources, seriesMedia, loadSeasons, loadEpisodes, loadEpisodeSources, loadSeriesMedia } = useAppStore();

  const session = usePlayerStore((s) => s.session);
  const openPlayback = usePlayerStore((s) => s.openPlayback);
  const switchCmsSource = usePlayerStore((s) => s.switchCmsSource);
  const handleSourceChange = usePlayerStore((s) => s.handleSourceChange);
  const setSlotRect = usePlayerStore((s) => s.setSlotRect);
  const updateNextEpisode = usePlayerStore((s) => s.updateNextEpisode);

  const setBgImage = useBackgroundStore((s) => s.setBgImage);
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);

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
  const playerSlotRef = useRef<HTMLDivElement | null>(null);

  const urlSourceIdRef = useRef<string | null>(null);
  const urlSourceAppliedRef = useRef(false);
  const urlEpisodeIdRef = useRef<string | undefined>(undefined);
  if (urlEpisodeIdRef.current !== episodeId) {
    urlEpisodeIdRef.current = episodeId;
    urlSourceIdRef.current = new URLSearchParams(location.search).get('sourceId');
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
    if (!media?.posterUrl) {
      setBgImage(null);
      return () => clearBgImage();
    }
    setBgImage(media.posterUrl);
    return () => clearBgImage();
  }, [media, setBgImage, clearBgImage]);

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
    void openPlayback(episodeId, { sourceId: urlSourceIdRef.current }).finally(() => {
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
      handleSourceChange(target);
    }
  }, [ready, activeSession?.episodeId, activeSession?.playSourceId, sources, handleSourceChange]);

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

  const handleSeasonClick = (s: number) => {
    const targetId = seasonToMediaMap.get(s);
    if (targetId && targetId !== media?.id) {
      navigate(`/media/${targetId}`, { replace: true });
    } else {
      setCurrentSeason(s);
    }
  };

  const handleLineClick = (entry: { episodeId: string; source: PlaySource }) => {
    if (!activeSession) return;
    if (entry.episodeId === activeSession.episodeId) {
      handleSourceChange(entry.source);
      return;
    }
    pendingLineRef.current = { episodeId: entry.episodeId, playSourceId: entry.source.id };
    navigate(`/play/${entry.episodeId}?sourceId=${entry.source.sourceId}`, { replace: true });
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
              <button type="button" onClick={() => navigate(`/media/${media.id}`)} className="truncate min-w-0 hover:text-text transition-colors">{media.title}</button>
              <ChevronRight className="size-3 shrink-0" />
              <span className="text-text shrink-0 truncate">{episode.title || `第${episode.episodeNumber}集`}</span>
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
              <h1 className="text-xl font-semibold">
                {media?.title}
                {episode.title ? ` · ${episode.title}` : ` · 第${episode.episodeNumber}集`}
              </h1>
              {media && (
                <p className="text-sm text-muted-foreground">
                  {media.year} · {media.area || '未知'}
                </p>
              )}
            </div>

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
                  <div className="shrink-0 flex flex-col items-end gap-1.5 pl-3">
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
                      {episodes.map((ep: any) => (
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
                        </button>
                      ))}
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
    </div>
  );
}
