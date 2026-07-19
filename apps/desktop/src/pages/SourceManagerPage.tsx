import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  RefreshCw,
  CheckCircle2,
  Loader2,
  Pencil,
  Ban,
  Trash2,
  Database,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Plus,
  ClipboardList,
  ScrollText,
  Trash,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppStore } from '../useAppStore';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/Layout';
import { getHttpClient, SourceImportService, AI_SOURCE_PROMPT, AI_SOURCE_IMPORT_SAMPLE } from '@movie-app/core';
import type { VideoSource, CollectTask, CollectPreviewItem, ImportSourceItem, ParsedImportSource } from '@movie-app/core';

export default function SourceManagerPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();

  const {
    videoSources,
    collectTasks,
    collectionLogs,
    clearCollectionLogs,
    loadVideoSources,
    loadRunningCollectTasks,
    collectSourceLatest,
    collectSourceAll,
    addVideoSource,
    removeVideoSource,
    toggleSourceEnabled,
    reorderSource,
    deletePlaySourcesBySourceId,
    updateSourceRateLimit,
    previewResults,
    previewLoading,
    searchKeywordPreview,
    saveSelectedPreviewItems,
    clearPreviewResults,
    batchImportSources,
    validateImportSources,
  } = useAppStore();

  const [pendingCollect, setPendingCollect] = useState<Map<string, 'increment' | 'full'>>(new Map());
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set());
  const [checkingSource, setCheckingSource] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [editingSource, setEditingSource] = useState<VideoSource | null>(null);
  const [editForm, setEditForm] = useState({ name: '', baseUrl: '' });
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ code: '', name: '', baseUrl: '', rateLimit: '5', priority: '0' });

  const [isLoading, setIsLoading] = useState(true);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [showKeywordDialog, setShowKeywordDialog] = useState(false);
  const [keywordInput, setKeywordInput] = useState('');
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [relaxBlacklist, setRelaxBlacklist] = useState(false);
  const [relaxYear, setRelaxYear] = useState(false);

  const [showAiImportDialog, setShowAiImportDialog] = useState(false);
  const [aiStep, setAiStep] = useState<'prompt' | 'paste' | 'preview'>('prompt');
  const [aiPastedText, setAiPastedText] = useState('');
  const [aiParsed, setAiParsed] = useState<{ items: ImportSourceItem[]; errors: { index: number; message: string }[] } | null>(null);
  const [aiPreview, setAiPreview] = useState<ParsedImportSource[]>([]);
  const [aiImporting, setAiImporting] = useState(false);
  const [aiResult, setAiResult] = useState<{ imported: number; skipped: number } | null>(null);

  const hasRunningTaskRef = useRef(false);

  useEffect(() => {
    setIsLoading(true);
    loadVideoSources().finally(() => setIsLoading(false));
    loadRunningCollectTasks();
  }, [loadVideoSources, loadRunningCollectTasks]);

  useEffect(() => {
    hasRunningTaskRef.current = collectTasks.some(
      (t: CollectTask) => t.status === 'PENDING' || t.status === 'RUNNING'
    );
  }, [collectTasks]);

  useEffect(() => {
    const interval = setInterval(async () => {
      await loadRunningCollectTasks();
      if (hasRunningTaskRef.current) {
        await loadVideoSources();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [loadRunningCollectTasks, loadVideoSources]);

  const isSourceCollecting = (sourceCode: string) => {
    return collectTasks.some(
      (t: CollectTask) => t.sourceCode === sourceCode && (t.status === 'PENDING' || t.status === 'RUNNING')
    );
  };

  const getRunningTaskForSource = (sourceCode: string) => {
    return collectTasks.find(
      (t: CollectTask) => t.sourceCode === sourceCode && (t.status === 'PENDING' || t.status === 'RUNNING')
    ) || null;
  };

  const getCollectingType = (sourceCode: string): 'increment' | 'full' | null => {
    const task = getRunningTaskForSource(sourceCode);
    if (!task) return null;
    return task.type === 'INCREMENTAL' ? 'increment' : task.type === 'FULL' ? 'full' : null;
  };

  const getProgress = (sourceCode: string) => {
    const task = getRunningTaskForSource(sourceCode);
    if (!task) return 0;
    if (task.totalPages === 0) return 0;
    return Math.round((task.currentPage / task.totalPages) * 100);
  };

  const getRecentErrorForSource = (sourceCode: string) => {
    const errorLogs = collectionLogs.filter(
      log => log.sourceCode === sourceCode && log.level === 'error'
    );
    return errorLogs.length > 0 ? errorLogs[errorLogs.length - 1] : null;
  };

  const handleCheck = async (source: VideoSource) => {
    if (checkingSource === source.code) return;
    setCheckingSource(source.code);
    try {
      const httpClient = getHttpClient();
      const response = await httpClient.get(source.baseUrl, { timeout: 10000 });
      if (response.status >= 200 && response.status < 300) {
        toast(`「${source.name}」连接正常`);
      } else {
        toast(`「${source.name}」连接失败: HTTP ${response.status}`, 'error');
      }
    } catch (err: any) {
      const errorMsg = err.message || String(err);
      console.error(`[SourceCheck] ${source.name} 检查失败:`, errorMsg);
      
      // 提供更详细的错误信息
      let userMsg = `「${source.name}」连接失败: ${errorMsg}`;
      if (errorMsg.includes('CORS') || errorMsg.includes('opaque')) {
        userMsg = `「${source.name}」CORS错误 - 无法访问外部API。Tauri HTTP插件可能未正确加载。`;
      } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
        userMsg = `「${source.name}」网络错误 - 无法连接到服务器。`;
      } else if (errorMsg.includes('timeout') || errorMsg.includes('abort')) {
        userMsg = `「${source.name}」连接超时 - 服务器响应时间过长。`;
      }
      
      toast(userMsg, 'error');
    } finally {
      setCheckingSource(null);
    }
  };

  const handleKeywordSearch = async () => {
    const kw = keywordInput.trim();
    if (!kw) return;
    setHasSearched(true);
    setSelectedPreviewIds(new Set());
    const overrides: { ignoreBlacklist?: boolean; unlimitedYear?: boolean } = {};
    if (relaxBlacklist) overrides.ignoreBlacklist = true;
    if (relaxYear) overrides.unlimitedYear = true;
    await searchKeywordPreview(kw, Object.keys(overrides).length > 0 ? overrides : undefined);
  };

  const handleTogglePreview = (fingerprint: string) => {
    setSelectedPreviewIds(prev => {
      const next = new Set(prev);
      if (next.has(fingerprint)) next.delete(fingerprint);
      else next.add(fingerprint);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedPreviewIds.size === previewResults.length) {
      setSelectedPreviewIds(new Set());
    } else {
      setSelectedPreviewIds(new Set(previewResults.map(r => r.fingerprint)));
    }
  };

  const handleSavePreview = async () => {
    const selected = previewResults.filter(r => selectedPreviewIds.has(r.fingerprint));
    if (selected.length === 0) return;
    setIsSaving(true);
    try {
      const overrides: { ignoreBlacklist?: boolean; unlimitedYear?: boolean } = {};
      if (relaxBlacklist) overrides.ignoreBlacklist = true;
      if (relaxYear) overrides.unlimitedYear = true;
      const count = await saveSelectedPreviewItems(selected, Object.keys(overrides).length > 0 ? overrides : undefined);
      toast(`已保存 ${count} 条数据到本地`);
      setShowKeywordDialog(false);
      setKeywordInput('');
      setSelectedPreviewIds(new Set());
      clearPreviewResults();
    } catch (err: any) {
      toast(`保存失败: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseKeywordDialog = () => {
    setShowKeywordDialog(false);
    setKeywordInput('');
    setSelectedPreviewIds(new Set());
    setHasSearched(false);
    setRelaxBlacklist(false);
    setRelaxYear(false);
    clearPreviewResults();
  };

  const handleCollect = async (source: VideoSource, type: 'increment' | 'full') => {
    if (isSourceCollecting(source.code) || pendingCollect.has(source.code)) {
      toast('该视频源已有采集中的任务，请等待完成', 'error');
      return;
    }
    setPendingCollect(prev => new Map(prev).set(source.code, type));
    try {
      let result;
      if (type === 'increment') {
        result = await collectSourceLatest(source.code);
        if (!result.success) {
          toast(`采集失败: ${result.error || '未知错误'}`, 'error');
          return;
        }
        toast(`采集任务已创建: ${result.taskId}, 新增 ${result.collected} 条`);
      } else {
        result = await collectSourceAll(source.code);
        if (!result.success) {
          toast(`采集失败: ${result.error || '未知错误'}`, 'error');
          return;
        }
        toast(`采集任务已创建: ${result.taskId}, 新增 ${result.collected} 条, ${result.pages} 页`);
      }
      await loadVideoSources();
      await loadRunningCollectTasks();
    } catch (err: any) {
      toast(`采集失败: ${err.message}`, 'error');
    } finally {
      setPendingCollect(prev => {
        const next = new Map(prev);
        next.delete(source.code);
        return next;
      });
    }
  };

  const handleStartEdit = (source: VideoSource) => {
    setEditingSource(source);
    setEditForm({ name: source.name, baseUrl: source.baseUrl });
  };

  const handleSaveEdit = async () => {
    if (!editingSource) return;
    if (!editForm.name.trim() || !editForm.baseUrl.trim()) {
      toast('名称和基础URL不能为空', 'error');
      return;
    }
    const updatedSource: VideoSource = {
      ...editingSource,
      name: editForm.name.trim(),
      baseUrl: editForm.baseUrl.trim(),
    };
    await addVideoSource(updatedSource);
    setEditingSource(null);
    setEditForm({ name: '', baseUrl: '' });
    toast('视频源已更新');
  };

  const handleDeleteSource = async (source: VideoSource) => {
    const ok = await confirm({
      title: '删除视频源',
      description: `确定要删除「${source.name}」吗？此操作无法撤销。`,
      confirmText: '删除',
      variant: 'destructive',
    });
    if (!ok) return;
    removeVideoSource(source.id);
  };

  const handleDeletePlaySources = async (source: VideoSource) => {
    const ok = await confirm({
      title: '删除播放源',
      description: `确定要删除「${source.name}」的所有播放源吗？如果某部视频没有其他播放源，该视频也会被一并删除。`,
      confirmText: '删除',
      variant: 'destructive',
    });
    if (!ok) return;
    setPendingDelete(prev => new Set([...prev, source.id]));
    try {
      await deletePlaySourcesBySourceId(source.id);
      await loadVideoSources();
      toast(`「${source.name}」的播放源已删除`);
    } catch (err: any) {
      toast(`删除失败: ${err.message}`, 'error');
    } finally {
      setPendingDelete(prev => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
    }
  };

  const handleAdd = () => {
    const code = addForm.code.trim();
    if (!code || !addForm.name.trim() || !addForm.baseUrl.trim()) {
      toast('请填写完整信息', 'error');
      return;
    }
    const source: VideoSource = {
      id: `source_${code}`,
      code,
      name: addForm.name.trim(),
      baseUrl: addForm.baseUrl.trim(),
      type: 'CMS',
      isEnabled: true,
      rateLimit: Number(addForm.rateLimit) || 5,
      priority: Number(addForm.priority) || 0,
      healthStatus: null,
      lastCheckAt: null,
    };
    addVideoSource(source);
    setAddForm({ code: '', name: '', baseUrl: '', rateLimit: '5', priority: '0' });
    setShowAddDialog(false);
    toast('视频源已添加');
  };

  const handleAiCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AI_SOURCE_PROMPT);
      toast('提示词已复制到剪贴板，请发送给 AI 助手');
    } catch {
      toast('复制失败，请手动复制', 'error');
    }
  };

  const handleAiPasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setAiPastedText(text);
      toast('已从剪贴板粘贴');
    } catch {
      toast('无法读取剪贴板，请手动粘贴', 'error');
    }
  };

  const handleAiParse = async () => {
    if (!aiPastedText.trim()) {
      toast('请先粘贴 AI 返回的数据', 'error');
      return;
    }
    const parsed = SourceImportService.parseJson(aiPastedText.trim());
    setAiParsed(parsed);
    if (parsed.errors.length > 0) {
      const firstError = parsed.errors[0];
      toast(firstError.message, 'error');
      return;
    }
    if (parsed.items.length === 0) {
      toast('未解析到有效数据', 'error');
      return;
    }
    const preview = await validateImportSources(parsed.items);
    setAiPreview(preview);
    setAiStep('preview');
  };

  const handleAiImport = async () => {
    const validItems = aiPreview
      .filter((p) => p.status === 'valid')
      .map((p) => p.item);
    if (validItems.length === 0) {
      toast('没有可导入的有效视频源', 'error');
      return;
    }
    setAiImporting(true);
    try {
      const result = await batchImportSources(validItems);
      setAiResult({ imported: result.imported, skipped: result.skipped });
      if (result.imported > 0) {
        toast(`成功导入 ${result.imported} 个视频源` + (result.skipped > 0 ? `，跳过 ${result.skipped} 个` : ''));
      } else {
        toast(`导入失败，${result.skipped} 个被跳过`, 'error');
      }
    } catch (err: any) {
      toast(`导入失败: ${err.message}`, 'error');
    } finally {
      setAiImporting(false);
    }
  };

  const handleAiReset = () => {
    setAiStep('prompt');
    setAiPastedText('');
    setAiParsed(null);
    setAiPreview([]);
    setAiResult(null);
  };

  const handleMove = async (index: number, dir: 'up' | 'down') => {
    const target = dir === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= videoSources.length) return;
    const a = videoSources[index];
    const b = videoSources[target];
    await reorderSource(a.id, b.priority);
    await reorderSource(b.id, a.priority);
  };

  const toggleExpand = (sourceCode: string) => {
    setExpandedSources(prev => {
      const next = new Set(prev);
      if (next.has(sourceCode)) {
        next.delete(sourceCode);
      } else {
        next.add(sourceCode);
      }
      return next;
    });
  };

  const getHealthLabel = (source: VideoSource): { label: string; color: string } => {
    const failCount = source.failCount || 0;
    const totalRequests = source.totalRequests || 0;
    const status = source.healthStatus;
    const failRate = totalRequests > 0 ? (failCount / totalRequests) * 100 : 0;

    if (status === 'DOWN' || status === 'unhealthy') {
      return { label: '源不可用，建议降速', color: '#ef4444' };
    }
    if (failRate > 20) {
      return { label: '失败较多，建议降速', color: '#ef4444' };
    }
    if (status === 'DEGRADED' || status === 'degraded' || failRate > 10) {
      return { label: '状态不稳定，建议降速', color: '#eab308' };
    }
    if (failRate < 5 && (source.rateLimit || 0) < 5) {
      return { label: '状态良好，可以加速', color: '#22c55e' };
    }
    return { label: '状态稳定，保持速率', color: '#22c55e' };
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 px-6 py-4 border-b border-border bg-background">
        <Button variant="ghost" onClick={() => navigate('/settings')} className="hover:text-primary">
          <ArrowLeft className="size-4 mr-2" />
          返回
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">视频源管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理视频源配置和采集任务</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => setShowKeywordDialog(true)}
          >
            <Search className="size-4 mr-2" />
            搜索采集
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate('/tasks')}
          >
            <ClipboardList className="size-4 mr-2" />
            采集任务列表
          </Button>
          <Button
            variant="default"
            onClick={() => {
              setShowAiImportDialog(true);
              handleAiReset();
            }}
          >
            <Plus className="size-4 mr-2" />
            AI 导入
          </Button>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogContent className="w-full max-w-[45vw]">
              <DialogHeader>
                <DialogTitle>添加视频源</DialogTitle>
                <DialogDescription>输入视频源的信息</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label>编码（唯一标识）</Label>
                  <Input value={addForm.code} onChange={(e) => setAddForm({ ...addForm, code: e.target.value })} placeholder="如 hcwv" />
                </div>
                <div className="space-y-1.5">
                  <Label>名称</Label>
                  <Input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="如 红尘视频" />
                </div>
                <div className="space-y-1.5">
                  <Label>API 地址</Label>
                  <Input value={addForm.baseUrl} onChange={(e) => setAddForm({ ...addForm, baseUrl: e.target.value })} placeholder="https://example.com/api.php/provide/vod" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>速率限制（1-10）</Label>
                    <Input type="number" value={addForm.rateLimit} onChange={(e) => setAddForm({ ...addForm, rateLimit: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>优先级</Label>
                    <Input type="number" value={addForm.priority} onChange={(e) => setAddForm({ ...addForm, priority: e.target.value })} />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-4">
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>取消</Button>
                <Button onClick={handleAdd}>添加</Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="size-4 mr-2" />
            添加视频源
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Loader2 className="size-8 text-muted-foreground mb-4 animate-spin" />
            <p className="text-sm text-muted-foreground">加载中...</p>
          </div>
        ) : videoSources.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Database className="size-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">暂无视频源</p>
            <p className="text-sm text-muted-foreground mt-2">点击右上角添加视频源</p>
          </div>
        ) : (
          <div className="space-y-4">
            {videoSources.map((source) => {
              const collecting = isSourceCollecting(source.code);
              const isPending = pendingCollect.has(source.code);
              const collectingType = isPending ? pendingCollect.get(source.code) : getCollectingType(source.code);
              const progress = getProgress(source.code);
              const health = getHealthLabel(source);

              return (
                <Card key={source.id} className="overflow-hidden">
                  <div className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleExpand(source.code)}
                        className="p-1 rounded hover:bg-accent transition-colors"
                      >
                        {expandedSources.has(source.code) ? (
                          <ChevronUp className="size-4" />
                        ) : (
                          <ChevronDown className="size-4" />
                        )}
                      </button>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{source.name}</span>
                        <Badge variant="outline" className="text-xs">{source.code}</Badge>
                        {source.isEnabled && (
                          <Badge className="text-xs" style={{ backgroundColor: '#22c55e', color: 'white' }}>源</Badge>
                        )}
                        {!source.isEnabled && (
                          <Badge variant="secondary" className="text-xs">已禁用</Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0 text-xl font-bold"
                          disabled={(source.rateLimit || 0) <= 1}
                          onClick={() => updateSourceRateLimit(source.id, Math.max(1, (source.rateLimit || 5) - 1))}
                        >
                          -
                        </Button>
                        {[2, 4, 6, 8, 10].map((threshold) => (
                          <div
                            key={threshold}
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: (source.rateLimit || 0) >= threshold ? '#22c55e' : '#4b5563' }}
                          />
                        ))}
                        <span className="text-xs text-muted-foreground ml-1">{source.rateLimit || 0}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0 text-xl font-bold"
                          disabled={(source.rateLimit || 0) >= 10}
                          onClick={() => updateSourceRateLimit(source.id, Math.min(10, (source.rateLimit || 5) + 1))}
                        >
                          +
                        </Button>
                      </div>

                      <Badge variant="outline" className="text-xs" style={{ color: health.color }}>
                        {health.label}
                      </Badge>

                      <Badge className="text-xs" style={{ backgroundColor: '#8b5cf6', color: 'white' }}>
                        视频: {source.mediaCount || 0}
                      </Badge>

                      <span className="text-xs text-muted-foreground">
                        上次检查: {source.lastCheckAt ? new Date(source.lastCheckAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '从未'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        上次采集: {source.lastCollectedAt ? new Date(source.lastCollectedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '从未'}
                      </span>
                    </div>
                  </div>

                  <div className="px-4 pb-3 flex items-center justify-end gap-2 flex-wrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleCheck(source)}
                      disabled={checkingSource === source.code}
                    >
                      {checkingSource === source.code ? (
                        <><Loader2 className="size-3.5 mr-1 animate-spin" /> 检查中...</>
                      ) : (
                        <><CheckCircle2 className="size-3.5 mr-1" /> 检查</>
                      )}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleCollect(source, 'increment')}
                      disabled={collecting || isPending}
                    >
                      {(collecting || isPending) && collectingType === 'increment' ? (
                        <><Loader2 className="size-3.5 mr-1 animate-spin" /> 采集中 {progress}%</>
                      ) : (
                        <><Play className="size-3.5 mr-1" /> 增量</>
                      )}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleCollect(source, 'full')}
                      disabled={collecting || isPending}
                    >
                      {(collecting || isPending) && collectingType === 'full' ? (
                        <><Loader2 className="size-3.5 mr-1 animate-spin" /> 采集中 {progress}%</>
                      ) : (
                        <><RefreshCw className="size-3.5 mr-1" /> 全量</>
                      )}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleStartEdit(source)}
                    >
                      <Pencil className="size-3.5 mr-1" /> 编辑
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => toggleSourceEnabled(source.id, !source.isEnabled)}
                    >
                      <Ban className="size-3.5 mr-1" /> {source.isEnabled ? '禁用' : '启用'}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-red-600"
                      onClick={() => handleDeleteSource(source)}
                    >
                      <Trash2 className="size-3.5 mr-1" /> 删除视频源
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleDeletePlaySources(source)}
                      disabled={pendingDelete.has(source.id)}
                    >
                      {pendingDelete.has(source.id) ? (
                        <><Loader2 className="size-3.5 mr-1 animate-spin" /> 删除中...</>
                      ) : (
                        <><Database className="size-3.5 mr-1" /> 删除抓取的数据</>
                      )}
                    </Button>
                  </div>

                  {expandedSources.has(source.code) && (
                    <div className="px-4 pb-3 pt-0 border-t border-border">
                      <div className="pt-3 space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">API 地址:</span>
                          <span className="font-mono text-xs break-all">{source.baseUrl}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">优先级:</span>
                          <span>{source.priority}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">创建时间:</span>
                          <span>'未知'</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 显示该视频源的最近错误 */}
                  {!collecting && (() => {
                    const recentError = getRecentErrorForSource(source.code);
                    const sourceTasks = collectTasks.filter(
                      (t: CollectTask) => t.sourceCode === source.code && (t.status === 'FAILED' || t.status === 'COMPLETED')
                    );
                    const latestTask = sourceTasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
                    const failedTask = latestTask?.status === 'FAILED' ? latestTask : null;
                    if (latestTask?.status === 'COMPLETED') return null;
                    if (!recentError && !failedTask) return null;
                    const errorMsg = recentError?.message || failedTask?.errorMessage || '';
                    if (!errorMsg) return null;
                    return (
                      <div className="px-4 pb-3 pt-0 border-t border-border">
                        <div className="pt-3 text-xs text-red-500 bg-red-500/5 rounded p-2">
                          <div className="font-medium mb-1">最近错误:</div>
                          <div className="break-all">{errorMsg}</div>
                          {failedTask?.errorType && (
                            <Badge variant="destructive" className="text-[10px] mt-1">
                              {failedTask.errorType}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!editingSource} onOpenChange={(open) => !open && setEditingSource(null)}>
        <DialogContent className="w-full max-w-[45vw]">
          <DialogHeader>
            <DialogTitle>编辑视频源</DialogTitle>
            <DialogDescription>修改视频源的名称和API地址</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>名称</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="如 红尘视频"
              />
            </div>
            <div className="space-y-1.5">
              <Label>API 地址</Label>
              <Input
                value={editForm.baseUrl}
                onChange={(e) => setEditForm({ ...editForm, baseUrl: e.target.value })}
                placeholder="https://example.com/api.php/provide/vod"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="outline" onClick={() => setEditingSource(null)}>取消</Button>
            <Button onClick={handleSaveEdit}>保存</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showKeywordDialog} onOpenChange={(open) => {
        if (!open) handleCloseKeywordDialog();
      }}>
        <DialogContent className="w-full max-w-[55vw] max-h-[80vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-5 pb-3">
            <DialogTitle>关键词搜索采集</DialogTitle>
            <DialogDescription>输入关键词，遍历所有已启用的视频源搜索，预览结果后选择保存</DialogDescription>
          </DialogHeader>

          <Separator />

          <div className="flex gap-2 px-6 py-3">
            <Input
              placeholder="输入电影/电视剧名称..."
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleKeywordSearch()}
              className="flex-1"
            />
            <Button onClick={handleKeywordSearch} disabled={previewLoading}>
              <Search className="size-4 mr-1" /> 搜索
            </Button>
          </div>

          <Separator />

          <div className="flex-1 overflow-y-auto min-h-0 px-6 py-3">
            {previewLoading ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground">
                <Loader2 className="size-5 mr-2 animate-spin" /> 正在搜索...
              </div>
            ) : previewResults.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">搜索结果</span>
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleSelectAll}>
                      {selectedPreviewIds.size === previewResults.length ? '取消全选' : '全选'}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      已选 {selectedPreviewIds.size} / 共 {previewResults.length} 条
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5 mt-2">
                  {previewResults.map((item) => {
                    const isSelected = selectedPreviewIds.has(item.fingerprint);
                    return (
                      <label
                        key={item.fingerprint}
                        className={`flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                          isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-hover'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleTogglePreview(item.fingerprint)}
                          className="mt-2 size-4 accent-primary"
                        />
                        <div className="w-10 h-14 shrink-0 rounded overflow-hidden bg-secondary">
                          {item.posterUrl && (
                            <img src={item.posterUrl} alt={item.title} className="size-full object-cover" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{item.title}</span>
                            <span className="text-xs text-muted-foreground shrink-0">({item.year})</span>
                            <Badge variant="outline" className="text-[10px] shrink-0">{item.type}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            {item.directors.length > 0 && <span>导演: {item.directors.join(', ')}</span>}
                            {item.directors.length > 0 && item.actors.length > 0 && <span> | </span>}
                            {item.actors.length > 0 && <span>演员: {item.actors.slice(0, 3).join(', ')}{item.actors.length > 3 ? '...' : ''}</span>}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            来源: {item.sourceName} · {item.area || '未知地区'}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : hasSearched ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                <Search className="size-8 opacity-30" />
                <p className="text-sm">「{keywordInput}」未搜索到相关结果</p>
                <p className="text-xs">请尝试其他关键词</p>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40 text-muted-foreground">
                <p className="text-sm">输入关键词后点击搜索</p>
              </div>
            )}
          </div>

          {hasSearched && (!previewLoading || relaxBlacklist || relaxYear) && (
            <>
              <Separator />
              <div className="flex items-center justify-between px-6 py-2.5">
                <span className="text-base font-bold">放宽搜索条件</span>
                <div className="flex items-center gap-5">
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <Switch checked={relaxBlacklist} onCheckedChange={setRelaxBlacklist} />
                    忽略黑名单
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <Switch checked={relaxYear} onCheckedChange={setRelaxYear} />
                    不限年份
                  </label>
                </div>
              </div>
            </>
          )}

          <Separator />

          <div className="flex justify-end gap-3 px-6 py-3">
            <Button variant="outline" onClick={handleCloseKeywordDialog}>关闭</Button>
            {previewResults.length > 0 && (
              <Button onClick={handleSavePreview} disabled={selectedPreviewIds.size === 0 || isSaving}>
                {isSaving ? <><Loader2 className="size-4 mr-1 animate-spin" /> 保存中...</> : `保存选中的 ${selectedPreviewIds.size} 条`}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* AI 导入对话框 */}
      <Dialog open={showAiImportDialog} onOpenChange={(open) => {
        if (!open) handleAiReset();
        setShowAiImportDialog(open);
      }}>
        <DialogContent className="w-full max-w-[50vw] max-h-[80vh] flex flex-col gap-0 p-0">
          {aiStep === 'prompt' && (
            <>
              <DialogHeader className="px-6 pt-5 pb-3">
                <DialogTitle>AI 导入视频源</DialogTitle>
                <DialogDescription>
                  复制下方提示词，发给 AI 助手（如 ChatGPT、Claude 等），再将 AI 返回的结果粘贴到下一步
                </DialogDescription>
              </DialogHeader>
              <Separator />
              <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
                <div className="relative">
                  <pre className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-4 whitespace-pre-wrap break-all max-h-[360px] overflow-y-auto font-sans leading-relaxed">
                    {AI_SOURCE_PROMPT}
                  </pre>
                </div>
              </div>
              <Separator />
              <div className="flex justify-end gap-3 px-6 py-3">
                <Button variant="outline" onClick={() => setShowAiImportDialog(false)}>取消</Button>
                <Button onClick={handleAiCopyPrompt}>
                  <CheckCircle2 className="size-4 mr-1" /> 复制提示词
                </Button>
                <Button onClick={() => setAiStep('paste')}>
                  下一步：粘贴 AI 返回的数据 <ChevronRight className="size-4 ml-1" />
                </Button>
              </div>
            </>
          )}

          {aiStep === 'paste' && (
            <>
              <DialogHeader className="px-6 pt-5 pb-3">
                <DialogTitle>粘贴 AI 返回的数据</DialogTitle>
                <DialogDescription>
                  将 AI 返回的 JSON 数据粘贴到下方文本框中，然后点击解析
                </DialogDescription>
              </DialogHeader>
              <Separator />
              <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
                <div className="flex gap-2 mb-3">
                  <Button variant="outline" size="sm" onClick={handleAiPasteFromClipboard}>
                    从剪贴板粘贴
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAiPastedText(AI_SOURCE_IMPORT_SAMPLE)}>
                    查看示例
                  </Button>
                </div>
                <textarea
                  className="w-full h-[300px] bg-muted/50 rounded-lg p-4 text-xs font-mono resize-none outline-none focus:ring-1 focus:ring-primary"
                  placeholder="在此粘贴 AI 返回的 JSON 数据..."
                  value={aiPastedText}
                  onChange={(e) => setAiPastedText(e.target.value)}
                />
              </div>
              <Separator />
              <div className="flex justify-end gap-3 px-6 py-3">
                <Button variant="outline" onClick={() => setAiStep('prompt')}>
                  <ChevronDown className="size-4 mr-1 rotate-90" /> 返回
                </Button>
                <Button onClick={handleAiParse}>
                  <Search className="size-4 mr-1" /> 解析并预览
                </Button>
              </div>
            </>
          )}

          {aiStep === 'preview' && (
            <>
              <DialogHeader className="px-6 pt-5 pb-3">
                <DialogTitle>预览导入结果</DialogTitle>
                <DialogDescription>
                  {aiResult
                    ? `导入完成：成功 ${aiResult.imported} 个${aiResult.skipped > 0 ? `，跳过 ${aiResult.skipped} 个` : ''}`
                    : `共解析 ${aiPreview.length} 个视频源，${aiPreview.filter(p => p.status === 'valid').length} 个可导入`
                  }
                </DialogDescription>
              </DialogHeader>
              <Separator />
              <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
                {aiResult ? (
                  <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
                    <CheckCircle2 className="size-10 text-green-500" />
                    <p className="text-lg font-medium text-green-500">
                      成功导入 {aiResult.imported} 个视频源
                    </p>
                    {aiResult.skipped > 0 && (
                      <p className="text-sm text-muted-foreground">{aiResult.skipped} 个被跳过</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {aiPreview.map((p, idx) => {
                      const statusIcon = p.status === 'valid' ? '✅' : p.status === 'invalid_field' ? '❌' : '⚠️';
                      const statusText = p.status === 'valid' ? '可导入'
                        : p.status === 'code_exists' ? '编码已存在'
                        : p.status === 'url_exists' ? '地址已存在'
                        : p.status === 'duplicate_in_list' ? '列表中重复'
                        : '字段无效';
                      const isOverwrite = p.status === 'code_exists' || p.status === 'url_exists';
                      return (
                        <div
                          key={idx}
                          className={`flex items-center gap-3 p-3 rounded-md border ${
                            p.status === 'valid' ? 'border-green-500/30 bg-green-500/5'
                            : isOverwrite ? 'border-yellow-500/30 bg-yellow-500/5'
                            : 'border-red-500/30 bg-red-500/5'
                          }`}
                        >
                          <span className="text-lg">{statusIcon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{p.item.name || '未命名'}</span>
                              <Badge variant="outline" className="text-[10px]">{p.item.code}</Badge>
                              <span className="text-[10px] text-muted-foreground">{statusText}</span>
                            </div>
                            <div className="text-xs text-muted-foreground truncate mt-0.5">{p.item.baseUrl}</div>
                            {p.errors.length > 0 && (
                              <div className="text-xs text-red-500 mt-0.5">{p.errors[0]}</div>
                            )}
                            {p.existingSource && (
                              <div className="text-xs text-yellow-500 mt-0.5">
                                已在库: {p.existingSource.name}（{p.existingSource.baseUrl}）
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <Separator />
              <div className="flex justify-end gap-3 px-6 py-3">
                {aiResult ? (
                  <Button onClick={() => { setShowAiImportDialog(false); handleAiReset(); }}>完成</Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => setAiStep('paste')}>
                      <ChevronDown className="size-4 mr-1 rotate-90" /> 返回修改
                    </Button>
                    <Button
                      onClick={handleAiImport}
                      disabled={aiImporting || aiPreview.filter(p => p.status === 'valid').length === 0}
                    >
                      {aiImporting ? (
                        <><Loader2 className="size-4 mr-1 animate-spin" /> 导入中...</>
                      ) : (
                        <><Database className="size-4 mr-1" /> 导入 {aiPreview.filter(p => p.status === 'valid').length} 个视频源</>
                      )}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 实时日志面板 */}
      <div className="border-t border-border bg-background">
        <div
          className="flex items-center justify-between w-full px-6 py-3 hover:bg-secondary/50 transition-colors cursor-pointer"
          onClick={() => setShowLogPanel(!showLogPanel)}
          role="button"
          tabIndex={0}
        >
          <div className="flex items-center gap-2">
            <ScrollText className="size-4 text-muted-foreground" />
            <span className="font-medium text-sm">采集日志</span>
            {collectionLogs.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {collectionLogs.filter(l => l.level === 'error').length} 个错误
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {collectionLogs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  clearCollectionLogs();
                }}
              >
                <Trash className="size-3 mr-1" /> 清空
              </Button>
            )}
            {showLogPanel ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronUp className="size-4 text-muted-foreground" />
            )}
          </div>
        </div>
        
        {showLogPanel && (
          <div className="px-6 pb-4">
            <ScrollArea className="h-[200px]">
              {collectionLogs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  暂无日志，开始采集后将显示实时日志
                </div>
              ) : (
                <div className="space-y-1 font-mono text-xs">
                  {[...collectionLogs].reverse().map((log) => (
                    <div
                      key={log.id}
                      className={`p-2 rounded ${
                        log.level === 'error' 
                          ? 'bg-red-500/10 text-red-500' 
                          : log.level === 'warn'
                          ? 'bg-yellow-500/10 text-yellow-500'
                          : 'bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        {log.sourceName && (
                          <Badge variant="outline" className="text-[10px]">
                            {log.sourceName}
                          </Badge>
                        )}
                        <Badge 
                          variant={log.level === 'error' ? 'destructive' : 'secondary'} 
                          className="text-[10px]"
                        >
                          {log.level}
                        </Badge>
                      </div>
                      <div className="mt-1 break-all">{log.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
