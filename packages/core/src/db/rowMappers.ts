import type {
  Media,
  Episode,
  PlaySource,
  VideoSource,
  Favorite,
  WatchHistory,
  MediaType,
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
    fingerprint: row.fingerprint,
    currentEpisodes: row.current_episodes,
    totalEpisodes: row.total_episodes,
    isShortDrama: row.is_short_drama === 1,
    viewCount: row.view_count || 0,
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
    priority: row.priority,
    healthStatus: row.health_status,
    lastCheckAt: row.last_check_at,
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
