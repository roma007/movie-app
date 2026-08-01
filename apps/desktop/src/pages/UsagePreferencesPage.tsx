import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Clock, Home } from 'lucide-react';
import { useAppStore } from '../useAppStore';
import { getProvider } from '../init';
import { SystemConfigService } from '@movie-app/core';
import type { UserUsageType } from '@movie-app/core';

const USAGE_OPTIONS: { type: UserUsageType; label: string; desc: string }[] = [
  { type: 'SEARCH_FIRST', label: '搜索优先', desc: '临时搜索采集，找想看的视频' },
  { type: 'NEW_MOVIES', label: '新片追逐', desc: '增量采集最新电影，挑选感兴趣的' },
  { type: 'TV_SERIES', label: '追剧/综艺', desc: '追更电视剧/综艺，追完再增量采集' },
];

export default function UsagePreferencesPage() {
  const navigate = useNavigate();

  const [playbackEnabled, setPlaybackEnabled] = useState(true);
  const [playbackThreshold, setPlaybackThreshold] = useState(10);
  const { userUsageTypes, loadUserUsageTypes, setUserUsageTypes } = useAppStore();

  useEffect(() => {
    loadUserUsageTypes();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const configService = new SystemConfigService(getProvider());
        const config = await configService.getPlaybackConfig();
        setPlaybackEnabled(config.showNextEpisodeOverlay);
        setPlaybackThreshold(config.outroThresholdMinutes);
      } catch {}
    })();
  }, []);

  const handleTogglePlayback = async () => {
    const next = !playbackEnabled;
    setPlaybackEnabled(next);
    try {
      const configService = new SystemConfigService(getProvider());
      await configService.setPlaybackConfig({ showNextEpisodeOverlay: next });
    } catch {}
  };

  const handleThresholdChange = async (minutes: number) => {
    setPlaybackThreshold(minutes);
    try {
      const configService = new SystemConfigService(getProvider());
      await configService.setPlaybackConfig({ outroThresholdMinutes: minutes });
    } catch {}
  };

  const handleToggleUsage = (type: UserUsageType) => {
    const next = userUsageTypes.includes(type)
      ? userUsageTypes.filter((t) => t !== type)
      : [...userUsageTypes, type];
    if (next.length > 0) setUserUsageTypes(next);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/settings')} className="hover:text-text">
            <ArrowLeft className="size-4 mr-2" />
            返回
          </Button>
          <h1 className="text-2xl font-bold">使用偏好</h1>
        </div>
      </div>

      <Card className="p-4 mt-6">
        <div className="flex items-center gap-3 mb-3">
          <Home className="size-4 text-muted-foreground" />
          <span className="font-medium">首页偏好（可多选）</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {USAGE_OPTIONS.map((opt) => {
            const isActive = userUsageTypes.includes(opt.type);
            return (
              <button
                key={opt.type}
                onClick={() => handleToggleUsage(opt.type)}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg transition-all backdrop-blur-sm ${
                  isActive
                    ? 'bg-muted-foreground/20 text-text'
                    : 'bg-[var(--color-card-alpha)] hover:bg-[var(--color-hover-alpha)] text-text-secondary hover:text-text'
                }`}
              >
                <div className={`size-5 flex items-center justify-center rounded transition-colors ${
                  isActive ? 'bg-muted-foreground' : 'bg-[var(--color-border)]'
                }`}>
                  {isActive && <span className="text-white text-xs font-bold">✓</span>}
                </div>
                <span className="text-sm font-medium">{opt.label}</span>
                <span className="text-xs text-center leading-tight">{opt.desc}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="p-4 space-y-4 mt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="size-4 text-muted-foreground" />
            <span className="font-medium">片尾下一集提示</span>
          </div>
          <Switch checked={playbackEnabled} onCheckedChange={handleTogglePlayback} />
        </div>

        {playbackEnabled && (
          <div>
            <span className="text-sm text-muted-foreground block mb-2">提前提示时间</span>
            <div className="flex gap-2">
              {[5, 10, 15].map((m) => (
                <Button
                  key={m}
                  variant="outline"
                  size="sm"
                  onClick={() => handleThresholdChange(m)}
                  className={playbackThreshold === m ? 'bg-muted-foreground/20 text-text' : ''}
                >
                  {m} 分钟
                </Button>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
