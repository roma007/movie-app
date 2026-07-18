import { CMSAdapter } from './cmsAdapter';
import { normalizer, DEFAULT_MIN_YEAR } from '../utils/normalizer';
import { mapType, isBlacklisted, refineTypeByEpisodes, isVersionTitle, needsShortDramaCheck } from '../utils/typeMapper';
import { SOURCE_ID_TO_NAME_MAP, PLAY_SOURCE_TYPE_MAP } from '../utils/constants';
import type { DatabaseProvider } from '../db/provider';
import type { CMSMediaItem, Media, Episode, PlaySource, CollectTask, TaskStatus, TaskErrorType, CollectionLog, CollectPreviewItem } from '../types';
import { SystemConfigService } from './systemConfigService';
import type { ShortDramaConfig } from './systemConfigService';
import { VideoDurationService } from './videoDurationService';

function generateId(): string {
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** 根据错误特征归类错误类型，用于前端按类型筛选/展示 */
function classifyError(err: unknown): TaskErrorType {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('cancel') || msg.includes('abort')) {
    return 'CANCELLED';
  }
  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('econnaborted') || msg.includes('超时')) {
    return 'TIMEOUT';
  }
  // 网络错误包括CORS、连接失败等
  if (msg.includes('network') || msg.includes('econnreset') || msg.includes('enotfound') || msg.includes('econnrefused')) {
    return 'NETWORK';
  }
  if (msg.includes('cors') || msg.includes('opaque') || msg.includes('blocked')) {
    return 'NETWORK';
  }
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network error')) {
    return 'NETWORK';
  }
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) {
    return 'NETWORK';
  }
  if (msg.includes('json') || msg.includes('parse') || msg.includes('syntax') || msg.includes('unexpected token')) {
    return 'PARSE';
  }
  if (msg.includes('sqlite') || msg.includes('constraint') || msg.includes('unique') || msg.includes('database')) {
    return 'DB';
  }
  return 'UNKNOWN';
}

function parsePlayInfo(
  vodPlayFrom: string,
  vodPlayUrl: string
): { sources: string[]; episodes: { title: string; url: string }[][] } {
  // CMS 标准格式：多个播放源用 $$$ 分隔，源内各集用 # 分隔，集标题与URL用 $ 分隔
  const sources = vodPlayFrom ? vodPlayFrom.split('$$$').map(s => s.trim()).filter(Boolean) : [];
  const urlGroups = vodPlayUrl ? vodPlayUrl.split('$$$').map(s => s.trim()).filter(Boolean) : [];

  const episodes: { title: string; url: string }[][] = [];

  for (const group of urlGroups) {
    const epList: { title: string; url: string }[] = [];
    const lines = group.split('#').filter(Boolean);
    for (const line of lines) {
      const idx = line.lastIndexOf('$');
      if (idx > 0) {
        const title = line.substring(0, idx).trim();
        const url = line.substring(idx + 1).trim();
        if (url) {
          epList.push({ title, url });
        }
      }
    }
    episodes.push(epList);
  }

  return { sources, episodes };
}

/**
 * 采集服务（共享核心逻辑）
 * 通过依赖注入接收 DatabaseProvider，与具体 SQLite 实现解耦。
 * 移动端注入 ExpoSqliteProvider，桌面端注入 TauriSqlProvider。
 */
export class CollectorService {
  private activeAbortControllers = new Map<string, AbortController>();
  private onLogCallback?: (log: CollectionLog) => void;

  constructor(private db: DatabaseProvider) {}

  setOnLogCallback(callback: (log: CollectionLog) => void): void {
    this.onLogCallback = callback;
  }

