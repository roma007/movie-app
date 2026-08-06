import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Layers, Type, Maximize2, Palette } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useThemeStore } from '../themes/store';
import { useFontSizeStore } from '../themes/fontSizeStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { ColorMode } from '../themes/types';

const CHECK_COLOR = '#22c55e';

const OPTIONS: { mode: ColorMode; label: string }[] = [
  { mode: 'system', label: '跟随系统' },
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
    <div className="p-6 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/settings')} className="hover:text-text">
            <ArrowLeft className="size-4 mr-2" />
            返回
          </Button>
          <h1 className="text-2xl font-bold">外观设置</h1>
        </div>
      </div>

      <Card className="overflow-hidden mb-8">
        <div className="flex items-center gap-6 p-5">
          <div className="flex items-center gap-3 w-40 shrink-0">
            <Palette className="size-4 text-muted-foreground" />
            <span className="font-medium">颜色模式</span>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap justify-end">
            {OPTIONS.map((opt) => {
              const active = colorMode === opt.mode;
              return (
                <button
                  key={opt.mode}
                  onClick={() => setColorMode(opt.mode)}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg hover:bg-secondary/40 transition-colors"
                >
                  <div className="text-base font-medium text-text">{opt.label}</div>
                  {active ? (
                    <div
                      className="rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ width: 22, height: 22, backgroundColor: CHECK_COLOR }}
                    >
                      <span className="text-white text-xs font-bold leading-none">✓</span>
                    </div>
                  ) : (
                    <div
                      className="rounded-full flex-shrink-0"
                      style={{
                        width: 22,
                        height: 22,
                        border: '2px solid rgb(148 163 184 / 0.6)',
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="p-5 mb-8">
        <div className="flex items-start gap-6">
          <div className="flex items-center gap-3 w-40 shrink-0 pt-1">
            <Layers className="size-4 text-muted-foreground" />
            <span className="font-medium">背景</span>
          </div>
          <div className="flex items-start gap-5 flex-1 min-w-0 flex-wrap justify-end">
            <div className="w-36 space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">透明度</span>
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

            <div className="w-36 space-y-2">
              <div className="flex items-center gap-1.5">
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

            <div className="w-36 space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">背景图模糊</span>
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

            <div className="w-36 space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">背景图缩放</span>
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
        </div>
      </Card>

      <Card className="p-5 mb-8">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 w-40 shrink-0">
            <Type className="size-4 text-muted-foreground" />
            <span className="font-medium">字体大小</span>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap justify-end">
            {fontSizes.map((size) => (
              <Button
                key={size.id}
                variant="outline"
                onClick={() => setFontSize(size.id)}
                className={currentFontSize === size.id ? 'bg-muted-foreground/20 text-text' : ''}
              >
                <span style={{ fontSize: size.size }}>{size.label}</span>
              </Button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="p-5 mb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Maximize2 className="size-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">记住窗口大小和位置</div>
              <div className="text-sm text-muted-foreground mt-1">
                关闭后每次启动将以最大化窗口打开
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
