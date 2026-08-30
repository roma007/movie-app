import { useEffect, useState, useCallback, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Radar, Loader2, CheckCircle2, AlertCircle, Film, Tv, Video, Disc, FileText, Database, EyeOff, X, RotateCcw, Plus, BarChart3, SlidersHorizontal, RefreshCw, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAppStore, getProvider } from '../useAppStore';
import { openMediaPlay } from '../utils/openMediaPlay';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/Layout';
import type { ShortDramaConfig } from '@movie-app/core';
import { UNCATEGORIZED_GENRE } from '@movie-app/core';
import { useBackgroundStore } from '../themes/backgroundStore';

interface MediaStats {
  total: number;
  byType: { type: string; count: number }[];
}

interface GenreChipProps {
  genre: string;
  selected: boolean;
  tone?: 'destructive' | 'warning' | 'warning-solid';
  icon?: 'eye-off' | 'x';
  onToggle: (genre: string) => void;
}

const GenreChip = memo(function GenreChip({ genre, selected, tone = 'warning', icon, onToggle }: GenreChipProps) {
  const base = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-colors';
  const style =
    tone === 'destructive'
      ? selected
        ? 'bg-destructive/15 text-destructive'
        : 'bg-secondary text-secondary-foreground hover:bg-destructive/10'
      : tone === 'warning-solid'
        ? selected
          ? 'bg-warning/30 text-warning'
          : 'bg-warning/10 text-warning hover:bg-warning/20'
        : selected
          ? 'bg-warning/15 text-warning'
          : 'bg-secondary text-secondary-foreground hover:bg-warning/10';
  return (
    <button data-genre={genre} onClick={() => onToggle(genre)} className={`${base} ${style}`}>
      {icon === 'eye-off' && <EyeOff className="size-3" />}
      {icon === 'x' && <X className="size-3 text-destructive" />}
      {genre}
    </button>
  );
});

interface ChipSelectFieldProps {
  genres: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  onToggleGenre: (genre: string) => void;
  tone?: GenreChipProps['tone'];
  icon?: GenreChipProps['icon'];
  limit?: number;
  scrollClassName?: string;
}

const LIVE_DRAG_LIMIT = 500;
const MIN_DRAG_SIZE = 3;

