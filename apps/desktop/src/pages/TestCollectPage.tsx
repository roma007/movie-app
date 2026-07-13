import { useState } from 'react';
import { getCollector } from '../init';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function TestCollectPage() {
  const [logs, setLogs] = useState<string[]>([]);
  const [collecting, setCollecting] = useState(false);

  const addLog = (message: string) => {
    setLogs(prev => [...prev, message]);
    console.log(message);
  };

  const handleTestCollect = async () => {
    setCollecting(true);
    setLogs([]);
    
    addLog('=== 开始测试采集 ===');
    
    try {
      addLog('获取采集器...');
      const collector = getCollector();
      addLog('采集器获取成功');
      
      addLog('调用 collectLatest(1, 20)...');
      const media = await collector.collectLatest(1, 20);
      addLog(`采集完成，获取到 ${media.length} 条数据`);
      
      if (media.length > 0) {
        media.forEach((m, i) => {
          addLog(`${i + 1}. ${m.title} (${m.year}年) - ${m.type}`);
        });
      } else {
        addLog('没有获取到任何数据');
      }
    } catch (error) {
      addLog(`采集失败: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        addLog(`堆栈信息:\n${error.stack}`);
      }
    } finally {
      setCollecting(false);
      addLog('=== 测试结束 ===');
    }
  };

  return (
    <div className="p-6">
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>采集测试</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleTestCollect} disabled={collecting} className="w-full">
            {collecting ? '采集中...' : '开始测试采集'}
          </Button>
          
          <ScrollArea className="h-[400px] rounded-md border">
            <div className="p-4 font-mono text-sm space-y-1">
              {logs.map((log, index) => (
                <div key={index} className="whitespace-pre-wrap">
                  {log}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}