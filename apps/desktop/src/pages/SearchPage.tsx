import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Media } from '@movie-app/core';
import { useAppStore } from '../useAppStore';
import { getProvider, getStore } from '../init';
import { useBackgroundStore } from '../themes/backgroundStore';
import { MediaGrid } from '@/components/MediaCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Search, X, Database, Clock, Flame } from 'lucide-react';

const resultCache = new Map<string, Media[]>();

export default function SearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { searchMedia } = useAppStore();
  const setBgImage = useBackgroundStore((s) => s.setBgImage);
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);
  const q = (searchParams.get('q') ?? '').trim();
  const [keyword, setKeyword] = useState(q);
  const [results, setResults] = useState<Media[]>(() => (q ? resultCache.get(q) ?? [] : []));
  const [searching, setSearching] = useState(() => !!q && !resultCache.has(q));
  const [searchHistory, setSearchHistory] = useState<{ keyword: string; count: number }[]>([]);
  const [hotSearches, setHotSearches] = useState<{ keyword: string; count: number }[]>([]);
  const reqRef = useRef(0);

  const refreshHistory = useCallback(() => {
    const p = getProvider();
    p.getSearchHistory(10).then(setSearchHistory).catch(() => {});
    p.getHotSearches(10).then(setHotSearches).catch(() => {});
  }, []);

  const runSearch = useCallback(async (kw: string) => {
    const trimKw = kw.trim();
    if (!trimKw) return;
    const id = ++reqRef.current;
    setKeyword(trimKw);
    const cached = resultCache.get(trimKw);
    if (cached) {
      setResults(cached);
      return;
    }
    setSearching(true);
    try {
      await getProvider().addSearchHistory(trimKw);
      await searchMedia(trimKw);
      const items = getStore().getState().mediaList;
      if (id !== reqRef.current) return;
      resultCache.set(trimKw, items);
      setResults(items);
      getStore().getState().scheduleRecommendationRecompute();
      refreshHistory();
    } catch (err) {
      console.error('搜索失败:', err);
    } finally {
      if (id === reqRef.current) setSearching(false);
    }
  }, [searchMedia, refreshHistory]);

  useEffect(() => {
    if (q) {
      runSearch(q);
    } else {
      setKeyword('');
      setResults([]);
      refreshHistory();
    }
  }, [q, runSearch]);

  useEffect(() => {
    const first = results[0];
    if (!first?.posterUrl) {
      setBgImage(null);
      return () => clearBgImage();
    }
    setBgImage(first.posterUrl);
    return () => clearBgImage();
  }, [results, setBgImage, clearBgImage]);

  const handleSubmit = () => {
    const kw = keyword.trim();
    if (!kw) return;
    setSearchParams({ q: kw });
  };

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  const activeKw = q;

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex gap-2 items-center">
        <Button variant="ghost" onClick={handleBack} className="shrink-0">
          <ArrowLeft className="size-4 mr-2" /> 返回
        </Button>
        <div className="relative flex-1">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-muted-foreground pointer-events-none">
            <Database className="size-3" />
            <span>本地</span>
          </div>
          <Input
            placeholder="搜索电影、电视剧、综艺..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            autoFocus
            className="flex-1 pl-14 pr-8"
          />
          {keyword && (
            <button
              onClick={() => setKeyword('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-text transition-colors"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button onClick={handleSubmit} variant="default"><Search className="size-4" />搜索</Button>
      </div>

      {activeKw ? (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">搜索结果："{activeKw}"</h2>
          {searching ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">搜索中...</div>
          ) : results.length > 0 ? (
            <MediaGrid items={results} navigateState={{ searchKeyword: activeKw }} />
          ) : (
            <div className="text-center text-muted-foreground py-8">未找到相关内容</div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {searchHistory.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="size-4 text-muted-foreground" />
                <span className="font-medium">搜索历史</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {searchHistory.map((h) => (
                  <button
                    key={h.keyword}
                    onClick={() => setSearchParams({ q: h.keyword })}
                    className="px-3 py-1.5 rounded-lg bg-[var(--color-secondary-alpha)] text-sm text-text-secondary hover:text-text transition-colors"
                  >
                    {h.keyword}
                  </button>
                ))}
              </div>
            </div>
          )}
          {hotSearches.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Flame className="size-4 text-error" />
                <span className="font-medium">热门搜索</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {hotSearches.map((h, idx) => (
                  <button
                    key={h.keyword}
                    onClick={() => setSearchParams({ q: h.keyword })}
                    className="px-3 py-1.5 rounded-lg bg-[var(--color-secondary-alpha)] text-sm text-text-secondary hover:text-text transition-colors"
                  >
                    <span className={idx < 3 ? 'text-error mr-1' : 'text-muted-foreground mr-1'}>{idx + 1}</span>
                    {h.keyword}
                  </button>
                ))}
              </div>
            </div>
          )}
          {searchHistory.length === 0 && hotSearches.length === 0 && (
            <div className="text-center text-muted-foreground py-10">输入关键词搜索本地已采集的视频</div>
          )}
        </div>
      )}
    </div>
  );
}
