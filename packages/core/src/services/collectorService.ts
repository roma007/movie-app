import { CMSAdapter } from './cmsAdapter';
import { normalizer, DEFAULT_MIN_YEAR } from '../utils/normalizer';
import { mapType, isBlacklisted, refineTypeByEpisodes, isVersionTitle, needsShortDramaCheck } from '../utils/typeMapper';
import { SOURCE_ID_TO_NAME_MAP, PLAY_SOURCE_TYPE_MAP } from '../utils/constants';
import type { DatabaseProvider } from '../db/provider';
import type { CMSMediaItem, Media, Episode, PlaySource, CollectTask, TaskStatus, TaskErrorType } from '../types';
import { SystemConfigService } from './systemConfigService';
import { VideoDurationService } from './videoDurationService';

function generateId(): string {
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** 任务级超时阈值（30 分钟） */
const TASK_TIMEOUT_MS = 30 * 60 * 1000;

/** 根据错误特征归类错误类型，用于前端按类型筛选/展示 */
function classifyError(err: unknown): TaskErrorType {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('cancel') || msg.includes('abort')) {
    return 'CANCELLED';
  }
  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('econnaborted') || msg.includes('超时')) {
    return 'TIMEOUT';
  }
  if (msg.includes('network') || msg.includes('econnreset') || msg.includes('enotfound') || msg.includes('econnrefused')) {
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

  constructor(private db: DatabaseProvider) {}

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

      let isShortDrama = false;
      let durationCheckStatus: 'SUMMARY' | 'PROBE' | 'FALLBACK' | null = null;
      let durationRetryAt: string | null = null;

      if (needsShortDramaCheck(mediaType)) {
        // 如果已有确定性判断结果（SUMMARY 或 PROBE），保留不重新判断
        const existingStatus = existing?.durationCheckStatus;
        if (existingStatus === 'SUMMARY' || existingStatus === 'PROBE') {
          isShortDrama = existing?.isShortDrama ?? false;
          durationCheckStatus = existingStatus;
        } else {
          const result = await this.determineShortDrama(genres, description || '', title, epGroups);
          isShortDrama = result.isShortDrama;
          durationCheckStatus = result.status;
          durationRetryAt = result.retryAt;
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
        fingerprint,
        currentEpisodes,
        totalEpisodes,
        isShortDrama,
        durationCheckStatus,
        durationRetryAt,
        viewCount: existing?.viewCount || 0,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      currentMediaId = media.id;
      await this.db.upsertMedia(media);
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
   * 第2级：实际探测前5集视频时长（m3u8 #EXTINF 累加）→ isShortDramaByDuration
   * 第3级：元数据关键词兜底（isShortDramaByMeta），标记 FALLBACK 并设置 10 分钟后重试
   *
   * 核心判定规则：单集时长 < 30 分钟 → 短剧
   */
  private async determineShortDrama(
    genres: string[],
    summary: string,
    title: string,
    epGroups: { title: string; url: string }[][]
  ): Promise<{
    isShortDrama: boolean;
    status: 'SUMMARY' | 'PROBE' | 'FALLBACK';
    retryAt: string | null;
  }> {
    // 第1级：从简介提取时长
    const summaryDuration = normalizer.extractDurationFromSummary(summary);
    if (summaryDuration !== null) {
      console.log(`[长短剧判断] 第1级(简介)命中: ${summaryDuration}分钟 → ${normalizer.isShortDramaByDuration(summaryDuration) ? '短剧' : '长剧'}`);
      return {
        isShortDrama: normalizer.isShortDramaByDuration(summaryDuration),
        status: 'SUMMARY',
        retryAt: null,
      };
    }

    // 第2级：实际探测视频时长（取前5集）
    const probeUrls: string[] = [];
    if (epGroups.length > 0) {
      const firstGroup = epGroups[0];
      for (let i = 0; i < Math.min(8, firstGroup.length); i++) {
        probeUrls.push(firstGroup[i].url);
      }
    }

    if (probeUrls.length > 0) {
      console.log(`[长短剧判断] 第1级未命中，尝试第2级(实际探测) ${probeUrls.length} 集`);
      const durationService = new VideoDurationService();
      const durations = await durationService.getDurationsFromUrls(probeUrls);
      const validDurations = durations.filter((d): d is number => d !== null);

      if (validDurations.length > 0) {
        const avgDurationSec = validDurations.reduce((a, b) => a + b, 0) / validDurations.length;
        const avgDurationMin = avgDurationSec / 60;
        console.log(`[长短剧判断] 第2级(探测)命中: ${validDurations.length}/${probeUrls.length}集成功, 平均${avgDurationMin.toFixed(1)}分钟 → ${normalizer.isShortDramaByDuration(avgDurationMin) ? '短剧' : '长剧'}`);
        return {
          isShortDrama: normalizer.isShortDramaByDuration(avgDurationMin),
          status: 'PROBE',
          retryAt: null,
        };
      }
      console.log(`[长短剧判断] 第2级(探测)失败: ${probeUrls.length}集全部探测失败`);
    }

    // 第3级：元数据关键词兜底
    const isShort = normalizer.isShortDramaByMeta(genres, summary, title);
    const retryAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10分钟后重试
    console.log(`[长短剧判断] 第3级(关键词兜底): ${isShort ? '短剧' : '长剧'}, 10分钟后重试`);
    return {
      isShortDrama: isShort,
      status: 'FALLBACK',
      retryAt,
    };
  }

  async collectFromSource(
    sourceId: string,
    baseUrl: string,
    rateLimit: number,
    page: number = 1,
    pageSize: number = 20,
    signal?: AbortSignal
  ): Promise<{ media: Media[]; total: number; pagecount: number; failedCount: number }> {
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
      const errorMsg = `[Collector] getList failed: ${err instanceof Error ? err.message : String(err)}`;
      console.error(errorMsg);
      await this.logToDb(errorMsg, 'error');
      return { media: [], total: 0, pagecount: 0, failedCount: 0 };
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
        [`log_${Date.now()}`, message, 'string', level, now, now]
      );
    } catch {
      // 忽略日志写入失败
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
    let consecutiveFailures = 0;
    let lastErrorMsg: string | null = null;
    let lastErrorType: TaskErrorType = 'UNKNOWN';
    let totalRuntimeMs = 0;
    const MAX_CONSECUTIVE_FAILURES = 3;
    const controller = new AbortController();
    this.activeAbortControllers.set(taskId, controller);

    try {
      await this.db.updateCollectTask(taskId, { status: 'RUNNING' as TaskStatus, startedAt: now, currentPage: startPage });

      while (page <= config.incrementalMaxPages) {
        const iterationStart = Date.now();

        const existing = await this.db.getCollectTaskById(taskId);
        if (!existing) {
          cancelled = true;
          break;
        }

        if (totalRuntimeMs > TASK_TIMEOUT_MS) {
          throw new Error(`任务超时（已运行${Math.round(totalRuntimeMs / 60000)}分钟），自动终止`);
        }

        try {
          const { media, pagecount, failedCount } = await this.collectFromSource(source.id, source.baseUrl, source.rateLimit, page, 20, controller.signal);

          collected += media.length;
          failed += failedCount;
          consecutiveFailures = 0;
          await this.db.updateCollectTask(taskId, {
            currentPage: page,
            totalPages: config.incrementalMaxPages,
            collectedCount: collected,
            failedCount: failed,
          });

          if (page >= pagecount) break;
          totalRuntimeMs += Date.now() - iterationStart;
          page++;
        } catch (err) {
          totalRuntimeMs += Date.now() - iterationStart;
          consecutiveFailures++;
          const errType = classifyError(err);
          const errMsg = `[Collector] 增量采集第${page}页失败: ${err instanceof Error ? err.message : String(err)}`;
          console.error(errMsg);
          await this.logToDb(errMsg, 'error');
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

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            const fuseError = new Error(`连续${MAX_CONSECUTIVE_FAILURES}页失败，已熔断: ${lastErrorMsg}`);
            (fuseError as any).errorType = lastErrorType;
            throw fuseError;
          }
          page++;
        }
      }

      if (!cancelled) {
        await this.db.updateCollectTask(taskId, {
          status: 'COMPLETED' as TaskStatus,
          completedAt: new Date().toISOString(),
        });
      }

      this.activeAbortControllers.delete(taskId);
      return { taskId, collected };
    } catch (err) {
      this.activeAbortControllers.delete(taskId);
      const errType = (err as any).errorType || classifyError(err);
      await this.db.updateCollectTask(taskId, {
        status: 'FAILED' as TaskStatus,
        currentPage: page,
        errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        errorType: errType,
        lastErrorPage: page,
        completedAt: new Date().toISOString(),
      });
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
    let consecutiveFailures = 0;
    let lastErrorMsg: string | null = null;
    let lastErrorType: TaskErrorType = 'UNKNOWN';
    let totalRuntimeMs = 0;
    const MAX_CONSECUTIVE_FAILURES = 3;
    const controller = new AbortController();
    this.activeAbortControllers.set(taskId, controller);

    try {
      await this.db.updateCollectTask(taskId, { status: 'RUNNING' as TaskStatus, startedAt: now });

      while (page <= config.maxPages) {
        const iterationStart = Date.now();

        const existing = await this.db.getCollectTaskById(taskId);
        if (!existing) {
          cancelled = true;
          break;
        }

        // 任务级超时检查（基于实际运行时长，排除系统休眠时间）
        if (totalRuntimeMs > TASK_TIMEOUT_MS) {
          throw new Error(`任务超时（已运行${Math.round(totalRuntimeMs / 60000)}分钟），自动终止`);
        }

        try {
          const { media, pagecount, failedCount } = await this.collectFromSource(source.id, source.baseUrl, source.rateLimit, page, 20, controller.signal);
          collected += media.length;
          failed += failedCount;
          pages++;
          consecutiveFailures = 0;

          await this.db.updateCollectTask(taskId, {
            currentPage: page,
            totalPages: Math.min(pagecount, config.maxPages),
            collectedCount: collected,
            failedCount: failed,
          });

          if (page >= pagecount) break;
          totalRuntimeMs += Date.now() - iterationStart;
          page++;
        } catch (err) {
          totalRuntimeMs += Date.now() - iterationStart;
          consecutiveFailures++;
          const errType = classifyError(err);
          const errMsg = `[Collector] 全量采集第${page}页失败: ${err instanceof Error ? err.message : String(err)}`;
          console.error(errMsg);
          await this.logToDb(errMsg, 'error');
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

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            const fuseError = new Error(`连续${MAX_CONSECUTIVE_FAILURES}页失败，已熔断: ${lastErrorMsg}`);
            (fuseError as any).errorType = lastErrorType;
            throw fuseError;
          }
          page++;
        }
      }

      if (!cancelled) {
        await this.db.updateCollectTask(taskId, {
          status: 'COMPLETED' as TaskStatus,
          completedAt: new Date().toISOString(),
        });
      }

      this.activeAbortControllers.delete(taskId);
      return { taskId, collected, pages };
    } catch (err) {
      this.activeAbortControllers.delete(taskId);
      const errType = (err as any).errorType || classifyError(err);
      await this.db.updateCollectTask(taskId, {
        status: 'FAILED' as TaskStatus,
        currentPage: page,
        errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        errorType: errType,
        lastErrorPage: page,
        completedAt: new Date().toISOString(),
      });
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
    retryAt: string | null
  ): Promise<void> {
    await this.db.execute(
      `UPDATE media SET is_short_drama = ?, duration_check_status = ?, duration_retry_at = ?, updated_at = ? WHERE id = ?`,
      [isShortDrama ? 1 : 0, status, retryAt, new Date().toISOString(), mediaId]
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
   * 查询所有 type='TV' 且 duration_check_status 为 FALLBACK 或 NULL 的媒体，
   * 重新探测实际视频时长并更新数据库。
   * 返回进度回调，用于实时更新UI。
   */
  async batchReprobeMedia(
    onProgress: (progress: {
      total: number;
      processed: number;
      longDrama: number;
      shortDrama: number;
      failed: number;
      currentMediaTitle: string;
    }) => void
  ): Promise<{
    total: number;
    longDrama: number;
    shortDrama: number;
    failed: number;
    failedItems: { id: string; title: string }[];
  }> {
    // 查询所有需要重新探测的媒体
    const mediaList = await this.db.select<{
      id: string;
      title: string;
    }>(
      `SELECT id, title FROM media WHERE type = 'TV' AND (duration_check_status = 'FALLBACK' OR duration_check_status IS NULL)`,
      []
    );

    const total = mediaList.length;
    let processed = 0;
    let longDrama = 0;
    let shortDrama = 0;
    let failed = 0;
    const failedItems: { id: string; title: string }[] = [];

    const durationService = new VideoDurationService();

    console.log(`[批量重新探测] 开始批量重新探测，共 ${total} 部媒体`);

    for (const media of mediaList) {
      const mediaStart = Date.now();
      // 更新进度
      onProgress({
        total,
        processed,
        longDrama,
        shortDrama,
        failed,
        currentMediaTitle: media.title,
      });

      try {
        // 获取该剧的前8集
        const episodes = await this.db.getEpisodesByMediaId(media.id);
        if (episodes.length === 0) {
          console.log(`[批量重新探测] "${media.title}" 无剧集数据，跳过`);
          failedItems.push({ id: media.id, title: media.title });
          failed++;
          processed++;
          continue;
        }

        // 探测前8集，每集尝试多个播放源（第一个源失败则尝试下一个）
        const probeEpisodeCount = Math.min(8, episodes.length);
        const durations: number[] = [];
        let totalSourcesTried = 0;

        for (let i = 0; i < probeEpisodeCount; i++) {
          const sources = await this.db.getPlaySourcesByEpisodeId(episodes[i].id);
          if (sources.length === 0) continue;

          // 依次尝试该集的每个播放源
          let episodeDuration: number | null = null;
          for (const source of sources) {
            totalSourcesTried++;
            const result = await durationService.getDurationFromM3U8(source.url);
            if (result !== null) {
              episodeDuration = result;
              break; // 成功了，不再尝试其他源
            }
          }

          if (episodeDuration !== null) {
            durations.push(episodeDuration);
          }
        }

        if (durations.length > 0) {
          // 探测成功：计算平均时长，判定长短剧，更新为 PROBE 状态
          const avgDurationSec = durations.reduce((a, b) => a + b, 0) / durations.length;
          const avgDurationMin = avgDurationSec / 60;
          const isShortDrama = normalizer.isShortDramaByDuration(avgDurationMin);

          await this.updateMediaDurationStatus(
            media.id,
            isShortDrama,
            'PROBE',
            null
          );

          if (isShortDrama) {
            shortDrama++;
            console.log(`[批量重新探测] "${media.title}" → 短剧 (PROBE, 平均${avgDurationMin.toFixed(1)}分钟, ${durations.length}/${probeEpisodeCount}集成功, 尝试${totalSourcesTried}个源, ${Date.now() - mediaStart}ms)`);
          } else {
            longDrama++;
            console.log(`[批量重新探测] "${media.title}" → 长剧 (PROBE, 平均${avgDurationMin.toFixed(1)}分钟, ${durations.length}/${probeEpisodeCount}集成功, 尝试${totalSourcesTried}个源, ${Date.now() - mediaStart}ms)`);
          }
        } else {
          // 探测失败：不更新数据库，保持原状态，留在队列等下次自动重试
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
    }

    console.log(`[批量重新探测] 完成: 总计 ${total}, 短剧 ${shortDrama}, 长剧 ${longDrama}, 失败 ${failed}`);

    // 最终更新进度
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
}
