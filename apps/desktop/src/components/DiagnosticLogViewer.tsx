import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Trash2, Download } from 'lucide-react';
import { getProvider } from '../init';

interface LogEntry {
  key: string;
  value: string;
  valueType: string;
  remark: string;
  createdAt: string;
}

export function DiagnosticLogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'error' | 'info'>('all');

  const loadLogs = async () => {
    setIsLoading(true);
    try {
      const provider = getProvider();
      const rows = await provider.select<{
        key: string;
        value: string;
        value_type: string;
        remark: string;
        created_at: string;
      }>(
        `SELECT key, value, value_type, remark, created_at 
         FROM system_config 
         WHERE key LIKE 'log_%' 
         ORDER BY created_at DESC 
         LIMIT 200`
      );
      
      setLogs(rows.map(row => ({
        key: row.key,
        value: row.value,
        valueType: row.value_type,
        remark: row.remark || '',
        createdAt: row.created_at,
      })));
    } catch (error) {
      console.error('加载诊断日志失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const clearLogs = async () => {
    try {
      const provider = getProvider();
      await provider.execute(
        `DELETE FROM system_config WHERE key LIKE 'log_%'`
      );
      setLogs([]);
    } catch (error) {
      console.error('清除日志失败:', error);
    }
  };

  const exportLogs = () => {
    const logText = logs.map(log => 
      `[${log.createdAt}] [${log.remark || 'info'}] ${log.value}`
    ).join('\n');
    
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `movie-app-diagnostic-${new Date().toISOString().slice(0, 10)}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const filteredLogs = filter === 'all' 
    ? logs 
    : logs.filter(log => log.remark === filter);

  const errorCount = logs.filter(log => log.remark === 'error').length;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">诊断日志</h3>
          {errorCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {errorCount} 个错误
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilter(filter === 'all' ? 'error' : 'all')}
          >
            {filter === 'all' ? '显示错误' : '显示全部'}
          </Button>
          <Button variant="outline" size="sm" onClick={loadLogs} disabled={isLoading}>
            <RefreshCw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="outline" size="sm" onClick={exportLogs}>
            <Download className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={clearLogs}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="h-[400px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            加载中...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            暂无日志
          </div>
        ) : (
          <div className="space-y-1 font-mono text-xs">
            {filteredLogs.map((log) => (
              <div
                key={log.key}
                className={`p-2 rounded ${
                  log.remark === 'error' 
                    ? 'bg-red-500/10 text-red-500' 
                    : 'bg-muted/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                  <Badge variant={log.remark === 'error' ? 'destructive' : 'secondary'} className="text-[10px]">
                    {log.remark || 'info'}
                  </Badge>
                </div>
                <div className="mt-1 break-all">{log.value}</div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </Card>
  );
}