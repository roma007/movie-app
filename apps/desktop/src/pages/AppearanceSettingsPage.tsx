import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Layers, Video, Type, Maximize2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useThemeStore } from '../themes/store';
import { useFontSizeStore } from '../themes/fontSizeStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { ColorMode } from '../themes/types';

const CHECK_COLOR = '#22c55e';

const OPTIONS: { mode: ColorMode; label: string; desc?: string }[] = [
  { mode: 'system', label: '跟随系统', desc: '开启后，应用将跟随系统切换您偏好的颜色模式。' },
  { mode: 'dark', label: '深色模式' },
  { mode: 'light', label: '浅色模式' },
];

export default function AppearanceSettingsPage() {
  const navigate = useNavigate();
  const colorMode = useThemeStore((s) => s.colorMode);
  const setColorMode = useThemeStore((s) => s.setColorMode);
  const {
    cardOpacity,
    setCardOpacity,
    blurIntensity,
    setBlurIntensity,
    bgImageBlur,
    setBgImageBlur,
    bgImageScale,
    setBgImageScale,
    maxBufferSize,
    setMaxBufferSize,
  } = useThemeStore();
  const { currentFontSize, fontSizes, setFontSize } = useFontSizeStore();
  const [rememberWindowSize, setRememberWindowSize] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await invoke<{ remember: boolean }>('get_window_state');
        if (!cancelled) setRememberWindowSize(state.remember);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleRememberWindow = async (next: boolean) => {
    setRememberWindowSize(next);
    try {
      await invoke('set_window_remember', { remember: next });
    } catch {}
  };

  const sliderClasses =
    'w-full h-1.5 rounded-full appearance-none cursor-pointer bg-[var(--color-secondary)] accent-muted-foreground ' +
    '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 ' +
    '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-muted-foreground ' +
    '[&::-webkit-slider-thumb]:cursor-pointer ' +
    '[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full ' +
    '[&::-moz-range-thumb]:bg-muted-foreground [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-pointer';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
        <div className="absolute inset-0 -z-10 bg-background/80 backdrop-blur-sm" />
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/settings')} className="hover:text-text">
            <ArrowLeft className="size-4 mr-2" />
            返回
          </Button>
          <h1 className="text-2xl font-bold">外观设置</h1>
        </div>
      </div>

      <div className="mt-6 mb-3 text-sm text-muted-foreground">颜色模式</div>
      <Card className="overflow-hidden mb-8">
        {OPTIONS.map((opt) => {
          const active = colorMode === opt.mode;
          return (
            <button
              key={opt.mode}
              onClick={() => setColorMode(opt.mode)}
              className="flex items-center w-full px-5 py-4 hover:bg-secondary/40 transition-colors text-left"
            >
              <div className="flex-1 min-w-0 pr-4">
                <div className="text-base font-medium text-text">{opt.label}</div>
                {opt.desc ? (
                  <div className="text-sm text-muted-foreground mt-1 leading-snug">{opt.desc}</div>
                ) : null}
              </div>
              <div className="flex-shrink-0">
                {active ? (
                  <div
                    className="rounded-full flex items-center justify-center"
                    style={{ width: 22, height: 22, backgroundColor: CHECK_COLOR }}
                  >
                    <span className="text-white text-xs font-bold leading-none">✓</span>
                  </div>
                ) : (
                  <div
                    className="rounded-full"
                    style={{
                      width: 22,
                      height: 22,
                      border: '2px solid rgb(148 163 184 / 0.6)',
                    }}
                  />
                )}
              </div>
            </button>
          );
        })}
      </Card>

      <div className="mb-3 text-sm text-muted-foreground">视觉效果</div>
      <Card className="p-5 mb-8">
        <div className="flex items-center gap-3 mb-4">
          <Layers className="size-4 text-muted-foreground" />
          <span className="font-medium">视觉效果</span>
        </div>
        <div className="flex flex-col md:flex-row gap-5">
          <div className="flex-1 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm">卡片透明度</span>
              <span className="text-sm text-muted-foreground">{cardOpacity}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              value={cardOpacity}
              onChange={(e) => setCardOpacity(Number(e.target.value))}
              className={sliderClasses}
            />
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm">磨砂强度</span>
              <span className="text-sm text-muted-foreground">{blurIntensity}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={blurIntensity}
              onChange={(e) => setBlurIntensity(Number(e.target.value))}
              className={sliderClasses}
            />
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm">图片模糊</span>
              <span className="text-sm text-muted-foreground">{bgImageBlur}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={bgImageBlur}
              onChange={(e) => setBgImageBlur(Number(e.target.value))}
              className={sliderClasses}
            />
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm">图片缩放</span>
              <span className="text-sm text-muted-foreground">{bgImageScale}x</span>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              value={bgImageScale}
              onChange={(e) => setBgImageScale(Number(e.target.value))}
              className={sliderClasses}
            />
          </div>
        </div>
      </Card>

      <div className="mb-3 text-sm text-muted-foreground">播放缓冲</div>
      <Card className="p-5 mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Video className="size-4 text-muted-foreground" />
          <span className="font-medium">播放缓冲</span>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm">缓冲上限</span>
            <span className="text-sm text-muted-foreground">{maxBufferSize}MB</span>
          </div>
          <input
            type="range"
            min={30}
            max={600}
            step={30}
            value={maxBufferSize}
            onChange={(e) => setMaxBufferSize(Number(e.target.value))}
            className={sliderClasses}
          />
          <p className="text-xs text-muted-foreground">值越大网络波动时越不容易卡顿，但内存占用越高</p>
        </div>
      </Card>

      <div className="mb-3 text-sm text-muted-foreground">字体大小</div>
      <Card className="p-5 mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Type className="size-4 text-muted-foreground" />
          <span className="font-medium">字体大小</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {fontSizes.map((size) => (
            <Button
              key={size.id}
              variant="outline"
              size="sm"
              onClick={() => setFontSize(size.id)}
              className={currentFontSize === size.id ? 'bg-muted-foreground/20 text-text' : ''}
            >
              {size.label}
            </Button>
          ))}
        </div>
      </Card>

      <div className="mb-3 text-sm text-muted-foreground">窗口</div>
      <Card className="p-5 mb-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Maximize2 className="size-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">记住窗口大小和位置</div>
              <div className="text-sm text-muted-foreground mt-1">
                关闭后每次启动将以默认窗口大小（1200×800）打开
              </div>
            </div>
          </div>
          <Switch
            checked={rememberWindowSize}
            onCheckedChange={handleToggleRememberWindow}
          />
        </div>
      </Card>
    </div>
  );
}
