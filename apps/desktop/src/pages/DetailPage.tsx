import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAppStore } from '../useAppStore';
import { getProvider } from '../init';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Heart, ChevronRight, Check, ArrowLeft } from 'lucide-react';
import type { Media, Episode, PlaySource } from '@movie-app/core';
import { VideoDurationService } from '@movie-app/core';

const typeLabel: Record<string, string> = {
    MOVIE: '电影',
    TV: '电视剧',
    VARIETY: '综艺',
    ANIME: '动漫',
    DOCUMENTARY: '纪录片',
  };

export default function DetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { currentMedia, episodes, seasons, isLoading, error, loadMediaDetail, loadSeasons, loadEpisodes, toggleFav } = useAppStore();
  const prevState = location.state as { page?: number; type?: string; subType?: string; year?: number; area?: string; episodeType?: string } | undefined;
  const [currentSeason, setCurrentSeason] = useState(1);
  const [isFav, setIsFav] = useState(false);
  const [, setEpisodeDurations] = useState<Record<string, number | null>>({});
  const [allPlaySources, setAllPlaySources] = useState<Record<string, PlaySource[]>>({});
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!id) return;
    loadMediaDetail(id);
    loadSeasons(id);
    getProvider().isFavorite(id).then(setIsFav).catch(() => {});
    getProvider().getAllWatchHistoryByMediaId(id).then(history => {
      const watched = new Set<string>();
      for (const h of history) {
        if (h.episodeId && h.episodeId !== id && (h.progress > 60 || (h.duration > 0 && h.progress / h.duration >= 0.1))) {
          watched.add(h.episodeId);
        }
      }
      setWatchedEpisodes(watched);
    }).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (seasons.length > 0 && !seasons.includes(currentSeason)) {
      setCurrentSeason(seasons[0]);
    }
  }, [seasons]);

  useEffect(() => {
    if (!id || currentSeason === 0) return;
    loadEpisodes(id, currentSeason);
  }, [id, currentSeason]);

  useEffect(() => {
    if (episodes.length === 0) return;

    const durationService = new VideoDurationService();
    const provider = getProvider();
    const CONCURRENCY_LIMIT = 3;

    const fetchDuration = async (ep: Episode) => {
      try {
        const sources = await provider.getPlaySourcesByEpisodeId(ep.id);
        setAllPlaySources(prev => ({ ...prev, [ep.id]: sources }));
        const m3u8Source = sources.find(s => s.url.endsWith('.m3u8') || s.url.toLowerCase().includes('m3u8'));
        if (m3u8Source) {
          const duration = await durationService.getDurationFromM3U8(m3u8Source.url);
          setEpisodeDurations(prev => ({ ...prev, [ep.id]: duration }));
        }
      } catch {
        setEpisodeDurations(prev => ({ ...prev, [ep.id]: null }));
      }
    };

    const runInBatches = async () => {
      for (let i = 0; i < episodes.length; i += CONCURRENCY_LIMIT) {
        const batch = episodes.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(batch.map(fetchDuration));
      }
    };

    runInBatches();
  }, [episodes]);

  const handleSeasonChange = (s: number) => {
    setCurrentSeason(s);
    if (id) loadEpisodes(id, s);
  };

  const handleFav = async () => {
    if (!id) return;
    const result = await toggleFav(id);
    setIsFav(result);
  };

  if (isLoading && !currentMedia) {
    return (
      <div className="p-6 space-y-5 max-w-7xl mx-auto">
        <div className="rounded-lg border border-border bg-card card-shadow">
          <div className="p-5">
            <Skeleton className="h-5 w-48 animate-pulse-skeleton" />
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card card-shadow">
          <div className="p-5 flex gap-6">
            <Skeleton className="w-48 h-72 rounded-lg animate-pulse-skeleton" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-8 w-2/3 animate-pulse-skeleton" />
              <Skeleton className="h-4 w-1/3 animate-pulse-skeleton" />
              <Skeleton className="h-24 w-full animate-pulse-skeleton" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const media = currentMedia as Media | null;
  if (!media) {
    return <div className="p-6 text-error">加载失败</div>;
  }

  const typeRouteMap: Record<string, string> = {
    MOVIE: '/movie',
    TV: '/tv',
    VARIETY: '/variety',
    ANIME: '/anime',
    DOCUMENTARY: '/documentary',
  };

  const getBackUrl = () => {
    if (prevState) {
      const params = new URLSearchParams();
      if (prevState.page) params.set('page', String(prevState.page));
      if (prevState.subType) params.set('subType', prevState.subType);
      if (prevState.year) params.set('year', String(prevState.year));
      if (prevState.area) params.set('area', prevState.area);
      if (prevState.episodeType) params.set('episodeType', prevState.episodeType);
      const base = prevState.type ? (typeRouteMap[prevState.type] || '/') : '/';
      const qs = params.toString();
      return qs ? `${base}?${qs}` : base;
    }
    return -1 as any;
  };

  const getTypeListUrl = () => typeRouteMap[media.type] || '/';

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 bg-background -mx-6 px-6 pb-4 border-b border-border">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate(getBackUrl())} className="hover:text-primary">
            <ArrowLeft className="size-4 mr-2" />
            返回
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card card-shadow">
        <div className="px-5 py-3 border-b border-border text-sm text-muted-foreground">
          <span>当前位置：</span>
          <Link 
            to={getTypeListUrl()} 
            className="hover:text-primary transition-colors"
          >
            {typeLabel[media.type] || media.type}
          </Link>
          <ChevronRight className="inline size-3 text-muted-foreground" />
          <span className="text-foreground">{media.title}</span>
        </div>

        <div className="p-5 flex gap-6">
          <div className="shrink-0">
            <div className="w-[210px] h-[290px] rounded-lg overflow-hidden bg-secondary">
              {media.posterUrl && (
                <img src={media.posterUrl} alt={media.title} className="size-full object-cover" />
              )}
            </div>
          </div>
          <div className="flex-1 space-y-2">
            <h1 className="text-2xl font-normal">
              {media.title}
            </h1>
            {media.alias && (
              <p className="text-sm"><span className="text-muted-foreground">又名：</span>{media.alias}</p>
            )}
            <p className="text-sm">
              <span className="text-muted-foreground">导演：</span>
              {media.directors.length > 0 ? media.directors.map((d, i) => (
                <span key={d}>
                  <button
                    type="button"
                    onClick={() => navigate('/', { state: { searchKeyword: d } })}
                    className="hover:text-primary transition-colors cursor-pointer"
                  >
                    {d}
                  </button>
                  {i < media.directors.length - 1 && <span>,</span>}
                </span>
              )) : '未知'}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">主演：</span>
              {media.actors.length > 0 ? media.actors.map((a, i) => (
                <span key={a}>
                  <button
                    type="button"
                    onClick={() => navigate('/', { state: { searchKeyword: a } })}
                    className="hover:text-primary transition-colors cursor-pointer"
                  >
                    {a}
                  </button>
                  {i < media.actors.length - 1 && <span>,</span>}
                </span>
              )) : '未知'}
            </p>
            <p className="text-sm"><span className="text-muted-foreground">类型：</span>{media.genres.join(',')}</p>
            <p className="text-sm"><span className="text-muted-foreground">年份：</span>{media.year}</p>
            <p className="text-sm"><span className="text-muted-foreground">地区：</span>{media.area || '未知'}</p>
            <p className="text-sm text-error"><span className="text-muted-foreground">更新时间：</span>{new Date(media.updatedAt).toISOString().split('T')[0]}</p>
            <div className="pt-2">
              <Button 
                variant={isFav ? 'default' : 'outline'} 
                size="sm" 
                onClick={handleFav}
                className={isFav ? 'bg-favorite hover:bg-favorite/90' : ''}
              >
                <Heart className={`size-4 ${isFav ? 'fill-current' : ''}`} />
                {isFav ? '已收藏' : '收藏'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {seasons.length > 1 && (
        <div className="rounded-lg border border-border bg-card card-shadow p-4 flex gap-2 flex-wrap">
          {seasons.map((s) => (
            <Button
              key={s}
              variant={currentSeason === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleSeasonChange(s)}
            >
              第 {s} 季
            </Button>
          ))}
        </div>
      )}

      {media.description && (
        <div className="rounded-lg border border-border bg-card card-shadow">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="text-base font-medium">剧情介绍</h3>
          </div>
          <div className="p-5 text-sm leading-6 text-foreground">
            {media.description}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card card-shadow">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="text-base font-medium">{currentMedia?.type === 'MOVIE' ? '播放源' : '集数'}</h3>
        </div>

        {error && (
          <div className="p-4 bg-error/10 border-b border-error/30">
            <p className="text-sm text-error">{error}</p>
          </div>
        )}

        {episodes.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <p className="text-sm">暂无集数信息</p>
            <p className="text-xs mt-1">请尝试重新采集数据或切换视频源</p>
          </div>
        ) : (
          <>
            <div className="px-5 py-3">
              <div className="flex flex-wrap gap-1.5">
                {currentMedia?.type === 'MOVIE' ? (
                  episodes.map((ep: any) => {
                    const sources = allPlaySources[ep.id] || [];

                    const sourceKeyMap = new Map<string, number>();
                    sources.forEach(s => {
                      const key = `${s.sourceName || ''}_${s.quality || ''}`;
                      sourceKeyMap.set(key, (sourceKeyMap.get(key) || 0) + 1);
                    });
                    const keyIndexMap = new Map<string, number>();

                    return sources.map((source: PlaySource, idx: number) => {
                      const key = `${source.sourceName || ''}_${source.quality || ''}`;
                      const count = sourceKeyMap.get(key) || 1;
                      const idxInGroup = (keyIndexMap.get(key) || 0) + 1;
                      keyIndexMap.set(key, idxInGroup);
                      const baseTitle = `${source.sourceName || ''}${source.quality ? ` · ${source.quality}` : ''}`.trim() || '正片';
                      const suffix = count > 1 ? ` (${idxInGroup})` : '';
                      const title = `${baseTitle}${suffix}`;
                      return (
                        <div
                          key={`${ep.id}-${source.id || idx}`}
                          className="relative group"
                        >
                          <button
                            type="button"
                            onClick={() => navigate(`/play/${ep.id}?source=${source.id}`)}
                            className="relative px-3 py-1.5 rounded text-xs font-medium transition-all duration-200 bg-secondary text-foreground cursor-pointer hover:text-primary hover:bg-hover border border-transparent"
                            title="点击播放"
                          >
                            {title}
                          </button>
                        </div>
                      );
                    });
                  })
                ) : (
                  episodes.map((ep: any) => {
                    const sources = allPlaySources[ep.id] || [];
                    const m3u8Source = sources.find(s => s.url.endsWith('.m3u8') || s.url.toLowerCase().includes('m3u8'));
                    const title = ep.title || `第${ep.episodeNumber}集`;
                    const isWatched = watchedEpisodes.has(ep.id);

                    return (
                      <div
                        key={ep.id}
                        className="relative group"
                      >
                        <button
                          type="button"
                          onClick={() => navigate(`/play/${ep.id}`)}
                          className={`relative px-3 py-1.5 rounded text-xs font-medium transition-all duration-200 bg-secondary text-foreground cursor-pointer hover:text-primary hover:bg-hover border border-transparent${isWatched ? ' opacity-50' : ''}`}
                          title="点击播放"
                        >
                          {title}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>


          </>
        )}
      </div>
    </div>
  );
}