import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../useAppStore';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, RefreshCw, Sparkles, RotateCcw, ThumbsDown, ThumbsUp, Search, Eye } from 'lucide-react';
import type { RecommendationOverview } from '@movie-app/core';

export default function RecommendationSettingsPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { getRecommendationOverview, resetRecommendationLearning, flushRecommendationRecompute } = useAppStore();
  const [overview, setOverview] = useState<RecommendationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  const loadOverview = async () => {
    try {
      const data = await getRecommendationOverview();
      setOverview(data);
    } catch (err: any) {
      toast(`加载推荐偏好失败: ${err?.message || '未知错误'}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const handleReset = async () => {
    const ok = await confirm({
      title: '从头学习',
      description: '将清空「越看越懂你」已学到的偏好，并从现在起重新学习。观看历史、收藏与续播进度记录都会保留，但重置前的观看、搜索与收藏不再参与推荐学习。',
      confirmText: '从头学习',
      variant: 'destructive',
    });
    if (!ok) return;
    setResetting(true);
    try {
      await resetRecommendationLearning();
      toast('已从头学习，推荐将从你的新观看行为重新积累');
      await loadOverview();
    } catch (err: any) {
      toast(`操作失败: ${err?.message || '未知错误'}`, 'error');
    } finally {
      setResetting(false);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    await flushRecommendationRecompute();
    await loadOverview();
    toast('推荐分已重新计算');
  };

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate('/settings')} className="hover:text-text">
              <ArrowLeft className="size-4 mr-2" /> 返回
            </Button>
            <h1 className="text-2xl font-bold">推荐偏好</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleRefresh} className="shrink-0">
              <RefreshCw className="size-4" /> 重新计算
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={resetting} className="text-error hover:text-error shrink-0">
              <RotateCcw className="size-4" /> {resetting ? '学习中...' : '从头学习'}
            </Button>
          </div>
        </div>
      </div>

      <Card className="p-4">
        <p className="text-sm text-muted-foreground leading-relaxed">
          「越看越懂你」会根据你的观看行为自动学习偏好：完播一部 +10、连续追多集 +5、收藏 +20、
          点开弃看 -10、展示多次未点开 -5、搜索命中 +3，并从经常「点开就弃」的子分类中降低推荐权重。
          所有信号都来自应用自身数据，可随时「从头学习」。
        </p>
      </Card>

      {loading || !overview ? (
        <Card className="p-5 space-y-4">
          <Skeleton className="h-6 w-40 rounded" />
          <Skeleton className="h-6 w-full rounded" />
          <Skeleton className="h-6 w-3/4 rounded" />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 flex items-center gap-3">
              <ThumbsUp className="size-5 text-success shrink-0" />
              <div>
                <div className="text-2xl font-bold leading-none">{overview.completedCount}</div>
                <div className="text-xs text-muted-foreground mt-1">完播影片</div>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-3">
              <ThumbsDown className="size-5 text-error shrink-0" />
              <div>
                <div className="text-2xl font-bold leading-none">{overview.giveUpCount}</div>
                <div className="text-xs text-muted-foreground mt-1">点开弃看</div>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-3">
              <Search className="size-5 text-muted-foreground shrink-0" />
              <div>
                <div className="text-2xl font-bold leading-none">{overview.searchKeywordCount}</div>
                <div className="text-xs text-muted-foreground mt-1">搜索关键词</div>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-3">
              <Eye className="size-5 text-muted-foreground shrink-0" />
              <div>
                <div className="text-2xl font-bold leading-none">{overview.impressionMediaCount}</div>
                <div className="text-xs text-muted-foreground mt-1">展示追踪</div>
              </div>
            </Card>
          </div>

          <Card className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-muted-foreground" />
              <h2 className="font-medium">当前高评分（为你推荐靠前）</h2>
            </div>
            {overview.topMedia.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                暂无学习数据。多看一些影片后，这里会显示你的高分偏好。
              </p>
            ) : (
              <div className="space-y-1">
                {overview.topMedia.map((m) => (
                  <button
                    key={m.id}
                    className="flex items-center justify-between w-full px-3 py-2 rounded-md text-left hover:bg-hover transition-colors"
                    onClick={() => navigate(`/media/${m.id}`)}
                  >
                    <span className="text-sm truncate">{m.title}</span>
                    <span className="text-sm text-muted-foreground shrink-0 ml-3">+{m.score}</span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ThumbsDown className="size-4 text-muted-foreground" />
              <h2 className="font-medium">降权子分类（点开即弃比例过高）</h2>
            </div>
            {overview.penalizedSubtypes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                暂无降权子分类。当某个子分类的弃看样本足够多时，会自动降低其推荐权重。
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {overview.penalizedSubtypes.map((g) => (
                  <span key={g} className="px-3 py-1 rounded-md bg-muted-foreground/15 text-sm">
                    {g}
                  </span>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
