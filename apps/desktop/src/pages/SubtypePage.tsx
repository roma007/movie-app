import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAppStore } from '../useAppStore';
import { getProvider, getStore } from '../init';
import { useBackgroundStore } from '../themes/backgroundStore';
import { MediaGrid } from '@/components/MediaCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';

const pageSize = 30;

const typeNames: Record<string, string> = {
  MOVIE: '电影',
  TV: '电视剧',
  VARIETY: '综艺',
  ANIME: '动漫',
  DOCUMENTARY: '纪录片',
};

const typeRoutes: Record<string, string> = {
  MOVIE: '/movie',
  TV: '/tv',
  VARIETY: '/variety',
  ANIME: '/anime',
  DOCUMENTARY: '/documentary',
};

export default function SubtypePage() {
  const { type = '', subType = '' } = useParams<{ type: string; subType: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { mediaList, mediaMeta, isLoading, loadMediaList } = useAppStore();
  const setBgImage = useBackgroundStore((s) => s.setBgImage);
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);
  const [currentPage, setCurrentPage] = useState(() => {
    const page = searchParams.get('page');
    return page ? Math.max(1, Number(page)) : 1;
  });
  const [sort, setSort] = useState<'latest' | 'recommend'>(() => {
    return searchParams.get('sort') === 'latest' ? 'latest' : 'recommend';
  });

  useEffect(() => {
    if (!type || !subType) return;
    const page = searchParams.get('page');
    setCurrentPage(page ? Math.max(1, Number(page)) : 1);
    setSort(searchParams.get('sort') === 'latest' ? 'latest' : 'recommend');
  }, [type, subType, searchParams]);

  useEffect(() => {
    if (!type || !subType) return;
    loadMediaList({ page: currentPage, pageSize, type, subType, sort });
  }, [type, subType, currentPage, sort, loadMediaList]);

  useEffect(() => {
    if (!type || !subType || mediaList.length === 0) return;
    const shownAt = new Date().toISOString();
    void getProvider()
      .recordImpressions(mediaList.map((m) => ({ mediaId: m.id, shownAt })))
      .then(() => {
        getStore().getState().scheduleRecommendationRecompute();
      })
      .catch((e) => console.error('记录列表展示失败:', e));
  }, [type, subType, mediaList]);

  const loadPage = (page: number) => {
    setCurrentPage(page);
    setSearchParams((prev) => {
      prev.set('page', String(page));
      return prev;
    });
  };

  const handleSortChange = (value: 'latest' | 'recommend') => {
    if (value === sort) return;
    setSort(value);
    setSearchParams((prev) => {
      prev.set('sort', value);
      prev.delete('page');
      return prev;
    });
  };

  useEffect(() => {
    const first = mediaList[0];
    if (!first?.posterUrl) {
      setBgImage(null);
      return () => clearBgImage();
    }
    setBgImage(first.posterUrl);
    return () => clearBgImage();
  }, [mediaList, setBgImage, clearBgImage]);

  const totalPages = mediaMeta?.totalPages || 1;
  const typeName = typeNames[type] || type;
  const typeRoute = typeRoutes[type] || '/';

  const getPageNumbers = () => {
    const pages: number[] = [];
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  };

  const navigateState = useMemo(
    () => ({ page: currentPage, type, subType, sort, subtypePage: true }),
    [currentPage, type, subType, sort]
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-4">
        <Button variant="ghost" onClick={() => navigate(-1)} className="hover:text-text shrink-0">
          <ArrowLeft className="size-4 mr-2" />
          返回
        </Button>
        <h1 className="text-lg font-medium shrink-0">
          <button
            type="button"
            onClick={() => navigate(typeRoute)}
            className="hover:text-text transition-colors cursor-pointer"
          >
            {typeName}
          </button>
          <span className="text-muted-foreground"> · </span>
          <span className="text-text">{subType}</span>
        </h1>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-muted-foreground">排序</span>
        <Button
          variant={sort === 'recommend' ? 'default' : 'outline'}
          size="sm"
          onClick={() => handleSortChange('recommend')}
          className="text-xs"
        >
          为你推荐
        </Button>
        <Button
          variant={sort === 'latest' ? 'default' : 'outline'}
          size="sm"
          onClick={() => handleSortChange('latest')}
          className="text-xs"
        >
          最新
        </Button>
      </div>

      {isLoading && mediaList.length === 0 ? (
        <div className="grid grid-cols-6 gap-4">
          {Array.from({ length: 18 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] rounded-lg animate-pulse-skeleton" />
          ))}
        </div>
      ) : mediaList.length > 0 ? (
        <MediaGrid items={mediaList} navigateState={navigateState} />
      ) : (
        <Card className="card-shadow">
          <div className="p-16 text-center text-muted-foreground">
            「{subType}」类下暂无内容
          </div>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 pt-6">
          <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => loadPage(1)}>
            首页
          </Button>
          <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => loadPage(currentPage - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          {getPageNumbers().map((p) => (
            <Button
              key={p}
              variant={p === currentPage ? 'default' : 'outline'}
              size="sm"
              onClick={() => loadPage(p)}
            >
              {p}
            </Button>
          ))}
          <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => loadPage(currentPage + 1)}>
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => loadPage(totalPages)}>
            尾页
          </Button>
          <span className="text-sm text-muted-foreground ml-2">
            {currentPage}/{totalPages}
          </span>
        </div>
      )}

      {isLoading && mediaList.length > 0 && (
        <div className="text-center text-muted-foreground text-sm py-4">加载中...</div>
      )}
    </div>
  );
}
