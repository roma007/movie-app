import { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getProvider } from '../init';
import { useAppStore } from '../useAppStore';
import { VideoPlayer } from '@/components/player/VideoPlayer';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Palette, Check, ChevronRight } from 'lucide-react';
import { useThemeStore } from '../themes/store';
import { SystemConfigService } from '@movie-app/core';
import type { Episode, Media, PlaySource, VideoSource } from '@movie-app/core';

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
  const { saveWatchProgress, episodes, episodesLoading, seasons, episodeSources, seriesMedia, loadSeasons, loadEpisodes, loadEpisodeSources, loadSeriesMedia } = useAppStore();
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [sources, setSources] = useState<PlaySource[]>([]);
  const [activeSource, setActiveSource] = useState<PlaySource | null>(null);
  const [initialCurrentTime, setInitialCurrentTime] = useState(0);
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [currentSeason, setCurrentSeason] = useState(1);
  const [outroThresholdMinutes, setOutroThresholdMinutes] = useState(10);
  const [showNextEpisodeOverlay, setShowNextEpisodeOverlay] = useState(true);
  const [themeOpen, setThemeOpen] = useState(false);
  const themeRef = useRef<HTMLDivElement>(null);
  const { currentTheme, themes, setTheme } = useThemeStore();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sourceParams = new URLSearchParams(location.search);
  const urlSourceId = sourceParams.get('sourceId');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [currentEpisodeId, setCurrentEpisodeId] = useState(episodeId);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (!currentEpisodeId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setInitialCurrentTime(0);
      setWatchedEpisodes(new Set());
      const provider = getProvider();
      const ep = await provider.getEpisodeById(currentEpisodeId);
      if (cancelled) return;
      setEpisode(ep);
      if (ep) {
        const [m, ps] = await Promise.all([
          provider.getMediaById(ep.mediaId),
          provider.getPlaySourcesByEpisodeId(ep.id),
        ]);
        if (cancelled) return;
        setMedia(m);
        setSources(ps);

        if (!initialLoadDone.current) {
          const effectiveSourceId = urlSourceId || ep.sourceId || null;
          if (effectiveSourceId) {
            setSelectedSourceId(effectiveSourceId);
            const matchingSource = ps.find(s => s.sourceId === effectiveSourceId && s.isActive !== false) || ps.find(s => s.sourceId === effectiveSourceId) || ps.find(s => s.isActive !== false) || ps[0] || null;
            setActiveSource(matchingSource);
          } else {
            const firstActive = ps.find(s => s.isActive !== false) || ps[0] || null;
            setSelectedSourceId(firstActive?.sourceId || null);
            setActiveSource(firstActive);
          }
          initialLoadDone.current = true;
        }

        if (m) {
          const configService = new SystemConfigService(provider);
          const [saved, allHistory, playbackConfig] = await Promise.all([
            provider.getWatchHistoryByMediaId(m.id),
            provider.getAllWatchHistoryByMediaId(m.id),
            configService.getPlaybackConfig(),
          ]);
          setOutroThresholdMinutes(playbackConfig.outroThresholdMinutes);
          setShowNextEpisodeOverlay(playbackConfig.showNextEpisodeOverlay);
          const watched = new Set<string>();
          for (const h of allHistory) {
            if (h.episodeId && h.episodeId !== m.id && (h.progress > 60 || (h.duration > 0 && h.progress / h.duration >= 0.1))) {
              watched.add(h.episodeId);
            }
          }
          setWatchedEpisodes(watched);

          if (saved && saved.progress > 0) {
            const matchEpisode = !saved.episodeId || saved.episodeId === ep.id;
            const nearEnd = saved.duration > 0 && saved.progress >= saved.duration - 5;
            if (matchEpisode && !nearEnd) {
              setInitialCurrentTime(saved.progress);
            }
          }
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [currentEpisodeId]);

  const [lastSaveTime, setLastSaveTime] = useState(0);

  useEffect(() => {
    if (episodeSources.length === 0 || !selectedSourceId) return;
    if (!episodeSources.find(s => s.id === selectedSourceId)) {
      const id = episodeSources[0].id;
      setSelectedSourceId(id);
      const matchingSource = sources.find(s => s.sourceId === id && s.isActive !== false) || sources.find(s => s.sourceId === id);
      if (matchingSource) setActiveSource(matchingSource);
    }
  }, [episodeSources]);

  const handleTimeUpdate = (currentTime: number, duration: number) => {
    if (media && duration > 0) {
      const now = Date.now();
      if (now - lastSaveTime >= 10000 || Math.floor(currentTime) >= duration - 2) {
        saveWatchProgress(media.id, currentEpisodeId || null, Math.floor(currentTime), Math.floor(duration));
        setLastSaveTime(now);
      }
    }
  };

  const handleSourceFail = async (sourceId: string) => {
    const provider = getProvider();
    await provider.reportPlaySourceFail(sourceId);
  };

  const handleSourceChange = (source: PlaySource) => {
    setActiveSource(source);
    setSelectedSourceId(source.sourceId);
  };

  const handleSwitchCmsSource = (sourceId: string) => {
    setSelectedSourceId(sourceId);
    const matchingSource = sources.find(s => s.sourceId === sourceId && s.isActive !== false) || sources.find(s => s.sourceId === sourceId);
    if (matchingSource) {
      setActiveSource(matchingSource);
    }
  };

  const availableCmsSources = useMemo(() => {
    return episodeSources.map(s => ({ id: s.id, name: s.name }));
  }, [episodeSources]);

  const filteredSources = sources;

  const [displayedSourceId, setDisplayedSourceId] = useState(selectedSourceId);
  useEffect(() => {
    if (!episodesLoading) {
      setDisplayedSourceId(selectedSourceId);
    }
  }, [episodesLoading, selectedSourceId]);

  const filteredEpisodes = useMemo(() => {
    if (!displayedSourceId) return episodes;
    return episodes.filter(ep => ep.sourceId === displayedSourceId);
  }, [episodes, displayedSourceId]);

  const nextEpisode = useMemo(() => {
    if (!episode || filteredEpisodes.length === 0 || media?.type === 'MOVIE') return null;
    const idx = filteredEpisodes.findIndex((ep: Episode) => ep.id === episode.id);
    if (idx < 0 || idx >= filteredEpisodes.length - 1) return null;
    return filteredEpisodes[idx + 1] as Episode;
  }, [episode, filteredEpisodes, media?.type]);

  const handleNextEpisode = () => {
    if (nextEpisode) {
      setCurrentEpisodeId(nextEpisode.id);
    }
  };

  useEffect(() => {
    if (!media?.id) return;
    loadSeasons(media.id);
    loadSeriesMedia(media.id);
  }, [media?.id]);

  useEffect(() => {
    if (!media?.id || currentSeason === 0) return;
    loadEpisodeSources(media.id, currentSeason);
  }, [media?.id, currentSeason]);

  useEffect(() => {
    if (!media?.id || currentSeason === 0 || !selectedSourceId) return;
    loadEpisodes(media.id, currentSeason, selectedSourceId);
  }, [media?.id, currentSeason, selectedSourceId]);

  useEffect(() => {
    if (seasons.length > 0 && !seasons.includes(currentSeason)) {
      setCurrentSeason(seasons[0]);
    }
  }, [seasons]);

  const seasonToMediaMap = new Map<number, string>();
  seriesMedia.forEach(m => {
    if (m.seriesSeason) seasonToMediaMap.set(m.seriesSeason, m.id);
  });
  const seasonsFromSeries = seriesMedia.map(m => m.seriesSeason ?? 1).sort((a, b) => a - b);
  const displaySeasons = seasonsFromSeries.length > 0 ? seasonsFromSeries : seasons;
  const currentMediaSeason = media?.seriesSeason ?? 1;

  const handleSeasonClick = (s: number) => {
    const targetId = seasonToMediaMap.get(s);
    if (targetId && targetId !== media?.id) {
      navigate(`/media/${targetId}`, { replace: true });
    } else {
      setCurrentSeason(s);
      setSelectedSourceId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-7xl mx-auto">
        <Skeleton className="w-full aspect-video rounded-lg animate-pulse-skeleton" />
      </div>
    );
  }

  if (!episode || filteredSources.length === 0) {
    return (
      <div className="p-6 space-y-4 max-w-7xl mx-auto">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" /> 返回
        </Button>
        <div className="text-muted-foreground">无可播放的剧集或线路</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-background -mx-6 px-6 pb-4 border-b border-border">
        <div className="flex items-center">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="hover:text-primary shrink-0">
            <ArrowLeft className="size-4" /> 返回
          </Button>

          {media && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground ml-2 min-w-0 overflow-hidden">
              <button type="button" onClick={() => navigate(media.type === 'MOVIE' ? '/movie' : media.type === 'TV' ? '/tv' : media.type === 'VARIETY' ? '/variety' : media.type === 'ANIME' ? '/anime' : '/documentary')} className="hover:text-primary transition-colors shrink-0">{typeLabel[media.type] || media.type}</button>
              <ChevronRight className="size-3 shrink-0" />
              <button type="button" onClick={() => navigate(`/media/${media.id}`)} className="truncate min-w-0 hover:text-primary transition-colors">{media.title}</button>
              <ChevronRight className="size-3 shrink-0" />
              <span className="text-foreground shrink-0 truncate">{episode.title || `第${episode.episodeNumber}集`}</span>
            </div>
          )}

          <div ref={themeRef} className="relative shrink-0 ml-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setThemeOpen(!themeOpen)}
              className="gap-1.5"
            >
              <Palette className="size-4" />
              <span className="text-xs">主题：{themes.find(t => t.id === currentTheme)?.name || '暗夜黑'}</span>
            </Button>

            {themeOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 rounded-lg border border-border bg-card shadow-lg py-1 z-50">
                {themes.map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => { setTheme(theme.id); setThemeOpen(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-hover transition-colors"
                  >
                    <div
                      className="w-3.5 h-3.5 rounded-full shrink-0"
                      style={{ backgroundColor: theme.colors.primary }}
                    />
                    <span className="flex-1 text-left">{theme.name}</span>
                    {currentTheme === theme.id && (
                      <Check className="size-3 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 mt-5">
        <div className="flex gap-6">
          <div className="flex-1 min-w-0">
            <VideoPlayer
              sources={filteredSources}
              initialSourceId={activeSource?.id}
              initialCurrentTime={initialCurrentTime}
              nextEpisode={nextEpisode}
              outroThresholdMinutes={outroThresholdMinutes}
              showNextEpisodeOverlay={showNextEpisodeOverlay}
              onTimeUpdate={handleTimeUpdate}
              onNextEpisode={handleNextEpisode}
              onSourceChange={handleSourceChange}
              onSourceFail={handleSourceFail}
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
                {filteredSources.length > 0 ? '播放线路' : '暂无播放线路'}
              </div>
              <div className="flex gap-2 flex-wrap">
                {(() => {
                  const sourceKeyMap = new Map<string, number>();
                  filteredSources.forEach(s => {
                    const key = `${s.sourceName || ''}_${s.quality || ''}`;
                    sourceKeyMap.set(key, (sourceKeyMap.get(key) || 0) + 1);
                  });
                  const keyIndexMap = new Map<string, number>();
                  return filteredSources.map((s, i) => {
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
                        variant={s.isActive === false ? 'outline' : s.id === activeSource?.id ? 'default' : 'outline'}
                        size="sm"
                        disabled={s.isActive === false}
                        className={`${s.isActive === false ? 'opacity-50 cursor-not-allowed' : ''}`}
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
              <div className="text-sm text-muted-foreground">季数</div>
              <div className="flex gap-2 flex-wrap">
                {displaySeasons.map((s) => {
                  const isCurrent = seasonToMediaMap.get(s) === media?.id || (!seasonToMediaMap.has(s) && currentSeason === s);
                  return (
                    <Button
                      key={s}
                      variant={isCurrent ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleSeasonClick(s)}
                    >
                      第 {s} 季
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {media?.type !== 'MOVIE' && filteredEpisodes.length > 0 && (
            <div className="rounded-lg overflow-hidden">
              <div className="flex">
                {availableCmsSources.length > 1 && (
                  <div className="w-28 shrink-0 bg-muted/30">
                    {availableCmsSources.map((cms) => (
                      <button
                        key={cms.id}
                        onClick={() => handleSwitchCmsSource(cms.id)}
                        className={`w-full text-left px-3 py-2.5 transition-colors ${
                          selectedSourceId === cms.id
                            ? 'text-lg bg-sidebar text-foreground font-medium'
                            : 'text-sm text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {cms.name}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex-1 min-w-0 p-4 bg-sidebar">
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-2">
                    {filteredEpisodes.map((ep: any) => (
                      <Button
                        key={ep.id}
                        variant={ep.id === currentEpisodeId ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setCurrentEpisodeId(ep.id)}
                        className={ep.id !== currentEpisodeId && watchedEpisodes.has(ep.id) ? 'opacity-50' : ''}
                      >
                        {ep.title || `第${ep.episodeNumber}集`}
                      </Button>
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