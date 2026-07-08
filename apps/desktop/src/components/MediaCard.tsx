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

export function MediaCard({ media }: { media: Media }) {
  const navigate = useNavigate();
  return (
    <Card
      className="group cursor-pointer overflow-hidden p-0 gap-0 bg-card hover:ring-1 hover:ring-primary/60 transition"
      onClick={() => navigate(`/media/${media.id}`)}
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
      <div className="p-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate">{media.title}</span>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {typeLabel[media.type] || media.type}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {media.year} · {media.area || '未知'}
        </div>
      </div>
    </Card>
  );
}

export function MediaGrid({ items }: { items: Media[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        暂无内容
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
      {items.map((m) => (
        <MediaCard key={m.id} media={m} />
      ))}
    </div>
  );
}
