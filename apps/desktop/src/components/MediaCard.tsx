import { useNavigate } from 'react-router-dom';
import type { Media } from '@movie-app/core';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function MediaCard({ 
  media, 
  navigateState,
  onBeforeNavigate,
  size = 'normal',
}: { 
  media: Media; 
  navigateState?: { page?: number; type?: string; subType?: string; year?: number; area?: string; episodeType?: string };
  onBeforeNavigate?: () => void;
  size?: 'normal' | 'small';
}) {
  const navigate = useNavigate();
  
  if (size === 'small') {
    return (
      <div
        className="group cursor-pointer overflow-hidden rounded-lg border border-border hover:border-highlight transition-all duration-300"
        onClick={() => {
          onBeforeNavigate?.();
          navigate(`/media/${media.id}`, { state: navigateState });
        }}
      >
        <div className="aspect-[2/3] bg-secondary overflow-hidden">
          {media.posterUrl ? (
            <img
              src={media.posterUrl}
              alt={media.title}
              loading="lazy"
              className="size-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="size-full flex items-center justify-center text-muted-foreground text-xs">
              无封面
            </div>
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
      className="group cursor-pointer overflow-hidden p-0 gap-0 bg-card border-border hover:border-highlight hover:shadow-card transition-all duration-300"
      onClick={() => {
        onBeforeNavigate?.();
        navigate(`/media/${media.id}`, { state: navigateState });
      }}
    >
      <div className="aspect-[2/3] bg-secondary overflow-hidden relative">
        {media.posterUrl ? (
          <img
            src={media.posterUrl}
            alt={media.title}
            loading="lazy"
            className="size-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="size-full flex items-center justify-center text-muted-foreground text-xs">
            无封面
          </div>
        )}
        {(media.status === 'ONGOING' || media.status === 'PUBLISHED') && media.type !== 'VARIETY' && media.currentEpisodes && (
          <Badge 
            variant="secondary" 
            className="absolute top-2 left-2 shrink-0 text-xs px-2 py-1 bg-primary/80 backdrop-blur-sm border-none text-white"
          >
            更新至第{media.currentEpisodes}集
          </Badge>
        )}
        {(media.status === 'ONGOING' || media.status === 'PUBLISHED') && media.type === 'VARIETY' && media.remarks && (
          <Badge 
            variant="secondary" 
            className="absolute top-2 left-2 shrink-0 text-xs px-2 py-1 bg-primary/80 backdrop-blur-sm border-none text-white"
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
          <div className="text-xs text-muted-foreground truncate">
            {media.actors.slice(0, 2).join(' / ')}
          </div>
        )}
        <div className="text-xs text-muted-foreground">
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
  navigateState?: { page?: number; type?: string; subType?: string; year?: number; area?: string; episodeType?: string };
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