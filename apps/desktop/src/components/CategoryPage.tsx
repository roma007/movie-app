import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import type { Media } from '@movie-app/core';
import { useAppStore } from '../useAppStore';
import { MediaGrid, MediaCard } from '@/components/MediaCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { LayoutGrid, List, ChevronLeft, ChevronRight, Search, X, Columns3 } from 'lucide-react';

const pageSize = 30;

const COLUMNS_KEY = 'movie-app-list-columns';

interface ColumnDef {
  id: string;
  label: string;
  className?: string;
  style?: React.CSSProperties;
  render: (m: Media) => React.ReactNode;
}

const allColumns: ColumnDef[] = [
  {
    id: 'title',
    label: '影片名称',
    render: (m) => (
      <>
        <span className="text-sm font-medium">{m.title}</span>
        {m.status === 'ONGOING' && m.currentEpisodes && (
          <small className="text-error ml-2">更新至第{m.currentEpisodes}集</small>
        )}
        {m.status === 'COMPLETED' && (
          <small className="text-error ml-2">正片</small>
        )}
      </>
    ),
  },
  {
    id: 'type',
    label: '类型',
    className: 'hidden sm:table-cell',
    render: (m) => (
      <span className="text-muted-foreground">{m.type === 'MOVIE' ? '电影' : m.type === 'TV' ? '电视剧' : m.type === 'VARIETY' ? '综艺' : m.type === 'ANIME' ? '动漫' : m.type === 'DOCUMENTARY' ? '纪录片' : m.type}</span>
    ),
  },
  {
    id: 'genres',
    label: '分类',
    className: 'hidden sm:table-cell',
    render: (m) => <span className="text-muted-foreground">{m.genres.join(', ')}</span>,
  },
  {
    id: 'year',
    label: '年份',
    className: 'hidden sm:table-cell',
    render: (m) => <span className="text-muted-foreground">{m.year}</span>,
  },
  {
    id: 'area',
    label: '地区',
    className: 'hidden sm:table-cell',
    render: (m) => <span className="text-muted-foreground">{m.area || '-'}</span>,
  },
  {
    id: 'directors',
    label: '导演',
    className: 'hidden lg:table-cell',
    render: (m) => <span className="text-muted-foreground truncate max-w-[200px] inline-block">{m.directors.join(', ') || '-'}</span>,
  },
  {
    id: 'actors',
    label: '演员',
    className: 'hidden lg:table-cell',
    render: (m) => <span className="text-muted-foreground truncate max-w-[200px] inline-block">{m.actors.join(', ') || '-'}</span>,
  },
  {
    id: 'episodes',
    label: '集数',
    className: 'hidden sm:table-cell',
    render: (m) => <span className="text-muted-foreground">{m.currentEpisodes ? `${m.currentEpisodes}集` : '-'}</span>,
  },
  {
    id: 'viewCount',
    label: '观看次数',
    className: 'hidden lg:table-cell',
    render: (m) => <span className="text-muted-foreground">{m.viewCount}</span>,
  },
  {
    id: 'createdAt',
    label: '创建时间',
    className: 'hidden lg:table-cell',
    render: (m) => <span className="text-muted-foreground">{new Date(m.createdAt).toISOString().split('T')[0]}</span>,
  },
  {
    id: 'updatedAt',
    label: '更新时间',
    className: '',
    style: { width: '130px' },
    render: (m) => <span className="text-error">{new Date(m.updatedAt).toISOString().split('T')[0]}</span>,
  },
];

