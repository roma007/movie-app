import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getProvider } from '../init';
import { useAppStore } from '../useAppStore';
import { VideoPlayer } from '@/components/player/VideoPlayer';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Palette, Check, ChevronRight } from 'lucide-react';
import { useThemeStore } from '../themes/store';
import type { Episode, Media, PlaySource } from '@movie-app/core';

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
  const { saveWatchProgress, episodes, seasons, loadSeasons, loadEpisodes } = useAppStore();
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [sources, setSources] = useState<PlaySource[]>([]);
  const [activeSource, setActiveSource] = useState<PlaySource | null>(null);
  const [initialCurrentTime, setInitialCurrentTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [currentSeason, setCurrentSeason] = useState(1);
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

  useEffect(() => {
    if (!episodeId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setInitialCurrentTime(0);
      const provider = getProvider();
      const ep = await provider.getEpisodeById(episodeId);
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
        const sourceParams = new URLSearchParams(location.search);
        const targetSourceId = sourceParams.get('source');
        let initialSource = ps.find(s => s.isActive !== false) || ps[0] || null;
        if (targetSourceId) {
          const specifiedSource = ps.find(s => s.id === targetSourceId);
          if (specifiedSource) {
            initialSource = specifiedSource;
          }
        }
        setActiveSource(initialSource);

        if (m) {
          const saved = await provider.getWatchHistoryByMediaId(m.id);
          if (saved && saved.progress > 0) {
            const matchEpisode = !saved.episode_id || saved.episode_id === ep.id;
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
  }, [episodeId, location.search]);

  const [lastSaveTime, setLastSaveTime] = useState(0);

  const handleTimeUpdate = (currentTime: number, duration: number) => {
    if (media && duration > 0) {
      const now = Date.now();
      if (now - lastSaveTime >= 10000 || Math.floor(currentTime) >= duration - 2) {
        saveWatchProgress(media.id, episodeId || null, Math.floor(currentTime), Math.floor(duration));
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
  };

  useEffect(() => {
    if (!media?.id) return;
    loadSeasons(media.id);
  }, [media?.id]);

  useEffect(() => {
    if (!media?.id || currentSeason === 0) return;
    loadEpisodes(media.id, currentSeason);
  }, [media?.id, currentSeason]);

  useEffect(() => {
    if (seasons.length > 0 && !seasons.includes(currentSeason)) {
      setCurrentSeason(seasons[0]);
    }
  }, [seasons]);

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-7xl mx-auto">
        <Skeleton className="w-full aspect-video rounded-lg animate-pulse-skeleton" />
      </div>
    );
  }

  if (!episode || sources.length === 0) {
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
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 bg-background -mx-6 px-6 pb-4 border-b border-border">
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

      <VideoPlayer
        sources={sources}
        initialSourceId={activeSource?.id}
        initialCurrentTime={initialCurrentTime}
        onTimeUpdate={handleTimeUpdate}
        onSourceChange={handleSourceChange}
        onSourceFail={handleSourceFail}
      />

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
          {sources.length > 0 ? (() => {
            const activeKey = activeSource ? `${activeSource.sourceName || ''}_${activeSource.quality || ''}` : '';
            const count = sources.filter(s => `${s.sourceName || ''}_${s.quality || ''}` === activeKey).length;
            const activeIdx = sources.findIndex(s => s.id === activeSource?.id);
            const prevCount = sources.slice(0, activeIdx).filter(s => `${s.sourceName || ''}_${s.quality || ''}` === activeKey).length;
            const suffix = count > 1 ? ` (${prevCount + 1})` : '';
            return `播放线路（当前：${activeSource?.sourceName || '线路1'}${activeSource?.quality ? ` · ${activeSource.quality}` : ''}${suffix}）`;
          })() : '暂无播放线路'}
        </div>
        <div className="flex gap-2 flex-wrap">
          {(() => {
            const sourceKeyMap = new Map<string, number>();
            sources.forEach(s => {
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

      {seasons.length > 1 && (
        <div className="rounded-lg border border-border bg-card card-shadow p-4 flex gap-2 flex-wrap">
          {seasons.map((s) => (
            <Button
              key={s}
              variant={currentSeason === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setCurrentSeason(s); if (media?.id) loadEpisodes(media.id, s); }}
            >
              第 {s} 季
            </Button>
          ))}
        </div>
      )}

      {media?.type !== 'MOVIE' && episodes.length > 0 && (
        <div className="rounded-lg border border-border bg-card card-shadow">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="text-base font-medium">集数</h3>
          </div>
          <div className="px-5 py-3">
            <div className="flex flex-wrap gap-1.5">
              {episodes.map((ep: any) => (
                <Button
                  key={ep.id}
                  variant={ep.id === episodeId ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => navigate(`/play/${ep.id}`)}
                >
                  {ep.title || `第${ep.episodeNumber}集`}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}