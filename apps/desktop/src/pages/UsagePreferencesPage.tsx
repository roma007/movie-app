import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Clock, Home, KeyRound, PictureInPicture2, Waypoints, Video } from 'lucide-react';
import { useAppStore } from '../useAppStore';
import { useThemeStore } from '../themes/store';
import { usePlayerStore } from '../stores/playerStore';
import { getProvider } from '../init';
import { SystemConfigService } from '@movie-app/core';
import type { UserUsageType } from '@movie-app/core';

const USAGE_OPTIONS: { type: UserUsageType; label: string; desc: string }[] = [
  { type: 'SEARCH_FIRST', label: '搜索优先', desc: '即时搜索采集想看的' },
  { type: 'NEW_MOVIES', label: '追新电影', desc: '增量采集最新的电影' },
  { type: 'TV_SERIES', label: '追剧/综艺', desc: '追更电视剧/综艺' },
];

const sliderClasses =
  'w-full h-1.5 rounded-full appearance-none cursor-pointer bg-[var(--color-secondary)] accent-muted-foreground ' +
  '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 ' +
  '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-muted-foreground ' +
  '[&::-webkit-slider-thumb]:cursor-pointer ' +
  '[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full ' +
  '[&::-moz-range-thumb]:bg-muted-foreground [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-pointer';

