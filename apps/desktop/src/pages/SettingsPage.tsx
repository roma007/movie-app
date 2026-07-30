import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { useBackgroundStore } from '../themes/backgroundStore';
import { Database, ChevronRight, Info, BookOpen, Palette, SlidersHorizontal } from 'lucide-react';

export default function SettingsPage() {
  const navigate = useNavigate();
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);
  useEffect(() => { clearBgImage(); return () => {}; }, [clearBgImage]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <Card className="p-4">
        <button
          className="flex items-center justify-between py-3 first:pt-0 w-full text-left hover:bg-secondary/50 transition-colors -mx-4 px-4"
          onClick={() => navigate('/settings/preferences')}
        >
          <div className="flex items-center gap-3">
            <SlidersHorizontal className="size-4 text-muted-foreground" />
            <span>使用偏好</span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
        <button
          className="flex items-center justify-between py-3 w-full text-left hover:bg-secondary/50 transition-colors -mx-4 px-4"
          onClick={() => navigate('/settings/appearance')}
        >
          <div className="flex items-center gap-3">
            <Palette className="size-4 text-muted-foreground" />
            <span>外观设置</span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
        <button
          className="flex items-center justify-between py-3 w-full text-left hover:bg-secondary/50 transition-colors -mx-4 px-4"
          onClick={() => navigate('/sources')}
        >
          <div className="flex items-center gap-3">
            <Database className="size-4 text-muted-foreground" />
            <span>视频源管理</span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
        <button
          className="flex items-center justify-between py-3 w-full text-left hover:bg-secondary/50 transition-colors -mx-4 px-4"
          onClick={() => navigate('/settings/video')}
        >
          <div className="flex items-center gap-3">
            <Database className="size-4 text-muted-foreground" />
            <span>视频管理</span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
        <button
          className="flex items-center justify-between py-3 w-full text-left hover:bg-secondary/50 transition-colors -mx-4 px-4"
          onClick={() => navigate('/settings/collect')}
        >
          <div className="flex items-center gap-3">
            <Database className="size-4 text-muted-foreground" />
            <span>采集配置</span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
        <button
          className="flex items-center justify-between py-3 w-full text-left hover:bg-secondary/50 transition-colors -mx-4 px-4"
          onClick={() => navigate('/settings/guide')}
        >
          <div className="flex items-center gap-3">
            <BookOpen className="size-4 text-muted-foreground" />
            <span>采集教程</span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-3">
          <Info className="size-4 text-muted-foreground" />
          <div>
            <div className="font-medium">关于</div>
            <div className="text-sm text-muted-foreground">Movie App · 版本 1.0.25</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
