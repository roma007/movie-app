import { useEffect, useState, KeyboardEvent } from 'react';
import { useAppStore } from '../useAppStore';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, RotateCcw, X, CheckCircle2, AlertCircle, Trash2, Radar, Loader2 } from 'lucide-react';

const DEFAULT_BLACKLIST: string[] = [
  '足球', '篮球', '排球', '网球', '羽毛球', '乒乓球', '橄榄球', '棒球',
  '高尔夫', '斯诺克', '台球', '体育', '运动', '赛事', '比赛', '决赛',
  '半决赛', '世界杯', '联赛', '锦标赛', '奥运', '奥运会',
  '预告片', '预告', '先行预告', '前瞻', '幕后花絮', '花絮',
  '特辑', '纪录片预告', '预告版', '预告篇',
  '里番', '里番动漫', '伦理片', '情色', '成人',
];

export default function CollectConfigPage() {
  const navigate = useNavigate();
  const { collectConfig, loadCollectConfig, updateCollectConfig, deleteMediaByGenres, getSubTypesByType, getReprobeMediaCount, loadReprobeMediaList, batchReprobeMedia, reprobeProgress, reprobeMediaCount, reprobeMediaList } = useAppStore();
  const [localConfig, setLocalConfig] = useState({
    minYear: 2025,
    rateLimitPerSecond: 2,
    retryTimes: 3,
    pageSize: 20,
    maxPages: 10,
    incrementalMaxPages: 100,
    concurrency: 1,
  });
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadCollectConfig();
  }, []);

  useEffect(() => {
    if (collectConfig) {
      setLocalConfig({
        minYear: collectConfig.minYear,
        rateLimitPerSecond: collectConfig.rateLimitPerSecond,
        retryTimes: collectConfig.retryTimes,
        pageSize: collectConfig.pageSize,
        maxPages: collectConfig.maxPages,
        incrementalMaxPages: collectConfig.incrementalMaxPages,
        concurrency: collectConfig.concurrency,
      });
      setBlacklist([...collectConfig.blacklistKeywords]);
    }
  }, [collectConfig]);

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
      blacklistKeywords: blacklist,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setLocalConfig({
      minYear: 2025,
      rateLimitPerSecond: 2,
      retryTimes: 3,
      pageSize: 20,
      maxPages: 100,
      incrementalMaxPages: 5,
      concurrency: 6,
    });
    setBlacklist([...DEFAULT_BLACKLIST]);
  };

  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ deleted: number } | null>(null);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [reprobing, setReprobing] = useState(false);
  const [reprobeResult, setReprobeResult] = useState<{
    total: number;
    longDrama: number;
    shortDrama: number;
    failed: number;
    failedItems: { id: string; title: string }[];
  } | null>(null);
  const [allGenres, setAllGenres] = useState<string[]>([]);
  const [deleteMediaType, setDeleteMediaType] = useState<string>('');

  const MEDIA_TYPES = [
    { value: '', label: '全部' },
    { value: 'MOVIE', label: '电影' },
    { value: 'TV', label: '电视剧' },
    { value: 'VARIETY', label: '综艺' },
    { value: 'ANIME', label: '动漫' },
    { value: 'DOCUMENTARY', label: '纪录片' },
  ];

  useEffect(() => {
    setSelectedGenres([]);
    getSubTypesByType(deleteMediaType || undefined).then(genres => setAllGenres(genres));
  }, [deleteMediaType]);

  useEffect(() => {
    loadReprobeMediaList();
  }, []);

  const toggleGenre = (genre: string) => {
    setSelectedGenres(prev =>
      prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]
    );
  };

  const handleDeleteByGenre = async () => {
    if (selectedGenres.length === 0) return;
    setDeleting(true);
    setDeleteResult(null);
    try {
      const result = await deleteMediaByGenres(selectedGenres);
      setDeleteResult(result);
      setSelectedGenres([]);
    } catch (err) {
      console.error('删除失败:', err);
    } finally {
      setDeleting(false);
    }
  };

  const handleBatchReprobe = async () => {
    if (reprobeMediaCount === 0) return;
    setReprobing(true);
    setReprobeResult(null);
    try {
      const result = await batchReprobeMedia();
      setReprobeResult(result);
    } catch (err) {
      console.error('批量重新探测失败:', err);
    } finally {
      setReprobing(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" onClick={() => navigate('/settings')} className="hover:text-primary">
          <ArrowLeft className="size-4 mr-2" />
          返回
        </Button>
        <h1 className="text-2xl font-bold">采集配置</h1>
      </div>

      <Card className="p-6 space-y-6 bg-card border-border">
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
              className="bg-secondary border-border"
            />
            <p className="text-xs text-muted-foreground">全量采集时最多采集多少页数据</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="incrementalMaxPages">增量采集最大页数</Label>
            <Input
              id="incrementalMaxPages"
              type="number"
              min="1"
              max="50"
              value={localConfig.incrementalMaxPages}
              onChange={(e) => setLocalConfig({ ...localConfig, incrementalMaxPages: Math.min(50, Math.max(1, parseInt(e.target.value) || 5)) })}
              className="bg-secondary border-border"
            />
            <p className="text-xs text-muted-foreground">增量采集时最多采集多少页数据</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rateLimit">请求速率限制</Label>
            <Input
              id="rateLimit"
              type="number"
              min="1"
              max="50"
              value={localConfig.rateLimitPerSecond}
              onChange={(e) => setLocalConfig({ ...localConfig, rateLimitPerSecond: Math.min(50, Math.max(1, parseInt(e.target.value) || 2)) })}
              className="bg-secondary border-border"
            />
            <p className="text-xs text-muted-foreground">每秒最多发送多少个请求</p>
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
              className="bg-secondary border-border"
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
              className="bg-secondary border-border"
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
              className="bg-secondary border-border"
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
              className="bg-secondary border-border"
            />
            <p className="text-xs text-muted-foreground">采集失败时的重试次数</p>
          </div>
        </div>
      </Card>

      <Card className="p-6 mt-4 space-y-4 bg-card border-border">
        <div>
          <h2 className="text-lg font-semibold">黑名单关键词</h2>
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
            className="flex-1 bg-secondary border-border"
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
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors bg-card text-foreground border-border hover:border-destructive/50 hover:text-destructive"
            >
              {kw}
              <X className="size-3" />
            </button>
          ))}
        </div>

        <div className="flex justify-between items-center pt-2">
          <Button variant="ghost" onClick={handleReset} className="text-xs">
            <RotateCcw className="size-3.5 mr-1.5" />
            重置默认
          </Button>
          <Button
            onClick={handleSave}
            className="bg-primary hover:bg-primary-hover"
          >
            <Save className="size-4 mr-2" />
            {saved ? '已保存' : '保存配置'}
          </Button>
        </div>
      </Card>

      <Card className="p-6 mt-4 space-y-4 bg-card border-border">
        <div>
          <h2 className="text-lg font-semibold">按子类型删除视频</h2>
          <p className="text-sm text-muted-foreground mt-1">
            先选择大类，再选择该大类下的子类型进行删除。此操作不可恢复。
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {MEDIA_TYPES.map(mt => (
            <button
              key={mt.value}
              onClick={() => setDeleteMediaType(mt.value)}
              className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                deleteMediaType === mt.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-foreground border-border hover:border-primary/50'
              }`}
            >
              {mt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 max-h-60 overflow-y-auto">
          {allGenres.length === 0 && (
            <span className="text-xs text-muted-foreground">暂无子类型数据</span>
          )}
          {allGenres.map(genre => (
            <button
              key={genre}
              onClick={() => toggleGenre(genre)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                selectedGenres.includes(genre)
                  ? 'bg-destructive text-white border-destructive'
                  : 'bg-card text-foreground border-border hover:border-destructive/50'
              }`}
            >
              {genre}
            </button>
          ))}
        </div>

        {selectedGenres.length > 0 && (
          <p className="text-xs text-muted-foreground">
            已选：{selectedGenres.join('、')}
          </p>
        )}

        {deleteResult && !deleting && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary">
            {deleteResult.deleted > 0 ? (
              <CheckCircle2 className="size-5 text-success shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="size-5 text-muted-foreground shrink-0 mt-0.5" />
            )}
            <div className="text-sm">
              {deleteResult.deleted === 0 ? (
                <span className="text-muted-foreground">没有匹配的视频</span>
              ) : (
                <span>
                  删除完成：成功删除 {deleteResult.deleted} 部视频
                </span>
              )}
            </div>
          </div>
        )}

        <Button
          onClick={handleDeleteByGenre}
          disabled={deleting || selectedGenres.length === 0}
          variant="destructive"
          className="w-full"
        >
          <Trash2 className={`size-4 mr-2 ${deleting ? 'animate-spin' : ''}`} />
          {deleting ? '删除中...' : `删除所选子类型 (${selectedGenres.length})`}
        </Button>
      </Card>

      <Card className="p-6 mt-4 space-y-4 bg-card border-border">
        <div>
          <h2 className="text-lg font-semibold">批量重新探测长短剧</h2>
          <p className="text-sm text-muted-foreground mt-1">
            对所有经过三级降级判断后仍为兜底状态（FALLBACK）或未判断的电视剧进行重新探测。
            此操作将实际探测视频流时长，准确判断长短剧分类。
          </p>
        </div>

        <div className="flex items-center gap-4 p-3 rounded-lg bg-secondary">
          <Radar className="size-5 text-muted-foreground" />
          <div className="text-sm">
            <span className="text-muted-foreground">待探测：</span>
            <span className="font-medium ml-1">{reprobeMediaList.length} 部电视剧</span>
          </div>
        </div>

        {reprobeMediaList.length > 0 && !reprobing && (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-3 py-2 bg-secondary text-xs font-medium text-muted-foreground border-b border-border">
              待探测清单（点击可查看详情）
            </div>
            <div className="max-h-60 overflow-y-auto divide-y divide-border">
              {reprobeMediaList.map((item) => (
                <button
                  key={item.id}
                  onClick={() => navigate(`/media/${item.id}`)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-secondary/50 transition-colors flex items-center gap-2"
                >
                  <AlertCircle className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{item.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {reprobeProgress && reprobing && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span>正在探测：{reprobeProgress.currentMediaTitle || '准备中...'}</span>
            </div>
            
            <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${reprobeProgress.total > 0 ? (reprobeProgress.processed / reprobeProgress.total) * 100 : 0}%` }}
              />
            </div>

            <div className="grid grid-cols-4 gap-4 text-center">
              <div className="p-2 rounded bg-secondary">
                <div className="text-lg font-bold">{reprobeProgress.processed}</div>
                <div className="text-xs text-muted-foreground">已处理</div>
              </div>
              <div className="p-2 rounded bg-secondary">
                <div className="text-lg font-bold text-success">{reprobeProgress.shortDrama}</div>
                <div className="text-xs text-muted-foreground">短剧</div>
              </div>
              <div className="p-2 rounded bg-secondary">
                <div className="text-lg font-bold text-primary">{reprobeProgress.longDrama}</div>
                <div className="text-xs text-muted-foreground">长剧</div>
              </div>
              <div className="p-2 rounded bg-secondary">
                <div className="text-lg font-bold text-destructive">{reprobeProgress.failed}</div>
                <div className="text-xs text-muted-foreground">失败</div>
              </div>
            </div>
          </div>
        )}

        {reprobeResult && !reprobing && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary">
              {reprobeResult.failed < reprobeResult.total ? (
                <CheckCircle2 className="size-5 text-success shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="size-5 text-muted-foreground shrink-0 mt-0.5" />
              )}
              <div className="text-sm">
                {reprobeResult.total === 0 ? (
                  <span className="text-muted-foreground">没有需要重新探测的电视剧</span>
                ) : (
                  <div className="space-y-1">
                    <div>
                      探测完成：共处理 {reprobeResult.total} 部电视剧
                    </div>
                    <div className="flex gap-4 text-muted-foreground">
                      <span>短剧：<span className="text-success font-medium">{reprobeResult.shortDrama}</span></span>
                      <span>长剧：<span className="text-primary font-medium">{reprobeResult.longDrama}</span></span>
                      <span>失败：<span className="text-destructive font-medium">{reprobeResult.failed}</span></span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {reprobeResult.failedItems.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 bg-secondary text-xs font-medium text-muted-foreground border-b border-border">
                  探测失败清单（点击可查看详情）
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-border">
                  {reprobeResult.failedItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => navigate(`/media/${item.id}`)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-secondary/50 transition-colors flex items-center gap-2"
                    >
                      <AlertCircle className="size-3.5 text-destructive shrink-0" />
                      <span className="truncate">{item.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <Button
          onClick={handleBatchReprobe}
          disabled={reprobing || reprobeMediaList.length === 0}
          variant="default"
          className="w-full"
        >
          <Radar className={`size-4 mr-2 ${reprobing ? 'animate-spin' : ''}`} />
          {reprobing ? '探测中...' : `开始批量重新探测 (${reprobeMediaList.length})`}
        </Button>
      </Card>
    </div>
  );
}