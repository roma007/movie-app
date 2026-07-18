import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ThemeSwitcher } from '../themes/ThemeSwitcher';
import { useFontSizeStore } from '../themes/fontSizeStore';
import { Database, ChevronRight, Info, BookOpen, Type, Video, FileText } from 'lucide-react';
import { DiagnosticLogViewer } from '@/components/DiagnosticLogViewer';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { currentFontSize, fontSizes, setFontSize } = useFontSizeStore();
  const [showDiagnosticLogs, setShowDiagnosticLogs] = useState(false);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 bg-background -mx-6 px-6 pb-4 border-b border-border">
        <h1 className="text-2xl font-bold">设置</h1>
      </div>

      <Card className="p-4 bg-card border-border">
        <ThemeSwitcher />
      </Card>

      <Card className="p-4 bg-card border-border">
        <div className="flex items-center gap-3 mb-3">
          <Type className="size-4 text-muted-foreground" />
          <span className="font-medium">字体大小</span>
        </div>
        <div className="flex gap-2">
          {fontSizes.map((size) => (
            <Button
              key={size.id}
              variant={currentFontSize === size.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFontSize(size.id)}
              className={currentFontSize === size.id ? 'bg-primary' : ''}
            >
              {size.label}
            </Button>
          ))}
        </div>
      </Card>

      <Card className="p-4 divide-y divide-border bg-card border-border">
        <button
          className="flex items-center justify-between py-3 first:pt-0 w-full text-left hover:bg-secondary/50 transition-colors -mx-4 px-4"
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
            <Video className="size-4 text-muted-foreground" />
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

      <Card className="p-4 bg-card border-border">
        <button
          className="flex items-center justify-between w-full text-left hover:bg-secondary/50 transition-colors -mx-4 px-4 py-2"
          onClick={() => setShowDiagnosticLogs(!showDiagnosticLogs)}
        >
          <div className="flex items-center gap-3">
            <FileText className="size-4 text-muted-foreground" />
            <span>诊断日志</span>
          </div>
          <ChevronRight className={`size-4 text-muted-foreground transition-transform ${showDiagnosticLogs ? 'rotate-90' : ''}`} />
        </button>
        {showDiagnosticLogs && (
          <div className="mt-4">
            <DiagnosticLogViewer />
          </div>
        )}
      </Card>

      <Card className="p-4 bg-card border-border">
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