import Database from '@tauri-apps/plugin-sql';
import {
  INSERT_DEFAULT_SOURCE_SQL,
  COUNT_VIDEO_SOURCE_SQL,
  defaultSources,
  rowToMedia,
  rowToEpisode,
  rowToPlaySource,
  rowToVideoSource,
  rowToFavorite,
  rowToWatchHistory,
} from '@movie-app/core';
import type { DatabaseProvider } from '@movie-app/core';
import type {
  Media,
  Episode,
  PlaySource,
  VideoSource,
  Favorite,
  WatchHistory,
  PaginatedResponse,
  ListParams,
} from '@movie-app/core';

/**
 * DatabaseProvider 的 tauri-plugin-sql 实现（桌面端）。
 * SQL 语句与移动端 ExpoSqliteProvider 完全一致，仅底层 API 不同：
 *   - migrations（建表 + FTS5 触发器）由 Rust 侧 lib.rs 在 Database.load 时自动执行
 *   - 单行查询用 select 返回数组的 [0]，对应移动端 getFirstAsync
 *   - 多行查询直接用 select 返回数组，对应移动端 getAllAsync
 *   - 写入用 execute，对应移动端 runAsync
 */
export class TauriSqlProvider implements DatabaseProvider {
  private db: Database | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    // Database.load 会自动运行 lib.rs 中注册的 migrations（建表 + FTS5 触发器）
    this.db = await Database.load('sqlite:movieapp.db');

    // PRAGMA（WAL 为持久设置；foreign_keys 需每连接设置）
    await this.db.execute('PRAGMA journal_mode = WAL;');
    await this.db.execute('PRAGMA foreign_keys = ON;');