function ChipSelectField({ genres, selected, onChange, onToggleGenre, tone = 'warning', icon, limit = 200, scrollClassName }: ChipSelectFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showAll, setShowAll] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  const rectsRef = useRef<{ genre: string; rect: DOMRect }[]>([]);
  const rafRef = useRef(0);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const genresRef = useRef(genres);
  genresRef.current = genres;

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const getDragRect = () => {
    const d = dragRef.current;
    if (!d) return null;
    const x = Math.min(d.startX, d.curX);
    const y = Math.min(d.startY, d.curY);
    return { x, y, w: Math.abs(d.curX - d.startX), h: Math.abs(d.curY - d.startY) };
  };

  const computeHit = (box: { x: number; y: number; w: number; h: number }) => {
    const hit = new Set<string>();
    for (const { genre, rect } of rectsRef.current) {
      if (rect.left < box.x + box.w && rect.right > box.x && rect.top < box.y + box.h && rect.bottom > box.y) {
        hit.add(genre);
      }
    }
    return hit;
  };

  const applyLiveDrag = (addMode: boolean) => {
    if (genresRef.current.length > LIVE_DRAG_LIMIT) return;
    const box = getDragRect();
    if (!box || box.w < MIN_DRAG_SIZE || box.h < MIN_DRAG_SIZE) return;
    const hit = computeHit(box);
    if (hit.size === 0) return;
    const current = selectedRef.current;
    const next = addMode ? [...new Set([...current, ...hit])] : [...hit];
    if (next.length !== current.length || next.some((g, i) => g !== current[i])) {
      onChangeRef.current(next);
    }
  };

  const finishDrag = (addMode: boolean) => {
    const box = getDragRect();
    if (box && box.w >= MIN_DRAG_SIZE && box.h >= MIN_DRAG_SIZE) {
      const hit = computeHit(box);
      if (hit.size > 0) {
        const current = selectedRef.current;
        onChangeRef.current(addMode ? [...new Set([...current, ...hit])] : [...hit]);
      }
    }
    dragRef.current = null;
    setDrag(null);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-genre]') || target.closest('button')) return;
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    rectsRef.current = Array.from(el.querySelectorAll<HTMLElement>('[data-genre]')).map(btn => ({
      genre: btn.dataset.genre || '',
      rect: btn.getBoundingClientRect(),
    }));
    dragRef.current = { startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY };
    setDrag({ x: 0, y: 0, w: 0, h: 0 });

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      dragRef.current.curX = ev.clientX;
      dragRef.current.curY = ev.clientY;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const d = dragRef.current;
        const el = containerRef.current;
        if (!d || !el) return;
        const crect = el.getBoundingClientRect();
        setDrag({
          x: Math.min(d.startX, d.curX) - crect.left,
          y: Math.min(d.startY, d.curY) - crect.top,
          w: Math.abs(d.curX - d.startX),
          h: Math.abs(d.curY - d.startY),
        });
        applyLiveDrag(ev.ctrlKey || ev.metaKey);
      });
    };
    const onUp = (ev: MouseEvent) => {
      if (dragRef.current) {
        dragRef.current.curX = ev.clientX;
        dragRef.current.curY = ev.clientY;
      }
      finishDrag(ev.ctrlKey || ev.metaKey);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const displayed = showAll ? genres : genres.slice(0, limit);

  return (
    <div ref={containerRef} onMouseDown={handleMouseDown} className={`relative select-none ${scrollClassName || ''}`}>
      <div className="flex flex-wrap gap-2">
        {displayed.map(genre => (
          <GenreChip
            key={genre}
            genre={genre}
            selected={selected.includes(genre)}
            tone={tone}
            icon={icon}
            onToggle={onToggleGenre}
          />
        ))}
      </div>
      {genres.length > limit && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="text-xs text-muted-foreground hover:text-text underline mt-1"
        >
          {showAll ? '收起' : `显示全部 (${genres.length})`}
        </button>
      )}
      {drag && (
        <div
          className="pointer-events-none absolute z-10 border-2 border-primary bg-primary-light"
          style={{ left: drag.x, top: drag.y, width: drag.w, height: drag.h }}
        />
      )}
    </div>
  );
}

