import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Media, PaginatedResponse } from '@movie-app/core';
import { getProvider, getStore } from '../init';
import { useBackgroundStore } from '../themes/backgroundStore';
import { MediaGrid } from '@/components/MediaCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Search, X, Database, Clock, Flame, ChevronLeft, ChevronRight } from 'lucide-react';

const pageSize = 30;

const resultCache = new Map<string, Media[]>();
const metaCache = new Map<string, PaginatedResponse<Media>['meta']>();

export default function SearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const setBgImage = useBackgroundStore((s) => s.setBgImage);
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);
  const q = (searchParams.get('q') ?? '').trim();
  const currentPage = Math.max(1, Number(searchParams.get('page')) || 1);
  const [keyword, setKeyword] = useState(q);
  const [results, setResults] = useState<Media[]>(() => {
    if (!q) return [];
    return resultCache.get(`${q}#${currentPage}`) ?? [];
  });
  const [resultMeta, setResultMeta] = useState<PaginatedResponse<Media>['meta'] | null>(() => {
    if (!q) return null;
    return metaCache.get(`${q}#${currentPage}`) ?? null;
  });
  const [searching, setSearching] = useState(() => !!q && !resultCache.has(`${q}#${currentPage}`));
  const [searchHistory, setSearchHistory] = useState<{ keyword: string; count: number }[]>([]);
  const [hotSearches, setHotSearches] = useState<{ keyword: string; count: number }[]>([]);
  const reqRef = useRef(0);

  const refreshHistory = useCallback(() => {
    const p = getProvider();
    p.getSearchHistory(10).then(setSearchHistory).catch(() => {});
    p.getHotSearches(10).then(setHotSearches).catch(() => {});
  }, []);

  const runSearch = useCallback(async (kw: string, page: number) => {
    const trimKw = kw.trim();
    if (!trimKw) return;
    const id = ++reqRef.current;
    const cacheKey = `${trimKw}#${page}`;
    const cached = resultCache.get(cacheKey);
    if (cached) {
      setResults(cached);
      setResultMeta(metaCache.get(cacheKey) ?? null);
      return;
    }
    setSearching(true);
    try {
      const result = await getProvider().searchMedia(trimKw, { page, pageSize });
      if (id !== reqRef.current) return;
      resultCache.set(cacheKey, result.items);
      metaCache.set(cacheKey, result.meta);
      setResults(result.items);
      setResultMeta(result.meta);
      getStore().getState().scheduleRecommendationRecompute();
    } catch (err) {
      console.error('搜索失败:', err);
    } finally {
      if (id === reqRef.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!q) {
      setKeyword('');
      setResults([]);
      setResultMeta(null);
      refreshHistory();
      return;
    }
    setKeyword(q);
    refreshHistory();
    getProvider().addSearchHistory(q).catch(() => {});
    runSearch(q, currentPage);
  }, [q, currentPage, runSearch, refreshHistory]);

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
    setSearchParams((prev) => {
      prev.set('q', kw);
      prev.delete('page');
      return prev;
    });
  };

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  const totalPages = resultMeta?.totalPages || 1;

  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setSearchParams((prev) => {
      prev.set('page', String(page));
      return prev;
    });
    const main = document.getElementById('main-content');
    if (main) main.scrollTop = 0;
  };

  const getPageNumbers = () => {
    const pages: number[] = [];
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
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
            <>
              <MediaGrid items={results} navigateState={{ searchKeyword: activeKw, page: currentPage }} />
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-1 pt-2">
                  <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => handlePageChange(1)}>
                    首页
                  </Button>
                  <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => handlePageChange(currentPage - 1)}>
                    <ChevronLeft className="size-4" />
                  </Button>
                  {getPageNumbers().map((p) => (
                    <Button
                      key={p}
                      variant={p === currentPage ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handlePageChange(p)}
                    >
                      {p}
                    </Button>
                  ))}
                  <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => handlePageChange(currentPage + 1)}>
                    <ChevronRight className="size-4" />
                  </Button>
                  <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => handlePageChange(totalPages)}>
                    尾页
                  </Button>
                  <span className="text-sm text-muted-foreground ml-2">
                    {currentPage}/{totalPages}
                  </span>
                </div>
              )}
            </>
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