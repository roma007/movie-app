import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '../useAppStore';
import { useToast } from '@/components/Layout';
import { getProvider } from '../init';
import { useBackgroundStore } from '../themes/backgroundStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Heart, ChevronRight, ArrowLeft, EyeOff, Star } from 'lucide-react';
import type { Media, Episode, PlaySource, VideoSource } from '@movie-app/core';
import { VideoDurationService, UNCATEGORIZED_GENRE } from '@movie-app/core';
import { PosterImage } from '@/components/PosterImage';

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
  const { currentMedia, episodes, seasons, isLoading, error, episodeSources, seriesMedia, loadMediaDetail, loadSeasons, loadEpisodes, loadSeasonEpisodes, loadSeriesMedia, toggleFav, hideMediaByGenres, fetchMediaRating, isRatingLoading } = useAppStore();
  const toast = useToast();
  const setBgImage = useBackgroundStore((s) => s.setBgImage);
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);
  const prevState = location.state as { page?: number; type?: string; subType?: string; year?: number; area?: string; episodeType?: string } | undefined;
  const [currentSeason, setCurrentSeason] = useState(1);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [isFav, setIsFav] = useState(false);
  const [, setEpisodeDurations] = useState<Record<string, number | null>>({});
  const [allPlaySources, setAllPlaySources] = useState<Record<string, PlaySource[]>>({});
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(new Set());
  const [episodesLoading, setEpisodesLoading] = useState(true);
  const [hideDialogOpen, setHideDialogOpen] = useState(false);
  const [selectedHideGenres, setSelectedHideGenres] = useState<string[]>([]);
  const [hiding, setHiding] = useState(false);

  const openHideDialog = () => {
    if (!currentMedia) return;
    setSelectedHideGenres([]);
    setHideDialogOpen(true);
  };

  useEffect(() => {
    if (!id) return;
    loadMediaDetail(id);
    fetchMediaRating(id);
    loadSeasons(id);
    loadSeriesMedia(id);
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
    if (!currentMedia?.posterUrl) {
      setBgImage(null);
      return () => clearBgImage();
    }
    setBgImage(currentMedia.posterUrl);
    return () => clearBgImage();
  }, [currentMedia, setBgImage, clearBgImage]);

  useEffect(() => {
    if (seasons.length > 0 && !seasons.includes(currentSeason)) {
      setCurrentSeason(seasons[0]);
    }
  }, [seasons]);

  useEffect(() => {
    if (!id || currentSeason === 0) return;

    let cancelled = false;
    setEpisodesLoading(true);

    loadSeasonEpisodes(id, currentSeason).then(firstSourceId => {
      if (cancelled) return;
      if (firstSourceId) setSelectedSourceId(firstSourceId);
      setEpisodesLoading(false);
    });

    return () => {
      cancelled = true;
    };
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

  const seasonToMediaMap = new Map<number, string>();
  seriesMedia.forEach(m => {
    if (m.seriesSeason) seasonToMediaMap.set(m.seriesSeason, m.id);
  });
  const seasonsFromSeries = [...new Set(seriesMedia.map(m => m.seriesSeason ?? 1))].sort((a, b) => a - b);
  const displaySeasons = seasonsFromSeries.length > 0 ? seasonsFromSeries : seasons;
  const currentMediaSeason = currentMedia?.seriesSeason ?? 1;

  const handleSeasonChange = (s: number) => {
    const targetId = seasonToMediaMap.get(s);
    if (targetId && targetId !== id) {
      navigate(`/media/${targetId}`, { replace: true });
    } else {
      setCurrentSeason(s);
    }
  };

  const handleSourceChange = (sourceId: string) => {
    setSelectedSourceId(sourceId);
    if (!id) return;
    setEpisodesLoading(true);
    loadEpisodes(id, currentSeason, sourceId).then(() => {
      setEpisodesLoading(false);
    });
  };

  const handleFav = async () => {
    if (!id) return;
    const result = await toggleFav(id);
    setIsFav(result);
  };

  const handleHide = async () => {
    if (selectedHideGenres.length === 0) return;
    setHiding(true);
    try {
      const result = await hideMediaByGenres(selectedHideGenres);
      toast(`已隐藏 ${result.hidden} 个「${selectedHideGenres.join('/')}」类视频`);
      setHideDialogOpen(false);
      navigate(getBackUrl());
    } catch (err: any) {
      toast(`隐藏失败: ${err.message || '未知错误'}`, 'error');
      setHideDialogOpen(false);
    } finally {
      setHiding(false);
    }
  };

  if (isLoading && !currentMedia) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
          <div className="flex items-center gap-4 min-w-0">
            <Button variant="ghost" onClick={() => navigate(-1)} className="hover:text-text shrink-0">
              <ArrowLeft className="size-4 mr-2" />
              返回
            </Button>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Skeleton className="h-4 w-12 animate-pulse-skeleton rounded" />
              <ChevronRight className="size-3 shrink-0" />
              <Skeleton className="h-4 w-32 animate-pulse-skeleton rounded" />
            </div>
          </div>
        </div>
        <div className="space-y-5 mt-5">
          <Card className="card-shadow">
            <div className="p-5 flex gap-6">
              <Skeleton className="w-48 h-72 rounded-lg animate-pulse-skeleton" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-8 w-2/3 animate-pulse-skeleton" />
                <Skeleton className="h-4 w-1/3 animate-pulse-skeleton" />
                <Skeleton className="h-24 w-full animate-pulse-skeleton" />
              </div>
            </div>
          </Card>
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
    <div className="p-6 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate(getBackUrl())} className="hover:text-text shrink-0">
            <ArrowLeft className="size-4 mr-2" />
            返回
          </Button>
          <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0 overflow-hidden flex-1">
            <button
              type="button"
              onClick={() => navigate(getTypeListUrl())}
              className="hover:text-text transition-colors shrink-0"
            >
              {typeLabel[media.type] || media.type}
            </button>
            <ChevronRight className="size-3 shrink-0" />
            <span className="text-text shrink-0 truncate">{media.title}</span>
          </div>
        </div>
      </div>

      <div className="flex gap-6 mt-5">
        <div className="w-80 shrink-0 space-y-5">
          <Card className="card-shadow">
            <div className="p-5">
              <div className="w-full aspect-[3/4] rounded-lg overflow-hidden bg-secondary mb-4">
                <PosterImage src={media.posterUrl} alt={media.title} className="size-full object-cover" />
              </div>
              <div className="space-y-2">
                  <h1 className="text-xl font-normal">
                    {media.title}
                  </h1>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openHideDialog}
                      title="将此类子类型视频加入隐藏列表"
                    >
                      <EyeOff className="size-4" />
                      隐藏此类视频
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleFav}
                      className={isFav ? 'bg-muted-foreground/20 text-text' : ''}
                    >
                      <Heart className={`size-4 ${isFav ? 'fill-current' : ''}`} />
                      {isFav ? '已收藏' : '收藏'}
                    </Button>
                  </div>
                {media.alias && (
                  <p className="text-sm"><span className="text-muted-foreground">又名：</span>{media.alias}</p>
                )}
                {media.rating != null && media.rating > 0 ? (
                  <p className="flex items-center gap-1.5">
                    <Star className="size-4 text-amber-400 fill-current shrink-0" />
                    <span className="text-lg font-semibold text-amber-400 leading-none">{media.rating.toFixed(1)}</span>
                    {media.ratingCount != null && media.ratingCount > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {media.ratingCount >= 10000 ? `${(media.ratingCount / 10000).toFixed(1)}万人` : `${media.ratingCount}人`}评分
                      </span>
                    )}
                  </p>
                ) : isRatingLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="inline-block size-3.5 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" />
                    正在获取评分...
                  </p>
                ) : null}
                <p className="text-sm">
                  <span className="text-muted-foreground">类型：</span>
                  {media.genres.length > 0 ? media.genres.map((g, i) => (
                    <span key={g}>
                      <button
                        type="button"
                        onClick={() => navigate(`${typeRouteMap[media.type] || '/'}?subType=${encodeURIComponent(g)}`)}
                        className="hover:text-text transition-colors cursor-pointer"
                        title={`筛选「${g}」类视频`}
                      >
                        {g}
                      </button>
                      {i < media.genres.length - 1 && <span>,</span>}
                    </span>
                  )) : '未知'}
                </p>
                <p className="text-sm"><span className="text-muted-foreground">年份：</span>{media.year}</p>
                <p className="text-sm"><span className="text-muted-foreground">地区：</span>{media.area || '未知'}</p>
                <p className="text-sm text-error"><span className="text-muted-foreground">更新时间：</span>{new Date(media.updatedAt).toISOString().split('T')[0]}</p>
              </div>
            </div>
          </Card>
        </div>

        <div className="flex-1 min-w-0 space-y-5">
          <Card className="card-shadow p-5 space-y-2">
            <p className="text-sm">
              <span className="text-muted-foreground">导演：</span>
              {media.directors.length > 0 ? media.directors.map((d, i) => (
                <span key={d}>
                  <button
                    type="button"
                    onClick={() => navigate('/', { state: { searchKeyword: d } })}
                    className="hover:text-text transition-colors cursor-pointer"
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
                    className="hover:text-text transition-colors cursor-pointer"
                  >
                    {a}
                  </button>
                  {i < media.actors.length - 1 && <span>,</span>}
                </span>
              )) : '未知'}
            </p>
          </Card>
          {media.description && (
            <Card className="card-shadow">
              <div className="px-5 py-3">
                <h3 className="text-base font-medium">剧情介绍</h3>
              </div>
              <div className="p-5 pt-0 text-sm leading-6 text-text">
                {media.description}
              </div>
            </Card>
          )}

          {displaySeasons.length > 1 && (
            <Card className="card-shadow p-4 flex gap-2 flex-wrap">
              {displaySeasons.map((s) => {
                const isCurrent = seasonToMediaMap.get(s) === id || (!seasonToMediaMap.has(s) && currentSeason === s);
                return (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    onClick={() => handleSeasonChange(s)}
                    className={isCurrent ? 'bg-muted-foreground/20 text-text' : ''}
                  >
                    第 {s} 季
                  </Button>
                );
              })}
            </Card>
          )}

          <Card className="card-shadow">
            {error && (
              <div className="mx-5 mt-5 mb-3 p-4 bg-error/10 rounded-lg">
                <p className="text-sm text-error">{error}</p>
              </div>
            )}

            <div className="flex">
              {episodeSources.length > 1 && (
                <div className="shrink-0 flex flex-col items-end gap-1.5 pl-3">
                  {episodeSources.map((s: VideoSource) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSourceChange(s.id)}
                      className={`text-left truncate rounded-l-md rounded-r-none transition-all duration-150 flex-1 ${
                        selectedSourceId === s.id
                          ? 'w-24 bg-[var(--color-card-accent-alpha)] text-[var(--color-button-primary-text)] py-2.5 px-3 shadow-none'
                          : 'w-20 bg-[var(--color-card-dim-alpha)] text-[var(--color-button-secondary-text)] py-1.5 px-2 hover:text-text'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex-1 min-w-0 rounded-l-none rounded-r-md bg-[var(--color-card-accent-alpha)] p-4">
                {episodesLoading ? (
                  <div className="p-6 text-center text-muted-foreground">
                    <div className="animate-spin size-5 border-2 border-muted-foreground border-t-transparent rounded-full mx-auto mb-2" />
                    <p className="text-sm">加载中...</p>
                  </div>
                ) : episodes.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground">
                    <p className="text-sm">暂无集数信息</p>
                    <p className="text-xs mt-1">请尝试重新采集数据或切换视频源</p>
                  </div>
                ) : (
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
                                className="relative px-3 py-1.5 rounded text-xs font-medium transition-all duration-200 bg-[var(--color-card-dim-alpha)] text-text-secondary cursor-pointer hover:text-text hover:bg-[var(--color-hover-alpha)]"
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
                              onClick={() => navigate(`/play/${ep.id}${selectedSourceId ? `?sourceId=${selectedSourceId}` : ''}`)}
                              className={`relative px-3 py-1.5 rounded text-xs font-medium transition-all duration-200 bg-[var(--color-card-dim-alpha)] text-text-secondary cursor-pointer hover:text-text hover:bg-[var(--color-hover-alpha)]${isWatched ? ' opacity-50' : ''}`}
                              title="点击播放"
                            >
                              {title}
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={hideDialogOpen} onOpenChange={(open) => { if (!open) setHideDialogOpen(false); }}>
        <DialogContent className="w-full max-w-sm">
          <DialogHeader>
            <DialogTitle>隐藏此类视频</DialogTitle>
            <DialogDescription>
              选择要隐藏的子类型，隐藏后此类视频将不再显示。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 py-2">
            {(media.genres.length === 0 ? [UNCATEGORIZED_GENRE] : media.genres).map((g) => {
              const selected = selectedHideGenres.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => {
                    setSelectedHideGenres(prev =>
                      prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]
                    );
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                    selected
                      ? 'bg-muted-foreground text-background border-muted-foreground'
                      : 'bg-card text-text hover:border-muted-foreground/50'
                  }`}
                >
                  {g}
                </button>
              );
            })}
          </div>
          <DialogFooter className="flex items-center gap-2">
            <DialogClose asChild>
              <Button variant="outline" size="sm" onClick={() => setHideDialogOpen(false)}>取消</Button>
            </DialogClose>
            <Button
              variant="outline"
              size="sm"
              disabled={hiding || selectedHideGenres.length === 0}
              onClick={handleHide}
            >
              <EyeOff className={`size-4 mr-1 ${hiding ? 'animate-spin' : ''}`} />
              {hiding ? '隐藏中...' : `隐藏 (${selectedHideGenres.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}