import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ThemeSwitcher } from '../themes/ThemeSwitcher';
import { useFontSizeStore } from '../themes/fontSizeStore';
import { Search, Film, Tv, Database, ChevronRight, Info, BookOpen, Type, Video, FileText } from 'lucide-react';
import { DiagnosticLogViewer } from '@/components/DiagnosticLogViewer';
import { useAppStore } from '../useAppStore';
import type { UserUsageType } from '@movie-app/core';

const USAGE_OPTIONS: { type: UserUsageType; label: string; desc: string; icon: any }[] = [
  { type: 'SEARCH_FIRST', label: '搜索优先', desc: '临时搜索采集，找想看的视频', icon: Search },
  { type: 'NEW_MOVIES', label: '新片追逐', desc: '增量采集最新电影，挑选感兴趣的', icon: Film },
  { type: 'TV_SERIES', label: '追剧/综艺', desc: '追更电视剧/综艺，追完再增量采集', icon: Tv },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const { currentFontSize, fontSizes, setFontSize } = useFontSizeStore();
  const [showDiagnosticLogs, setShowDiagnosticLogs] = useState(false);
  const { userUsageTypes, loadUserUsageTypes, setUserUsageTypes } = useAppStore();

  useEffect(() => {
    loadUserUsageTypes();
  }, []);

  const handleToggleUsage = (type: UserUsageType) => {
    const next = userUsageTypes.includes(type)
      ? userUsageTypes.filter((t) => t !== type)
      : [...userUsageTypes, type];
    if (next.length > 0) setUserUsageTypes(next);
  };

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

      <Card className="p-4 bg-card border-border">
        <span className="font-medium mb-3 block">使用偏好（可多选）</span>
        <div className="grid grid-cols-3 gap-3">
          {USAGE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isActive = userUsageTypes.includes(opt.type);
            return (
              <button
                key={opt.type}
                onClick={() => handleToggleUsage(opt.type)}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-all ${
                  isActive
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/50 hover:bg-secondary/50 text-muted-foreground'
                }`}
              >
                <div className={`size-5 flex items-center justify-center rounded border-2 ${
                  isActive ? 'border-primary bg-primary' : 'border-current'
                }`}>
                  {isActive && <span className="text-white text-xs font-bold">✓</span>}
                </div>
                <Icon className="size-6" />
                <span className="text-sm font-medium">{opt.label}</span>
                <span className="text-xs text-center leading-tight">{opt.desc}</span>
              </button>
            );
          })}
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
            <div className="text-sm text-muted-foreground">Movie App · 版本 1.0.2</div>
          </div>
        </div>
      </Card>
    </div>
  );
}