export default function VideoManagementPage() {
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);
  useEffect(() => { clearBgImage(); }, [clearBgImage]);
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
    reprobeMediaCount,
    reprobeMediaList,
    hideMediaByGenres,
    unhideMediaByGenres,
    getHiddenMediaCount,
    getHiddenGenres,
    getUncategorizedCount,
    runningReprobeTask,
    startReprobeTask,
    startFullReprobeTask,
    getFullReprobeMediaCount,
    cancelReprobeTask,
    loadRunningReprobeTask,
    startReprobePolling,
    reprobePoll,
    shortDramaConfig,
    loadShortDramaConfig,
    updateShortDramaConfig,
    getDefaultShortDramaConfig,
    videoManageDeleteType: deleteMediaType,
    setVideoManageDeleteType,
    videoManageHideType: hideMediaType,
    setVideoManageHideType,
  } = useAppStore();

  const [stats, setStats] = useState<MediaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [hiddenCount, setHiddenCount] = useState(0);

  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ deleted: number } | null>(null);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [allGenres, setAllGenres] = useState<string[]>([]);
  const [hideAllGenres, setHideAllGenres] = useState<string[]>([]);
  const [visibleGenres, setVisibleGenres] = useState<string[]>([]);
  const [hiddenGenres, setHiddenGenres] = useState<string[]>([]);
  const [selectedVisibleGenres, setSelectedVisibleGenres] = useState<string[]>([]);
  const [selectedHiddenGenres, setSelectedHiddenGenres] = useState<string[]>([]);
  const [hidingGenres, setHidingGenres] = useState(false);
  const [unhidingGenres, setUnhidingGenres] = useState(false);
  const [fullReprobeMediaCount, setFullReprobeMediaCount] = useState(0);
  const [localConfig, setLocalConfig] = useState<ShortDramaConfig | null>(null);
  const [patternInput, setPatternInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');

  const [showAllReprobe, setShowAllReprobe] = useState(false);

  const MEDIA_TYPES = [
    { value: '', label: '全部' },
    { value: 'MOVIE', label: '电影' },
    { value: 'TV', label: '电视剧' },
    { value: 'VARIETY', label: '综艺' },
    { value: 'ANIME', label: '动漫' },
    { value: 'DOCUMENTARY', label: '纪录片' },
  ];

  const fullReprobing = !!reprobePoll && reprobePoll.full && reprobePoll.status === 'running';
  const reprobing = !!reprobePoll && !reprobePoll.full && reprobePoll.status === 'running';
  const fullReprobeResult = reprobePoll?.full ? reprobePoll.result : null;
  const reprobeResult = reprobePoll && !reprobePoll.full ? reprobePoll.result : null;

  const prevPollStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const status = reprobePoll?.status ?? null;
    if (prevPollStatusRef.current === 'running' && status && status !== 'running') {
      if (status === 'done') toast('探测任务已完成');
      else if (status === 'failed') toast('探测任务失败', 'error');
    }
    prevPollStatusRef.current = status;
  }, [reprobePoll?.status, toast]);

  useEffect(() => {
    if (runningReprobeTask) {
      const full = (runningReprobeTask.sourceName || '').includes('全量');
      startReprobePolling(runningReprobeTask.taskId, full);
    }
  }, [runningReprobeTask, startReprobePolling]);

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
    getSubTypesByType(deleteMediaType || undefined, true).then(genres => setAllGenres(genres));
  }, [deleteMediaType]);

  useEffect(() => {
    if (shortDramaConfig) {
      setLocalConfig({ ...shortDramaConfig });
    }
  }, [shortDramaConfig]);

  const loadHideGenres = useCallback(async () => {
    const [all, visible, hiddenRaw, uncatVisible, uncatAll] = await Promise.all([
      getSubTypesByType(hideMediaType || undefined, true),
      getSubTypesByType(hideMediaType || undefined, false),
      getHiddenGenres(),
      getUncategorizedCount(hideMediaType || undefined, false),
      getUncategorizedCount(hideMediaType || undefined, true),
    ]);
    const hidden = hiddenRaw.filter(h => h !== UNCATEGORIZED_GENRE && all.includes(h));
    if (hiddenRaw.includes(UNCATEGORIZED_GENRE) && uncatAll > 0) {
      hidden.push(UNCATEGORIZED_GENRE);
    }
    setHideAllGenres(all);
    setVisibleGenres([...new Set([...visible, ...(uncatVisible > 0 ? [UNCATEGORIZED_GENRE] : [])])]);
    setHiddenGenres(hidden);
  }, [getSubTypesByType, getHiddenGenres, getUncategorizedCount, hideMediaType]);

  useEffect(() => {
    loadHideGenres();
  }, [loadHideGenres]);

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

  const toggleGenre = useCallback((genre: string) => {
    setSelectedGenres(prev =>
      prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]
    );
  }, []);

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
    await loadHideGenres();
  };

  const toggleVisibleGenre = useCallback((genre: string) => {
    setSelectedVisibleGenres(prev =>
      prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]
    );
  }, []);

  const toggleHiddenGenre = useCallback((genre: string) => {
    setSelectedHiddenGenres(prev =>
      prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]
    );
  }, []);

  const handleHideSelected = async () => {
    if (selectedVisibleGenres.length === 0) return;
    setHidingGenres(true);
    try {
      await hideMediaByGenres(selectedVisibleGenres);
      setSelectedVisibleGenres([]);
      await reloadHideGenres();
      loadStats();
    } catch (err) {
      console.error('批量隐藏失败:', err);
    } finally {
      setHidingGenres(false);
    }
  };

  const handleUnhideSelected = async () => {
    if (selectedHiddenGenres.length === 0) return;
    setUnhidingGenres(true);
    try {
      await unhideMediaByGenres(selectedHiddenGenres);
      setSelectedHiddenGenres([]);
      await reloadHideGenres();
      loadStats();
    } catch (err) {
      console.error('批量取消隐藏失败:', err);
    } finally {
      setUnhidingGenres(false);
    }
  };

  const persistConfig = async (config: ShortDramaConfig) => {
    try {
      await updateShortDramaConfig(config);
    } catch (err: any) {
      toast(err.message || '保存配置失败', 'error');
    }
  };

  const handleResetConfig = () => {
    const defaults = getDefaultShortDramaConfig();
    setLocalConfig({ ...defaults });
    persistConfig(defaults);
  };

  const addPattern = () => {
    const p = patternInput.trim();
    if (!p || !localConfig) return;
    if (localConfig.summaryPatterns.includes(p)) {
      toast('该模板已存在', 'error');
      setPatternInput('');
      return;
    }
    const next = { ...localConfig, summaryPatterns: [...localConfig.summaryPatterns, p] };
    setLocalConfig(next);
    setPatternInput('');
    persistConfig(next);
  };

  const removePattern = (pattern: string) => {
    if (!localConfig) return;
    const next = { ...localConfig, summaryPatterns: localConfig.summaryPatterns.filter(p => p !== pattern) };
    setLocalConfig(next);
    persistConfig(next);
  };

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (!kw || !localConfig) return;
    if (localConfig.metaKeywords.includes(kw)) {
      toast('该关键词已存在', 'error');
      setKeywordInput('');
      return;
    }
    const next = { ...localConfig, metaKeywords: [...localConfig.metaKeywords, kw] };
    setLocalConfig(next);
    setKeywordInput('');
    persistConfig(next);
  };

  const removeKeyword = (keyword: string) => {
    if (!localConfig) return;
    const next = { ...localConfig, metaKeywords: localConfig.metaKeywords.filter(k => k !== keyword) };
    setLocalConfig(next);
    persistConfig(next);
  };

  const handleThresholdBlur = (value: string) => {
    if (!localConfig) return;
    const v = Math.max(1, parseInt(value) || 30);
    const next = { ...localConfig, durationThresholdMinutes: v };
    setLocalConfig(next);
    persistConfig(next);
  };

  const handleProbeCountBlur = (value: string) => {
    if (!localConfig) return;
    const v = Math.max(1, parseInt(value) || 8);
    const next = { ...localConfig, probeEpisodeCount: v };
    setLocalConfig(next);
    persistConfig(next);
  };

  const handleFullReprobe = async () => {
    try {
      const taskId = await startFullReprobeTask();
      toast(`全量探测任务已启动，任务ID: ${taskId}`);
    } catch (err: any) {
      console.error('启动全量探测任务失败:', err);
      toast(err.message || '启动全量探测任务失败', 'error');
    }
  };

  const handleBatchReprobe = async () => {
    if (reprobeMediaList.length === 0) return;
    try {
      const taskId = await startReprobeTask();
      toast(`探测任务已启动，任务ID: ${taskId}`);
    } catch (err: any) {
      console.error('启动探测任务失败:', err);
      toast(err.message || '启动探测任务失败', 'error');
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
    toast('探测任务已取消');
    loadReprobeMediaList();
    loadStats();
  };

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
    <div className="p-6 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/settings')} className="hover:text-text">
            <ArrowLeft className="size-4 mr-2" />
            返回
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">视频管理</h1>
            <p className="text-sm text-muted-foreground mt-1">查看视频统计和管理视频数据</p>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <Card className="p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <BarChart3 className="size-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">数据统计</h2>
          </div>
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

        <Card className="p-6 mb-6 border-l-4 border-l-destructive">
          <div className="flex items-center gap-3 mb-4">
            <Trash2 className="size-4 text-destructive" />
            <h2 className="text-lg font-semibold text-destructive">按子类型删除视频</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            先选择大类，再选择该大类下的子类型进行删除。此操作不可恢复。
          </p>

          <div className="w-full flex items-end gap-1.5">
            {MEDIA_TYPES.map(mt => (
              <button
                key={mt.value}
                onClick={() => setVideoManageDeleteType(mt.value)}
                className={`flex-1 rounded-t-md rounded-b-none transition-all duration-150 ${
                  deleteMediaType === mt.value
                    ? 'bg-[var(--color-card-accent-alpha)] text-[var(--color-button-primary-text)] py-2.5 shadow-none'
                    : 'bg-[var(--color-card-dim-alpha)] text-[var(--color-button-secondary-text)] py-1.5'
                }`}
              >
                {mt.label}
              </button>
            ))}
          </div>

          <div className="rounded-t-none rounded-b-md bg-[var(--color-card-accent-alpha)] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                可选子类型 ({allGenres.length})
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedGenres([...allGenres])} className="text-xs text-muted-foreground hover:text-text underline">全选</button>
                <button onClick={() => setSelectedGenres(prev => allGenres.filter(g => !prev.includes(g)))} className="text-xs text-muted-foreground hover:text-text underline">反选</button>
                <button onClick={() => setSelectedGenres([])} className="text-xs text-muted-foreground hover:text-text underline">清空</button>
              </div>
            </div>
            {allGenres.length === 0 ? (
              <span className="text-xs text-muted-foreground">暂无子类型数据</span>
            ) : (
              <ChipSelectField
                genres={allGenres}
                selected={selectedGenres}
                onChange={setSelectedGenres}
                onToggleGenre={toggleGenre}
                tone="destructive"
                scrollClassName="max-h-60 overflow-y-auto"
              />
            )}
          </div>

          <div className="mt-4 p-4 rounded-lg bg-destructive/5">
            <div className="text-xs font-medium text-destructive mb-2">
              待删除子类 ({selectedGenres.length})
            </div>
            {selectedGenres.length === 0 ? (
              <span className="text-xs text-muted-foreground">请在上方各分类中选择要删除的子类型</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selectedGenres.map(genre => (
                  <GenreChip
                    key={genre}
                    genre={genre}
                    selected
                    tone="destructive"
                    icon="x"
                    onToggle={toggleGenre}
                  />
                ))}
              </div>
            )}
          </div>

          {deleteResult && !deleting && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary mt-4">
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
            className="w-full mt-4"
          >
            <Trash2 className={`size-4 mr-2 ${deleting ? 'animate-spin' : ''}`} />
            {deleting ? '删除中...' : `删除所选子类型 (${selectedGenres.length})`}
          </Button>
        </Card>

        <Card className="p-6 mb-6 border-l-4 border-l-amber-500">
          <div className="flex items-center gap-3 mb-4">
            <EyeOff className="size-4 text-amber-500" />
            <h2 className="text-lg font-semibold text-amber-600">按子类型隐藏视频</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            先选择子类型，再点击下方按钮一次性批量隐藏或恢复。
          </p>

          <div className="w-full flex items-end gap-1.5">
            {MEDIA_TYPES.map(mt => (
              <button
                key={mt.value}
                onClick={() => {
                  setSelectedVisibleGenres([]);
                  setSelectedHiddenGenres([]);
                  setVideoManageHideType(mt.value);
                }}
                className={`flex-1 rounded-t-md rounded-b-none transition-all duration-150 ${
                  hideMediaType === mt.value
                    ? 'bg-[var(--color-card-accent-alpha)] text-[var(--color-button-primary-text)] py-2.5 shadow-none'
                    : 'bg-[var(--color-card-dim-alpha)] text-[var(--color-button-secondary-text)] py-1.5'
                }`}
              >
                {mt.label}
              </button>
            ))}
          </div>

          <div className="rounded-t-none rounded-b-md bg-[var(--color-card-accent-alpha)] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                未隐藏 ({visibleGenres.length})
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedVisibleGenres([...visibleGenres])} className="text-xs text-muted-foreground hover:text-text underline">全选</button>
                <button onClick={() => setSelectedVisibleGenres(prev => visibleGenres.filter(g => !prev.includes(g)))} className="text-xs text-muted-foreground hover:text-text underline">反选</button>
                <button onClick={() => setSelectedVisibleGenres([])} className="text-xs text-muted-foreground hover:text-text underline">清空</button>
              </div>
            </div>
            {visibleGenres.length === 0 ? (
              <span className="text-xs text-muted-foreground">暂无未隐藏的子类型</span>
            ) : (
              <ChipSelectField
                genres={visibleGenres}
                selected={selectedVisibleGenres}
                onChange={setSelectedVisibleGenres}
                onToggleGenre={toggleVisibleGenre}
                tone="warning"
              />
            )}
            <Button
              onClick={handleHideSelected}
              disabled={hidingGenres || selectedVisibleGenres.length === 0}
              variant="outline"
              className="w-full mt-3"
            >
              {hidingGenres ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <EyeOff className="size-4 mr-2" />
              )}
              {hidingGenres ? '隐藏中...' : `隐藏所选子类型 (${selectedVisibleGenres.length})`}
            </Button>
          </div>

          <div className="mt-4 p-4 rounded-lg bg-warning/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-warning">
                已隐藏子类 ({hiddenGenres.length})
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedHiddenGenres([...hiddenGenres])} className="text-xs text-muted-foreground hover:text-text underline">全选</button>
                <button onClick={() => setSelectedHiddenGenres(prev => hiddenGenres.filter(g => !prev.includes(g)))} className="text-xs text-muted-foreground hover:text-text underline">反选</button>
                <button onClick={() => setSelectedHiddenGenres([])} className="text-xs text-muted-foreground hover:text-text underline">清空</button>
              </div>
            </div>
            {hiddenGenres.length === 0 ? (
              <span className="text-xs text-muted-foreground">暂无已隐藏的子类型</span>
            ) : (
              <ChipSelectField
                genres={hiddenGenres}
                selected={selectedHiddenGenres}
                onChange={setSelectedHiddenGenres}
                onToggleGenre={toggleHiddenGenre}
                tone="warning-solid"
                icon="eye-off"
              />
            )}
            <Button
              onClick={handleUnhideSelected}
              disabled={unhidingGenres || selectedHiddenGenres.length === 0}
              variant="outline"
              className="w-full mt-3"
            >
              {unhidingGenres ? '恢复中...' : `取消隐藏所选子类型 (${selectedHiddenGenres.length})`}
            </Button>
          </div>
        </Card>

        <Card className="p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <SlidersHorizontal className="size-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">长短剧判断配置</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            配置三层判断逻辑的参数。修改配置后需重新探测才能生效。
          </p>

          {localConfig && (
            <>
              <Tabs defaultValue="1">
                <TabsList className="w-full items-end gap-1.5 h-auto bg-transparent p-0 rounded-none">
                  {[
                    { v: '1', b: '①', t: '匹配模板' },
                    { v: '2', b: '②', t: '探测时长' },
                    { v: '3', b: '③', t: '关键词' },
                  ].map((tab) => (
                    <TabsTrigger
                      key={tab.v}
                      value={tab.v}
                      className="flex-1 rounded-t-md rounded-b-none transition-all duration-150 data-[state=active]:py-2.5 data-[state=inactive]:py-1.5 data-[state=active]:bg-[var(--color-card-accent-alpha)] data-[state=inactive]:bg-[var(--color-card-dim-alpha)] data-[state=active]:text-[var(--color-button-primary-text)] data-[state=inactive]:text-[var(--color-button-secondary-text)] data-[state=active]:shadow-none"
                    >
                      <span className="inline-flex size-7 items-center justify-center rounded-full text-[17px]">{tab.b}</span>
                      {tab.t}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="1" className="mt-0 rounded-t-none rounded-b-md bg-[var(--color-card-accent-alpha)] p-4 space-y-2">
                  <p className="text-xs text-muted-foreground">用 {'{'}N{'}'} 代表数字，例如「{'{'}N{'}'}分钟」可匹配"30分钟"、"每集30分钟"等文本中的时长</p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {[...new Set(localConfig.summaryPatterns)].map((pattern) => (
                      <button
                        key={pattern}
                        onClick={() => removePattern(pattern)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-colors bg-[var(--color-card-alpha)] text-text hover:border-destructive/50 hover:text-destructive"
                      >
                        {pattern}
                        <X className="size-3 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={patternInput}
                      onChange={(e) => setPatternInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPattern(); } }}
                      placeholder="输入模板，如 {N}分钟，按回车添加"
                      className="flex-1 text-xs"
                    />
                    <Button onClick={addPattern} variant="default" size="sm">
                      <Plus className="size-3 mr-1" />添加
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="2" className="mt-0 rounded-t-none rounded-b-md bg-[var(--color-card-accent-alpha)] p-4 space-y-2">
                  <p className="text-xs text-muted-foreground">逐集探测视频流时长，成功1集即止；根据探测结果与下方阈值判断长短剧</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">短剧判定阈值（分钟）</Label>
                      <p className="text-xs text-muted-foreground">单集时长低于阈值为短剧</p>
                      <Input
                        type="number"
                        min="1"
                        max="120"
                        value={localConfig.durationThresholdMinutes}
                        onChange={(e) => setLocalConfig({ ...localConfig, durationThresholdMinutes: Math.max(1, parseInt(e.target.value) || 30) })}
                        onBlur={(e) => handleThresholdBlur(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">探测集数上限</Label>
                      <p className="text-xs text-muted-foreground">逐集探测视频时长，成功1集即止；最多探测N集</p>
                      <Input
                        type="number"
                        min="1"
                        max="20"
                        value={localConfig.probeEpisodeCount}
                        onChange={(e) => setLocalConfig({ ...localConfig, probeEpisodeCount: Math.max(1, parseInt(e.target.value) || 8) })}
                        onBlur={(e) => handleProbeCountBlur(e.target.value)}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="3" className="mt-0 rounded-t-none rounded-b-md bg-[var(--color-card-accent-alpha)] p-4 space-y-2">
                  <p className="text-xs text-muted-foreground">当第1、2层均未命中时，根据简介、标题、类型中是否包含这些关键词来判断</p>
                  <div className="flex flex-wrap gap-2 mb-2 max-h-40 overflow-y-auto">
                    {[...new Set(localConfig.metaKeywords)].map((kw) => (
                      <button
                        key={kw}
                        onClick={() => removeKeyword(kw)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-colors bg-[var(--color-card-alpha)] text-text hover:border-destructive/50 hover:text-destructive"
                      >
                        {kw}
                        <X className="size-3 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={keywordInput}
                      onChange={(e) => setKeywordInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
                      placeholder="输入关键词后按回车添加"
                      className="flex-1"
                    />
                    <Button onClick={addKeyword} variant="default" size="sm">
                      <Plus className="size-3 mr-1" />添加
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>

              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={handleResetConfig} className="text-xs">
                  <RotateCcw className="size-3.5 mr-1.5" />
                  恢复默认
                </Button>
                <span className="text-xs text-muted-foreground">修改后自动保存</span>
              </div>
            </>
          )}
        </Card>

        <Card className="p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <RefreshCw className="size-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">全量重新探测长短剧</h2>
          </div>
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

          {fullReprobing && reprobePoll?.progress && (
            <div className="space-y-3 mb-4">
              <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-muted-foreground transition-all duration-300"
                  style={{ width: `${reprobePoll.progress.total > 0 ? (reprobePoll.progress.processed / reprobePoll.progress.total) * 100 : 0}%` }}
                />
              </div>
              <div className="grid grid-cols-4 gap-4 text-center">
                <div className="p-2 rounded bg-secondary">
                  <div className="text-lg font-bold">{reprobePoll.progress.processed}</div>
                  <div className="text-xs text-muted-foreground">已处理</div>
                </div>
                <div className="p-2 rounded bg-secondary">
                  <div className="text-lg font-bold text-success">{reprobePoll.progress.shortDrama}</div>
                  <div className="text-xs text-muted-foreground">短剧</div>
                </div>
                <div className="p-2 rounded bg-secondary">
                  <div className="text-lg font-bold text-text-secondary">{reprobePoll.progress.longDrama}</div>
                  <div className="text-xs text-muted-foreground">长剧</div>
                </div>
                <div className="p-2 rounded bg-secondary">
                  <div className="text-lg font-bold text-destructive">{reprobePoll.progress.failed}</div>
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
                        <span>长剧：<span className="text-text-secondary font-medium">{fullReprobeResult.longDrama}</span></span>
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
            {`开始全量重新探测 (${fullReprobeMediaCount})`}
          </Button>
        </Card>

        <Card className="p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Radar className="size-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">批量重新探测长短剧</h2>
          </div>
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
            <div className="p-3 rounded-lg bg-muted-foreground/10 border border-muted-foreground/20 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
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

              {reprobing && reprobePoll?.progress && (
                <div className="space-y-3 mt-4">
                  <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-muted-foreground transition-all duration-300"
                      style={{ width: `${reprobePoll.progress.total > 0 ? (reprobePoll.progress.processed / reprobePoll.progress.total) * 100 : 0}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div className="p-2 rounded bg-secondary">
                      <div className="text-lg font-bold">{reprobePoll.progress.processed}</div>
                      <div className="text-xs text-muted-foreground">已处理</div>
                    </div>
                    <div className="p-2 rounded bg-secondary">
                      <div className="text-lg font-bold text-success">{reprobePoll.progress.shortDrama}</div>
                      <div className="text-xs text-muted-foreground">短剧</div>
                    </div>
                    <div className="p-2 rounded bg-secondary">
                      <div className="text-lg font-bold text-text-secondary">{reprobePoll.progress.longDrama}</div>
                      <div className="text-xs text-muted-foreground">长剧</div>
                    </div>
                    <div className="p-2 rounded bg-secondary">
                      <div className="text-lg font-bold text-destructive">{reprobePoll.progress.failed}</div>
                      <div className="text-xs text-muted-foreground">失败</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {reprobeMediaList.length > 0 && !reprobing && !runningReprobeTask && (
            <div className="rounded-lg overflow-hidden mb-4">
              <div className="px-3 py-2 bg-secondary text-xs font-medium text-muted-foreground">
                待探测清单（点击可查看详情）
              </div>
              <div className="max-h-60 overflow-y-auto">
                {(showAllReprobe ? reprobeMediaList : reprobeMediaList.slice(0, 100)).map((item) => (
                  <button
                    key={item.id}
                    onClick={async () => { const m = await getProvider().getMediaById(item.id); if (m) openMediaPlay(navigate, m); }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-secondary/50 transition-colors flex items-center gap-2"
                  >
                    <AlertCircle className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
                {reprobeMediaList.length > 100 && (
                  <button
                    onClick={() => setShowAllReprobe(v => !v)}
                    className="w-full px-3 py-2 text-left text-xs text-muted-foreground hover:text-text underline"
                  >
                    {showAllReprobe ? '收起' : `显示全部 (${reprobeMediaList.length})`}
                  </button>
                )}
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
                        <span>长剧：<span className="text-text-secondary font-medium">{reprobeResult.longDrama}</span></span>
                        <span>失败：<span className="text-destructive font-medium">{reprobeResult.failed}</span></span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {reprobeResult.failedItems.length > 0 && (
                <div className="rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-secondary text-xs font-medium text-muted-foreground">
                    探测失败清单（点击可查看详情）
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {reprobeResult.failedItems.map((item) => (
                      <button
                        key={item.id}
                    onClick={async () => { const m = await getProvider().getMediaById(item.id); if (m) openMediaPlay(navigate, m); }}
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
            {`开始批量重新探测 (${reprobeMediaList.length})`}
          </Button>
        </Card>

        <div className="grid grid-cols-2 gap-6 mb-6">
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Trash2 className="size-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold">删除所有视频</h2>
            </div>
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

          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Unlink className="size-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold">删除无播放源视频</h2>
            </div>
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
      </div>
    </div>
  );
}