export default function UsagePreferencesPage() {
  const navigate = useNavigate();

  const [playbackEnabled, setPlaybackEnabled] = useState(true);
  const [playbackThreshold, setPlaybackThreshold] = useState(10);
  const [prefetchConcurrency, setPrefetchConcurrency] = useState(3);
  const [miniPlayerEnabled, setMiniPlayerEnabled] = useState(true);
  const [tmdbApiKey, setTmdbApiKey] = useState('');
  const [tmdbKeyDirty, setTmdbKeyDirty] = useState(false);
  const { userUsageTypes, loadUserUsageTypes, setUserUsageTypes } = useAppStore();
  const { maxBufferSize, setMaxBufferSize } = useThemeStore();

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
        setPrefetchConcurrency(config.prefetchConcurrency);
        setMiniPlayerEnabled(config.miniPlayerEnabled);
        setTmdbApiKey(await configService.getString('rating.tmdbApiKey', ''));
      } catch {}
    })();
  }, []);

  const handleSaveTmdbKey = async () => {
    try {
      const configService = new SystemConfigService(getProvider());
      await configService.setString('rating.tmdbApiKey', tmdbApiKey.trim());
      setTmdbKeyDirty(false);
    } catch {}
  };

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

  const handleConcurrencyChange = async (n: number) => {
    setPrefetchConcurrency(n);
    try {
      const configService = new SystemConfigService(getProvider());
      await configService.setPlaybackConfig({ prefetchConcurrency: n });
    } catch {}
  };

  const handleToggleMiniPlayer = async () => {
    const next = !miniPlayerEnabled;
    setMiniPlayerEnabled(next);
    usePlayerStore.getState().setMiniPlayerEnabled(next);
    try {
      const configService = new SystemConfigService(getProvider());
      await configService.setPlaybackConfig({ miniPlayerEnabled: next });
    } catch {}
  };

  const handleToggleUsage = (type: UserUsageType) => {
    const next = userUsageTypes.includes(type)
      ? userUsageTypes.filter((t) => t !== type)
      : [...userUsageTypes, type];
    if (next.length > 0) setUserUsageTypes(next);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/settings')} className="hover:text-text">
            <ArrowLeft className="size-4 mr-2" />
            返回
          </Button>
          <h1 className="text-2xl font-bold">使用偏好</h1>
        </div>
      </div>

      <Card className="p-5 mb-8">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 w-48 shrink-0">
            <Home className="size-4 text-muted-foreground shrink-0" />
            <span className="font-medium">首页偏好（可多选）</span>
          </div>
          <div className="flex gap-3 flex-1 min-w-0 flex-wrap justify-end">
            {USAGE_OPTIONS.map((opt) => {
              const isActive = userUsageTypes.includes(opt.type);
              return (
                <button
                  key={opt.type}
                  onClick={() => handleToggleUsage(opt.type)}
                  className={`flex flex-col items-center gap-2 px-4 py-4 rounded-lg transition-all backdrop-blur-sm ${
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
        </div>
      </Card>

      <Card className="p-5 mb-8">
        <div className="flex items-center gap-6">
          <div className="w-80 shrink-0">
            <div className="flex items-center gap-3">
              <PictureInPicture2 className="size-4 text-muted-foreground shrink-0" />
              <span className="font-medium">弹窗播放</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">开启后，离开播放页时以小窗继续播放；关闭后，离开播放页将停止播放</p>
          </div>
          <div className="flex-1 min-w-0 flex items-center justify-end">
            <Switch checked={miniPlayerEnabled} onCheckedChange={handleToggleMiniPlayer} />
          </div>
        </div>
      </Card>

      <Card className="p-5 mb-8">
        <div className="flex items-center gap-6">
          <div className="w-48 shrink-0">
            <div className="flex items-center gap-3">
              <Clock className="size-4 text-muted-foreground shrink-0" />
              <span className="font-medium">片尾下一集提示</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1 whitespace-nowrap">临近片尾时提前提示下一集</p>
          </div>
          <div className="flex-1 min-w-0 flex flex-col items-end gap-3">
            <Switch checked={playbackEnabled} onCheckedChange={handleTogglePlayback} />
            {playbackEnabled && (
              <div className="flex items-center gap-2 flex-wrap justify-end">
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
            )}
          </div>
        </div>
      </Card>

      <Card className="p-5 mb-8">
        <div className="flex items-start gap-6">
          <div className="w-80 shrink-0">
            <div className="flex items-center gap-3">
              <Waypoints className="size-4 text-muted-foreground shrink-0" />
              <span className="font-medium">播放缓冲并发数</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">播放时单视频并发缓冲的数量。越大卡顿越少，但越可能引起片源方反爬</p>
          </div>
          <div className="flex items-center gap-3 flex-1 min-w-0 flex-wrap justify-end">
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={prefetchConcurrency}
              onChange={(e) => handleConcurrencyChange(Number(e.target.value))}
              className={sliderClasses + ' w-56'}
            />
            <span className="text-sm text-muted-foreground w-6 text-right shrink-0">{prefetchConcurrency}</span>
          </div>
        </div>
      </Card>

      <Card className="p-5 mb-8">
        <div className="flex items-center gap-6">
          <div className="w-80 shrink-0">
            <div className="flex items-center gap-3">
              <Video className="size-4 text-muted-foreground shrink-0" />
              <span className="font-medium">播放缓冲内存上限</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">值越大网络波动时越不容易卡顿，但内存占用越高</p>
          </div>
          <div className="flex items-center gap-3 flex-1 min-w-0 flex-wrap justify-end">
            <input
              type="range"
              min={30}
              max={600}
              step={30}
              value={maxBufferSize}
              onChange={(e) => setMaxBufferSize(Number(e.target.value))}
              className={sliderClasses + ' w-56'}
            />
            <span className="text-sm text-muted-foreground w-12 text-right shrink-0">{maxBufferSize}MB</span>
          </div>
        </div>
      </Card>

      <Card className="p-5 mb-8">
        <div className="flex items-start gap-6">
          <div className="w-80 shrink-0">
            <div className="flex items-center gap-3">
              <KeyRound className="size-4 text-muted-foreground shrink-0" />
              <span className="font-medium">TMDB API Key（评分回退）</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">当豆瓣查不到评分时，用 TMDB 作为补充评分来源。到 themoviedb.org 免费申请 Key；留空则只使用豆瓣</p>
          </div>
          <div className="flex items-center gap-3 flex-1 min-w-0 flex-wrap justify-end">
            <Input
              type="text"
              placeholder="填入 TMDB API Key（可选）"
              value={tmdbApiKey}
              onChange={(e) => { setTmdbApiKey(e.target.value); setTmdbKeyDirty(true); }}
              className="w-72"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!tmdbKeyDirty}
              onClick={handleSaveTmdbKey}
            >
              保存
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
