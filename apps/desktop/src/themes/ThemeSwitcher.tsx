import { useThemeStore } from './store';
import { Check, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ThemeSwitcher() {
  const { currentTheme, themes, setTheme } = useThemeStore();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Palette className="size-4" />
        <span>选择主题</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {themes.map((theme) => (
          <button
            key={theme.id}
            onClick={() => setTheme(theme.id)}
            className={cn(
              'relative flex flex-col items-center p-3 rounded-lg border transition-all duration-200',
              currentTheme === theme.id
                ? 'border-primary bg-primary-light'
                : 'border-border bg-card hover:border-highlight'
            )}
          >
            <div className="flex gap-1 mb-2">
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: theme.colors.background }}
              />
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: theme.colors.primary }}
              />
            </div>
            <span className="text-xs font-medium">{theme.name}</span>
            <span className="text-xs text-muted-foreground">{theme.description}</span>
            {currentTheme === theme.id && (
              <div className="absolute top-1.5 right-1.5">
                <Check className="size-3 text-primary" />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}