import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Search, Film, Tv } from 'lucide-react';
import { useAppStore } from '../useAppStore';
import type { UserUsageType } from '@movie-app/core';

const OPTIONS: { type: UserUsageType; label: string; desc: string; icon: any }[] = [
  { type: 'SEARCH_FIRST', label: '搜索优先', desc: '临时搜索采集，找想看的视频', icon: Search },
  { type: 'NEW_MOVIES', label: '新片追逐', desc: '增量采集最新电影，挑选感兴趣的', icon: Film },
  { type: 'TV_SERIES', label: '追剧/综艺', desc: '追更电视剧/综艺，追完再增量采集', icon: Tv },
];

export function UsageGuideDialog() {
  const [open, setOpen] = useState(true);
  const { setUserUsageTypes } = useAppStore();
  const [selected, setSelected] = useState<Set<UserUsageType>>(new Set());

  const handleToggle = (type: UserUsageType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selected.size === 0) return;
    await setUserUsageTypes([...selected]);
    setOpen(false);
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
      <DialogContent className="w-full max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-bold">选择你的使用方式</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground text-center mb-4">
          可多选，首页将展示所有选中类型的核心功能卡片（后续可在设置中修改）
        </p>
        <div className="space-y-3">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isActive = selected.has(opt.type);
            return (
              <button
                key={opt.type}
                onClick={() => handleToggle(opt.type)}
                className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-all ${
                  isActive
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <div className={`size-5 flex items-center justify-center rounded border-2 ${
                  isActive ? 'border-primary bg-primary' : 'border-muted-foreground'
                }`}>
                  {isActive && <span className="text-white text-xs font-bold">✓</span>}
                </div>
                <Icon className={`size-6 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                <div className="text-left">
                  <div className={`font-medium ${isActive ? 'text-primary' : ''}`}>{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex gap-3 mt-4">
          <Button variant="outline" onClick={() => setOpen(false)} className="flex-1">
            跳过
          </Button>
          <Button onClick={handleConfirm} disabled={selected.size === 0} className="flex-1">
            确认（{selected.size} 项）
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
