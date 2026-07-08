import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore } from '../useAppStore';
import { getProvider } from '../init';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Heart, Play } from 'lucide-react';
import type { Media } from '@movie-app/core';

export default function DetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentMedia, episodes, seasons, isLoading, loadMediaDetail, loadSeasons, loadEpisodes, toggleFav } = useAppStore();
  const [currentSeason, setCurrentSeason] = useState(1);
  const [isFav, setIsFav] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadMediaDetail(id);
    loadSeasons(id);
    loadEpisodes(id, 1);
    getProvider().isFavorite(id).then(setIsFav).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (seasons.length > 0 && !seasons.includes(currentSeason)) {
      setCurrentSeason(seasons[0]);
    }
  }, [seasons]);

  const handleSeasonChange = (s: number) => {
    setCurrentSeason(s);
    if (id) loadEpisodes(id, s);
  };

  const handleFav = async () => {
    if (!id) return;
    const result = await toggleFav(id);
    setIsFav(result);
  };

  if (isLoading && !currentMedia) {
    return (
      <div className="p-6 flex gap-6">
        <Skeleton className="w-48 h-72 rounded-lg" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  const media = currentMedia as Media | null;
  if (!media) {
    return <div className="p-6 text-destructive">加载失败</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex gap-6">
        <div className="w-48 shrink-0 aspect-[2/3] rounded-lg overflow-hidden bg-secondary">
          {media.posterUrl && (
            <img src={media.posterUrl} alt={media.title} className="size-full object-cover" />
          )}
        </div>
        <div className="flex-1 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-3xl font-bold">{media.title}</h1>
            <Button variant={isFav ? 'default' : 'outline'} size="sm" onClick={handleFav}>
              <Heart className={`size-4 ${isFav ? 'fill-current' : ''}`} />
              {isFav ? '已收藏' : '收藏'}
            </Button>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <span>{media.year}</span>
            <span>·</span>
            <span>{media.area || '未知'}</span>
            {media.status && (
              <Badge variant="secondary">
                {media.status === 'ONGOING' ? '连载中' : media.status === 'COMPLETED' ? '已完结' : '已发布'}
              </Badge>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {media.genres.map((g, i) => (
              <Badge key={i} variant="outline">{g}</Badge>
            ))}
          </div>
          {media.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">{media.description}</p>
          )}
          {media.directors.length > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">导演：</span>
              {media.directors.join(' / ')}
            </div>
          )}
          {media.actors.length > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">主演：</span>
              {media.actors.join(' / ')}
            </div>
          )}
        </div>
      </div>

      {seasons.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {seasons.map((s) => (
            <Button
              key={s}
              variant={currentSeason === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleSeasonChange(s)}
            >
              第 {s} 季
            </Button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">剧集 ({episodes.length})</h2>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
          {episodes.map((ep: any) => (
            <Button
              key={ep.id}
              variant="secondary"
              className="justify-start"
              onClick={() => navigate(`/play/${ep.id}`)}
            >
              <Play className="size-3" />
              <span className="truncate">{ep.title || `第${ep.episodeNumber}集`}</span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
