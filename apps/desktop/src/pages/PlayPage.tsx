import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getProvider } from '../init';
import { useAppStore } from '../useAppStore';
import { VideoPlayer } from '@/components/player/VideoPlayer';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft } from 'lucide-react';
import type { Episode, Media, PlaySource } from '@movie-app/core';

export default function PlayPage() {
  const { episodeId } = useParams<{ episodeId: string }>();
  const navigate = useNavigate();
  const { saveWatchProgress } = useAppStore();
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [sources, setSources] = useState<PlaySource[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
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
          provider.getPlaySourcesByEpisodeId(ep.mediaId),
        ]);
        if (cancelled) return;
        setMedia(m);
        setSources(ps);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [episodeId]);

  const handleTimeUpdate = (currentTime: number, duration: number) => {
    if (media && duration > 0) {
      saveWatchProgress(media.id, episodeId || null, Math.floor(currentTime), Math.floor(duration));
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="w-full aspect-video rounded-lg" />
      </div>
    );
  }

  if (!episode || sources.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" /> 返回
        </Button>
        <div className="text-muted-foreground">无可播放的剧集或线路</div>
      </div>
    );
  }

  const activeSource = sources[activeIdx] || sources[0];

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
        <ArrowLeft className="size-4" /> 返回
      </Button>

      <VideoPlayer url={activeSource.url} onTimeUpdate={handleTimeUpdate} />

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

      {sources.length > 1 && (
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">播放线路</div>
          <div className="flex gap-2 flex-wrap">
            {sources.map((s, i) => (
              <Button
                key={s.id}
                variant={i === activeIdx ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveIdx(i)}
              >
                {s.sourceName || `线路${i + 1}`}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
