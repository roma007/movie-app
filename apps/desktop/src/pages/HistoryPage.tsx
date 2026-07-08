import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../useAppStore';
import { getProvider } from '../init';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Trash2, Play } from 'lucide-react';
import type { Media } from '@movie-app/core';

export default function HistoryPage() {
  const { watchHistory, loadWatchHistory, clearHistory, removeHistoryItem } = useAppStore();
  const navigate = useNavigate();
  const [mediaMap, setMediaMap] = useState<Record<string, Media | null>>({});

  useEffect(() => {
    loadWatchHistory(1);
  }, []);

  useEffect(() => {
    (async () => {
      const provider = getProvider();
      const ids = [...new Set(watchHistory.map((h) => h.mediaId))];
      const entries = await Promise.all(
        ids.map(async (id) => [id, await provider.getMediaById(id)] as const)
      );
      setMediaMap(Object.fromEntries(entries));
    })();
  }, [watchHistory]);

  const handleClear = () => {
    if (confirm('确定清除所有观看历史吗？')) {
      clearHistory();
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">观看历史</h1>
        {watchHistory.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleClear}>
            <Trash2 className="size-4" /> 清除全部
          </Button>
        )}
      </div>

      {watchHistory.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          暂无观看历史
        </div>
      ) : (
        <div className="space-y-3">
          {watchHistory.map((h) => {
            const m = mediaMap[h.mediaId];
            const pct = h.duration > 0 ? Math.round((h.progress / h.duration) * 100) : 0;
            return (
              <Card key={h.id} className="p-3 flex items-center gap-4">
                <div className="w-12 h-16 shrink-0 rounded bg-secondary overflow-hidden">
                  {m?.posterUrl && (
                    <img src={m.posterUrl} alt={m.title} className="size-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{m?.title || '未知视频'}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    观看至 {pct}% · {new Date(h.updatedAt).toLocaleString()}
                  </div>
                  <div className="h-1 bg-secondary rounded mt-2 overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="flex gap-2">
                  {h.episodeId && (
                    <Button size="sm" onClick={() => navigate(`/play/${h.episodeId}`)}>
                      <Play className="size-3" /> 继续
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeHistoryItem(h.mediaId)}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
