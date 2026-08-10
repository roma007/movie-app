import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../useAppStore';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/Layout';
import { useBackgroundStore } from '../themes/backgroundStore';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ArrowLeft,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  Play,
  Trash2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import type { CollectTask } from '@movie-app/core';

function getStatusIcon(status: string) {
  switch (status) {
    case 'PENDING':
      return <Clock className="size-4" />;
    case 'RUNNING':
      return <Loader2 className="size-4 animate-spin" />;
    case 'COMPLETED':
      return <CheckCircle2 className="size-4 text-success" />;
    case 'FAILED':
      return <XCircle className="size-4 text-error" />;
    default:
      return <Clock className="size-4" />;
  }
}

function getStatusLabel(status: string): { label: string; className: string } {
  switch (status) {
    case 'PENDING':
      return { label: '等待中', className: 'text-gray-400 bg-gray-500/10' };
    case 'RUNNING':
      return { label: '运行中', className: 'text-muted-foreground bg-muted-foreground/20' };
    case 'COMPLETED':
      return { label: '已完成', className: 'text-success bg-success/10' };
    case 'FAILED':
      return { label: '失败', className: 'text-error bg-error/10' };
    default:
      return { label: status, className: 'text-gray-400 bg-gray-500/10' };
  }
}

function getTypeLabel(type: string): string {
  switch (type) {
    case 'INCREMENTAL':
      return '增量采集';
    case 'FULL':
      return '全量采集';
    case 'KEYWORD':
      return '关键词采集';
    default:
      return type;
  }
}

function getErrorTypeLabel(errorType: string | null): { label: string; className: string } {
  switch (errorType) {
    case 'NETWORK': return { label: '网络错误', className: 'text-orange-500 bg-orange-500/10' };
    case 'TIMEOUT': return { label: '请求超时', className: 'text-yellow-500 bg-yellow-500/10' };
    case 'RATE_LIMIT': return { label: '限流', className: 'text-red-500 bg-red-500/10' };
    case 'PARSE': return { label: '解析错误', className: 'text-purple-500 bg-purple-500/10' };
    case 'DB': return { label: '数据库错误', className: 'text-pink-500 bg-pink-500/10' };
    case 'CANCELLED': return { label: '已取消', className: 'text-gray-400 bg-gray-500/10' };
    default: return { label: '', className: '' };
  }
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;
  return date.toLocaleDateString('zh-CN');
}