    await this.insertDefaultSources();
  }

  private async insertDefaultSources(): Promise<void> {
    const rows = await this.db!.select<{ count: number }[]>(COUNT_VIDEO_SOURCE_SQL);
    if ((rows[0]?.count ?? 0) === 0) {
      const now = new Date().toISOString();
      for (const source of defaultSources) {
        await this.db!.execute(INSERT_DEFAULT_SOURCE_SQL, [
          `source_${source.code}`,
          source.code,
          source.name,
          source.baseUrl,
          source.rateLimit,
          source.priority,
          now,
        ]);
      }
    }
  }

  // —— Media DAO ——
  async getMediaById(id: string): Promise<Media | null> {
    const rows = await this.db!.select<any[]>('SELECT * FROM media WHERE id = ?', [id]);
    return rows[0] ? rowToMedia(rows[0]) : null;
  }

  async getMediaByFingerprint(fingerprint: string): Promise<Media | null> {
    const rows = await this.db!.select<any[]>('SELECT * FROM media WHERE fingerprint = ?', [fingerprint]);
    return rows[0] ? rowToMedia(rows[0]) : null;
  }

  async listMedia(params: ListParams = {}): Promise<PaginatedResponse<Media>> {
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let whereClause = '';
    const queryParams: any[] = [];
    if (params.type) {
      whereClause += ' WHERE type = ?';
      queryParams.push(params.type);
    }
    if (params.year) {
      whereClause += whereClause ? ' AND year = ?' : ' WHERE year = ?';
      queryParams.push(params.year);
    }
    if (params.area) {
      whereClause += whereClause ? ' AND area = ?' : ' WHERE area = ?';
      queryParams.push(params.area);
    }
    const orderBy = params.sort === 'view' ? 'view_count DESC' : 'updated_at DESC';

    const countRows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM media${whereClause}`,
      queryParams
    );
    const total = countRows[0]?.count || 0;
    const totalPages = Math.ceil(total / pageSize);

    const rows = await this.db!.select<any[]>(
      `SELECT * FROM media${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...queryParams, pageSize, offset]
    );

    return { items: rows.map(rowToMedia), meta: { page, pageSize, total, totalPages } };
  }

  async upsertMedia(media: Media): Promise<void> {
    const now = new Date().toISOString();
    await this.db!.execute(
      `INSERT INTO media (
        id, title, original_title, alias, type, year, area, genre, director, cast,
        description, poster_url, backdrop_url, status, fingerprint,
        current_episodes, total_episodes, is_short_drama, view_count,
        favorite_count, search_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        title = excluded.title,
        original_title = excluded.original_title,
        alias = excluded.alias,
        area = excluded.area,
        genre = excluded.genre,
        director = excluded.director,
        cast = excluded.cast,
        description = excluded.description,
        poster_url = excluded.poster_url,
        backdrop_url = excluded.backdrop_url,
        status = excluded.status,
        current_episodes = excluded.current_episodes,
        total_episodes = excluded.total_episodes,
        is_short_drama = excluded.is_short_drama,
        updated_at = excluded.updated_at`,
      [
        media.id, media.title, media.originalTitle || null, media.alias || null,
        media.type, media.year, media.area || null,
        JSON.stringify(media.genres), JSON.stringify(media.directors), JSON.stringify(media.actors),
        media.description || null, media.posterUrl || null, media.backdropUrl || null,
        media.status || null, media.fingerprint,
        media.currentEpisodes || null, media.totalEpisodes || null,
        media.isShortDrama ? 1 : 0, media.viewCount || 0, 0, 0,
        media.createdAt || now, now,
      ]
    );
  }

  async incrementViewCount(id: string): Promise<void> {
    await this.db!.execute('UPDATE media SET view_count = view_count + 1 WHERE id = ?', [id]);
  }

  async incrementSearchCount(id: string): Promise<void> {
    await this.db!.execute('UPDATE media SET search_count = search_count + 1 WHERE id = ?', [id]);
  }

  async searchMedia(keyword: string, page: number = 1, pageSize: number = 20): Promise<PaginatedResponse<Media>> {
    const offset = (page - 1) * pageSize;
    const countRows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM media_fts WHERE media_fts MATCH ?`, [keyword]
    );
    const total = countRows[0]?.count || 0;
    const totalPages = Math.ceil(total / pageSize);
    const rows = await this.db!.select<any[]>(
      `SELECT m.* FROM media m
       INNER JOIN media_fts fts ON m.rowid = fts.rowid
       WHERE media_fts MATCH ?
       ORDER BY rank
       LIMIT ? OFFSET ?`,
      [keyword, pageSize, offset]
    );
    return { items: rows.map(rowToMedia), meta: { page, pageSize, total, totalPages } };
  }

  // —— Episode DAO ——
  async getEpisodesByMediaId(mediaId: string, season: number = 1): Promise<Episode[]> {
    const rows = await this.db!.select<any[]>(
      'SELECT * FROM episode WHERE media_id = ? AND season_number = ? ORDER BY episode_number ASC',
      [mediaId, season]
    );
    return rows.map(rowToEpisode);
  }

  async getEpisodeById(id: string): Promise<Episode | null> {
    const rows = await this.db!.select<any[]>('SELECT * FROM episode WHERE id = ?', [id]);
    return rows[0] ? rowToEpisode(rows[0]) : null;
  }

  async upsertEpisode(episode: Episode): Promise<void> {
    await this.db!.execute(
      `INSERT INTO episode (id, media_id, season_number, episode_number, title, duration)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         duration = excluded.duration`,
      [episode.id, episode.mediaId, episode.seasonNumber, episode.episodeNumber, episode.title || null, episode.duration || null]
    );
  }

  async deleteEpisodesByMediaId(mediaId: string): Promise<void> {
    await this.db!.execute('DELETE FROM episode WHERE media_id = ?', [mediaId]);
  }

  async getSeasonsByMediaId(mediaId: string): Promise<number[]> {
    const rows = await this.db!.select<{ season_number: number }[]>(
      'SELECT DISTINCT season_number FROM episode WHERE media_id = ? ORDER BY season_number ASC',
      [mediaId]
    );
    return rows.map(row => row.season_number);
  }

  // —— PlaySource DAO ——
  async getPlaySourcesByEpisodeId(episodeId: string): Promise<PlaySource[]> {
    const rows = await this.db!.select<any[]>('SELECT * FROM play_source WHERE episode_id = ?', [episodeId]);
    return rows.map(rowToPlaySource);
  }

  async getPlaySourcesByMediaId(mediaId: string): Promise<PlaySource[]> {
    const rows = await this.db!.select<any[]>(
      `SELECT ps.* FROM play_source ps
       INNER JOIN episode e ON ps.episode_id = e.id
       WHERE e.media_id = ?`,
      [mediaId]
    );
    return rows.map(rowToPlaySource);
  }

  async upsertPlaySource(playSource: PlaySource): Promise<void> {
    await this.db!.execute(
      `INSERT INTO play_source (id, episode_id, source_id, source_name, url, quality)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         url = excluded.url,
         quality = excluded.quality`,
      [playSource.id, playSource.episodeId, playSource.sourceId, playSource.sourceName || null, playSource.url, playSource.quality || null]
    );
  }

  async deletePlaySourcesByMediaId(mediaId: string): Promise<void> {
    await this.db!.execute(
      `DELETE FROM play_source WHERE episode_id IN (SELECT id FROM episode WHERE media_id = ?)`,
      [mediaId]
    );
  }

  // —— VideoSource DAO ——
  async getAllVideoSources(): Promise<VideoSource[]> {
    const rows = await this.db!.select<any[]>('SELECT * FROM video_source ORDER BY priority DESC, id ASC');
    return rows.map(rowToVideoSource);
  }

  async getEnabledVideoSources(): Promise<VideoSource[]> {
    const rows = await this.db!.select<any[]>('SELECT * FROM video_source WHERE is_enabled = 1 ORDER BY priority DESC, id ASC');
    return rows.map(rowToVideoSource);
  }

  async getVideoSourceById(id: string): Promise<VideoSource | null> {
    const rows = await this.db!.select<any[]>('SELECT * FROM video_source WHERE id = ?', [id]);
    return rows[0] ? rowToVideoSource(rows[0]) : null;
  }

  async getVideoSourceByCode(code: string): Promise<VideoSource | null> {
    const rows = await this.db!.select<any[]>('SELECT * FROM video_source WHERE code = ?', [code]);
    return rows[0] ? rowToVideoSource(rows[0]) : null;
  }

  async upsertVideoSource(source: VideoSource): Promise<void> {
    await this.db!.execute(
      `INSERT INTO video_source (id, code, name, base_url, type, is_enabled, rate_limit, priority, health_status, last_check_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         name = excluded.name,
         base_url = excluded.base_url,
         type = excluded.type,
         is_enabled = excluded.is_enabled,
         rate_limit = excluded.rate_limit,
         priority = excluded.priority,
         health_status = excluded.health_status,
         last_check_at = excluded.last_check_at`,
      [source.id, source.code, source.name, source.baseUrl, source.type, source.isEnabled ? 1 : 0, source.rateLimit, source.priority, source.healthStatus || null, source.lastCheckAt || null]
    );
  }

  async deleteVideoSource(id: string): Promise<void> {
    await this.db!.execute('DELETE FROM video_source WHERE id = ?', [id]);
  }

  async setVideoSourceEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db!.execute('UPDATE video_source SET is_enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
  }

  async updateSourcePriority(id: string, priority: number): Promise<void> {
    await this.db!.execute('UPDATE video_source SET priority = ? WHERE id = ?', [priority, id]);
  }

  async updateSourceHealth(id: string, healthStatus: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db!.execute('UPDATE video_source SET health_status = ?, last_check_at = ? WHERE id = ?', [healthStatus, now, id]);
  }

  // —— Favorite DAO ——
  async getAllFavorites(): Promise<Favorite[]> {
    const rows = await this.db!.select<any[]>('SELECT * FROM favorite ORDER BY created_at DESC');
    return rows.map(rowToFavorite);
  }

  async isFavorite(mediaId: string): Promise<boolean> {
    const rows = await this.db!.select<{ count: number }[]>('SELECT COUNT(*) as count FROM favorite WHERE media_id = ?', [mediaId]);
    return (rows[0]?.count || 0) > 0;
  }

  async addFavorite(mediaId: string): Promise<void> {
    const now = new Date().toISOString();
    const id = `fav_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    await this.db!.execute('INSERT INTO favorite (id, media_id, created_at) VALUES (?, ?, ?)', [id, mediaId, now]);
  }

  async removeFavorite(mediaId: string): Promise<void> {
    await this.db!.execute('DELETE FROM favorite WHERE media_id = ?', [mediaId]);
  }

  async toggleFavorite(mediaId: string): Promise<boolean> {
    const isFav = await this.isFavorite(mediaId);
    if (isFav) {
      await this.removeFavorite(mediaId);
      return false;
    } else {
      await this.addFavorite(mediaId);
      return true;
    }
  }

  // —— WatchHistory DAO ——
  async getAllWatchHistory(page: number = 1, pageSize: number = 20): Promise<WatchHistory[]> {
    const offset = (page - 1) * pageSize;
    const rows = await this.db!.select<any[]>(
      'SELECT * FROM watch_history ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    );
    return rows.map(rowToWatchHistory);
  }

  async getWatchHistoryByMediaId(mediaId: string): Promise<WatchHistory | null> {
    const rows = await this.db!.select<any[]>(
      'SELECT * FROM watch_history WHERE media_id = ? ORDER BY updated_at DESC LIMIT 1',
      [mediaId]
    );
    return rows[0] ? rowToWatchHistory(rows[0]) : null;
  }

  async upsertWatchHistory(mediaId: string, episodeId: string | null, progress: number, duration: number): Promise<void> {
    const now = new Date().toISOString();
    const id = `wh_${mediaId}_${episodeId || 'movie'}`;
    await this.db!.execute(
      `INSERT INTO watch_history (id, media_id, episode_id, progress, duration, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         progress = excluded.progress,
         duration = excluded.duration,
         updated_at = excluded.updated_at`,
      [id, mediaId, episodeId, progress, duration, now]
    );
  }

  async clearWatchHistory(): Promise<void> {
    await this.db!.execute('DELETE FROM watch_history');
  }

  async deleteWatchHistory(mediaId: string): Promise<void> {
    await this.db!.execute('DELETE FROM watch_history WHERE media_id = ?', [mediaId]);
  }
}
