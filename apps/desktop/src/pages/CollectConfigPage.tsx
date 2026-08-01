import { useEffect, useState, useMemo, useRef, useCallback, KeyboardEvent } from 'react';
import { useAppStore } from '../useAppStore';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, RotateCcw, X, Ban } from 'lucide-react';
import { useBackgroundStore } from '../themes/backgroundStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

const DEFAULT_BLACKLIST: string[] = [
  '足球', '篮球', '排球', '网球', '羽毛球', '乒乓球', '橄榄球', '棒球',
  '高尔夫', '斯诺克', '台球', '体育', '运动', '赛事', '比赛', '决赛',
  '半决赛', '世界杯', '联赛', '锦标赛', '奥运', '奥运会',
  '预告片', '预告', '先行预告', '前瞻', '幕后花絮', '花絮',
  '特辑', '纪录片预告', '预告版', '预告篇',
  '里番', '里番动漫', '伦理片', '情色', '成人',
];

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
  });
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
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
        blacklistKeywords: collectConfig.blacklistKeywords,
      });
      setLocalConfig({
        minYear: collectConfig.minYear,
        retryTimes: collectConfig.retryTimes,
        pageSize: collectConfig.pageSize,
        maxPages: collectConfig.maxPages,
        incrementalMaxPages: collectConfig.incrementalMaxPages,
        maxIncrementalHours: collectConfig.maxIncrementalHours,
        concurrency: collectConfig.concurrency,
      });
      setBlacklist([...collectConfig.blacklistKeywords]);
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
      blacklistKeywords: blacklist,
    });
    return current !== savedConfigRef.current;
  }, [localConfig, blacklist, collectConfig]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (!kw) return;
    if (blacklist.includes(kw)) {
      setKeywordInput('');
      return;
    }
    setBlacklist([...blacklist, kw]);
    setKeywordInput('');
  };

  const removeKeyword = (keyword: string) => {
    setBlacklist(blacklist.filter(k => k !== keyword));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword();
    }
  };

  const handleSave = async () => {
    await updateCollectConfig({
      ...localConfig,
      maxIncrementalHours: Math.max(0, localConfig.maxIncrementalHours),
      blacklistKeywords: blacklist,
    });
    savedConfigRef.current = JSON.stringify({
      minYear: localConfig.minYear,
      retryTimes: localConfig.retryTimes,
      pageSize: localConfig.pageSize,
      maxPages: localConfig.maxPages,
      incrementalMaxPages: localConfig.incrementalMaxPages,
      maxIncrementalHours: Math.max(0, localConfig.maxIncrementalHours),
      concurrency: localConfig.concurrency,
      blacklistKeywords: blacklist,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleFieldBlur = async (field: string, value: number) => {
    await updateCollectConfig({
      ...localConfig,
      [field]: value,
      blacklistKeywords: blacklist,
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
    });
    setBlacklist([...DEFAULT_BLACKLIST]);
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
          <Button variant="outline" size="sm" onClick={handleReset}>
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
              max="200"
              value={localConfig.maxPages}
              onChange={(e) => setLocalConfig({ ...localConfig, maxPages: Math.min(200, Math.max(1, parseInt(e.target.value) || 10)) })}
            />
            <p className="text-xs text-muted-foreground">全量采集时最多采集多少页数据</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="incrementalMaxPages">增量采集最大页数（安全上限）</Label>
            <Input
              id="incrementalMaxPages"
              type="number"
              min="1"
              max="200"
              value={localConfig.incrementalMaxPages}
              onChange={(e) => setLocalConfig({ ...localConfig, incrementalMaxPages: Math.min(200, Math.max(1, parseInt(e.target.value) || 10)) })}
              onBlur={() => handleFieldBlur('incrementalMaxPages', localConfig.incrementalMaxPages)}
            />
            <p className="text-xs text-muted-foreground">增量采集的安全上限，断点和定额模式均受此限制</p>
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
            <Ban className="size-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">黑名单关键词</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            采集时会过滤类型名称中包含这些关键词的视频
          </p>
        </div>

        <div className="flex gap-2">
          <Input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入关键词后按回车或点击添加"
            className="flex-1"
          />
          <Button
            onClick={addKeyword}
            variant="default"
          >
            添加
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {blacklist.map((kw) => (
            <button
              key={kw}
              onClick={() => removeKeyword(kw)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-colors bg-card text-text hover:border-destructive/50 hover:text-destructive"
            >
              {kw}
              <X className="size-3" />
            </button>
          ))}
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
