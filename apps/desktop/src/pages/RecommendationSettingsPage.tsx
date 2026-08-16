import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../useAppStore';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, RefreshCw, Sparkles, RotateCcw, ThumbsDown, ThumbsUp, Search, Eye, X, Plus, Ban } from 'lucide-react';
import type { RecommendationOverview, DislikedMediaItem, TagBlacklistItem } from '@movie-app/core';

const TAG_TYPE_LABEL: Record<TagBlacklistItem['tagType'], string> = {
  genre: '类型',
  director: '导演',
  actor: '演员',
  keyword: '关键词',
};

const TAG_TYPE_OPTIONS = ['genre', 'director', 'actor', 'keyword'] as const;

export default function RecommendationSettingsPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { getRecommendationOverview, resetRecommendationLearning, flushRecommendationRecompute, getDislikedMedia, listInterestTagBlacklist, toggleInterestTagBlacklist, toggleDislike } = useAppStore();
  const [overview, setOverview] = useState<RecommendationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [dislikedList, setDislikedList] = useState<DislikedMediaItem[]>([]);
  const [blacklist, setBlacklist] = useState<TagBlacklistItem[]>([]);
  const [newTag, setNewTag] = useState('');
  const [newTagType, setNewTagType] = useState<TagBlacklistItem['tagType']>('genre');

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

  const loadLists = async () => {
    try {
      const [d, b] = await Promise.all([getDislikedMedia(), listInterestTagBlacklist()]);
      setDislikedList(d);
      setBlacklist(b);
    } catch (err: any) {
      toast(`加载列表失败: ${err?.message || '未知错误'}`, 'error');
    }
  };

  useEffect(() => {
    loadOverview();
    loadLists();
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
    await loadLists();
    toast('推荐分已重新计算');
  };

  const handleAddTag = async () => {
    const tag = newTag.trim();
    if (!tag) return;
    try {
      await toggleInterestTagBlacklist(tag, newTagType);
      setNewTag('');
      await loadLists();
      toast(`已屏蔽 ${TAG_TYPE_LABEL[newTagType]}「${tag}」`);
    } catch (err: any) {
      toast(`操作失败: ${err?.message || '未知错误'}`, 'error');
    }
  };

  const handleRemoveTag = async (item: TagBlacklistItem) => {
    try {
      await toggleInterestTagBlacklist(item.tag, item.tagType);
      await loadLists();
      toast(`已取消屏蔽 ${TAG_TYPE_LABEL[item.tagType]}「${item.tag}」`);
    } catch (err: any) {
      toast(`操作失败: ${err?.message || '未知错误'}`, 'error');
    }
  };

  const handleRemoveDislike = async (mediaId: string) => {
    try {
      await toggleDislike(mediaId);
      await loadLists();
      toast('已取消不感兴趣');
    } catch (err: any) {
      toast(`操作失败: ${err?.message || '未知错误'}`, 'error');
    }
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
            <Card className="p-4 flex items-center gap-3">
              <Ban className="size-5 text-error shrink-0" />
              <div>
                <div className="text-2xl font-bold leading-none">{overview.dislikedMediaCount}</div>
                <div className="text-xs text-muted-foreground mt-1">不感兴趣</div>
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

          <Card className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Ban className="size-4 text-muted-foreground" />
              <h2 className="font-medium">已屏蔽的兴趣标签</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              被屏蔽的标签不再参与推荐学习与打分。影片详情页点「不感兴趣」会自动降低其类型/导演/演员类内容的权重。
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddTag();
                }}
                placeholder="输入要屏蔽的标签名（如：恐怖）"
                className="flex-1 min-w-40 h-9"
              />
              <select
                value={newTagType}
                onChange={(e) => setNewTagType(e.target.value as TagBlacklistItem['tagType'])}
                className="h-9 rounded-md bg-[var(--color-input-alpha)] px-2 text-sm focus:outline-none"
              >
                {TAG_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {TAG_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <Button variant="outline" size="sm" onClick={handleAddTag} disabled={!newTag.trim()} className="h-9 shrink-0">
                <Plus className="size-4" /> 添加
              </Button>
            </div>
            {blacklist.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                暂无已屏蔽标签。
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {blacklist.map((item) => (
                  <Badge key={`${item.tagType}:${item.tag}`} variant="outline" className="gap-1.5 pr-1.5 py-1">
                    {TAG_TYPE_LABEL[item.tagType]}：{item.tag}
                    <button
                      onClick={() => handleRemoveTag(item)}
                      className="text-muted-foreground hover:text-text transition-colors"
                      title="取消屏蔽"
                    >
                      <X className="size-3.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ThumbsDown className="size-4 text-error" />
              <h2 className="font-medium">不感兴趣影片（{dislikedList.length}）</h2>
            </div>
            {dislikedList.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                暂无。在影片详情页点「不感兴趣」即可加入，这类影片将不再出现在推荐列表中。
              </p>
            ) : (
              <div className="space-y-1">
                {dislikedList.map((m) => (
                  <div key={m.mediaId} className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-hover transition-colors">
                    <button
                      className="flex-1 text-left text-sm truncate hover:text-text"
                      onClick={() => navigate(`/media/${m.mediaId}`)}
                    >
                      {m.title || m.mediaId}
                    </button>
                    <button
                      onClick={() => handleRemoveDislike(m.mediaId)}
                      className="text-muted-foreground hover:text-text shrink-0 transition-colors"
                      title="取消不感兴趣"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
