import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Media, MediaNavState } from '@movie-app/core';
import { openMediaPlay } from '../utils/openMediaPlay';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PosterImage } from '@/components/PosterImage';
import { X, Star } from 'lucide-react';

export function MediaCard({ 
  media, 
  navigateState,
  onBeforeNavigate,
  size = 'normal',
  onDelete,
}: { 
  media: Media; 
  navigateState?: MediaNavState;
  onBeforeNavigate?: () => void;
  size?: 'normal' | 'small';
  onDelete?: (media: Media) => void;
}) {
  const navigate = useNavigate();

  const [resolving, setResolving] = useState(false);
  const handleOpen = useCallback(async () => {
    if (resolving) return;
    onBeforeNavigate?.();
    setResolving(true);
    try {
      await openMediaPlay(navigate, media, navigateState);
    } finally {
      setResolving(false);
    }
  }, [resolving, media, navigateState, navigate, onBeforeNavigate]);

  if (size === 'small') {
    return (
      <div
        className="group cursor-pointer overflow-hidden rounded-lg bg-[var(--color-card-alpha)] backdrop-blur-sm transition-all duration-300"
        onClick={handleOpen}
      >
        <div className="aspect-[2/3] bg-[var(--color-secondary-alpha)] overflow-hidden relative">
          <PosterImage
            src={media.posterUrl}
            alt={media.title}
            className="size-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          {media.rating != null && media.rating > 0 && (
            <Badge
              variant="secondary"
              className="absolute top-1 right-1 shrink-0 text-[10px] px-1.5 py-0.5 bg-black/50 backdrop-blur-sm border-none text-amber-400 font-semibold"
            >
              <Star className="size-2.5 fill-current mr-0.5" />
              {media.rating.toFixed(1)}
            </Badge>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(media);
              }}
              className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full bg-error hover:bg-error/90 text-white"
              title="删除记录"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="px-1.5 py-1">
          <div className="text-xs truncate">{media.title}</div>
        </div>
      </div>
    );
  }
  
  return (
    <Card
      className="group cursor-pointer overflow-hidden p-0 gap-0 transition-all duration-300 hover:shadow-card"
      onClick={handleOpen}
    >
      <div className="aspect-[2/3] bg-[var(--color-secondary-alpha)] overflow-hidden relative">
        <PosterImage
          src={media.posterUrl}
          alt={media.title}
          className="size-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        {media.rating != null && media.rating > 0 && (
          <Badge
            variant="secondary"
            className="absolute top-2 right-2 shrink-0 text-xs px-2 py-1 bg-black/50 backdrop-blur-sm border-none text-amber-400 font-semibold"
          >
            <Star className="size-3 fill-current mr-0.5" />
            {media.rating.toFixed(1)}
          </Badge>
        )}
        {(media.status === 'ONGOING' || media.status === 'PUBLISHED') && media.type !== 'VARIETY' && media.currentEpisodes && (
          <Badge 
            variant="secondary" 
            className="absolute top-2 left-2 shrink-0 text-xs px-2 py-1 bg-muted-foreground/50 backdrop-blur-sm border-none text-white"
          >
            更新至第{media.currentEpisodes}集
          </Badge>
        )}
        {(media.status === 'ONGOING' || media.status === 'PUBLISHED') && media.type === 'VARIETY' && media.remarks && (
          <Badge 
            variant="secondary" 
            className="absolute top-2 left-2 shrink-0 text-xs px-2 py-1 bg-muted-foreground/50 backdrop-blur-sm border-none text-white"
          >
            {media.remarks}
          </Badge>
        )}
        {media.status === 'COMPLETED' && media.type !== 'VARIETY' && media.totalEpisodes != null && (
          <Badge 
            variant="secondary" 
            className="absolute top-2 left-2 shrink-0 text-xs px-2 py-1 bg-muted-foreground/80 backdrop-blur-sm border-none text-white"
          >
            完结 全{media.totalEpisodes}集
          </Badge>
        )}
        {media.status === 'COMPLETED' && media.type !== 'VARIETY' && media.totalEpisodes == null && (
          <Badge 
            variant="secondary" 
            className="absolute top-2 left-2 shrink-0 text-xs px-2 py-1 bg-muted-foreground/80 backdrop-blur-sm border-none text-white"
          >
            已完结
          </Badge>
        )}
        {media.status === 'COMPLETED' && media.type === 'VARIETY' && media.remarks && (
          <Badge 
            variant="secondary" 
            className="absolute top-2 left-2 shrink-0 text-xs px-2 py-1 bg-muted-foreground/80 backdrop-blur-sm border-none text-white"
          >
            {media.remarks}
          </Badge>
        )}
      </div>
      <div className="p-2.5 space-y-1.5">
        <div className="text-sm font-medium truncate">{media.title}</div>
        {media.actors.length > 0 && (
          <div className="text-xs text-secondary-foreground truncate">
            {media.actors.slice(0, 2).join(' / ')}
          </div>
        )}
        <div className="text-xs text-secondary-foreground">
          {media.year} · {media.area || '未知'}
        </div>
      </div>
    </Card>
  );
}

export function MediaGrid({ 
  items, 
  navigateState,
  onBeforeNavigate,
}: { 
  items: Media[]; 
  navigateState?: MediaNavState;
  onBeforeNavigate?: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        暂无内容
      </div>
    );
  }
  return (
    <div className="grid grid-cols-6 gap-4">
      {items.map((m) => (
        <MediaCard key={m.id} media={m} navigateState={navigateState} onBeforeNavigate={onBeforeNavigate} />
      ))}
    </div>
  );
}