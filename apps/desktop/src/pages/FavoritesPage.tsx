import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../useAppStore';
import { getProvider } from '../init';
import { MediaGrid } from '@/components/MediaCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import type { Media } from '@movie-app/core';
import { useBackgroundStore } from '../themes/backgroundStore';

export default function FavoritesPage() {
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);
  useEffect(() => { clearBgImage(); }, [clearBgImage]);
  const { favorites, loadFavorites } = useAppStore();
  const navigate = useNavigate();
  const [medias, setMedias] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadFavorites();
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const provider = getProvider();
      const results = await Promise.all(
        favorites.map((f) => provider.getMediaById(f.mediaId))
      );
      setMedias(results.filter((m): m is Media => m !== null));
    })();
  }, [favorites]);

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate(-1)} className="hover:text-text">
            <ArrowLeft className="size-4 mr-2" /> 返回
          </Button>
          <h1 className="text-2xl font-bold">收藏</h1>
        </div>
      </div>
      {loading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] rounded-lg animate-pulse-skeleton" />
          ))}
        </div>
      ) : medias.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          暂无收藏
        </div>
      ) : (
        <MediaGrid items={medias} />
      )}
    </div>
  );
}