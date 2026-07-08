import { useEffect, useState } from 'react';
import { useAppStore, getCollector } from '../useAppStore';
import { MediaGrid } from '@/components/MediaCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const filters: { label: string; type?: string }[] = [
  { label: '全部' },
  { label: '电影', type: 'MOVIE' },
  { label: '电视剧', type: 'TV' },
  { label: '综艺', type: 'VARIETY' },
  { label: '动漫', type: 'ANIME' },
  { label: '纪录片', type: 'DOCUMENTARY' },
];

export default function HomePage() {
  const { mediaList, isLoading, loadMediaList } = useAppStore();
  const [activeType, setActiveType] = useState<string | undefined>(undefined);
  const [collecting, setCollecting] = useState(false);

  useEffect(() => {
    loadMediaList({ page: 1, pageSize: 60, type: activeType });
  }, [activeType]);

  const handleCollectLatest = async () => {
    setCollecting(true);
    try {
      const collector = getCollector();
      await collector.collectLatest(1, 20);
      await loadMediaList({ page: 1, pageSize: 60, type: activeType });
    } catch (err) {
      console.error('采集失败:', err);
    } finally {
      setCollecting(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">首页</h1>
        <Button onClick={handleCollectLatest} disabled={collecting} variant="default" size="sm">
          {collecting ? '采集中...' : '采集最新'}
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {filters.map((f) => (
          <Button
            key={f.label}
            variant={activeType === f.type ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveType(f.type)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] rounded-lg" />
          ))}
        </div>
      ) : (
        <MediaGrid items={mediaList} />
      )}
    </div>
  );
}
