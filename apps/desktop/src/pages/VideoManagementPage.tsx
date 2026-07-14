import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Radar, Loader2, CheckCircle2, AlertCircle, Film, Tv, Video, Disc, FileText, Database, EyeOff, X, Save, RotateCcw, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore, getProvider } from '../useAppStore';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/Layout';
import type { ShortDramaConfig } from '@movie-app/core';

interface MediaStats {
  total: number;
  byType: { type: string; count: number }[];
}

export default function VideoManagementPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const {
    deleteAllMedia,
    deleteMediaWithoutPlaySource,
    deleteMediaByGenres,
    getSubTypesByType,
    getReprobeMediaCount,
    loadReprobeMediaList,
    batchReprobeMedia,
    reprobeProgress,
    reprobeMediaCount,
    reprobeMediaList,
    hideMediaByGenres,
    unhideMediaByGenres,
    getHiddenMediaCount,
    runningReprobeTask,
    startReprobeTask,
    startFullReprobeTask,
    getFullReprobeMediaCount,
    cancelReprobeTask,
    loadRunningReprobeTask,
    shortDramaConfig,
    loadShortDramaConfig,
    updateShortDramaConfig,
    getDefaultShortDramaConfig,
  } = useAppStore();

  const [stats, setStats] = useState<MediaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [hiddenCount, setHiddenCount] = useState(0);

  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ deleted: number } | null>(null);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [allGenres, setAllGenres] = useState<string[]>([]);
  const [deleteMediaType, setDeleteMediaType] = useState<string>('');
  const [hideMediaType, setHideMediaType] = useState<string>('');
  const [hideAllGenres, setHideAllGenres] = useState<string[]>([]);
  const [visibleGenres, setVisibleGenres] = useState<string[]>([]);
  const [togglingGenre, setTogglingGenre] = useState<string | null>(null);
  const [reprobing, setReprobing] = useState(false);
  const [fullReprobing, setFullReprobing] = useState(false);
  const [fullReprobeResult, setFullReprobeResult] = useState<{
    total: number;
    longDrama: number;
    shortDrama: number;
    failed: number;
    failedItems: { id: string; title: string }[];
  } | null>(null);
  const [fullReprobeMediaCount, setFullReprobeMediaCount] = useState(0);
  const [localConfig, setLocalConfig] = useState<ShortDramaConfig | null>(null);
  const [configSaved, setConfigSaved] = useState(false);
  const [patternInput, setPatternInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [reprobeResult, setReprobeResult] = useState<{
    total: number;
    longDrama: number;
    shortDrama: number;
    failed: number;
    failedItems: { id: string; title: string }[];
  } | null>(null);
  const [pollProgress, setPollProgress] = useState<{
    total: number;
    processed: number;
    longDrama: number;
    shortDrama: number;
    failed: number;
    currentMediaTitle: string;
  } | null>(null);

  const MEDIA_TYPES = [
    { value: '', label: '全部' },
    { value: 'MOVIE', label: '电影' },
    { value: 'TV', label: '电视剧' },
    { value: 'VARIETY', label: '综艺' },
    { value: 'ANIME', label: '动漫' },
    { value: 'DOCUMENTARY', label: '纪录片' },
  ];

  const loadStats = async () => {
    try {
      const provider = getProvider();
      const total = await provider.selectOne<{ count: number }>('SELECT COUNT(*) as count FROM media');
      const byType = await provider.select<{ type: string; count: number }>('SELECT type, COUNT(*) as count FROM media GROUP BY type');
      const hidden = await getHiddenMediaCount();
      setStats({
        total: total?.count || 0,
        byType: byType || [],
      });
      setHiddenCount(hidden);
    } catch (err) {
      console.error('加载统计失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    loadReprobeMediaList();
    loadRunningReprobeTask();
    loadShortDramaConfig();
    getFullReprobeMediaCount().then(setFullReprobeMediaCount);
  }, []);

  useEffect(() => {
    setSelectedGenres([]);
    getSubTypesByType(deleteMediaType || undefined, true).then(genres => setAllGenres(genres));
  }, [deleteMediaType]);

  useEffect(() => {
    if (shortDramaConfig) {
      setLocalConfig({ ...shortDramaConfig });
    }
  }, [shortDramaConfig]);

  useEffect(() => {
    Promise.all([
      getSubTypesByType(hideMediaType || undefined, true),
      getSubTypesByType(hideMediaType || undefined, false),
    ]).then(([all, visible]) => {
      setHideAllGenres(all);
      setVisibleGenres(visible);
    });
  }, [hideMediaType]);

  const handleDeleteAllMedia = async () => {
    const ok = await confirm({
      title: '删除所有视频',
      description: '确定要删除所有视频吗？此操作无法撤销，所有播放源、剧集、收藏和观看历史都将被删除。',
      confirmText: '删除',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await deleteAllMedia();
      toast('所有视频已删除');
      loadStats();
    } catch (err: any) {
      toast(`删除失败: ${err.message}`, 'error');
    }
  };

  const handleDeleteMediaWithoutPlaySource = async () => {
    const ok = await confirm({
      title: '删除无播放源视频',
      description: '确定要删除所有没有播放源的视频吗？此操作无法撤销。',
      confirmText: '删除',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      const deletedCount = await deleteMediaWithoutPlaySource();
      toast(`已删除 ${deletedCount} 个没有播放源的视频`);
      loadStats();
      const remaining = await deleteMediaWithoutPlaySource();
      if (remaining > 0) {
        toast(`警告: 仍有 ${remaining} 个无播放源视频未删除`, 'error');
      } else {
        toast('验证通过: 已无无播放源视频', 'success');
      }
    } catch (err: any) {
      toast(`删除失败: ${err.message}`, 'error');
    }
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres(prev =>
      prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]
    );
  };

  const handleDeleteByGenre = async () => {
    if (selectedGenres.length === 0) return;
    setDeleting(true);
    setDeleteResult(null);
    try {
      const result = await deleteMediaByGenres(selectedGenres);
      setDeleteResult(result);
      setSelectedGenres([]);
      loadStats();
    } catch (err) {
      console.error('删除失败:', err);
    } finally {
      setDeleting(false);
    }
  };

  const reloadHideGenres = async () => {
    const [all, visible] = await Promise.all([
      getSubTypesByType(hideMediaType || undefined, true),
      getSubTypesByType(hideMediaType || undefined, false),
    ]);
    setHideAllGenres(all);
    setVisibleGenres(visible);
  };

  const handleToggleHideGenre = async (genre: string) => {
    setTogglingGenre(genre);
    try {
      const isCurrentlyHidden = !visibleGenres.includes(genre);
      if (isCurrentlyHidden) {
        await unhideMediaByGenres([genre]);
      } else {
        await hideMediaByGenres([genre]);
      }
      await reloadHideGenres();
      loadStats();
    } catch (err) {
      console.error('切换隐藏状态失败:', err);
    } finally {
      setTogglingGenre(null);
    }
  };

  const handleSaveConfig = async () => {
    if (!localConfig) return;
    await updateShortDramaConfig(localConfig);
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 2000);
  };

  const handleResetConfig = () => {
    const defaults = getDefaultShortDramaConfig();
    setLocalConfig({ ...defaults });
  };

  const addPattern = () => {
    const p = patternInput.trim();
    if (!p || !localConfig) return;
    if (localConfig.summaryPatterns.includes(p)) {
      toast('该模板已存在', 'error');
      setPatternInput('');
      return;
    }
    setLocalConfig({ ...localConfig, summaryPatterns: [...localConfig.summaryPatterns, p] });
    setPatternInput('');
  };

  const removePattern = (pattern: string) => {
    if (!localConfig) return;
    setLocalConfig({ ...localConfig, summaryPatterns: localConfig.summaryPatterns.filter(p => p !== pattern) });
  };

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (!kw || !localConfig) return;
    if (localConfig.metaKeywords.includes(kw)) {
      toast('该关键词已存在', 'error');
      setKeywordInput('');
      return;
    }
    setLocalConfig({ ...localConfig, metaKeywords: [...localConfig.metaKeywords, kw] });
    setKeywordInput('');
  };

  const removeKeyword = (keyword: string) => {
    if (!localConfig) return;
    setLocalConfig({ ...localConfig, metaKeywords: localConfig.metaKeywords.filter(k => k !== keyword) });
  };

  const handleFullReprobe = async () => {
    setFullReprobing(true);
    setFullReprobeResult(null);
    try {
      const taskId = await startFullReprobeTask();
      toast(`全量探测任务已启动，任务ID: ${taskId}`);
      pollFullReprobeTaskStatus(taskId);
    } catch (err: any) {
      console.error('启动全量探测任务失败:', err);
      toast(err.message || '启动全量探测任务失败', 'error');
      setFullReprobing(false);
    }
  };

  const pollFullReprobeTaskStatus = useCallback(async (taskId: string) => {
    const checkStatus = async () => {
      try {
        const provider = getProvider();
        const task = await provider.selectOne<{ status: string; probed_count: number; short_drama_count: number; long_drama_count: number }>(
          "SELECT status, probed_count, short_drama_count, long_drama_count FROM collect_task WHERE task_id = ?",
          [taskId]
        );
        if (!task) { setFullReprobing(false); return; }
        if (task.status === 'RUNNING' || task.status === 'PENDING') {
          setPollProgress({
            total: fullReprobeMediaCount,
            processed: task.probed_count || 0,
            longDrama: task.long_drama_count || 0,
            shortDrama: task.short_drama_count || 0,
            failed: (task.probed_count || 0) - (task.short_drama_count || 0) - (task.long_drama_count || 0),
            currentMediaTitle: '',
          });
          setTimeout(checkStatus, 2000);
        } else {
          setFullReprobing(false);
          setPollProgress(null);
          setFullReprobeResult({
            total: fullReprobeMediaCount,
            longDrama: task.long_drama_count || 0,
            shortDrama: task.short_drama_count || 0,
            failed: (task.probed_count || 0) - (task.short_drama_count || 0) - (task.long_drama_count || 0),
            failedItems: [],
          });
          loadReprobeMediaList();
          loadRunningReprobeTask();
          loadStats();
          getFullReprobeMediaCount().then(setFullReprobeMediaCount);
          if (task.status === 'COMPLETED') {
            toast('全量探测任务已完成');
          } else {
            toast('全量探测任务失败', 'error');
          }
        }
      } catch (err) {
        console.error('轮询全量探测任务状态失败:', err);
        setFullReprobing(false);
      }
    };
    checkStatus();
  }, [fullReprobeMediaCount, loadReprobeMediaList, loadRunningReprobeTask, loadStats, getFullReprobeMediaCount, toast]);

  const handleBatchReprobe = async () => {
    if (reprobeMediaList.length === 0) return;
    setReprobing(true);
    setReprobeResult(null);
    try {
      const taskId = await startReprobeTask();
      toast(`探测任务已启动，任务ID: ${taskId}`);
      // 轮询任务状态
      pollTaskStatus(taskId);
    } catch (err: any) {
      console.error('启动探测任务失败:', err);
      toast(err.message || '启动探测任务失败', 'error');
      setReprobing(false);
    }
  };

  const handleCancelReprobe = async () => {
    if (!runningReprobeTask) return;
    const ok = await confirm({
      title: '取消探测任务',
      description: '确定要取消正在运行的探测任务吗？',
      confirmText: '取消任务',
      variant: 'destructive',
    });
    if (!ok) return;
    await cancelReprobeTask(runningReprobeTask.taskId);
    setReprobing(false);
    toast('探测任务已取消');
    loadReprobeMediaList();
    loadStats();
  };

  const pollTaskStatus = useCallback(async (taskId: string) => {
    const checkStatus = async () => {
      try {
        const provider = getProvider();
        const task = await provider.selectOne<{ status: string; probed_count: number; short_drama_count: number; long_drama_count: number }>(
          "SELECT status, probed_count, short_drama_count, long_drama_count FROM collect_task WHERE task_id = ?",
          [taskId]
        );
        
        if (!task) {
          setReprobing(false);
          return;
        }

        if (task.status === 'RUNNING' || task.status === 'PENDING') {
          // 更新进度
          setPollProgress({
            total: reprobeMediaList.length,
            processed: task.probed_count || 0,
            longDrama: task.long_drama_count || 0,
            shortDrama: task.short_drama_count || 0,
            failed: (task.probed_count || 0) - (task.short_drama_count || 0) - (task.long_drama_count || 0),
            currentMediaTitle: '',
          });
          // 继续轮询
          setTimeout(checkStatus, 2000);
        } else {
          // 任务完成
          setReprobing(false);
          setPollProgress(null);
          setReprobeResult({
            total: reprobeMediaList.length,
            longDrama: task.long_drama_count || 0,
            shortDrama: task.short_drama_count || 0,
            failed: (task.probed_count || 0) - (task.short_drama_count || 0) - (task.long_drama_count || 0),
            failedItems: [],
          });
          loadReprobeMediaList();
          loadRunningReprobeTask();
          loadStats();
          if (task.status === 'COMPLETED') {
            toast('探测任务已完成');
          } else {
            toast('探测任务失败', 'error');
          }
        }
      } catch (err) {
        console.error('轮询任务状态失败:', err);
        setReprobing(false);
      }
    };
    
    checkStatus();
  }, [reprobeMediaList.length, loadReprobeMediaList, loadRunningReprobeTask, loadStats, toast]);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'MOVIE': return <Film className="size-4" />;
      case 'TV': return <Tv className="size-4" />;
      case 'VARIETY': return <Video className="size-4" />;
      case 'ANIME': return <Disc className="size-4" />;
      case 'DOCUMENTARY': return <FileText className="size-4" />;
      default: return <Database className="size-4" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'MOVIE': return '电影';
      case 'TV': return '电视剧';
      case 'VARIETY': return '综艺';
      case 'ANIME': return '动漫';
      case 'DOCUMENTARY': return '纪录片';
      default: return type;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 px-6 py-4 border-b border-border bg-background">
        <Button variant="ghost" onClick={() => navigate('/settings')} className="hover:text-primary">
          <ArrowLeft className="size-4 mr-2" />
          返回
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">视频管理</h1>
          <p className="text-sm text-muted-foreground mt-1">查看视频统计和管理视频数据</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <Card className="p-6 mb-6 bg-card border-border">
          <h2 className="text-lg font-semibold mb-4">数据统计</h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : stats ? (
            <div className="grid grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-secondary">
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-sm text-muted-foreground">总视频数</div>
              </div>
              <div className="p-4 rounded-lg bg-secondary">
                <div className="flex items-center gap-2 mb-1">
                  <EyeOff className="size-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">已隐藏</span>
                </div>
                <div className="text-2xl font-bold">{hiddenCount}</div>
              </div>
              {stats.byType.map((item) => (
                <div key={item.type} className="p-4 rounded-lg bg-secondary">
                  <div className="flex items-center gap-2 mb-1">
                    {getTypeIcon(item.type)}
                    <span className="text-sm text-muted-foreground">{getTypeLabel(item.type)}</span>
                  </div>
                  <div className="text-2xl font-bold">{item.count}</div>
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        <div className="grid grid-cols-2 gap-6 mb-6">
          <Card className="p-6 bg-card border-border">
            <h2 className="text-lg font-semibold mb-4">删除所有视频</h2>
            <p className="text-sm text-muted-foreground mb-4">
              删除所有视频数据，包括播放源、剧集、收藏和观看历史。此操作无法撤销。
            </p>
            <Button
              variant="destructive"
              onClick={handleDeleteAllMedia}
              disabled={stats?.total === 0}
              className="w-full"
            >
              <Trash2 className="size-4 mr-2" />
              删除所有视频 ({stats?.total || 0})
            </Button>
          </Card>

          <Card className="p-6 bg-card border-border">
            <h2 className="text-lg font-semibold mb-4">删除无播放源视频</h2>
            <p className="text-sm text-muted-foreground mb-4">
              删除所有没有播放源的视频。此操作无法撤销。
            </p>
            <Button
              variant="destructive"
              onClick={handleDeleteMediaWithoutPlaySource}
              className="w-full"
            >
              <Trash2 className="size-4 mr-2" />
              删除无播放源视频
            </Button>
          </Card>
        </div>

        <Card className="p-6 mb-6 bg-card border-l-4 border-l-destructive border-border">
          <h2 className="text-lg font-semibold mb-4 text-destructive">按子类型删除视频</h2>
          <p className="text-sm text-muted-foreground mb-4">
            先选择大类，再选择该大类下的子类型进行删除。此操作不可恢复。
          </p>

          <div className="flex flex-wrap gap-2 mb-4">
            {MEDIA_TYPES.map(mt => (
              <button
                key={mt.value}
                onClick={() => setDeleteMediaType(mt.value)}
                className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                  deleteMediaType === mt.value
                    ? 'bg-destructive text-white border-destructive'
                    : 'bg-card text-foreground border-border hover:border-destructive/50'
                }`}
              >
                {mt.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 max-h-60 overflow-y-auto mb-4">
            {allGenres.length === 0 && (
              <span className="text-xs text-muted-foreground">暂无子类型数据</span>
            )}
            {allGenres.map(genre => (
              <button
                key={genre}
                onClick={() => toggleGenre(genre)}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  selectedGenres.includes(genre)
                    ? 'bg-destructive text-white border-destructive'
                    : 'bg-card text-foreground border-border hover:border-destructive/50'
                }`}
              >
                {genre}
              </button>
            ))}
          </div>

          {selectedGenres.length > 0 && (
            <p className="text-xs text-muted-foreground mb-4">
              已选：{selectedGenres.join('、')}
            </p>
          )}

          {deleteResult && !deleting && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary mb-4">
              {deleteResult.deleted > 0 ? (
                <CheckCircle2 className="size-5 text-success shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="size-5 text-muted-foreground shrink-0 mt-0.5" />
              )}
              <div className="text-sm">
                {deleteResult.deleted === 0 ? (
                  <span className="text-muted-foreground">没有匹配的视频</span>
                ) : (
                  <span>
                    删除完成：成功删除 {deleteResult.deleted} 部视频
                  </span>
                )}
              </div>
            </div>
          )}

          <Button
            onClick={handleDeleteByGenre}
            disabled={deleting || selectedGenres.length === 0}
            variant="destructive"
            className="w-full"
          >
            <Trash2 className={`size-4 mr-2 ${deleting ? 'animate-spin' : ''}`} />
            {deleting ? '删除中...' : `删除所选子类型 (${selectedGenres.length})`}
          </Button>
        </Card>

        <Card className="p-6 mb-6 bg-card border-l-4 border-l-amber-500 border-border">
          <h2 className="text-lg font-semibold mb-4 text-amber-600">按子类型隐藏视频</h2>
          <p className="text-sm text-muted-foreground mb-4">
            点击子类型立即切换隐藏状态，无需确认。左栏点击可隐藏，右栏点击可取消隐藏。
          </p>

          <div className="flex flex-wrap gap-2 mb-4">
            {MEDIA_TYPES.map(mt => (
              <button
                key={mt.value}
                onClick={() => setHideMediaType(mt.value)}
                className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                  hideMediaType === mt.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-foreground border-border hover:border-primary/50'
                }`}
              >
                {mt.label}
              </button>
            ))}
          </div>

          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-muted-foreground mb-2 px-1">
                未隐藏 ({visibleGenres.length})
              </div>
              <div className="flex flex-wrap gap-2 min-h-[3rem] p-3 rounded-lg border border-border bg-secondary/30">
                {visibleGenres.length === 0 && (
                  <span className="text-xs text-muted-foreground">暂无未隐藏的子类型</span>
                )}
                {visibleGenres.map(genre => (
                  <button
                    key={genre}
                    onClick={() => handleToggleHideGenre(genre)}
                    disabled={togglingGenre === genre}
                    className="px-2.5 py-1 rounded-full text-xs border transition-colors bg-card text-foreground border-border hover:border-amber-500 hover:bg-amber-500/10 disabled:opacity-50"
                  >
                    {togglingGenre === genre ? '...' : genre}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-muted-foreground mb-2 px-1">
                已隐藏 ({hideAllGenres.length - visibleGenres.length})
              </div>
              <div className="flex flex-wrap gap-2 min-h-[3rem] p-3 rounded-lg border border-dashed border-amber-500/40 bg-secondary/50">
                {hideAllGenres.length - visibleGenres.length === 0 && (
                  <span className="text-xs text-muted-foreground">暂无已隐藏的子类型</span>
                )}
                {hideAllGenres.filter(g => !visibleGenres.includes(g)).map(genre => (
                  <button
                    key={genre}
                    onClick={() => handleToggleHideGenre(genre)}
                    disabled={togglingGenre === genre}
                    className="px-2.5 py-1 rounded-full text-xs border border-dashed border-amber-500/40 transition-colors bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {togglingGenre === genre ? '...' : <><EyeOff className="size-3" />{genre}</>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6 mb-6 bg-card border-border">
          <h2 className="text-lg font-semibold mb-4">长短剧判断配置</h2>
          <p className="text-sm text-muted-foreground mb-4">
            配置三层判断逻辑的参数。修改配置后需重新探测才能生效。
          </p>

          {localConfig && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="text-sm font-medium">第1层：从简介提取时长的匹配模板</Label>
                <p className="text-xs text-muted-foreground">用 {'{'}N{'}'} 代表数字，例如「{'{'}N{'}'}分钟」可匹配"30分钟"、"每集30分钟"等文本中的时长</p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {localConfig.summaryPatterns.map((pattern, i) => (
                    <button
                      key={i}
                      onClick={() => removePattern(pattern)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors bg-card text-foreground border-border hover:border-destructive/50 hover:text-destructive"
                    >
                      {pattern}
                      <X className="size-3" />
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={patternInput}
                    onChange={(e) => setPatternInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPattern(); } }}
                    placeholder="输入模板，如 {N}分钟，按回车添加"
                    className="flex-1 bg-secondary border-border text-xs"
                  />
                  <Button onClick={addPattern} variant="default" size="sm">
                    <Plus className="size-3 mr-1" />添加
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">第2层：短剧判定阈值（分钟）</Label>
                  <p className="text-xs text-muted-foreground">单集平均时长低于此值判定为短剧</p>
                  <Input
                    type="number"
                    min="1"
                    max="120"
                    value={localConfig.durationThresholdMinutes}
                    onChange={(e) => setLocalConfig({ ...localConfig, durationThresholdMinutes: Math.max(1, parseInt(e.target.value) || 30) })}
                    className="bg-secondary border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">探测集数上限</Label>
                  <p className="text-xs text-muted-foreground">逐集探测视频流，成功1集即停止；全部失败则尝试下一集，最多探测N集</p>
                  <Input
                    type="number"
                    min="1"
                    max="20"
                    value={localConfig.probeEpisodeCount}
                    onChange={(e) => setLocalConfig({ ...localConfig, probeEpisodeCount: Math.max(1, parseInt(e.target.value) || 8) })}
                    className="bg-secondary border-border"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">第3层：元数据关键词列表</Label>
                <p className="text-xs text-muted-foreground">当第1、2层均未命中时，根据简介、标题、类型中是否包含这些关键词来判断</p>
                <div className="flex flex-wrap gap-2 mb-2 max-h-40 overflow-y-auto">
                  {localConfig.metaKeywords.map((kw, i) => (
                    <button
                      key={i}
                      onClick={() => removeKeyword(kw)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors bg-card text-foreground border-border hover:border-destructive/50 hover:text-destructive"
                    >
                      {kw}
                      <X className="size-3" />
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
                    placeholder="输入关键词后按回车添加"
                    className="flex-1 bg-secondary border-border"
                  />
                  <Button onClick={addKeyword} variant="default" size="sm">
                    <Plus className="size-3 mr-1" />添加
                  </Button>
                </div>
              </div>

              <div className="flex justify-between items-center pt-2">
                <Button variant="ghost" onClick={handleResetConfig} className="text-xs">
                  <RotateCcw className="size-3.5 mr-1.5" />
                  恢复默认
                </Button>
                <Button onClick={handleSaveConfig} className="bg-primary hover:bg-primary-hover">
                  <Save className="size-4 mr-2" />
                  {configSaved ? '已保存' : '保存配置'}
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-6 mb-6 bg-card border-border">
          <h2 className="text-lg font-semibold mb-4">全量重新探测长短剧</h2>
          <p className="text-sm text-muted-foreground mb-4">
            清除所有电视剧的已有判断结果，全量重新执行三层判断逻辑。
            已有单集时长数据的电视剧将直接复用，无需重新探测视频流。任务在后台运行，可以跳转到其他页面。
          </p>

          <div className="flex items-center gap-4 p-3 rounded-lg bg-secondary mb-4">
            <Radar className="size-5 text-muted-foreground" />
            <div className="text-sm">
              <span className="text-muted-foreground">所有电视剧：</span>
              <span className="font-medium ml-1">{fullReprobeMediaCount} 部</span>
            </div>
          </div>

          {fullReprobing && pollProgress && (
            <div className="space-y-3 mb-4">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin text-primary" />
                <span>正在全量探测：{pollProgress.currentMediaTitle || '准备中...'}</span>
              </div>
              <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${pollProgress.total > 0 ? (pollProgress.processed / pollProgress.total) * 100 : 0}%` }}
                />
              </div>
              <div className="grid grid-cols-4 gap-4 text-center">
                <div className="p-2 rounded bg-secondary">
                  <div className="text-lg font-bold">{pollProgress.processed}</div>
                  <div className="text-xs text-muted-foreground">已处理</div>
                </div>
                <div className="p-2 rounded bg-secondary">
                  <div className="text-lg font-bold text-success">{pollProgress.shortDrama}</div>
                  <div className="text-xs text-muted-foreground">短剧</div>
                </div>
                <div className="p-2 rounded bg-secondary">
                  <div className="text-lg font-bold text-primary">{pollProgress.longDrama}</div>
                  <div className="text-xs text-muted-foreground">长剧</div>
                </div>
                <div className="p-2 rounded bg-secondary">
                  <div className="text-lg font-bold text-destructive">{pollProgress.failed}</div>
                  <div className="text-xs text-muted-foreground">失败</div>
                </div>
              </div>
            </div>
          )}

          {fullReprobeResult && !fullReprobing && (
            <div className="space-y-3 mb-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary">
                {fullReprobeResult.failed < fullReprobeResult.total ? (
                  <CheckCircle2 className="size-5 text-success shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="size-5 text-muted-foreground shrink-0 mt-0.5" />
                )}
                <div className="text-sm">
                  {fullReprobeResult.total === 0 ? (
                    <span className="text-muted-foreground">没有电视剧数据</span>
                  ) : (
                    <div className="space-y-1">
                      <div>全量探测完成：共处理 {fullReprobeResult.total} 部电视剧</div>
                      <div className="flex gap-4 text-muted-foreground">
                        <span>短剧：<span className="text-success font-medium">{fullReprobeResult.shortDrama}</span></span>
                        <span>长剧：<span className="text-primary font-medium">{fullReprobeResult.longDrama}</span></span>
                        <span>失败：<span className="text-destructive font-medium">{fullReprobeResult.failed}</span></span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <Button
            onClick={handleFullReprobe}
            disabled={fullReprobing || fullReprobeMediaCount === 0 || !!runningReprobeTask}
            variant="default"
            className="w-full"
          >
            <Radar className={`size-4 mr-2 ${fullReprobing ? 'animate-spin' : ''}`} />
            {runningReprobeTask ? '任务运行中...' : fullReprobing ? '启动中...' : `开始全量重新探测 (${fullReprobeMediaCount})`}
          </Button>
        </Card>

        <Card className="p-6 bg-card border-border">
          <h2 className="text-lg font-semibold mb-4">批量重新探测长短剧</h2>
          <p className="text-sm text-muted-foreground mb-4">
            对所有经过三级降级判断后仍为兜底状态（FALLBACK）或未判断的电视剧进行重新探测。
            此操作将实际探测视频流时长，准确判断长短剧分类。任务在后台运行，可以跳转到其他页面。
          </p>

          <div className="flex items-center gap-4 p-3 rounded-lg bg-secondary mb-4">
            <Radar className="size-5 text-muted-foreground" />
            <div className="text-sm">
              <span className="text-muted-foreground">待探测：</span>
              <span className="font-medium ml-1">{reprobeMediaList.length} 部电视剧</span>
            </div>
          </div>

          {runningReprobeTask && (
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  <span className="text-sm font-medium">探测任务运行中</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelReprobe}
                  className="text-destructive hover:text-destructive"
                >
                  <X className="size-4 mr-1" />
                  取消
                </Button>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                任务ID: {runningReprobeTask.taskId}
              </div>
            </div>
          )}

          {reprobeMediaList.length > 0 && !reprobing && !runningReprobeTask && (
            <div className="rounded-lg border border-border overflow-hidden mb-4">
              <div className="px-3 py-2 bg-secondary text-xs font-medium text-muted-foreground border-b border-border">
                待探测清单（点击可查看详情）
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-border">
                {reprobeMediaList.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => navigate(`/media/${item.id}`)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-secondary/50 transition-colors flex items-center gap-2"
                  >
                    <AlertCircle className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {(pollProgress || reprobeProgress) && reprobing && (
            <div className="space-y-3 mb-4">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin text-primary" />
                <span>正在探测：{(pollProgress || reprobeProgress)?.currentMediaTitle || '准备中...'}</span>
              </div>
              
              <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${(pollProgress || reprobeProgress)!.total > 0 ? ((pollProgress || reprobeProgress)!.processed / (pollProgress || reprobeProgress)!.total) * 100 : 0}%` }}
                />
              </div>

              <div className="grid grid-cols-4 gap-4 text-center">
                <div className="p-2 rounded bg-secondary">
                  <div className="text-lg font-bold">{(pollProgress || reprobeProgress)!.processed}</div>
                  <div className="text-xs text-muted-foreground">已处理</div>
                </div>
                <div className="p-2 rounded bg-secondary">
                  <div className="text-lg font-bold text-success">{(pollProgress || reprobeProgress)!.shortDrama}</div>
                  <div className="text-xs text-muted-foreground">短剧</div>
                </div>
                <div className="p-2 rounded bg-secondary">
                  <div className="text-lg font-bold text-primary">{(pollProgress || reprobeProgress)!.longDrama}</div>
                  <div className="text-xs text-muted-foreground">长剧</div>
                </div>
                <div className="p-2 rounded bg-secondary">
                  <div className="text-lg font-bold text-destructive">{(pollProgress || reprobeProgress)!.failed}</div>
                  <div className="text-xs text-muted-foreground">失败</div>
                </div>
              </div>
            </div>
          )}

          {reprobeResult && !reprobing && (
            <div className="space-y-3 mb-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary">
                {reprobeResult.failed < reprobeResult.total ? (
                  <CheckCircle2 className="size-5 text-success shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="size-5 text-muted-foreground shrink-0 mt-0.5" />
                )}
                <div className="text-sm">
                  {reprobeResult.total === 0 ? (
                    <span className="text-muted-foreground">没有需要重新探测的电视剧</span>
                  ) : (
                    <div className="space-y-1">
                      <div>
                        探测完成：共处理 {reprobeResult.total} 部电视剧
                      </div>
                      <div className="flex gap-4 text-muted-foreground">
                        <span>短剧：<span className="text-success font-medium">{reprobeResult.shortDrama}</span></span>
                        <span>长剧：<span className="text-primary font-medium">{reprobeResult.longDrama}</span></span>
                        <span>失败：<span className="text-destructive font-medium">{reprobeResult.failed}</span></span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {reprobeResult.failedItems.length > 0 && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="px-3 py-2 bg-secondary text-xs font-medium text-muted-foreground border-b border-border">
                    探测失败清单（点击可查看详情）
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-border">
                    {reprobeResult.failedItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => navigate(`/media/${item.id}`)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-secondary/50 transition-colors flex items-center gap-2"
                      >
                        <AlertCircle className="size-3.5 text-destructive shrink-0" />
                        <span className="truncate">{item.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <Button
            onClick={handleBatchReprobe}
            disabled={reprobing || reprobeMediaList.length === 0 || !!runningReprobeTask}
            variant="default"
            className="w-full"
          >
            <Radar className={`size-4 mr-2 ${reprobing ? 'animate-spin' : ''}`} />
            {runningReprobeTask ? '任务运行中...' : reprobing ? '启动中...' : `开始批量重新探测 (${reprobeMediaList.length})`}
          </Button>
        </Card>
      </div>
    </div>
  );
}
