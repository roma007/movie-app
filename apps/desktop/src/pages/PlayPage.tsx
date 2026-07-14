import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getProvider } from '../init';
import { useAppStore } from '../useAppStore';
import { VideoPlayer } from '@/components/player/VideoPlayer';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft } from 'lucide-react';
import type { Episode, Media, PlaySource } from '@movie-app/core';

export default function PlayPage() {
  const { episodeId } = useParams<{ episodeId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { saveWatchProgress } = useAppStore();
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [sources, setSources] = useState<PlaySource[]>([]);
  const [activeSource, setActiveSource] = useState<PlaySource | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!episodeId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
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
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="hover:text-primary">
        <ArrowLeft className="size-4" /> 返回
      </Button>

      <VideoPlayer
        sources={sources}
        initialSourceId={activeSource?.id}
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
    </div>
  );
}