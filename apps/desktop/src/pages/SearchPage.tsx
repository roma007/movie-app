import { useState } from 'react';
import { useAppStore, getCollector } from '../useAppStore';
import { MediaGrid } from '@/components/MediaCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';

export default function SearchPage() {
  const { mediaList, isLoading, searchMedia } = useAppStore();
  const [keyword, setKeyword] = useState('');

  const handleSearch = async () => {
    const kw = keyword.trim();
    if (!kw) return;
    try {
      const collector = getCollector();
      await collector.collectByKeyword(kw);
      await searchMedia(kw);
    } catch (err) {
      console.error('搜索失败:', err);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-2xl font-bold">搜索</h1>

      <div className="flex gap-2 max-w-xl">
        <Input
          placeholder="搜索电影、电视剧、综艺..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <Button onClick={handleSearch} disabled={isLoading}>
          <Search className="size-4" />
          {isLoading ? '搜索中...' : '搜索'}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">搜索中...</div>
      ) : (
        <MediaGrid items={mediaList} />
      )}
    </div>
  );
}
