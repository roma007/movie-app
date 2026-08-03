import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '../useAppStore';
import { useBackgroundStore } from '../themes/backgroundStore';
import { usePlayerStore } from '../stores/playerStore';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, ChevronRight } from 'lucide-react';

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
  const [displayedSourceId, setDisplayedSourceId] = useState<string | null>(null);
  const [slotReady, setSlotReady] = useState(false);
  const playerSlotRef = useRef<HTMLDivElement | null>(null);

  const urlSourceIdRef = useRef<string | null>(null);
  if (!urlSourceIdRef.current) {
    urlSourceIdRef.current = new URLSearchParams(location.search).get('sourceId');
  }

  const openingRef = useRef<string | null>(null);
  const prevMediaIdRef = useRef<string | null>(null);

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
      const urlSid = urlSourceIdRef.current;
      if (urlSid && urlSid !== activeSession.selectedSourceId) {
        switchCmsSource(urlSid);
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
    loadEpisodeSources(media.id, currentSeason);
  }, [ready, media?.id, currentSeason]);

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
    if (!episodesLoading) setDisplayedSourceId(selectedSourceId);
  }, [episodesLoading, selectedSourceId]);

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

  const filteredEpisodes = useMemo(() => {
    if (!displayedSourceId) return episodes;
    return episodes.filter((ep: any) => ep.sourceId === displayedSourceId);
  }, [episodes, displayedSourceId]);

  const availableCmsSources = useMemo(() => {
    return episodeSources.map((s) => ({ id: s.id, name: s.name }));
  }, [episodeSources]);

  const watchedEpisodes = useMemo(() => new Set(activeSession?.watchedEpisodes ?? []), [activeSession?.watchedEpisodes]);

  const seasonToMediaMap = useMemo(() => {
    const map = new Map<number, string>();
    seriesMedia.forEach((m) => {
      if (m.seriesSeason) map.set(m.seriesSeason, m.id);
    });
    return map;
  }, [seriesMedia]);

  const seasonsFromSeries = useMemo(
    () => seriesMedia.map((m) => m.seriesSeason ?? 1).sort((a, b) => a - b),
    [seriesMedia],
  );
  const displaySeasons = seasonsFromSeries.length > 0 ? seasonsFromSeries : seasons;

  const handleSeasonClick = (s: number) => {
    const targetId = seasonToMediaMap.get(s);
    if (targetId && targetId !== media?.id) {
      navigate(`/media/${targetId}`, { replace: true });
    } else {
      setCurrentSeason(s);
      setDisplayedSourceId(null);
    }
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
                {sources.length > 0 ? '播放线路' : '暂无播放线路'}
              </div>
              <div className="flex gap-2 flex-wrap">
                {(() => {
                  const sourceKeyMap = new Map<string, number>();
                  sources.forEach((s) => {
                    const key = `${s.sourceName || ''}_${s.quality || ''}`;
                    sourceKeyMap.set(key, (sourceKeyMap.get(key) || 0) + 1);
                  });
                  const keyIndexMap = new Map<string, number>();
                  return sources.map((s, i) => {
                    const key = `${s.sourceName || ''}_${s.quality || ''}`;
                    const count = sourceKeyMap.get(key) || 1;
                    const idx = (keyIndexMap.get(key) || 0) + 1;
                    keyIndexMap.set(key, idx);
                    const baseName = s.sourceName || `线路${i + 1}`;
                    const qualityStr = s.quality ? ` · ${s.quality}` : '';
                    const suffix = count > 1 ? ` (${idx})` : '';
                    return (
                      <Button
                        key={s.id}
                        variant="outline"
                        size="sm"
                        disabled={s.isActive === false}
                        className={`${s.isActive === false ? 'opacity-50 cursor-not-allowed' : ''} ${s.id === activeSource?.id ? 'bg-muted-foreground/20 text-text' : ''}`}
                        onClick={() => handleSourceChange(s)}
                      >
                        {baseName}{qualityStr}{suffix}
                        {s.isActive === false && ' (不可用)'}
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

          {media?.type !== 'MOVIE' && filteredEpisodes.length > 0 && (
            <div className="rounded-lg overflow-hidden bg-[var(--color-card-alpha)] backdrop-blur-sm">
              <div className="flex">
                {availableCmsSources.length > 1 && (
                  <div className="w-28 shrink-0">
                    {availableCmsSources.map((cms) => (
                      <button
                        key={cms.id}
                        onClick={() => switchCmsSource(cms.id)}
                        className={`w-full text-left px-3 py-2.5 transition-colors rounded-lg ${
                          selectedSourceId === cms.id
                            ? 'bg-muted-foreground/20 text-text'
                            : 'bg-[var(--color-card-alpha)] hover:bg-[var(--color-hover-alpha)] text-text-secondary hover:text-text'
                        }`}
                      >
                        {cms.name}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex-1 min-w-0 p-4">
                  <div className="flex flex-wrap gap-1.5">
                    {filteredEpisodes.map((ep: any) => (
                      <button
                        key={ep.id}
                        type="button"
                        onClick={() => {
                          if (ep.id !== activeSession?.episodeId) {
                            navigate(`/play/${ep.id}`, { replace: true });
                          }
                        }}
                        title="点击播放"
                        className={`relative px-3 py-1.5 rounded text-xs font-medium transition-all duration-200 bg-[var(--color-card-alpha)] text-text-secondary cursor-pointer hover:text-text hover:bg-[var(--color-hover-alpha)]${ep.id === activeSession?.episodeId ? ' bg-muted-foreground/20 text-text' : ''}${ep.id !== activeSession?.episodeId && watchedEpisodes.has(ep.id) ? ' opacity-50' : ''}`}
                      >
                        {ep.title || `第${ep.episodeNumber}集`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
