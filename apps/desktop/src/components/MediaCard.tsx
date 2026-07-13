import { useNavigate } from 'react-router-dom';
import type { Media } from '@movie-app/core';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const typeLabel: Record<string, string> = {
  MOVIE: '电影',
  TV: '电视剧',
  VARIETY: '综艺',
  ANIME: '动漫',
  DOCUMENTARY: '纪录片',
};

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
            <div className="size-full flex items-center justify-center text-muted-foreground text-[10px]">
              无封面
            </div>
          )}
        </div>
        <div className="px-1.5 py-1">
          <div className="text-[10px] truncate">{media.title}</div>
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
        <Badge 
          variant="secondary" 
          className="absolute top-2 right-2 shrink-0 text-[10px] px-1.5 py-0.5 bg-black/60 backdrop-blur-sm border-none"
        >
          {typeLabel[media.type] || media.type}
        </Badge>
      </div>
      <div className="p-2.5 space-y-1.5">
        <div className="text-sm font-medium truncate">{media.title}</div>
        <div className="flex gap-1 flex-wrap">
          {media.genres.slice(0, 2).map((g, i) => (
            <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0.5">
              {g}
            </Badge>
          ))}
        </div>
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