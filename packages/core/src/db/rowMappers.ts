import type {
  Media,
  Episode,
  PlaySource,
  VideoSource,
  Favorite,
  WatchHistory,
  MediaType,
  CollectTask,
  TaskType,
  TaskStatus,
  TaskErrorType,
} from '../types';

/** row → 领域对象转换函数（两端共享，SQL 列名为 snake_case） */

export function rowToMedia(row: any): Media {
  return {
    id: row.id,
    title: row.title,
    originalTitle: row.original_title,
    alias: row.alias,
    type: row.type as MediaType,
    year: row.year,
    area: row.area,
    genres: row.genre ? JSON.parse(row.genre) : [],
    directors: row.director ? JSON.parse(row.director) : [],
    actors: row.cast ? JSON.parse(row.cast) : [],
    description: row.description,
    posterUrl: row.poster_url,
    backdropUrl: row.backdrop_url,
    status: row.status as 'PUBLISHED' | 'ONGOING' | 'COMPLETED' | undefined,
    remarks: row.remarks || null,
    fingerprint: row.fingerprint,
    seriesGroup: row.series_group || null,
    seriesSeason: row.series_season ?? null,
    currentEpisodes: row.current_episodes,
    totalEpisodes: row.total_episodes,
    isShortDrama: row.is_short_drama === 1,
    durationCheckStatus: (row.duration_check_status || null) as 'SUMMARY' | 'PROBE' | 'FALLBACK' | null,
    episodeDuration: row.episode_duration || null,
    viewCount: row.view_count || 0,
    hidden: row.hidden === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToEpisode(row: any): Episode {
  return {
    id: row.id,
    mediaId: row.media_id,
    seasonNumber: row.season_number,
    episodeNumber: row.episode_number,
    title: row.title,
    duration: row.duration,
    sourceId: row.source_id || null,
  };
}

export function rowToPlaySource(row: any): PlaySource {
  return {
    id: row.id,
    episodeId: row.episode_id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    url: row.url,
    quality: row.quality,
    isActive: row.is_active === 1,
    failCount: row.fail_count || 0,
    lastFailAt: row.last_fail_at || null,
  };
}

export function rowToVideoSource(row: any): VideoSource {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    baseUrl: row.base_url,
    type: row.type,
    isEnabled: row.is_enabled === 1,
    rateLimit: row.rate_limit,
    healthStatus: row.health_status,
    lastCheckAt: row.last_check_at,
    lastCollectedAt: row.last_collected_at || null,
    lastSuccessAt: row.last_success_at || null,
    failCount: row.fail_count || 0,
    totalRequests: row.total_requests || 0,
    avgResponseTime: row.avg_response_time || undefined,
  };
}

export function rowToFavorite(row: any): Favorite {
  return {
    id: row.id,
    mediaId: row.media_id,
    createdAt: row.created_at,
  };
}

export function rowToWatchHistory(row: any): WatchHistory {
  return {
    id: row.id,
    mediaId: row.media_id,
    episodeId: row.episode_id,
    progress: row.progress || 0,
    duration: row.duration || 0,
    updatedAt: row.updated_at,
  };
}

export function rowToCollectTask(row: any): CollectTask {
  return {
    id: row.id,
    taskId: row.task_id,
    sourceCode: row.source_code,
    sourceName: row.source_name,
    type: row.type as TaskType,
    status: row.status as TaskStatus,
    currentPage: row.current_page,
    totalPages: row.total_pages,
    collectedCount: row.collected_count,
    failedCount: row.failed_count || 0,
    errorMessage: row.error_message || null,
    errorType: (row.error_type || null) as TaskErrorType | null,
    lastErrorPage: row.last_error_page ?? null,
    failedPages: row.failed_pages || null,
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
  };
}
