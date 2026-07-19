import { useCallback } from 'react';
import { Menu } from '@vidstack/react';

interface ColorControlsProps {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  onChange: (values: { brightness: number; contrast: number; saturation: number; hue: number }) => void;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  defaultValue: number;
  onChange: (value: number) => void;
}

function SliderRow({ label, value, min, max, step, unit, defaultValue, onChange }: SliderRowProps) {
  return (
    <div className="py-1 px-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-white/90">{label}</span>
        <button
          onClick={() => onChange(defaultValue)}
          className="text-xs text-white/50 hover:text-white/80 transition-colors"
        >
          {value === defaultValue ? '' : '重置'}
        </button>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-[200%] h-1.5 rounded-full appearance-none cursor-pointer bg-white/20
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
          [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md
          [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-pointer"
        style={{
          background: `linear-gradient(to right, rgb(74 158 255) ${(value - min) / (max - min) * 100}%, rgb(255 255 255 / 0.2) ${(value - min) / (max - min) * 100}%)`,
        }}
      />
      <div className="flex justify-between mt-0.5">
        <span className="text-xs text-white/40">{min}{unit}</span>
        <span className="text-xs text-white/40">{max}{unit}</span>
      </div>
    </div>
  );
}

export function ColorControls({ brightness, contrast, saturation, hue, onChange }: ColorControlsProps) {
  const handleReset = useCallback(() => {
    onChange({ brightness: 100, contrast: 100, saturation: 100, hue: 0 });
  }, [onChange]);

  const isDefault = brightness === 100 && contrast === 100 && saturation === 100 && hue === 0;

  return (
    <Menu.Root>
      <Menu.Button className="vds-menu-item">
        <svg className="vds-menu-close-icon vds-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        <svg className="vds-menu-item-icon vds-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="13.5" cy="6.5" r="2.5" />
          <circle cx="17.5" cy="10.5" r="2.5" />
          <circle cx="8.5" cy="7.5" r="2.5" />
          <circle cx="6.5" cy="12.5" r="2.5" />
          <path d="M12 22a10 10 0 1 1 0-20 10 10 0 0 1 10 10c0 1.5-.5 2-2 2h-2c-.6 0-1 .4-1 1v2c0 .6-.4 1-1 1h-1c-.6 0-1 .4-1 1v1c0 .6-.4 1-1 1z" />
        </svg>
        <span className="vds-menu-item-label">色彩控制</span>
        {!isDefault && (
          <span className="vds-menu-item-hint" onClick={(e) => { e.stopPropagation(); handleReset(); }} style={{ cursor: 'pointer' }}>
            重置
          </span>
        )}
        <svg className="vds-menu-open-icon vds-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
      </Menu.Button>
      <Menu.Items className="vds-menu-items">
        <div className="border-t border-white/10">
          <SliderRow
            label="亮度"
            value={brightness}
            min={0}
            max={200}
            step={1}
            unit="%"
            defaultValue={100}
            onChange={(v) => onChange({ brightness: v, contrast, saturation, hue })}
          />
          <SliderRow
            label="对比度"
            value={contrast}
            min={0}
            max={200}
            step={1}
            unit="%"
            defaultValue={100}
            onChange={(v) => onChange({ brightness, contrast: v, saturation, hue })}
          />
          <SliderRow
            label="饱和度"
            value={saturation}
            min={0}
            max={200}
            step={1}
            unit="%"
            defaultValue={100}
            onChange={(v) => onChange({ brightness, contrast, saturation: v, hue })}
          />
          <SliderRow
            label="色调"
            value={hue}
            min={0}
            max={360}
            step={1}
            unit="°"
            defaultValue={0}
            onChange={(v) => onChange({ brightness, contrast, saturation, hue: v })}
          />
        </div>
      </Menu.Items>
    </Menu.Root>
  );
}