export default function TaskListPage() {
  const navigate = useNavigate();
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);
  useEffect(() => { clearBgImage(); }, [clearBgImage]);
  const { collectTasks, loadCollectTasks, deleteCollectTask, deleteOldTasks, resumeCollectTask } = useAppStore();
  const confirm = useConfirm();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);

  useEffect(() => {
    loadCollectTasks();
  }, [loadCollectTasks]);

  useEffect(() => {
    const hasActive = collectTasks.some((t) => t.status === 'RUNNING' || t.status === 'PENDING');
    if (!hasActive && !resumingId) return;
    const id = setInterval(() => {
      loadCollectTasks();
    }, 2000);
    return () => clearInterval(id);
  }, [collectTasks, resumingId, loadCollectTasks]);

  useEffect(() => {
    if (!resumingId) return;
    const task = collectTasks.find((t) => t.taskId === resumingId);
    if (task && task.status !== 'FAILED') {
      setResumingId(null);
    }
  }, [collectTasks, resumingId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadCollectTasks();
    setRefreshing(false);
  };

  const handleDelete = async (task: CollectTask) => {
    const isRunning = task.status === 'RUNNING' || task.status === 'PENDING';
    // 已完成/失败的任务直接删除，无需确认
    if (isRunning) {
      const ok = await confirm({
        title: '删除运行中的任务',
        description: `任务「${task.taskId}」正在运行中，删除后将终止采集。确认删除吗？`,
        confirmText: '删除',
        variant: 'destructive',
      });
      if (!ok) return;
    }
    setDeletingId(task.taskId);
    await deleteCollectTask(task.taskId);
    setDeletingId(null);
  };

  const handleResume = (task: CollectTask) => {
    setResumingId(task.taskId);
    resumeCollectTask(task.taskId)
      .then((result) => {
        if (!result.success) {
          toast(`续采失败: ${result.error || '未知错误'}`, 'error');
        }
        setResumingId((cur) => (cur === task.taskId ? null : cur));
      })
      .catch((err: any) => {
        toast(`续采失败: ${err.message || '未知错误'}`, 'error');
        setResumingId((cur) => (cur === task.taskId ? null : cur));
      });
    loadCollectTasks();
  };

  const handleClearOld = async () => {
    await deleteOldTasks(7);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate('/sources')} className="hover:text-text shrink-0">
              <ArrowLeft className="size-4 mr-2" /> 返回视频源
            </Button>
            <div>
              <h1 className="text-2xl font-bold">采集任务列表</h1>
              <p className="text-sm text-muted-foreground">查看所有采集任务的执行状态和进度</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap shrink-0">
            <Button variant="ghost" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? <Loader2 className="size-4 mr-2 animate-spin" /> : <RefreshCw className="size-4 mr-2" />} 刷新
            </Button>
            <Button variant="ghost" onClick={handleClearOld}>
              <Trash2 className="size-4 mr-2" /> 清除7天前任务
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">任务ID</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">视频源</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">类型</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">状态</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">进度</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">成功 / 失败</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">创建时间</th>
                <th className="text-left p-3 text-xs font-semibold text-muted-foreground">操作</th>
              </tr>
            </thead>
            <tbody>
              {collectTasks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    暂无采集任务
                  </td>
                </tr>
              ) : (
                collectTasks.map((task) => {
                  const statusInfo = getStatusLabel(task.status);
                  const progress = task.totalPages > 0 ? Math.round((task.currentPage / task.totalPages) * 100) : 0;

                  return (
                    <tr key={task.id} className="hover:bg-hover transition-colors">
                      <td className="p-3 text-sm font-mono text-muted-foreground max-w-[100px] truncate" title={task.taskId}>
                        {task.taskId}
                      </td>
                      <td className="p-3 text-sm">
                        <div className="font-medium">{task.sourceName}</div>
                        <div className="text-xs text-muted-foreground">{task.sourceCode}</div>
                      </td>
                      <td className="p-3 text-sm">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-muted-foreground/10 text-muted-foreground">
                          <Play className="size-3" /> {getTypeLabel(task.type)}
                        </span>
                      </td>
                      <td className="p-3 text-sm">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${statusInfo.className}`}>
                          {getStatusIcon(task.status)} {statusInfo.label}
                        </span>
                        {task.status === 'FAILED' && task.errorMessage && (
                          <div className="mt-1 max-w-[220px]">
                            {task.errorType && (() => {
                              const errorTypeInfo = getErrorTypeLabel(task.errorType);
                              return errorTypeInfo.label ? (
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${errorTypeInfo.className}`}>
                                  {errorTypeInfo.label}
                                </span>
                              ) : null;
                            })()}
                            <div
                              className="text-xs text-error mt-0.5 truncate cursor-help"
                              title={task.errorMessage}
                            >
                              {task.errorMessage}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${task.status === 'RUNNING' ? 'bg-muted-foreground' : task.status === 'COMPLETED' ? 'bg-success' : task.status === 'FAILED' ? 'bg-error' : 'bg-gray-500'}`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {task.currentPage}/{task.totalPages} 页
                        </div>
                      </td>
                      <td className="p-3 text-sm">
                        <span className="font-medium text-success">{task.collectedCount}</span>
                        <span className="text-muted-foreground mx-1">/</span>
                        <span className="font-medium text-error">{task.failedCount}</span>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {formatTimeAgo(task.createdAt)}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          {task.status === 'FAILED' && (task.type === 'INCREMENTAL' || task.type === 'FULL') && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => handleResume(task)}
                              disabled={resumingId === task.taskId}
                            >
                              {resumingId === task.taskId ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />} 继续
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-error"
                            onClick={() => handleDelete(task)}
                            disabled={deletingId === task.taskId || resumingId === task.taskId}
                          >
                            {deletingId === task.taskId ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}