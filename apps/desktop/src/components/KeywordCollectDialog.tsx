import { useEffect, useState } from 'react';
import { useAppStore, getStore } from '../useAppStore';
import { useToast } from '@/components/Layout';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { PosterImage } from '@/components/PosterImage';
import { Search, Loader2, Plus } from 'lucide-react';
import type { HiddenCollectItem } from '@movie-app/core';

const MAX_DISPLAY_TITLES = 8;

interface KeywordCollectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialKeyword?: string;
  initialRelaxYear?: boolean;
}

export function KeywordCollectDialog({ open, onOpenChange, initialKeyword, initialRelaxYear }: KeywordCollectDialogProps) {
  const {
    previewResults, previewLoading,
    searchKeywordPreview, saveSelectedPreviewItems, clearPreviewResults, unhideMediaByGenres,
  } = useAppStore();
  const toast = useToast();

  const [keywordInput, setKeywordInput] = useState('');
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [relaxYear, setRelaxYear] = useState(false);
  const [hiddenAlert, setHiddenAlert] = useState<HiddenCollectItem[] | null>(null);

  useEffect(() => {
    if (!open) return;
    const kw = (initialKeyword ?? '').trim();
    const relax = initialRelaxYear ?? false;
    setRelaxYear(relax);
    if (kw) {
      setKeywordInput(kw);
      setHasSearched(true);
      setSelectedPreviewIds(new Set());
      searchKeywordPreview(kw, relax ? { unlimitedYear: true } : undefined).then(() => {
        setSelectedPreviewIds(new Set(getStore().getState().previewResults.map((r) => r.previewId)));
      }).catch(() => {});
    } else {
      setKeywordInput('');
      setHasSearched(false);
      setSelectedPreviewIds(new Set());
    }
  }, [open, initialKeyword, initialRelaxYear, searchKeywordPreview]);

  const getOverrides = () => {
    const overrides: { unlimitedYear?: boolean } = {};
    if (relaxYear) overrides.unlimitedYear = true;
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  };

  const handleKeywordSearch = async () => {
    const kw = keywordInput.trim();
    if (!kw) return;
    setHasSearched(true);
    setSelectedPreviewIds(new Set());
    await searchKeywordPreview(kw, getOverrides());
    setSelectedPreviewIds(new Set(getStore().getState().previewResults.map((r) => r.previewId)));
  };

  const handleTogglePreview = (previewId: string) => {
    setSelectedPreviewIds((prev) => {
      const next = new Set(prev);
      if (next.has(previewId)) next.delete(previewId);
      else next.add(previewId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedPreviewIds.size === previewResults.length) {
      setSelectedPreviewIds(new Set());
    } else {
      setSelectedPreviewIds(new Set(previewResults.map((r) => r.previewId)));
    }
  };

  const isSelected = (previewId: string) => selectedPreviewIds.has(previewId);
  const selectedCount = selectedPreviewIds.size;
  const isAllSelected = previewResults.length > 0 && selectedPreviewIds.size === previewResults.length;

  const resetState = () => {
    setKeywordInput('');
    setSelectedPreviewIds(new Set());
    setHasSearched(false);
    setRelaxYear(false);
    clearPreviewResults();
  };

  const handleCloseKeywordDialog = () => {
    resetState();
    onOpenChange(false);
  };

  const handleSavePreview = async () => {
    const selected = previewResults.filter((r) => selectedPreviewIds.has(r.previewId));
    if (selected.length === 0) {
      toast('请至少选择一个视频', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const result = await saveSelectedPreviewItems(selected, getOverrides());
      const count = result.saved;
      resetState();
      onOpenChange(false);
      if (count > 0) {
        toast(`成功采集 ${count} 部视频`);
        if (result.hiddenItems.length > 0) {
          setHiddenAlert(result.hiddenItems);
        }
      } else {
        toast('采集失败，请重试', 'error');
      }
    } catch (err: any) {
      toast(`保存失败: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) handleCloseKeywordDialog();
          else onOpenChange(next);
        }}
      >
        <DialogContent className="w-full max-w-[55vw] max-h-[80vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-5 pb-3">
            <DialogTitle>关键词搜索采集</DialogTitle>
            <DialogDescription>输入关键词，遍历所有已启用的视频源搜索，预览结果后选择保存</DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 px-6 py-3">
            <Input
              placeholder="输入电影/电视剧名称..."
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleKeywordSearch()}
              className="flex-1"
            />
            <Button onClick={handleKeywordSearch} disabled={previewLoading}>
              <Search className="size-4 mr-1" /> 搜索
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 px-6 py-3">
            {previewLoading ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground">
                <Loader2 className="size-5 mr-2 animate-spin" /> 正在搜索...
              </div>
            ) : previewResults.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">搜索结果</span>
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleSelectAll}>
                      {isAllSelected ? '取消全选' : '全选'}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      已选 {selectedCount} / 共 {previewResults.length} 条
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5 mt-2">
                  {previewResults.map((item) => {
                    const selected = isSelected(item.previewId);
                    return (
                      <label
                        key={item.previewId}
                        className={`flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                          selected ? 'border-muted-foreground bg-muted-foreground/20' : 'hover:bg-hover'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => handleTogglePreview(item.previewId)}
                          className="mt-2 size-5 accent-primary cursor-pointer"
                        />
                        <div className="w-10 h-14 shrink-0 rounded overflow-hidden bg-secondary">
                          {item.posterUrl && (
                            <PosterImage src={item.posterUrl} alt={item.title} className="size-full object-cover" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{item.title}</span>
                            <span className="text-xs text-muted-foreground shrink-0">({item.year})</span>
                            <Badge variant="outline" className="text-[10px] shrink-0">{item.type}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            {item.directors.length > 0 && <span>导演: {item.directors.join(', ')}</span>}
                            {item.directors.length > 0 && item.actors.length > 0 && <span> | </span>}
                            {item.actors.length > 0 && <span>演员: {item.actors.slice(0, 3).join(', ')}{item.actors.length > 3 ? '...' : ''}</span>}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            来源: {item.sourceName} · {item.area || '未知地区'}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : hasSearched ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                <Search className="size-8 opacity-30" />
                <p className="text-sm">「{keywordInput}」未搜索到相关结果</p>
                <p className="text-xs">请尝试其他关键词</p>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40 text-muted-foreground">
                <p className="text-sm">输入关键词后点击搜索</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-6 py-2.5">
            <span className="text-base font-bold">放宽搜索条件</span>
            <div className="flex items-center gap-5">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Switch checked={relaxYear} onCheckedChange={setRelaxYear} />
                不限年份
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 px-6 py-3">
            <Button variant="outline" onClick={handleCloseKeywordDialog}>关闭</Button>
            {previewResults.length > 0 && (
              <Button onClick={handleSavePreview} disabled={selectedCount === 0 || isSaving}>
                {isSaving ? <><Loader2 className="size-4 mr-1 animate-spin" /> 保存中...</> : <><Plus className="size-4 mr-1" />保存选中的 {selectedCount} 条</>}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!hiddenAlert} onOpenChange={(next) => { if (!next) setHiddenAlert(null); }}>
        <DialogContent className="w-full max-w-md">
          <DialogHeader>
            <DialogTitle>部分视频已被隐藏</DialogTitle>
            <DialogDescription>
              {hiddenAlert && (() => {
                const titles = hiddenAlert.map((h) => h.title);
                const titleText = titles.length > MAX_DISPLAY_TITLES
                  ? `${titles.slice(0, MAX_DISPLAY_TITLES).join('、')}等${titles.length}部`
                  : titles.join('、');
                const genres = [...new Set(hiddenAlert.flatMap((h) => h.genres))];
                return `「${titleText}」视频名被隐藏，恢复显示「${genres.join('、')}」类视频后就可以找到。`;
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="default"
              size="sm"
              onClick={async () => {
                const genres = hiddenAlert ? [...new Set(hiddenAlert.flatMap((h) => h.genres))] : [];
                setHiddenAlert(null);
                if (genres.length === 0) return;
                try {
                  const res = await unhideMediaByGenres(genres);
                  toast(`已取消隐藏「${genres.join('、')}」，恢复显示 ${res.unhidden} 部视频`);
                } catch (err: any) {
                  toast('取消隐藏失败', 'error');
                  console.error('[KeywordCollect] 取消隐藏子类型失败:', err);
                }
              }}
            >
              取消隐藏
            </Button>
            <DialogClose asChild>
              <Button variant="outline" size="sm" onClick={() => setHiddenAlert(null)}>知道了</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}