function loadColumns(): string[] {
  try {
    const saved = localStorage.getItem(COLUMNS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return ['title', 'genres', 'updatedAt'];
}

function saveColumns(columns: string[]): void {
  try {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify(columns));
  } catch {}
}

interface CategoryPageProps {
  type: string;
}

const typeNames: Record<string, string> = {
  MOVIE: '电影',
  TV: '电视剧',
  VARIETY: '综艺',
  ANIME: '动漫',
  DOCUMENTARY: '纪录片',
};

export default function CategoryPage({ type }: CategoryPageProps) {
  const { mediaList, mediaMeta, isLoading, loadMediaList, searchMedia, getSubTypesByType, getYearsByType, getAreasByType, hasShortDrama } = useAppStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeSubType, setActiveSubType] = useState<string | undefined>(() => searchParams.get('subType') || undefined);
  const [activeYear, setActiveYear] = useState<number | undefined>(() => {
    const year = searchParams.get('year');
    return year ? Number(year) : undefined;
  });
  const [activeArea, setActiveArea] = useState<string | undefined>(() => searchParams.get('area') || undefined);
  const [activeEpisodeType, setActiveEpisodeType] = useState<string | undefined>(() => {
    const episodeType = searchParams.get('episodeType');
    return episodeType === 'short' || episodeType === 'long' ? episodeType : undefined;
  });
  const [subTypes, setSubTypes] = useState<string[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(() => {
    const page = searchParams.get('page');
    return page ? Math.max(1, Number(page)) : 1;
  });
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedColumns, setSelectedColumns] = useState<string[]>(loadColumns);
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [showShortDramaFilter, setShowShortDramaFilter] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const hasRestoredScroll = useRef(false);
  const hasTriggeredLoad = useRef(false);
  const columnsMenuRef = useRef<HTMLDivElement>(null);

  const scrollKey = `scrollPos_${type}`;

  useEffect(() => {
    const state = location.state as { searchKeyword?: string } | undefined;
    if (state?.searchKeyword) {
      const kw = state.searchKeyword.trim();
      if (kw) {
        setSearchKeyword(kw);
        setIsSearching(true);
        searchMedia(kw).catch(() => {});
        window.history.replaceState({}, document.title);
      }
    }
  }, []);

  useEffect(() => {
    if (!showColumnsMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(e.target as Node)) {
        setShowColumnsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showColumnsMenu]);

  useEffect(() => {
    const subType = searchParams.get('subType');
    const year = searchParams.get('year');
    const area = searchParams.get('area');
    const page = searchParams.get('page');
    const episodeType = searchParams.get('episodeType');

    setActiveSubType(subType || undefined);
    setActiveYear(year ? Number(year) : undefined);
    setActiveArea(area || undefined);
    setCurrentPage(page ? Math.max(1, Number(page)) : 1);
    setActiveEpisodeType(episodeType === 'short' || episodeType === 'long' ? episodeType : undefined);
  }, [searchParams]);

  const saveScrollPosition = () => {
    const main = document.getElementById('main-content');
    sessionStorage.setItem(scrollKey, String(main?.scrollTop ?? 0));
  };

  useEffect(() => {
    loadMediaList({ page: currentPage, pageSize, type, subType: activeSubType, year: activeYear, area: activeArea, isShortDrama: activeEpisodeType === 'short' ? true : activeEpisodeType === 'long' ? false : undefined });
  }, [type, activeSubType, activeYear, activeArea, activeEpisodeType, currentPage]);

  useEffect(() => {
    if (isLoading) {
      hasTriggeredLoad.current = true;
    }
    if (!hasRestoredScroll.current && hasTriggeredLoad.current && !isLoading && mediaList.length > 0) {
      hasRestoredScroll.current = true;
      const saved = sessionStorage.getItem(scrollKey);
      if (saved) {
        sessionStorage.removeItem(scrollKey);
        setTimeout(() => {
          const main = document.getElementById('main-content');
          if (main) main.scrollTop = Number(saved);
        }, 50);
      }
    }
  }, [isLoading, mediaList]);

  useEffect(() => {
    fetchFilters();
    fetchShortDramaFlag();
  }, [type]);

  const handleSearch = async () => {
    const kw = searchKeyword.trim();
    if (!kw) return;
    setIsSearching(true);
    setIsSearchLoading(true);
    try {
      await searchMedia(kw);
    } finally {
      setIsSearchLoading(false);
    }
  };

  const handleClearSearch = () => {
    setSearchKeyword('');
    setIsSearching(false);
    setIsSearchLoading(false);
    loadMediaList({ page: 1, pageSize, type, subType: activeSubType, year: activeYear, area: activeArea, isShortDrama: activeEpisodeType === 'short' ? true : activeEpisodeType === 'long' ? false : undefined });
  };

  const fetchFilters = async () => {
    try {
      const [subTypeList, yearList, areaList] = await Promise.all([
        getSubTypesByType(type),
        getYearsByType(type),
        getAreasByType(type),
      ]);
      setSubTypes(subTypeList);
      setYears(yearList);
      setAreas(areaList);
    } catch (err) {
      console.error('获取筛选数据失败:', err);
    }
  };

  const fetchShortDramaFlag = async () => {
    try {
      if (type === 'TV') {
        const has = await hasShortDrama('TV');
        setShowShortDramaFilter(has);
      } else {
        setShowShortDramaFilter(false);
      }
    } catch (err) {
      console.error('获取短剧标志失败:', err);
      setShowShortDramaFilter(false);
    }
  };

  const clearFilters = () => {
    setActiveSubType(undefined);
    setActiveYear(undefined);
    setActiveArea(undefined);
    setActiveEpisodeType(undefined);
  };

  const totalPages = mediaMeta?.totalPages || 1;

  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
    sessionStorage.removeItem(scrollKey);
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

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 bg-background -mx-6 px-6 pb-4 border-b border-border">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">{typeNames[type] || type}</h1>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            placeholder="搜索电影、电视剧、综艺..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
              if (e.key === 'Escape' && isSearching) handleClearSearch();
            }}
            className="flex-1 bg-card border-border pr-8"
          />
          {searchKeyword && (
            <button
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        {isSearching ? (
          <Button variant="outline" onClick={handleClearSearch} className="bg-secondary">
            清除搜索
          </Button>
        ) : (
          <Button onClick={handleSearch} className="bg-primary hover:bg-primary-hover">
            <Search className="size-4" />
            搜索
          </Button>
        )}
      </div>

      {isSearching ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">搜索结果："{searchKeyword}"</h2>
          </div>
          {isSearchLoading ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              搜索中...
            </div>
          ) : mediaList.length > 0 ? (
            <MediaGrid items={mediaList} />
          ) : (
            <div className="text-center text-muted-foreground py-8">
              未找到相关内容
            </div>
          )}
        </div>
      ) : (
        <>
          {(subTypes.length > 0 || years.length > 0 || areas.length > 0) && (
            <div className="space-y-3 bg-card rounded-lg p-4 border border-border">
              {(activeSubType || activeYear || activeArea || activeEpisodeType) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="mb-2"
                >
                  清除筛选
                </Button>
              )}

              {subTypes.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">类型</span>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant={!activeSubType ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setActiveSubType(undefined)}
                      className="text-xs"
                    >
                      全部
                    </Button>
                    {subTypes.map((g) => (
                      <Button
                        key={g}
                        variant={activeSubType === g ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setActiveSubType(g)}
                        className="text-xs"
                      >
                        {g}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {years.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">年份</span>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant={!activeYear ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setActiveYear(undefined)}
                      className="text-xs"
                    >
                      全部
                    </Button>
                    {years.map((y) => (
                      <Button
                        key={y}
                        variant={activeYear === y ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setActiveYear(y)}
                        className="text-xs"
                      >
                        {y}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {areas.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">地区</span>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant={!activeArea ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setActiveArea(undefined)}
                      className="text-xs"
                    >
                      全部
                    </Button>
                    {areas.slice(0, 20).map((a) => (
                      <Button
                        key={a}
                        variant={activeArea === a ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setActiveArea(a)}
                        className="text-xs"
                      >
                        {a}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {showShortDramaFilter && (
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">剧集</span>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant={!activeEpisodeType ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setActiveEpisodeType(undefined);
                        setSearchParams(prev => { prev.delete('episodeType'); return prev; });
                      }}
                      className="text-xs"
                    >
                      全部
                    </Button>
                    <Button
                      variant={activeEpisodeType === 'short' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setActiveEpisodeType('short');
                        setSearchParams(prev => { prev.set('episodeType', 'short'); return prev; });
                      }}
                      className="text-xs"
                    >
                      短剧
                    </Button>
                    <Button
                      variant={activeEpisodeType === 'long' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setActiveEpisodeType('long');
                        setSearchParams(prev => { prev.set('episodeType', 'long'); return prev; });
                      }}
                      className="text-xs"
                    >
                      长剧
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            {viewMode === 'list' && (
              <div className="relative" ref={columnsMenuRef}>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setShowColumnsMenu(!showColumnsMenu)}
                >
                  <Columns3 className="size-3.5 mr-1" />
                  列
                </Button>
                {showColumnsMenu && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-card border border-border rounded-lg shadow-lg p-2 max-h-[400px] overflow-y-auto">
                    {allColumns
                      .filter((col) => !(col.id === 'episodes' && type === 'MOVIE'))
                      .map((col) => {
                      const isSelected = selectedColumns.includes(col.id);
                      const isTitle = col.id === 'title';
                      return (
                        <label
                          key={col.id}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-hover'}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isTitle}
                            onChange={() => {
                              if (isTitle) return;
                              const next = isSelected
                                ? selectedColumns.filter((c) => c !== col.id)
                                : [...selectedColumns, col.id];
                              setSelectedColumns(next);
                              saveColumns(next);
                            }}
                            className="size-3.5 rounded border-border accent-primary"
                          />
                          {col.label}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-1 border border-border rounded-md p-0.5">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'ghost'}
                size="sm"
                className="h-7 px-2"
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid className="size-3.5" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="sm"
                className="h-7 px-2"
                onClick={() => setViewMode('list')}
              >
                <List className="size-3.5" />
              </Button>
            </div>
          </div>

          {isLoading ? (
            viewMode === 'grid' ? (
              <div className="grid grid-cols-6 gap-4">
                {Array.from({ length: 18 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[2/3] rounded-lg animate-pulse-skeleton" />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-card card-shadow overflow-hidden">
                <div className="space-y-0">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <Skeleton key={i} className="h-[60px] mx-5 my-0 rounded-none border-b border-border animate-pulse-skeleton" />
                  ))}
                </div>
              </div>
            )
          ) : viewMode === 'grid' ? (
            <MediaGrid
              items={mediaList}
              navigateState={{ page: currentPage, type, subType: activeSubType, year: activeYear, area: activeArea, episodeType: activeEpisodeType }}
              onBeforeNavigate={saveScrollPosition}
            />
          ) : (
            <div className="rounded-lg border border-border bg-card card-shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50">
                  <tr>
                    {allColumns
                      .filter((c) => selectedColumns.includes(c.id))
                      .filter((c) => !(c.id === 'episodes' && type === 'MOVIE'))
                      .map((col) => (
                      <th key={col.id} className={`text-left px-5 py-3 font-semibold text-sm ${col.className || ''}`} style={col.style}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mediaList.map((m) => (
                    <tr
                      key={m.id}
                      className="hover:bg-hover cursor-pointer border-b border-dashed border-border last:border-b-0 transition-colors"
                      onClick={() => {
                        saveScrollPosition();
                        navigate(`/media/${m.id}`, {
                          state: { page: currentPage, type, subType: activeSubType, year: activeYear, area: activeArea, episodeType: activeEpisodeType }
                        });
                      }}
                    >
                      {allColumns
                        .filter((c) => selectedColumns.includes(c.id))
                        .filter((c) => !(c.id === 'episodes' && type === 'MOVIE'))
                        .map((col) => (
                        <td key={col.id} className={`px-5 py-3 leading-[30px] ${col.className || ''}`} style={col.style}>
                          {col.render(m)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
      )}
    </div>
  );
}
