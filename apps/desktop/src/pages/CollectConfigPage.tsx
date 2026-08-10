import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useAppStore } from '../useAppStore';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, RotateCcw, RefreshCw } from 'lucide-react';
import { useBackgroundStore } from '../themes/backgroundStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';

export default function CollectConfigPage() {
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);
  useEffect(() => { clearBgImage(); }, [clearBgImage]);
  const navigate = useNavigate();
  const { collectConfig, loadCollectConfig, updateCollectConfig } = useAppStore();
  const [localConfig, setLocalConfig] = useState({
    minYear: 2025,
    retryTimes: 3,
    pageSize: 20,
    maxPages: 10,
    incrementalMaxPages: 100,
    maxIncrementalHours: 720,
    concurrency: 1,
    autoEnabled: false,
    autoIntervalHours: 24,
    autoOnStartup: false,
  });
  const [autoLastRunAt, setAutoLastRunAt] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const savedConfigRef = useRef('');

  useEffect(() => {
    loadCollectConfig();
  }, []);

  useEffect(() => {
    if (collectConfig) {
      savedConfigRef.current = JSON.stringify({
        minYear: collectConfig.minYear,
        retryTimes: collectConfig.retryTimes,
        pageSize: collectConfig.pageSize,
        maxPages: collectConfig.maxPages,
        incrementalMaxPages: collectConfig.incrementalMaxPages,
        maxIncrementalHours: collectConfig.maxIncrementalHours,
        concurrency: collectConfig.concurrency,
        autoEnabled: collectConfig.autoEnabled,
        autoIntervalHours: collectConfig.autoIntervalHours,
        autoOnStartup: collectConfig.autoOnStartup,
      });
      setLocalConfig({
        minYear: collectConfig.minYear,
        retryTimes: collectConfig.retryTimes,
        pageSize: collectConfig.pageSize,
        maxPages: collectConfig.maxPages,
        incrementalMaxPages: collectConfig.incrementalMaxPages,
        maxIncrementalHours: collectConfig.maxIncrementalHours,
        concurrency: collectConfig.concurrency,
        autoEnabled: collectConfig.autoEnabled,
        autoIntervalHours: collectConfig.autoIntervalHours,
        autoOnStartup: collectConfig.autoOnStartup,
      });
      setAutoLastRunAt(collectConfig.autoLastRunAt);
    }
  }, [collectConfig]);

  const hasChanges = useMemo(() => {
    if (!collectConfig || !savedConfigRef.current) return false;
    const current = JSON.stringify({
      minYear: localConfig.minYear,
      retryTimes: localConfig.retryTimes,
      pageSize: localConfig.pageSize,
      maxPages: localConfig.maxPages,
      incrementalMaxPages: localConfig.incrementalMaxPages,
      maxIncrementalHours: Math.max(0, localConfig.maxIncrementalHours),
      concurrency: localConfig.concurrency,
      autoEnabled: localConfig.autoEnabled,
      autoIntervalHours: localConfig.autoIntervalHours,
      autoOnStartup: localConfig.autoOnStartup,
    });
    return current !== savedConfigRef.current;
  }, [localConfig, collectConfig]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  const handleSave = async () => {
    await updateCollectConfig({
      ...localConfig,
      maxIncrementalHours: Math.max(0, localConfig.maxIncrementalHours),
    });
    savedConfigRef.current = JSON.stringify({
      minYear: localConfig.minYear,
      retryTimes: localConfig.retryTimes,
      pageSize: localConfig.pageSize,
      maxPages: localConfig.maxPages,
      incrementalMaxPages: localConfig.incrementalMaxPages,
      maxIncrementalHours: Math.max(0, localConfig.maxIncrementalHours),
      concurrency: localConfig.concurrency,
      autoEnabled: localConfig.autoEnabled,
      autoIntervalHours: localConfig.autoIntervalHours,
      autoOnStartup: localConfig.autoOnStartup,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleFieldBlur = async (field: string, value: number) => {
    await updateCollectConfig({
      ...localConfig,
      [field]: value,
    });
  };

  const handleReset = () => {
    setLocalConfig({
      minYear: 2025,
      retryTimes: 3,
      pageSize: 20,
      maxPages: 100,
      incrementalMaxPages: 100,
      maxIncrementalHours: 720,
      concurrency: 6,
      autoEnabled: false,
      autoIntervalHours: 24,
      autoOnStartup: false,
    });
  };

  const handleBack = useCallback(() => {
    if (hasChanges) {
      setPendingNavigation(() => () => navigate('/settings'));
      setShowUnsavedDialog(true);
    } else {
      navigate('/settings');
    }
  }, [hasChanges, navigate]);

  const handleDialogClose = async (action: 'save' | 'discard' | 'cancel') => {
    if (action === 'save') {
      await handleSave();
      pendingNavigation?.();
    } else if (action === 'discard') {
      pendingNavigation?.();
    }
    setShowUnsavedDialog(false);
    setPendingNavigation(null);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={handleBack} className="hover:text-text">
            <ArrowLeft className="size-4 mr-2" />
            返回
          </Button>
          <h1 className="text-2xl font-bold">采集配置</h1>
          <div className="flex-1" />
          <Button size="sm" onClick={handleReset}>
            <RotateCcw className="size-3.5 mr-1.5" />
            重置默认
          </Button>
          <Button size="sm" onClick={handleSave}>
            <Save className="size-4 mr-2" />
            {saved ? '已保存' : '保存配置'}
          </Button>
        </div>
      </div>

      <Card className="p-6 space-y-6">
        <div className="grid grid-cols-3 gap-6">
          <div className="space-y-2">
            <Label htmlFor="maxPages">全量采集最大页数</Label>
            <Input
              id="maxPages"
              type="number"
              min="1"
              value={localConfig.maxPages}
              onChange={(e) => setLocalConfig({ ...localConfig, maxPages: Math.max(1, parseInt(e.target.value) || 10) })}
            />
            <p className="text-xs text-muted-foreground">全量采集时最多采集多少页数据</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="incrementalMaxPages">增量采集最大页数</Label>
            <Input
              id="incrementalMaxPages"
              type="number"
              min="1"
              value={localConfig.incrementalMaxPages}
              onChange={(e) => setLocalConfig({ ...localConfig, incrementalMaxPages: Math.max(1, parseInt(e.target.value) || 10) })}
              onBlur={() => handleFieldBlur('incrementalMaxPages', localConfig.incrementalMaxPages)}
            />
            <p className="text-xs text-muted-foreground">断点和定额模式均受此限制</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxIncrementalHours">增量最大追溯时间（小时）</Label>
            <Input
              id="maxIncrementalHours"
              type="number"
              min="0"
              max="8760"
              value={localConfig.maxIncrementalHours}
              onChange={(e) => setLocalConfig({ ...localConfig, maxIncrementalHours: Math.max(0, parseInt(e.target.value) || 0) })}
            />
            <p className="text-xs text-muted-foreground">0=不限，断点续采时 h 的最大值（全量采集不受影响）</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="concurrency">并发处理数量</Label>
            <Input
              id="concurrency"
              type="number"
              min="1"
              max="20"
              value={localConfig.concurrency}
              onChange={(e) => setLocalConfig({ ...localConfig, concurrency: Math.min(20, Math.max(1, parseInt(e.target.value) || 1)) })}
            />
            <p className="text-xs text-muted-foreground">同时处理多少个项目（过高可能触发反爬）</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pageSize">每页大小</Label>
            <Input
              id="pageSize"
              type="number"
              min="5"
              max="100"
              value={localConfig.pageSize}
              onChange={(e) => setLocalConfig({ ...localConfig, pageSize: Math.min(100, Math.max(5, parseInt(e.target.value) || 20)) })}
            />
            <p className="text-xs text-muted-foreground">每页返回的数据条数</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="minYear">最小年份过滤</Label>
            <Input
              id="minYear"
              type="number"
              value={localConfig.minYear}
              onChange={(e) => setLocalConfig({ ...localConfig, minYear: parseInt(e.target.value) || 2025 })}
            />
            <p className="text-xs text-muted-foreground">低于此年份的内容将被跳过</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="retryTimes">重试次数</Label>
            <Input
              id="retryTimes"
              type="number"
              min="0"
              max="10"
              value={localConfig.retryTimes}
              onChange={(e) => setLocalConfig({ ...localConfig, retryTimes: Math.min(10, Math.max(0, parseInt(e.target.value) || 3)) })}
            />
            <p className="text-xs text-muted-foreground">采集失败时的重试次数</p>
          </div>
        </div>
      </Card>

      <Card className="p-6 mt-4 space-y-4">
        <div>
          <div className="flex items-center gap-3">
            <RefreshCw className="size-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">自动增量采集</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            满足条件自动执行增量采集，有启用视频源且无手动采集任务时才执行。
          </p>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="space-y-2">
            <div className="text-sm font-medium">启用自动采集</div>
            <Switch
              checked={localConfig.autoEnabled}
              onCheckedChange={(checked) => setLocalConfig({ ...localConfig, autoEnabled: checked })}
            />
            <p className="text-xs text-muted-foreground">关闭后定时与启动触发均不执行</p>
          </div>

          <div className={`space-y-2 transition-opacity ${localConfig.autoEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
            <div className="text-sm font-medium">启动时立即采集</div>
            <Switch
              checked={localConfig.autoOnStartup}
              onCheckedChange={(checked) => setLocalConfig({ ...localConfig, autoOnStartup: checked })}
              disabled={!localConfig.autoEnabled}
            />
            <p className="text-xs text-muted-foreground">应用启动后延迟数秒自动执行一次增量采集</p>
          </div>

          <div className={`space-y-2 transition-opacity ${localConfig.autoEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
            <Label htmlFor="autoIntervalHours">定时采集间隔（小时）</Label>
            <Input
              id="autoIntervalHours"
              type="number"
              min="1"
              max="8760"
              value={localConfig.autoIntervalHours}
              onChange={(e) => setLocalConfig({ ...localConfig, autoIntervalHours: Math.min(8760, Math.max(1, parseInt(e.target.value) || 24)) })}
            />
            <p className="text-xs text-muted-foreground">距上次自动采集达到该间隔后触发</p>
          </div>

          <div className={`space-y-2 transition-opacity ${localConfig.autoEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
            <div className="text-sm font-medium">上次自动采集时间</div>
            <div className="h-9 px-3 py-2 text-sm text-muted-foreground bg-muted/40 rounded-md border border-transparent">
              {autoLastRunAt ? new Date(autoLastRunAt).toLocaleString() : '从未执行'}
            </div>
            <p className="text-xs text-muted-foreground">用于跨启动判断间隔与断点追溯</p>
          </div>
        </div>
      </Card>

      <Dialog open={showUnsavedDialog} onOpenChange={(open) => { if (!open) handleDialogClose('cancel'); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>提示</DialogTitle>
            <p className="text-sm text-muted-foreground">有未保存的配置，是否保存？</p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleDialogClose('cancel')}>取消</Button>
            <Button variant="destructive" onClick={() => handleDialogClose('discard')}>不保存</Button>
            <Button onClick={() => handleDialogClose('save')}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
