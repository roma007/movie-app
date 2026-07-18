import { useEffect, useState, useRef } from 'react';
import { useAppStore } from '../useAppStore';
import { Button } from '@/components/ui/button';
import { X, Loader2, CheckCircle2, XCircle } from 'lucide-react';

export function CollectProgressDialog() {
  const { collectSourceProgress } = useAppStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [collectSourceProgress]);

  if (!collectSourceProgress || dismissed) return null;

  const allDone = collectSourceProgress.every(
    (s) => s.status === 'done' || s.status === 'failed'
  );

  if (allDone && !timerRef.current) {
    timerRef.current = setTimeout(() => {
      setDismissed(true);
      timerRef.current = undefined;
    }, 2000);
  }

  const totalCollected = collectSourceProgress.reduce((sum, s) => sum + s.collected, 0);
  const doneCount = collectSourceProgress.filter((s) => s.status === 'done').length;
  const failedCount = collectSourceProgress.filter((s) => s.status === 'failed').length;

  return (
    <div className="fixed top-4 left-4 z-50 w-80 max-h-[70vh] rounded-lg border border-border bg-card shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">
          {allDone ? '采集完成' : '增量采集中...'}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => {
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = undefined;
            setDismissed(true);
          }}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="overflow-y-auto max-h-[calc(70vh-48px)] p-2 space-y-1">
        {collectSourceProgress.map((s, i) => (
          <div
            key={i}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
              s.status === 'failed'
                ? 'bg-error/5'
                : s.status === 'done'
                  ? 'bg-success/5'
                  : 'bg-accent/30'
            }`}
          >
            {s.status === 'running' ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
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
              ) : (
                <div className="text-xs text-muted-foreground">
                  第 {s.currentPage}/{s.totalPages} 页 · 已采集 {s.collected} 部
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        共采集 {totalCollected} 部
        {doneCount > 0 && ` · ${doneCount} 源完成`}
        {failedCount > 0 && ` · ${failedCount} 源失败`}
      </div>
    </div>
  );
}
