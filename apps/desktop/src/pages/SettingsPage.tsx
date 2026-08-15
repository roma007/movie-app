import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { useBackgroundStore } from '../themes/backgroundStore';
import { Database, ChevronRight, Palette, SlidersHorizontal, Sparkles } from 'lucide-react';

export default function SettingsPage() {
  const navigate = useNavigate();
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);
  useEffect(() => { clearBgImage(); return () => {}; }, [clearBgImage]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <Card className="p-4">
        <button
          className="flex items-center justify-between py-3 w-[calc(100%+2rem)] text-left hover:bg-secondary/50 transition-colors -mx-4 px-4"
          onClick={() => navigate('/settings/preferences')}
        >
          <div className="flex items-center gap-3">
            <SlidersHorizontal className="size-4 text-muted-foreground" />
            <span>使用偏好</span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
        <button
          className="flex items-center justify-between py-3 w-[calc(100%+2rem)] text-left hover:bg-secondary/50 transition-colors -mx-4 px-4"
          onClick={() => navigate('/settings/recommendation')}
        >
          <div className="flex items-center gap-3">
            <Sparkles className="size-4 text-muted-foreground" />
            <span>推荐偏好</span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
        <button
          className="flex items-center justify-between py-3 w-[calc(100%+2rem)] text-left hover:bg-secondary/50 transition-colors -mx-4 px-4"
          onClick={() => navigate('/settings/appearance')}
        >
          <div className="flex items-center gap-3">
            <Palette className="size-4 text-muted-foreground" />
            <span>外观设置</span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
        <button
          className="flex items-center justify-between py-3 w-[calc(100%+2rem)] text-left hover:bg-secondary/50 transition-colors -mx-4 px-4"
          onClick={() => navigate('/sources')}
        >
          <div className="flex items-center gap-3">
            <Database className="size-4 text-muted-foreground" />
            <span>视频源管理</span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
        <button
          className="flex items-center justify-between py-3 w-[calc(100%+2rem)] text-left hover:bg-secondary/50 transition-colors -mx-4 px-4"
          onClick={() => navigate('/settings/video')}
        >
          <div className="flex items-center gap-3">
            <Database className="size-4 text-muted-foreground" />
            <span>视频管理</span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
        <button
          className="flex items-center justify-between py-3 w-[calc(100%+2rem)] text-left hover:bg-secondary/50 transition-colors -mx-4 px-4"
          onClick={() => navigate('/settings/collect')}
        >
          <div className="flex items-center gap-3">
            <Database className="size-4 text-muted-foreground" />
            <span>采集配置</span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
      </Card>
    </div>
  );
}
