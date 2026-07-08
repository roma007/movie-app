import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../useAppStore';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Database, Trash2, ChevronRight, Info } from 'lucide-react';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { clearHistory } = useAppStore();

  const handleClearHistory = () => {
    if (confirm('确定清除所有观看历史吗？')) {
      clearHistory();
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">设置</h1>

      <Card className="p-4 divide-y divide-border">
        <div className="flex items-center justify-between py-3 first:pt-0">
          <div className="flex items-center gap-3">
            <Database className="size-4 text-muted-foreground" />
            <span>视频源管理</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/sources')}>
            管理 <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Trash2 className="size-4 text-muted-foreground" />
            <span>清除观看历史</span>
          </div>
          <Button variant="outline" size="sm" className="text-destructive" onClick={handleClearHistory}>
            清除
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-3">
          <Info className="size-4 text-muted-foreground" />
          <div>
            <div className="font-medium">关于</div>
            <div className="text-sm text-muted-foreground">Movie App · 版本 1.0.0</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
