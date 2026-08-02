import { useEffect, useState, useRef } from 'react';
import { useAppStore } from '../useAppStore';
import { Button } from '@/components/ui/button';
import { X, Minus, Loader2, CheckCircle2, XCircle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const AUTO_COLLAPSE_MS = 5000;

export function CollectProgressDialog() {
  const { collectSourceProgress, collectTrigger } = useAppStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prevVisibleRef = useRef<boolean>(false);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const visible = !!collectSourceProgress && collectSourceProgress.length > 0;
    if (visible && !prevVisibleRef.current) {
      setDismissed(false);
      if (collectTrigger === 'auto') {
        // 自动采集默认收缩为小药丸，不自动展开
        setExpanded(false);
      } else {
        setExpanded(true);
        startCollapseTimer();
      }
    }
    prevVisibleRef.current = visible;
  }, [collectSourceProgress, collectTrigger]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    };
  }, []);

  const startCollapseTimer = () => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = setTimeout(() => {
      setExpanded(false);
      collapseTimerRef.current = undefined;
    }, AUTO_COLLAPSE_MS);
  };

  const handleExpand = () => {
    setExpanded(true);
    startCollapseTimer();
  };

  const handleCollapse = () => {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = undefined;
    }
    setExpanded(false);
  };

  const handleDismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = undefined;
    handleCollapse();
    setDismissed(true);
  };

  if (!collectSourceProgress || collectSourceProgress.length === 0 || dismissed) return null;

  const allDone = collectSourceProgress.every(
    (s) => s.status === 'done' || s.status === 'failed'
  );

  if (allDone && !timerRef.current) {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = undefined;
    }
    timerRef.current = setTimeout(() => {
      setDismissed(true);
      timerRef.current = undefined;
    }, 2000);
  }

  const totalCollected = collectSourceProgress.reduce((sum, s) => sum + s.collected, 0);
  const doneCount = collectSourceProgress.filter((s) => s.status === 'done').length;
  const failedCount = collectSourceProgress.filter((s) => s.status === 'failed').length;

  if (!expanded) {
    return (
      <div className="fixed bottom-4 left-4 z-50">
        <Button
          variant="secondary"
          size="sm"
          className="rounded-full shadow-lg"
          onClick={handleExpand}
        >
          {allDone ? (
            <Check className="size-3.5 text-success" />
          ) : (
            <Loader2 className="size-3.5 animate-spin" />
          )}
          <span>{allDone ? '采集完成' : '增量采集中'}</span>
          {totalCollected > 0 && (
            <span className="text-xs text-muted-foreground">{totalCollected}部</span>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 w-80 max-h-[70vh] rounded-lg bg-card shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold">
          {allDone ? '采集完成' : '增量采集中...'}
        </h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={handleCollapse}
          >
            <Minus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={handleDismiss}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="overflow-y-auto max-h-[calc(70vh-48px)] p-2 space-y-1">
        {collectSourceProgress.map((s, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
              s.status === 'failed'
                ? 'bg-error/5'
                : s.status === 'done'
                  ? 'bg-success/5'
                  : 'bg-accent/30'
            )}
          >
            {s.status === 'running' ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : s.status === 'done' ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-success" />
            ) : (
              <XCircle className="size-3.5 shrink-0 text-error" />
            )}
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium">{s.sourceName}</div>
              {s.status === 'failed' ? (
                <div className="text-xs text-error truncate">{s.error || '采集失败'}</div>
              ) : s.status === 'done' ? (
                <div className="text-xs text-muted-foreground">完成 · 共采集 {s.collected} 部</div>
              ) : s.totalPages === 0 ? (
                <div className="text-xs text-muted-foreground">正在读取待采集量...</div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  第 {s.currentPage}/{s.totalPages} 页 · 已采集 {s.collected} 部
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 py-2 text-xs text-muted-foreground">
        共采集 {totalCollected} 部
        {doneCount > 0 && ` · ${doneCount} 源完成`}
        {failedCount > 0 && ` · ${failedCount} 源失败`}
      </div>
    </div>
  );
}
