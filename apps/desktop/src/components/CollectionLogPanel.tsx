import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../useAppStore';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, X, Loader2, AlertTriangle, Info } from 'lucide-react';

interface CollectionLogPanelProps {
  sourceCode?: string;
  taskId?: string;
}

export function CollectionLogPanel({ sourceCode, taskId }: CollectionLogPanelProps) {
  const { collectionLogs, clearCollectionLogs, loadPersistedCollectionLogs } = useAppStore();
  const [collapsed, setCollapsed] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filteredLogs = collectionLogs.filter(l => {
    if (sourceCode && l.sourceCode !== sourceCode) return false;
    if (taskId && l.taskId !== taskId) return false;
    return true;
  });

  useEffect(() => {
    if (!collapsed && collectionLogs.length === 0) {
      setLoading(true);
      loadPersistedCollectionLogs({ limit: 200, sourceCode, taskId }).finally(() => setLoading(false));
    }
  }, [collapsed, sourceCode, taskId]);

  useEffect(() => {
    if (scrollRef.current && !collapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs, collapsed]);

  const errorCount = filteredLogs.filter(l => l.level === 'error').length;
  const warnCount = filteredLogs.filter(l => l.level === 'warn').length;

  return (
    <div className="border-t bg-card">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-accent transition-colors text-sm"
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          <span className="font-medium">采集日志</span>
          {errorCount > 0 && (
            <span className="text-xs text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">{errorCount} 错误</span>
          )}
          {warnCount > 0 && (
            <span className="text-xs text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">{warnCount} 警告</span>
          )}
          <span className="text-xs text-muted-foreground">{filteredLogs.length} 条</span>
        </div>
        {!collapsed && (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => clearCollectionLogs()}>
              清空
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setCollapsed(true)}>
              <X className="size-3" />
            </Button>
          </div>
        )}
      </button>
      {!collapsed && (
        <div ref={scrollRef} className="max-h-60 overflow-y-auto px-4 pb-2 space-y-0.5 text-xs font-mono">
          {loading ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="size-4 animate-spin mr-2" /> 加载中...
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-4 text-center text-muted-foreground">{sourceCode || taskId ? '无匹配日志' : '暂无日志'}</div>
          ) : (
            filteredLogs.map((log) => (
              <div key={log.id}>
                <div
                  className={`flex items-start gap-2 py-1 px-2 rounded cursor-pointer hover:bg-accent/50 ${
                    log.level === 'error' ? 'text-red-600 bg-red-500/5' :
                    log.level === 'warn' ? 'text-yellow-600 bg-yellow-500/5' :
                    'text-muted-foreground'
                  }`}
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                >
                  <span className="shrink-0 w-4 text-center">
                    {log.level === 'error' ? <X className="size-3 inline" /> :
                     log.level === 'warn' ? <AlertTriangle className="size-3 inline" /> :
                     <Info className="size-3 inline" />}
                  </span>
                  <span className="shrink-0 opacity-60">{log.timestamp.slice(11, 19)}</span>
                  {log.sourceCode && (
                    <span className="shrink-0 text-[10px] bg-foreground/10 px-1 rounded">{log.sourceCode}</span>
                  )}
                  <span className="break-all">{log.message}</span>
                </div>
                {expandedId === log.id && log.details && (
                  <div className="ml-8 pb-1 text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1 whitespace-pre-wrap break-all">
                    {(() => {
                      try {
                        const d = JSON.parse(log.details);
                        return Object.entries(d).map(([k, v]) => `${k}: ${v}`).join('\n');
                      } catch {
                        return log.details;
                      }
                    })()}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
