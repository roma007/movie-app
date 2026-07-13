import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppStore, getCollector, getProvider } from '../useAppStore';
import { MediaGrid } from '@/components/MediaCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Clock, Flame, Trash2, X } from 'lucide-react';

export default function SearchPage() {
  const { mediaList, isLoading, searchMedia } = useAppStore();
  const location = useLocation();
  const [keyword, setKeyword] = useState('');
  const [searchHistory, setSearchHistory] = useState<{ keyword: string; count: number }[]>([]);
  const [hotSearches, setHotSearches] = useState<{ keyword: string; count: number }[]>([]);

  useEffect(() => {
    const provider = getProvider();
    provider.getSearchHistory(10).then(setSearchHistory).catch(() => {});
    provider.getHotSearches(10).then(setHotSearches).catch(() => {});

    const initialKeyword = (location.state as { keyword?: string })?.keyword;
    if (initialKeyword) {
      setKeyword(initialKeyword);
      const kw = initialKeyword.trim();
      if (kw) {
        provider.addSearchHistory(kw).catch(() => {});
        getCollector().collectByKeyword(kw).catch(() => {});
        searchMedia(kw).catch(() => {});
        provider.getSearchHistory(10).then(setSearchHistory).catch(() => {});
        provider.getHotSearches(10).then(setHotSearches).catch(() => {});
      }
    }
  }, []);

  const handleSearch = async () => {
    const kw = keyword.trim();
    if (!kw) return;
    try {
      const provider = getProvider();
      await provider.addSearchHistory(kw);
      const collector = getCollector();
      await collector.collectByKeyword(kw);
      await searchMedia(kw);
      provider.getSearchHistory(10).then(setSearchHistory).catch(() => {});
      provider.getHotSearches(10).then(setHotSearches).catch(() => {});
    } catch (err) {
      console.error('搜索失败:', err);
    }
  };

  const handleHistoryClick = async (kw: string) => {
    setKeyword(kw);
    await handleSearch();
  };

  const handleClearHistory = async () => {
    const provider = getProvider();
    await provider.clearSearchHistory();
    setSearchHistory([]);
  };

  const handleDeleteHistory = async (kw: string) => {
    const provider = getProvider();
    await provider.deleteSearchHistory(kw);
    setSearchHistory(prev => prev.filter(h => h.keyword !== kw));
  };

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold">搜索</h1>

      <div className="flex gap-2">
        <Input
          placeholder="搜索电影、电视剧、综艺..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1 bg-card border-border"
        />
        <Button onClick={handleSearch} disabled={isLoading} className="bg-primary hover:bg-primary-hover">
          <Search className="size-4" />
          {isLoading ? '搜索中...' : '搜索'}
        </Button>
      </div>

      {mediaList.length === 0 && !isLoading && (
        <div className="space-y-4">
          {searchHistory.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="size-4" />
                  搜索历史
                </div>
                <Button variant="ghost" size="sm" onClick={handleClearHistory}>
                  <Trash2 className="size-3" />
                  清空
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {searchHistory.map((item) => (
                  <div
                    key={item.keyword}
                    className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-md bg-card hover:border-highlight transition-colors"
                  >
                    <button
                      className="text-sm text-foreground hover:text-primary transition-colors"
                      onClick={() => handleHistoryClick(item.keyword)}
                    >
                      {item.keyword}
                    </button>
                    <button
                      className="h-5 w-5 flex items-center justify-center rounded hover:bg-hover transition-colors"
                      onClick={() => handleDeleteHistory(item.keyword)}
                    >
                      <X className="size-3 text-muted-foreground hover:text-error" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hotSearches.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Flame className="size-4" />
                热门搜索
              </div>
              <div className="flex flex-wrap gap-2">
                {hotSearches.map((item, index) => (
                  <Button
                    key={item.keyword}
                    variant="secondary"
                    size="sm"
                    onClick={() => handleHistoryClick(item.keyword)}
                    className="bg-secondary hover:bg-hover"
                  >
                    <span className="text-xs mr-1 text-error">{index + 1}</span>
                    {item.keyword}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          搜索中...
        </div>
      ) : keyword.trim() && mediaList.length > 0 ? (
        <MediaGrid items={mediaList} />
      ) : null}
    </div>
  );
}