  private emitLog(level: 'info' | 'error' | 'warn', message: string, sourceCode?: string, sourceName?: string, taskId?: string): void {
    const log: CollectionLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      sourceCode,
      sourceName,
      taskId,
    };
    this.onLogCallback?.(log);
  }

  cancelTask(taskId: string): void {
    const controller = this.activeAbortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.activeAbortControllers.delete(taskId);
    }
  }

  private async processItem(
    item: CMSMediaItem,
    sourceId: string,
    _sourceName?: string,
    blacklistKeywords: string[] = [],
    minYear: number = DEFAULT_MIN_YEAR
  ): Promise<Media | null> {
    let mediaWritten = false;
    let currentMediaId: string | null = null;
    try {
      const typeName = item.type_name || item.vod_type || '';
      const remarks = item.vod_remarks || '';
      const vodPlayFrom = item.vod_play_from || '';
      const vodPlayUrl = item.vod_play_url || '';

      normalizer.setMinYear(minYear);
      const year = normalizer.normalizeYear(item.vod_year);
      if (!year) {
        return null;
      }

      const title = await normalizer.normalizeTitle(item.vod_name);
      if (!title) {
        return null;
      }

      const { sources, episodes: epGroups } = parsePlayInfo(vodPlayFrom, vodPlayUrl);

      const vodClass = item.vod_class || '';
      const vodTag = item.vod_tag || '';
      const typeNameGenres = typeName ? [typeName] : [];
      const vodClassGenres = vodClass.split(/[,，]/).filter(Boolean);
      const vodTagGenres = vodTag.split(/[,，]/).filter(Boolean);
      const rawGenres = [...new Set([...typeNameGenres, ...vodClassGenres, ...vodTagGenres])];
      const allGenreTexts = [...rawGenres, remarks, title];
      const isBlack = isBlacklisted(blacklistKeywords.length > 0 ? blacklistKeywords : undefined, ...allGenreTexts);
      if (isBlack) {
        return null;
      }

      let mediaType = mapType(typeName, remarks, vodPlayFrom, rawGenres);

      let firstGroupEps: { title: string; number: number }[] = [];
      if (epGroups.length > 0) {
        firstGroupEps = epGroups[0].map((ep, idx) => ({
          title: ep.title,
          number: idx + 1,
        }));
      }
      mediaType = refineTypeByEpisodes(firstGroupEps, mediaType, title);

      const seasonNumber = normalizer.extractSeasonNumber(title) || 1;
      const fingerprint = await normalizer.generateFingerprint(title, year, mediaType, seasonNumber);

      const existing = await this.db.getMediaByFingerprint(fingerprint);
      const mediaId = existing?.id || generateId();

      const genres = await normalizer.normalizeGenres(rawGenres, mediaType);
      const directors = await normalizer.normalizePersonList(item.vod_director);
      const actors = await normalizer.normalizePersonList(item.vod_actor);
      const area = await normalizer.normalizeArea(item.vod_area);
      const description = await normalizer.normalizeDescription(item.vod_content);

      let hidden = existing?.hidden ?? false;
      if (!existing && genres.length > 0) {
        const hiddenSubtype = await this.db.selectOne<{ sub_type: string }>(
          `SELECT json_extract(genre, '$[0]') as sub_type FROM media WHERE hidden = 1 AND json_extract(genre, '$[0]') = ? LIMIT 1`,
          [genres[0]]
        );
        if (hiddenSubtype) hidden = true;
      }

      let isShortDrama = false;
      let durationCheckStatus: 'SUMMARY' | 'PROBE' | 'FALLBACK' | null = null;
      let episodeDurationSec: number | null = null;

      if (needsShortDramaCheck(mediaType)) {
        // 如果已有确定性判断结果（SUMMARY 或 PROBE），保留不重新判断
        const existingStatus = existing?.durationCheckStatus;
        if (existingStatus === 'SUMMARY' || existingStatus === 'PROBE') {
          isShortDrama = existing?.isShortDrama ?? false;
          durationCheckStatus = existingStatus;
          episodeDurationSec = existing?.episodeDuration ?? null;
        } else {
          const configService = new SystemConfigService(this.db);
          const config = await configService.getShortDramaConfig();
          const result = await this.determineShortDrama(genres, description || '', title, epGroups, config);
          isShortDrama = result.isShortDrama;
          durationCheckStatus = result.status;
          episodeDurationSec = result.episodeDuration;
        }
      }

      let currentEpisodes: number | undefined;
      let totalEpisodes: number | undefined;
      if (mediaType !== 'MOVIE') {
        const maxEps = Math.max(...epGroups.map(g => g.length), 0);
        currentEpisodes = maxEps;
        const totalMatch = remarks.match(/共\s*(\d+)\s*集/) || remarks.match(/全\s*(\d+)\s*集/);
        if (totalMatch) {
          totalEpisodes = parseInt(totalMatch[1], 10);
        }
      }

      let status: Media['status'] = 'PUBLISHED';
      if (mediaType !== 'MOVIE' && remarks) {
        if (remarks.includes('更新') || remarks.includes('连载')) {
          status = 'ONGOING';
        } else if (remarks.includes('全') || remarks.includes('完') || remarks.includes('完结')) {
          status = 'COMPLETED';
        }
      }

      const media: Media = {
        id: mediaId,
        title,
        originalTitle: item.vod_name !== title ? item.vod_name : null,
        alias: null,
        type: mediaType,
        year,
        area,
        genres,
        directors,
        actors,
        description,
        posterUrl: item.vod_pic || null,
        backdropUrl: null,
        status,
        remarks: remarks || null,
        fingerprint,
        currentEpisodes,
        totalEpisodes,
        isShortDrama,
        durationCheckStatus,
        episodeDuration: episodeDurationSec,
        viewCount: existing?.viewCount || 0,
        hidden,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      currentMediaId = media.id;
      if (existing) {
        // 多源合并：状态取更"完结"的，集数取更大的
        const statusPriority: Record<string, number> = { COMPLETED: 3, ONGOING: 2, PUBLISHED: 1 };
        const bestStatus = (statusPriority[status] || 0) > (statusPriority[existing.status || ''] || 0) ? status : (existing.status || status);
        const bestEpisodes = Math.max(currentEpisodes || 0, existing.currentEpisodes || 0);
        const bestTotal = Math.max(totalEpisodes || 0, existing.totalEpisodes || 0);

        if (bestStatus !== existing.status || bestEpisodes !== existing.currentEpisodes || bestTotal !== existing.totalEpisodes) {
          await this.db.updateMediaStatusAndEpisodes(mediaId, bestStatus, bestEpisodes, bestTotal, new Date().toISOString());
        }
      } else {
        await this.db.upsertMedia(media);
      }
      mediaWritten = true;
      await this.db.deletePlaySourcesByMediaIdAndSourceId(mediaId, sourceId);

      const existingEpisodes = await this.db.getEpisodesByMediaId(mediaId);
      const episodeMap = new Map<string, Episode>();
      for (const ep of existingEpisodes) {
        const key = `s${ep.seasonNumber}_e${ep.episodeNumber}`;
        episodeMap.set(key, ep);
      }

      for (let sourceIdx = 0; sourceIdx < epGroups.length; sourceIdx++) {
        const sourceNameFromList = sources[sourceIdx] || `线路${sourceIdx + 1}`;
        const sourceDisplayName = SOURCE_ID_TO_NAME_MAP[sourceId] || '未知源';
        const mappedQuality = PLAY_SOURCE_TYPE_MAP[sourceNameFromList];
        const eps = epGroups[sourceIdx];

        for (let epIdx = 0; epIdx < eps.length; epIdx++) {
          const ep = eps[epIdx];
          const epNumber = epIdx + 1;
          const isVersion = isVersionTitle(ep.title) && mediaType === 'MOVIE';

          let episodeKey: string;
          if (isVersion) {
            episodeKey = `movie_${mediaId}`;
          } else {
            episodeKey = `s${seasonNumber}_e${epNumber}`;
          }

          let episode = episodeMap.get(episodeKey);
          if (!episode) {
            const episodeId = isVersion
              ? `ep_${mediaId}_movie`
              : `ep_${mediaId}_s${seasonNumber}_e${epNumber}`;

            episode = {
              id: episodeId,
              mediaId,
              seasonNumber,
              episodeNumber: isVersion ? 1 : epNumber,
              title: isVersion ? null : ep.title,
              duration: null,
            };

            await this.db.upsertEpisode(episode);
            episodeMap.set(episodeKey, episode);
          }

          const playSourceId = `ps_${episode.id}_${sourceId}_${sourceIdx}`;
          const playSource: PlaySource = {
            id: playSourceId,
            episodeId: episode.id,
            sourceId,
            sourceName: sourceDisplayName,
            url: ep.url,
            quality: isVersion ? ep.title : (mappedQuality || null),
          };

          await this.db.upsertPlaySource(playSource);
        }
      }

      return media;
    } catch (err) {
      console.error("[Collector] processItem 失败:", err instanceof Error ? err.message : String(err));
      if (mediaWritten && currentMediaId) {
        try {
          await this.db.deleteMediaCompletely(currentMediaId);
          console.log(`[Collector] 已清理部分写入的媒体: ${currentMediaId}`);
        } catch (cleanupErr) {
          console.error("[Collector] 清理失败媒体出错:", cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr));
        }
      }
      throw err;
    }
  }

  /**
   * 三级降级长短剧判断：
   * 第1级：从简介提取时长（extractDurationFromSummary）→ isShortDramaByDuration
   * 第2级：实际探测前N集视频时长（m3u8 #EXTINF 累加）→ isShortDramaByDuration
   * 第3级：元数据关键词兜底（isShortDramaByMeta），标记 FALLBACK
   */
  private async determineShortDrama(
    genres: string[],
    summary: string,
    title: string,
    epGroups: { title: string; url: string }[][],
    config: ShortDramaConfig
  ): Promise<{
    isShortDrama: boolean;
    status: 'SUMMARY' | 'PROBE' | 'FALLBACK';
    episodeDuration: number | null;
  }> {
    // 第1级：从简介提取时长
    const summaryDuration = normalizer.extractDurationFromSummary(summary, config.summaryPatterns);
    if (summaryDuration !== null) {
      console.log(`[长短剧判断] 第1级(简介)命中: ${summaryDuration}分钟 → ${normalizer.isShortDramaByDuration(summaryDuration, config.durationThresholdMinutes) ? '短剧' : '长剧'}`);
      return {
        isShortDrama: normalizer.isShortDramaByDuration(summaryDuration, config.durationThresholdMinutes),
        status: 'SUMMARY',
        episodeDuration: summaryDuration * 60,
      };
    }

    // 第2级：实际探测视频时长（逐集探测，成功1集即停）
    if (epGroups.length > 0) {
      const firstGroup = epGroups[0];
      const probeCount = Math.min(config.probeEpisodeCount, firstGroup.length);
      console.log(`[长短剧判断] 第1级未命中，尝试第2级(实际探测) 最多${probeCount}集`);

      const durationService = new VideoDurationService();
      for (let i = 0; i < probeCount; i++) {
        const probeLog = (msg: string) => this.logToDb(`[M3U8探测详情] "${title}" ${msg}`);
        const duration = await durationService.getDurationFromM3U8(firstGroup[i].url, probeLog);
        if (duration !== null) {
          const durationMin = duration / 60;
          console.log(`[长短剧判断] 第2级(探测)命中: 第${i + 1}集成功, ${durationMin.toFixed(1)}分钟 → ${normalizer.isShortDramaByDuration(durationMin, config.durationThresholdMinutes) ? '短剧' : '长剧'}`);
          return {
            isShortDrama: normalizer.isShortDramaByDuration(durationMin, config.durationThresholdMinutes),
            status: 'PROBE',
            episodeDuration: duration,
          };
        }
      }
      console.log(`[长短剧判断] 第2级(探测)失败: ${probeCount}集全部探测失败`);
    }

    // 第3级：元数据关键词兜底
    const isShort = normalizer.isShortDramaByMeta(genres, summary, title, config.metaKeywords);
    console.log(`[长短剧判断] 第3级(关键词兜底): ${isShort ? '短剧' : '长剧'}`);
    return {
      isShortDrama: isShort,
      status: 'FALLBACK',
      episodeDuration: null,
    };
  }

  async collectFromSource(
    sourceId: string,
    baseUrl: string,
    rateLimit: number,
    page: number = 1,
    pageSize: number = 20,
    signal?: AbortSignal
  ): Promise<{ media: Media[]; total: number; pagecount: number; failedCount: number; error?: string; errorType?: TaskErrorType }> {
    const configService = new SystemConfigService(this.db);
    const config = await configService.getCollectConfig();

    console.log(`[Collector] collectFromSource: sourceId=${sourceId}, baseUrl=${baseUrl}, rateLimit=${rateLimit}, page=${page}, pageSize=${pageSize}`);
    console.log(`[Collector] config: minYear=${config.minYear}, blacklistKeywords=${config.blacklistKeywords.length}, concurrency=${config.concurrency}`);

    const adapter = new CMSAdapter(baseUrl, rateLimit);
    console.log(`[Collector] CMSAdapter created, calling getList...`);

    let response;
    try {
      await this.db.incrementSourceRequestCount(sourceId);
      response = await adapter.getList(page, pageSize, signal);
      console.log(`[Collector] getList response: code=${response.code}, total=${response.total}, list.length=${response.list?.length || 0}`);
    } catch (err) {
      await this.db.incrementSourceFailCount(sourceId);
      const errInstance = err instanceof Error ? err : new Error(String(err));
      const errorMsg = `[Collector] getList failed: ${errInstance.message}`;
      const errorType = classifyError(err);
      console.error(`[Collector] getList 失败 (${errorType}):`, errorMsg);
      await this.logToDb(`${errorMsg} [类型: ${errorType}]`, 'error');
      
      let detailedError = errInstance.message;
      if (errInstance.message.includes('CORS') || errInstance.message.includes('opaque')) {
        detailedError = 'CORS错误 - 无法访问外部API。Tauri HTTP插件可能未正确加载。';
      } else if (errInstance.message.includes('Failed to fetch') || errInstance.message.includes('NetworkError')) {
        detailedError = '网络错误 - 无法连接到服务器。请检查网络连接。';
      } else if (errInstance.message.includes('timeout') || errInstance.message.includes('abort')) {
        detailedError = '请求超时 - 服务器响应时间过长。';
      }

      this.emitLog('error', detailedError);
      
      return { media: [], total: 0, pagecount: 0, failedCount: 0, error: detailedError, errorType };
    }

    const list = response.list || [];
    const results: Media[] = [];
    let failedCount = 0;

    if (config.concurrency > 1 && list.length > 0) {
      failedCount = await this.processItemsWithConcurrency(adapter, list, sourceId, config, results, signal);
    } else {
      for (const listItem of list) {
        try {
          console.log(`[Collector] Processing: ${listItem.vod_name} (vod_id=${listItem.vod_id})`);

          await this.db.incrementSourceRequestCount(sourceId);
          const detailResponse = await adapter.getDetail(String(listItem.vod_id), signal);
          console.log(`[Collector] Detail response: code=${detailResponse.code}, list.length=${detailResponse.list?.length || 0}`);

          if (!detailResponse.list || detailResponse.list.length === 0) {
            await this.db.incrementSourceFailCount(sourceId);
            console.warn(`[Collector] 获取详情失败: ${listItem.vod_name}`);
            failedCount++;
            continue;
          }

          const item = detailResponse.list[0];
          console.log(`[Collector] Detail item: vod_name=${item.vod_name}, vod_year=${item.vod_year}, type_name=${item.type_name}`);

          const media = await this.processItem(item, sourceId, '', config.blacklistKeywords, config.minYear);
          if (media) {
            console.log(`[Collector] Media created: ${media.title} (${media.year})`);
            results.push(media);
          } else {
            console.log(`[Collector] processItem returned null for: ${item.vod_name}`);
          }
        } catch (err) {
          await this.db.incrementSourceFailCount(sourceId);
          const errorMsg = `[Collector] 处理视频 ${listItem.vod_name} 失败: ${err instanceof Error ? err.message : String(err)}`;
          console.error(errorMsg);
          await this.logToDb(errorMsg, 'error');
          failedCount++;
        }
      }
    }

    console.log(`[Collector] collectFromSource completed: ${results.length} media collected, ${failedCount} failed, pagecount=${response.pagecount}`);

    return {
      media: results,
      total: response.total,
      pagecount: response.pagecount || 0,
      failedCount,
    };
  }

  private async processItemsWithConcurrency(
    adapter: CMSAdapter,
    items: any[],
    sourceId: string,
    config: { blacklistKeywords: string[]; minYear: number; concurrency: number },
    results: Media[],
    signal?: AbortSignal
  ): Promise<number> {
    let index = 0;
    let failedCount = 0;

    const worker = async () => {
      while (index < items.length) {
        const currentIndex = index++;
        const listItem = items[currentIndex];

        try {
          console.log(`[Collector] Processing (worker): ${listItem.vod_name} (vod_id=${listItem.vod_id})`);

          await this.db.incrementSourceRequestCount(sourceId);
          const detailResponse = await adapter.getDetail(String(listItem.vod_id), signal);

          if (!detailResponse.list || detailResponse.list.length === 0) {
            await this.db.incrementSourceFailCount(sourceId);
            console.warn(`[Collector] 获取详情失败: ${listItem.vod_name}`);
            failedCount++;
            continue;
          }

          const item = detailResponse.list[0];
          const media = await this.processItem(item, sourceId, '', config.blacklistKeywords, config.minYear);

          if (media) {
            console.log(`[Collector] Media created: ${media.title} (${media.year})`);
            results.push(media);
          }
        } catch (err) {
          await this.db.incrementSourceFailCount(sourceId);
          const errorMsg = `[Collector] 处理视频 ${listItem.vod_name} 失败: ${err instanceof Error ? err.message : String(err)}`;
          console.error(errorMsg);
          await this.logToDb(errorMsg, 'error');
          failedCount++;
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(config.concurrency, items.length) },
      () => worker()
    );

    await Promise.all(workers);
    return failedCount;
  }

  private async logToDb(message: string, level: 'info' | 'error' = 'info'): Promise<void> {
    try {
      const now = new Date().toISOString();
      await this.db.execute(
        'INSERT INTO system_config (key, value, value_type, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [`log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, message, 'string', level, now, now]
      );
    } catch (err) {
      console.error(`[logToDb] 日志写入失败: ${message}`, err);
    }
  }

  async collectByKeyword(keyword: string): Promise<Media[]> {
    const sources = await this.db.getEnabledVideoSources();
    const configService = new SystemConfigService(this.db);
    const config = await configService.getCollectConfig();

    const results: Media[] = [];
    const seenFingerprints = new Set<string>();

    for (const source of sources) {
      try {
        const adapter = new CMSAdapter(source.baseUrl, source.rateLimit);
        await this.db.incrementSourceRequestCount(source.id);
        const response = await adapter.search(keyword, 1);

        for (const listItem of response.list) {
          try {
            await this.db.incrementSourceRequestCount(source.id);
            const detailResponse = await adapter.getDetail(String(listItem.vod_id));
            if (!detailResponse.list || detailResponse.list.length === 0) {
              await this.db.incrementSourceFailCount(source.id);
              console.warn(`获取详情失败: ${listItem.vod_name}`);
              continue;
            }
            const item = detailResponse.list[0];
            const media = await this.processItem(item, source.id, source.name, config.blacklistKeywords, config.minYear);
            if (media && !seenFingerprints.has(media.fingerprint)) {
              seenFingerprints.add(media.fingerprint);
              results.push(media);
            }
          } catch (err) {
            await this.db.incrementSourceFailCount(source.id);
            console.error(`处理搜索结果失败:`, err);
          }
        }
      } catch (err) {
        await this.db.incrementSourceFailCount(source.id);
        console.error(`搜索源 ${source.name} 失败:`, err);
      }
    }

    return results;
  }

  async searchKeywordPreview(
    keyword: string,
    overrides?: { ignoreBlacklist?: boolean; unlimitedYear?: boolean }
  ): Promise<CollectPreviewItem[]> {
    const sources = await this.db.getEnabledVideoSources();
    const configService = new SystemConfigService(this.db);
    const config = await configService.getCollectConfig();

    const results: CollectPreviewItem[] = [];
    const seenFingerprints = new Set<string>();

    for (const source of sources) {
      try {
        const adapter = new CMSAdapter(source.baseUrl, source.rateLimit);
        await this.db.incrementSourceRequestCount(source.id);
        const response = await adapter.search(keyword, 1);

        for (const listItem of response.list) {
          try {
            await this.db.incrementSourceRequestCount(source.id);
            const detailResponse = await adapter.getDetail(String(listItem.vod_id));
            if (!detailResponse.list || detailResponse.list.length === 0) {
              await this.db.incrementSourceFailCount(source.id);
              continue;
            }
            const item = detailResponse.list[0];

            const effectiveMinYear = overrides?.unlimitedYear ? 0 : config.minYear;
            normalizer.setMinYear(effectiveMinYear);
            const year = normalizer.normalizeYear(item.vod_year);
            if (!year) continue;

            const title = await normalizer.normalizeTitle(item.vod_name);
            if (!title) continue;

            const typeName = item.type_name || item.vod_type || '';
            const remarks = item.vod_remarks || '';
            const vodClass = item.vod_class || '';
            const rawGenres = [...new Set([typeName, ...vodClass.split(/[,，]/).filter(Boolean)])];
            if (!overrides?.ignoreBlacklist) {
              const allGenreTexts = [...rawGenres, remarks, title];
              if (isBlacklisted(config.blacklistKeywords.length > 0 ? config.blacklistKeywords : undefined, ...allGenreTexts)) continue;
            }

            const mediaType = mapType(typeName, remarks, item.vod_play_from || '', rawGenres);
            const seasonNumber = normalizer.extractSeasonNumber(title) || 1;
            const fingerprint = await normalizer.generateFingerprint(title, year, mediaType, seasonNumber);

            if (seenFingerprints.has(fingerprint)) continue;
            seenFingerprints.add(fingerprint);

            results.push({
              fingerprint,
              title,
              year,
              type: mediaType,
              posterUrl: item.vod_pic || '',
              area: item.vod_area || '',
              directors: item.vod_director ? item.vod_director.split(/[,，]/).filter(Boolean) : [],
              actors: item.vod_actor ? item.vod_actor.split(/[,，]/).filter(Boolean) : [],
              sourceName: source.name,
              sourceId: source.id,
              rawItem: item,
            });
          } catch (err) {
            await this.db.incrementSourceFailCount(source.id);
          }
        }
      } catch (err) {
        await this.db.incrementSourceFailCount(source.id);
      }
    }

    return results;
  }

  async savePreviewItems(
    items: CollectPreviewItem[],
    overrides?: { ignoreBlacklist?: boolean; unlimitedYear?: boolean }
  ): Promise<number> {
    const configService = new SystemConfigService(this.db);
    const config = await configService.getCollectConfig();
    let saved = 0;

    const effectiveMinYear = overrides?.unlimitedYear ? 0 : config.minYear;
    const effectiveBlacklist = overrides?.ignoreBlacklist ? [] : config.blacklistKeywords;

    for (const item of items) {
      try {
        const media = await this.processItem(item.rawItem, item.sourceId, item.sourceName, effectiveBlacklist, effectiveMinYear);
        if (media) saved++;
      } catch (err) {
        console.error(`保存预览项失败: ${item.title}`, err);
      }
    }

    return saved;
  }

  async collectLatest(page: number = 1, pageSize: number = 20): Promise<Media[]> {
    const sources = await this.db.getEnabledVideoSources();
    const configService = new SystemConfigService(this.db);
    const config = await configService.getCollectConfig();
    
    console.log(`[Collector] collectLatest: ${sources.length} sources, config.minYear=${config.minYear}, config.maxPages=${config.maxPages}`);
    
    const results: Media[] = [];
    const seenFingerprints = new Set<string>();

    for (const source of sources) {
      try {
        let currentPage = page;
        let hasMore = true;
        let totalPages = config.maxPages;

        while (hasMore && currentPage <= totalPages) {
          console.log(`[Collector] Processing source ${source.name} page ${currentPage}/${totalPages}`);
          const { media, pagecount } = await this.collectFromSource(source.id, source.baseUrl, source.rateLimit, currentPage, pageSize);
          
          for (const m of media) {
            if (!seenFingerprints.has(m.fingerprint)) {
              seenFingerprints.add(m.fingerprint);
              results.push(m);
            }
          }

          hasMore = currentPage < pagecount && currentPage < totalPages;
          currentPage++;
        }
      } catch (err) {
        console.error(`采集源 ${source.name} 失败:`, err);
      }
    }

    console.log(`[Collector] collectLatest completed: ${results.length} unique media collected`);
    return results;
  }

  async collectAll(pageSize: number = 20): Promise<{ totalCollected: number; totalPages: number }> {
    const configService = new SystemConfigService(this.db);
    const config = await configService.getCollectConfig();
    const sources = await this.db.getEnabledVideoSources();

    let totalCollected = 0;
    let totalPages = 0;

    for (const source of sources) {
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= config.maxPages) {
        try {
          const { media, pagecount } = await this.collectFromSource(source.id, source.baseUrl, source.rateLimit, page, pageSize);
          totalCollected += media.length;
          totalPages += 1;

          hasMore = page < pagecount;
          page++;
        } catch (err) {
          console.error(`全量采集源 ${source.name} 第${page}页失败:`, err);
          break;
        }
      }
    }

    return { totalCollected, totalPages };
  }

  async getMediaDetailFromSource(
    sourceId: string,
    baseUrl: string,
    rateLimit: number,
    vodId: string
  ): Promise<Media | null> {
    const adapter = new CMSAdapter(baseUrl, rateLimit);
    const response = await adapter.getDetail(vodId);

    if (response.list.length === 0) return null;

    const item = response.list[0];
    return this.processItem(item, sourceId, '');
  }

  async checkSource(sourceId: string): Promise<{ healthy: boolean; responseTime: number }> {
    const source = await this.db.getVideoSourceById(sourceId);
    if (!source) return { healthy: false, responseTime: 0 };

    const adapter = new CMSAdapter(source.baseUrl, source.rateLimit);
    const startTime = Date.now();

    try {
      await adapter.getTypes();
      const responseTime = Date.now() - startTime;

      const avgResponseTime = source.avgResponseTime
        ? Math.round((source.avgResponseTime + responseTime) / 2)
        : responseTime;

      await this.db.updateSourceHealth(sourceId, {
        healthStatus: 'HEALTHY',
        lastCheckAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
        failCount: 0,
        avgResponseTime,
      });

      return { healthy: true, responseTime };
    } catch {
      await this.db.updateSourceHealth(sourceId, {
        healthStatus: 'DOWN',
        lastCheckAt: new Date().toISOString(),
        failCount: (source.failCount || 0) + 1,
      });
      return { healthy: false, responseTime: Date.now() - startTime };
    }
  }

  async collectSourceLatest(sourceCode: string, startPage: number = 1): Promise<{ taskId: string; collected: number }> {
    const source = await this.db.getVideoSourceByCode(sourceCode);
    if (!source || !source.isEnabled) return { taskId: '', collected: 0 };

    const runningTasks = await this.db.getRunningTasksBySourceCode(sourceCode);
    if (runningTasks.some(t => t.type === 'INCREMENTAL' && (t.status === 'RUNNING' || t.status === 'PENDING'))) {
      throw new Error('该视频源已有增量采集任务正在运行，请等待完成后再启动');
    }

    const taskId = `${sourceCode}-INCREMENTAL-${Date.now()}`;
    const now = new Date().toISOString();
    const config = await (new SystemConfigService(this.db)).getCollectConfig();

    const task: CollectTask = {
      id: generateId(),
      taskId,
      sourceCode: source.code,
      sourceName: source.name,
      type: 'INCREMENTAL',
      status: 'PENDING',
      currentPage: startPage - 1,
      totalPages: config.incrementalMaxPages,
      collectedCount: 0,
      failedCount: 0,
      createdAt: now,
    };

    await this.db.createCollectTask(task);

    let collected = 0;
    let failed = 0;
    let page = startPage;
    let cancelled = false;
    let lastErrorMsg: string | null = null;
    let lastErrorType: TaskErrorType = 'UNKNOWN';
    let totalRuntimeMs = 0;
    const controller = new AbortController();
    this.activeAbortControllers.set(taskId, controller);

    try {
      await this.db.updateCollectTask(taskId, { status: 'RUNNING' as TaskStatus, startedAt: now, currentPage: startPage });
      this.emitLog('info', `开始增量采集 [${source.name}]，最多${config.incrementalMaxPages}页`, sourceCode, source.name, taskId);

      while (page <= config.incrementalMaxPages) {
        const iterationStart = Date.now();

        const existing = await this.db.getCollectTaskById(taskId);
        if (!existing) {
          cancelled = true;
          break;
        }

        try {
          const result = await this.collectFromSource(source.id, source.baseUrl, source.rateLimit, page, 20, controller.signal);

          if (result.error) {
            throw new Error(result.error);
          }

          const { media, pagecount, failedCount } = result;
          collected += media.length;
          failed += failedCount;
          await this.db.updateCollectTask(taskId, {
            currentPage: page,
            totalPages: config.incrementalMaxPages,
            collectedCount: collected,
            failedCount: failed,
          });

          this.emitLog('info', `第${page}页完成: 新增${media.length}条${failedCount > 0 ? `，失败${failedCount}条` : ''}`, sourceCode, source.name, taskId);

          if (page >= pagecount) break;
          totalRuntimeMs += Date.now() - iterationStart;
          page++;
        } catch (err) {
          totalRuntimeMs += Date.now() - iterationStart;
          const errType = classifyError(err);
          const errMsg = `[Collector] 增量采集第${page}页失败: ${err instanceof Error ? err.message : String(err)}`;
          console.error(errMsg);
          await this.logToDb(errMsg, 'error');
          this.emitLog('error', `第${page}页失败: ${err instanceof Error ? err.message : String(err)}`, sourceCode, source.name, taskId);
          lastErrorMsg = errMsg;
          lastErrorType = errType;
          failed++;
          await this.db.updateCollectTask(taskId, {
            currentPage: page,
            failedCount: failed,
            errorMessage: errMsg.slice(0, 500),
            errorType: errType,
            lastErrorPage: page,
          });

          page++;
        }
      }

      if (!cancelled) {
        await this.db.updateCollectTask(taskId, {
          status: 'COMPLETED' as TaskStatus,
          completedAt: new Date().toISOString(),
        });
        this.emitLog('info', `增量采集完成 [${source.name}]: 共采集${collected}条，失败${failed}条`, sourceCode, source.name, taskId);
      }

      this.activeAbortControllers.delete(taskId);
      return { taskId, collected };
    } catch (err) {
      this.activeAbortControllers.delete(taskId);
      const errType = (err as any).errorType || classifyError(err);
      const finalErrMsg = err instanceof Error ? err.message : String(err);
      await this.db.updateCollectTask(taskId, {
        status: 'FAILED' as TaskStatus,
        currentPage: page,
        errorMessage: finalErrMsg.slice(0, 500),
        errorType: errType,
        lastErrorPage: page,
        completedAt: new Date().toISOString(),
      });
      this.emitLog('error', `增量采集失败 [${source.name}]: ${finalErrMsg}`, sourceCode, source.name, taskId);
      throw err;
    }
  }

  async collectSourceAll(sourceCode: string, startPage: number = 1): Promise<{ taskId: string; collected: number; pages: number }> {
    const source = await this.db.getVideoSourceByCode(sourceCode);
    if (!source || !source.isEnabled) return { taskId: '', collected: 0, pages: 0 };

    const runningTasks = await this.db.getRunningTasksBySourceCode(sourceCode);
    if (runningTasks.some(t => t.type === 'FULL' && (t.status === 'RUNNING' || t.status === 'PENDING'))) {
      throw new Error('该视频源已有全量采集任务正在运行，请等待完成后再启动');
    }

    const taskId = `${sourceCode}-FULL-${Date.now()}`;
    const now = new Date().toISOString();
    const config = await (new SystemConfigService(this.db)).getCollectConfig();
    const startedAtMs = Date.now();

    const task: CollectTask = {
      id: generateId(),
      taskId,
      sourceCode: source.code,
      sourceName: source.name,
      type: 'FULL',
      status: 'PENDING',
      currentPage: startPage - 1,
      totalPages: config.maxPages,
      collectedCount: 0,
      failedCount: 0,
      createdAt: now,
    };

    await this.db.createCollectTask(task);

    let collected = 0;
    let failed = 0;
    let pages = 0;
    let page = startPage;
    let cancelled = false;
    let lastErrorMsg: string | null = null;
    let lastErrorType: TaskErrorType = 'UNKNOWN';
    let totalRuntimeMs = 0;
    const controller = new AbortController();
    this.activeAbortControllers.set(taskId, controller);

    try {
      await this.db.updateCollectTask(taskId, { status: 'RUNNING' as TaskStatus, startedAt: now });
      this.emitLog('info', `开始全量采集 [${source.name}]，最多${config.maxPages}页`, sourceCode, source.name, taskId);

      while (page <= config.maxPages) {
        const iterationStart = Date.now();

        const existing = await this.db.getCollectTaskById(taskId);
        if (!existing) {
          cancelled = true;
          break;
        }

        try {
          const result = await this.collectFromSource(source.id, source.baseUrl, source.rateLimit, page, 20, controller.signal);

          if (result.error) {
            throw new Error(result.error);
          }

          const { media, pagecount, failedCount } = result;
          collected += media.length;
          failed += failedCount;
          pages++;

          await this.db.updateCollectTask(taskId, {
            currentPage: page,
            totalPages: Math.min(pagecount, config.maxPages),
            collectedCount: collected,
            failedCount: failed,
          });

          this.emitLog('info', `第${page}页完成: 新增${media.length}条${failedCount > 0 ? `，失败${failedCount}条` : ''}`, sourceCode, source.name, taskId);

          if (page >= pagecount) break;
          totalRuntimeMs += Date.now() - iterationStart;
          page++;
        } catch (err) {
          totalRuntimeMs += Date.now() - iterationStart;
          const errType = classifyError(err);
          const errMsg = `[Collector] 全量采集第${page}页失败: ${err instanceof Error ? err.message : String(err)}`;
          console.error(errMsg);
          await this.logToDb(errMsg, 'error');
          this.emitLog('error', `第${page}页失败: ${err instanceof Error ? err.message : String(err)}`, sourceCode, source.name, taskId);
          lastErrorMsg = errMsg;
          lastErrorType = errType;
          failed++;
          await this.db.updateCollectTask(taskId, {
            currentPage: page,
            failedCount: failed,
            errorMessage: errMsg.slice(0, 500),
            errorType: errType,
            lastErrorPage: page,
          });

          page++;
        }
      }

      if (!cancelled) {
        await this.db.updateCollectTask(taskId, {
          status: 'COMPLETED' as TaskStatus,
          completedAt: new Date().toISOString(),
        });
        this.emitLog('info', `全量采集完成 [${source.name}]: 共采集${collected}条，失败${failed}条`, sourceCode, source.name, taskId);
      }

      this.activeAbortControllers.delete(taskId);
      return { taskId, collected, pages };
    } catch (err) {
      this.activeAbortControllers.delete(taskId);
      const errType = (err as any).errorType || classifyError(err);
      const finalErrMsg = err instanceof Error ? err.message : String(err);
      await this.db.updateCollectTask(taskId, {
        status: 'FAILED' as TaskStatus,
        currentPage: page,
        errorMessage: finalErrMsg.slice(0, 500),
        errorType: errType,
        lastErrorPage: page,
        completedAt: new Date().toISOString(),
      });
      this.emitLog('error', `全量采集失败 [${source.name}]: ${finalErrMsg}`, sourceCode, source.name, taskId);
      throw err;
    }
  }

  /**
   * 重试兜底判断的长短剧记录。
   * 查询 duration_check_status = 'FALLBACK' 且已到重试时间的媒体，
   * 重新探测实际视频时长，成功则更新为 PROBE 状态，失败则推迟下一次重试。
   */
  private async updateMediaDurationStatus(
    mediaId: string,
    isShortDrama: boolean,
    status: 'SUMMARY' | 'PROBE' | 'FALLBACK',
    episodeDuration: number | null
  ): Promise<void> {
    await this.db.execute(
      `UPDATE media SET is_short_drama = ?, duration_check_status = ?, episode_duration = ?, updated_at = ? WHERE id = ?`,
      [isShortDrama ? 1 : 0, status, episodeDuration, new Date().toISOString(), mediaId]
    );
  }

  /**
   * 批量重检历史电视剧的长短剧判断。
   * 查询所有 type='TV' 且 duration_check_status 为 NULL（旧数据）或 FALLBACK 的媒体，
   * 用新的三级降级逻辑重新判断并更新。
   */
  /**
   * 将数据库中现存的漫剧（含AI漫剧）从 TV 类型迁移到 MOVIE 类型。
   * 匹配逻辑：genre 字段包含 '漫剧' 或 title 包含 '漫剧'，且当前 type 为 'TV'。
   */
  async migrateAiDramaToMovie(): Promise<{ migrated: number }> {
    const now = new Date().toISOString();
    const likeCondition = '%漫剧%';
    await this.db.execute(
      `UPDATE media SET type = 'MOVIE', updated_at = ? WHERE type = 'TV' AND (genre LIKE ? OR title LIKE ?)`,
      [now, likeCondition, likeCondition]
    );
    const result = await this.db.selectOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM media WHERE type = 'MOVIE' AND updated_at = ? AND (genre LIKE ? OR title LIKE ?)`,
      [now, likeCondition, likeCondition]
    );
    return { migrated: result?.count || 0 };
  }

  /**
   * 按 genre 关键词批量删除视频（含关联的剧集和播放源）。
   * keywords: genre 关键词列表，视频的 genre JSON 中包含任一关键词即匹配删除。
   */
  async deleteMediaByGenres(keywords: string[]): Promise<{ deleted: number }> {
    if (keywords.length === 0) return { deleted: 0 };

    const conditions: string[] = [];
    const params: any[] = [];
    for (const kw of keywords) {
      conditions.push('genre LIKE ?');
      params.push(`%${kw}%`);
    }

    const mediaList = await this.db.select<{ id: string }>(
      `SELECT id FROM media WHERE ${conditions.join(' OR ')}`,
      params
    );
    for (const media of mediaList) {
      await this.db.deleteMediaCompletely(media.id);
    }
    return { deleted: mediaList.length };
  }

  /**
   * 获取需要重新探测的媒体数量。
   * 查询 type='TV' 且 duration_check_status 为 FALLBACK 或 NULL 的媒体。
   */
  async getReprobeMediaCount(): Promise<number> {
    const result = await this.db.selectOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM media WHERE type = 'TV' AND (duration_check_status = 'FALLBACK' OR duration_check_status IS NULL)`,
      []
    );
    return result?.count || 0;
  }

  /**
   * 获取需要重新探测的媒体清单。
   */
  async getReprobeMediaList(): Promise<{ id: string; title: string }[]> {
    return this.db.select<{ id: string; title: string }>(
      `SELECT id, title FROM media WHERE type = 'TV' AND (duration_check_status = 'FALLBACK' OR duration_check_status IS NULL) ORDER BY title`,
      []
    );
  }

  /**
   * 批量重新探测媒体的长短剧判断。
   * @param allMedia 为 true 时查询所有 TV 媒体（全量），否则仅查询 FALLBACK 或 NULL 的（批量）
   * 如果 episode_duration 已有值且 > 0，直接使用，跳过 M3U8 探测。
   */
  async batchReprobeMedia(
    onProgress: (progress: {
      total: number;
      processed: number;
      longDrama: number;
      shortDrama: number;
      failed: number;
      currentMediaTitle: string;
    }) => void,
    taskId?: string,
    abortSignal?: AbortSignal,
    allMedia?: boolean
  ): Promise<{
    total: number;
    longDrama: number;
    shortDrama: number;
    failed: number;
    failedItems: { id: string; title: string }[];
  }> {
    const configService = new SystemConfigService(this.db);
    const config = await configService.getShortDramaConfig();

    const whereClause = allMedia
      ? `type = 'TV'`
      : `type = 'TV' AND (duration_check_status = 'FALLBACK' OR duration_check_status IS NULL)`;

    const mediaList = await this.db.select<{
      id: string;
      title: string;
      episode_duration: number | null;
    }>(
      `SELECT id, title, episode_duration FROM media WHERE ${whereClause}`,
      []
    );

    console.log(`[批量重新探测] mediaList 查询结果: ${JSON.stringify(mediaList.map(m => ({ title: m.title, episode_duration: m.episode_duration })))}`);
    const total = mediaList.length;
    let processed = 0;
    let longDrama = 0;
    let shortDrama = 0;
    let failed = 0;
    const failedItems: { id: string; title: string }[] = [];

    const durationService = new VideoDurationService();

    console.log(`[批量重新探测] 开始批量重新探测，共 ${total} 部媒体`);
    await this.logToDb(`[M3U8探测详情] 开始批量重新探测，共 ${total} 部媒体`);

    for (const media of mediaList) {
      console.log(`[批量重新探测] 处理: ${media.title}, episode_duration=${media.episode_duration}`);
      console.log(`[批量重新探测] DB 连接状态: ${this.db ? '存在' : '不存在'}`);
      if (abortSignal?.aborted) {
        console.log(`[批量重新探测] 任务被取消`);
        break;
      }

      const mediaStart = Date.now();
      onProgress({
        total,
        processed,
        longDrama,
        shortDrama,
        failed,
        currentMediaTitle: media.title,
      });

      try {
        // 如果 episode_duration 已有值且 > 0，直接使用
        if (media.episode_duration && media.episode_duration > 0) {
          console.log(`[批量重新探测] "${media.title}" episode_duration=${media.episode_duration} > 0，复用已有时长`);
          const avgDurationMin = media.episode_duration / 60;
          const isShortDrama = normalizer.isShortDramaByDuration(avgDurationMin, config.durationThresholdMinutes);
          await this.updateMediaDurationStatus(media.id, isShortDrama, 'PROBE', media.episode_duration);
          if (isShortDrama) {
            shortDrama++;
          } else {
            longDrama++;
          }
          console.log(`[批量重新探测] "${media.title}" → ${isShortDrama ? '短剧' : '长剧'} (复用已有时长${avgDurationMin.toFixed(1)}分钟, ${Date.now() - mediaStart}ms)`);
          processed++;
          if (taskId) {
            try {
              await this.db.updateReprobeTaskProgress(taskId, { probedCount: processed, shortDramaCount: shortDrama, longDramaCount: longDrama });
            } catch (err) {
              console.error(`[批量重新探测] 更新任务进度失败:`, err);
            }
          }
          continue;
        }

        // 无 episode_duration，需要探测（逐集探测，成功1集即停）
        console.log(`[批量重新探测] "${media.title}" 无 episode_duration，开始查询剧集`);
        const episodes = await this.db.getEpisodesByMediaId(media.id);
        console.log(`[批量重新探测] "${media.title}" 查到 ${episodes.length} 集`);
        if (episodes.length === 0) {
          console.log(`[批量重新探测] "${media.title}" 无剧集数据，跳过`);
          await this.logToDb(`[M3U8探测详情] "${media.title}" 无剧集数据，跳过`);
          failedItems.push({ id: media.id, title: media.title });
          failed++;
          processed++;
          continue;
        }

        const probeEpisodeCount = Math.min(config.probeEpisodeCount, episodes.length);
        console.log(`[批量重新探测] "${media.title}" 将探测 ${probeEpisodeCount} 集`);
        let totalSourcesTried = 0;
        let successDuration: number | null = null;

        for (let i = 0; i < probeEpisodeCount; i++) {
          if (abortSignal?.aborted) {
            console.log(`[批量重新探测] 任务被取消`);
            break;
          }

          console.log(`[批量重新探测] "${media.title}" 正在查询第 ${i + 1} 集的播放源`);
          const sources = await this.db.getPlaySourcesByEpisodeId(episodes[i].id);
          console.log(`[批量重新探测] "${media.title}" 第 ${i + 1} 集有 ${sources.length} 个播放源`);
          if (sources.length === 0) {
            console.log(`[批量重新探测] "${media.title}" 第${i + 1}集 无播放源`);
            await this.logToDb(`[M3U8探测详情] "${media.title}" 第${i + 1}集 无播放源`);
            continue;
          }

          console.log(`[批量重新探测] "${media.title}" 第${i + 1}集 共${sources.length}个播放源`);
          await this.logToDb(`[M3U8探测详情] "${media.title}" 第${i + 1}集 共${sources.length}个播放源`);

          for (const source of sources) {
            totalSourcesTried++;
            console.log(`[批量重新探测] "${media.title}" 尝试探测源: ${source.url.substring(0, 50)}...`);
            const probeLog = (msg: string) => {
              console.log(`[批量重新探测] "${media.title}" 探测日志: ${msg}`);
              return this.logToDb(`[M3U8探测详情] "${media.title}" ${msg}`);
            };
            const result = await durationService.getDurationFromM3U8(source.url, probeLog);
            console.log(`[批量重新探测] "${media.title}" 探测结果: ${result}`);
            if (result !== null) {
              successDuration = result;
              break;
            }
          }

          if (successDuration !== null) break;
        }

        if (abortSignal?.aborted) {
          console.log(`[批量重新探测] 任务被取消`);
          break;
        }

        if (successDuration !== null) {
          const durationMin = successDuration / 60;
          const isShortDrama = normalizer.isShortDramaByDuration(durationMin, config.durationThresholdMinutes);

          await this.updateMediaDurationStatus(media.id, isShortDrama, 'PROBE', successDuration);
          await this.logToDb(`[M3U8探测详情] "${media.title}" → ${isShortDrama ? '短剧' : '长剧'} (${durationMin.toFixed(1)}分钟, ${Date.now() - mediaStart}ms)`);

          if (isShortDrama) {
            shortDrama++;
            console.log(`[批量重新探测] "${media.title}" → 短剧 (PROBE, ${durationMin.toFixed(1)}分钟, 尝试${totalSourcesTried}个源, ${Date.now() - mediaStart}ms)`);
          } else {
            longDrama++;
            console.log(`[批量重新探测] "${media.title}" → 长剧 (PROBE, ${durationMin.toFixed(1)}分钟, 尝试${totalSourcesTried}个源, ${Date.now() - mediaStart}ms)`);
          }
        } else {
          await this.logToDb(`[M3U8探测详情] "${media.title}" 全部失败 (${probeEpisodeCount}集, ${totalSourcesTried}个源, ${Date.now() - mediaStart}ms)`, 'error');
          console.log(`[批量重新探测] "${media.title}" 探测失败 (${probeEpisodeCount}集全部失败, 尝试${totalSourcesTried}个源, ${Date.now() - mediaStart}ms)，保持原状态`);
          failedItems.push({ id: media.id, title: media.title });
          failed++;
        }
      } catch (error) {
        console.error(`[批量重新探测] "${media.title}" 探测异常 (${Date.now() - mediaStart}ms):`, error);
        failedItems.push({ id: media.id, title: media.title });
        failed++;
      }

      processed++;

      if (taskId) {
        try {
          await this.db.updateReprobeTaskProgress(taskId, {
            probedCount: processed,
            shortDramaCount: shortDrama,
            longDramaCount: longDrama,
          });
        } catch (err) {
          console.error(`[批量重新探测] 更新任务进度失败:`, err);
        }
      }
    }

    console.log(`[批量重新探测] 完成: 总计 ${total}, 短剧 ${shortDrama}, 长剧 ${longDrama}, 失败 ${failed}`);

    onProgress({
      total,
      processed,
      longDrama,
      shortDrama,
      failed,
      currentMediaTitle: '',
    });

    return {
      total,
      longDrama,
      shortDrama,
      failed,
      failedItems,
    };
  }

  /**
   * 获取所有电视剧数量（用于全量重新探测）。
   */
  async getFullReprobeMediaCount(): Promise<number> {
    const result = await this.db.selectOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM media WHERE type = 'TV'`,
      []
    );
    return result?.count || 0;
  }

  /**
   * 全量重新探测：清除所有电视剧的判断结果，保留已有的 episode_duration。
   * 然后调用 batchReprobeMedia 重新探测所有电视剧。
   */
  async fullReprobeAllMedia(
    onProgress: (progress: {
      total: number;
      processed: number;
      longDrama: number;
      shortDrama: number;
      failed: number;
      currentMediaTitle: string;
    }) => void,
    taskId?: string,
    abortSignal?: AbortSignal
  ): Promise<{
    total: number;
    longDrama: number;
    shortDrama: number;
    failed: number;
    failedItems: { id: string; title: string }[];
  }> {
    const now = new Date().toISOString();
    // 重置所有电视剧的判断结果
    // episode_duration 已有值且 > 0 的保留，否则重置为 NULL
    await this.db.execute(
      `UPDATE media SET is_short_drama = 0, duration_check_status = NULL,
       episode_duration = CASE WHEN episode_duration IS NOT NULL AND episode_duration > 0 THEN episode_duration ELSE NULL END,
       updated_at = ? WHERE type = 'TV'`,
      [now]
    );
    console.log(`[全量重新探测] 已重置所有电视剧的判断结果`);

    // 调用 batchReprobeMedia，allMedia=true 查询所有 TV
    return this.batchReprobeMedia(onProgress, taskId, abortSignal, true);
  }

  /**
   * 启动批量重新探测任务（仅 FALLBACK/NULL 状态）。
   */
  async startReprobeTask(): Promise<string> {
    return this.startReprobeTaskInternal('批量重新探测', false);
  }

  /**
   * 启动全量重新探测任务（所有电视剧）。
   */
  async startFullReprobeTask(): Promise<string> {
    return this.startReprobeTaskInternal('全量重新探测', true);
  }

  private async startReprobeTaskInternal(sourceName: string, fullReprobe: boolean): Promise<string> {
    const runningTask = await this.db.getRunningReprobeTask();
    if (runningTask) {
      throw new Error('已有运行中的探测任务，请等待完成或取消后再试');
    }

    const taskId = `reprobe_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const now = new Date().toISOString();

    const task: CollectTask = {
      id: generateId(),
      taskId,
      sourceCode: 'REPROBE',
      sourceName,
      type: 'REPROBE',
      status: 'PENDING',
      currentPage: 0,
      totalPages: 0,
      collectedCount: 0,
      failedCount: 0,
      probedCount: 0,
      shortDramaCount: 0,
      longDramaCount: 0,
      createdAt: now,
    };

    await this.db.createReprobeTask(task);

    const abortController = new AbortController();
    this.activeAbortControllers.set(taskId, abortController);

    this.runReprobeTask(taskId, abortController.signal, fullReprobe).catch(err => {
      console.error(`[重新探测] 任务执行异常:`, err);
    });

    return taskId;
  }

  /**
   * 执行探测任务的内部方法。
   */
  private async runReprobeTask(taskId: string, abortSignal: AbortSignal, fullReprobe: boolean = false): Promise<void> {
    try {
      await this.db.updateReprobeTaskProgress(taskId, { status: 'RUNNING' });
      await this.db.updateCollectTask(taskId, {
        startedAt: new Date().toISOString(),
      });

      const result = fullReprobe
        ? await this.fullReprobeAllMedia(
            () => {},
            taskId,
            abortSignal
          )
        : await this.batchReprobeMedia(
            () => {},
            taskId,
            abortSignal
          );

      // 检查是否被取消
      if (abortSignal.aborted) {
        await this.db.updateReprobeTaskProgress(taskId, { status: 'FAILED' });
        await this.db.updateCollectTask(taskId, {
          errorMessage: '用户已取消',
          errorType: 'CANCELLED',
          completedAt: new Date().toISOString(),
        });
      } else {
        // 任务完成
        await this.db.updateReprobeTaskProgress(taskId, {
          status: 'COMPLETED',
          probedCount: result.total,
          shortDramaCount: result.shortDrama,
          longDramaCount: result.longDrama,
        });
        await this.db.updateCollectTask(taskId, {
          completedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error(`[批量重新探测] 任务执行失败:`, error);
      await this.db.updateReprobeTaskProgress(taskId, { status: 'FAILED' });
      await this.db.updateCollectTask(taskId, {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorType: classifyError(error),
        completedAt: new Date().toISOString(),
      });
    } finally {
      this.activeAbortControllers.delete(taskId);
    }
  }

  /**
   * 取消正在运行的探测任务。
   */
  cancelReprobeTask(taskId: string): void {
    const controller = this.activeAbortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.activeAbortControllers.delete(taskId);
    }
  }
}
