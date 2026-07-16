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
  Plus,
  ClipboardList,
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
import { useAppStore } from '../useAppStore';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/Layout';
import { getHttpClient } from '@movie-app/core';
import type { VideoSource, CollectTask } from '@movie-app/core';

export default function SourceManagerPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();

  const {
    videoSources,
    collectTasks,
    loadVideoSources,
    loadRunningCollectTasks,
    collectSourceLatest,
    collectSourceAll,
    addVideoSource,
    removeVideoSource,
    toggleSourceEnabled,
    reorderSource,
    deletePlaySourcesBySourceId,
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
            onClick={() => navigate('/tasks')}
          >
            <ClipboardList className="size-4 mr-2" />
            采集任务列表
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
                        {[2, 4, 6, 8, 10].map((threshold) => (
                          <div
                            key={threshold}
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: (source.rateLimit || 0) >= threshold ? '#22c55e' : '#4b5563' }}
                          />
                        ))}
                        <span className="text-xs text-muted-foreground ml-1">{source.rateLimit || 0}</span>
                      </div>

                      <Badge variant="outline" className="text-xs" style={{ color: health.color }}>
                        {health.label}
                      </Badge>

                      <Badge className="text-xs" style={{ backgroundColor: '#8b5cf6', color: 'white' }}>
                        视频: {source.mediaCount || 0}
                      </Badge>

                      <span className="text-xs text-muted-foreground">
                        上次检查: {source.lastCheckAt || '从未'}
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
                      disabled={collecting}
                    >
                      {collecting && collectingType === 'increment' ? (
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
                      disabled={collecting}
                    >
                      {collecting && collectingType === 'full' ? (
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
    </div>
  );
}
