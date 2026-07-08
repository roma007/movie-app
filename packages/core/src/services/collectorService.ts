import { CMSAdapter } from './cmsAdapter';
import { normalizer } from '../utils/normalizer';
import { mapType, isBlacklisted, refineTypeByEpisodes, isVersionTitle } from '../utils/typeMapper';
import { BLACKLIST_KEYWORDS } from '../utils/constants';
import type { DatabaseProvider } from '../db/provider';
import type { CMSMediaItem, Media, Episode, PlaySource } from '../types';

function generateId(): string {
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function parsePlayInfo(
  vodPlayFrom: string,
  vodPlayUrl: string
): { sources: string[]; episodes: { title: string; url: string }[][] } {
  const sources = vodPlayFrom ? vodPlayFrom.split(/\$\$|\$/).filter(Boolean) : [];
  const urlGroups = vodPlayUrl ? vodPlayUrl.split(/\$\$|\$/).filter(Boolean) : [];

  const episodes: { title: string; url: string }[][] = [];

  for (const group of urlGroups) {
    const epList: { title: string; url: string }[] = [];
    const lines = group.split(/#/).filter(Boolean);
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
  constructor(private db: DatabaseProvider) {}

  private async processItem(
    item: CMSMediaItem,
    sourceId: string,
    _sourceName?: string
  ): Promise<Media | null> {
    const typeName = item.vod_type || '';
    const remarks = item.vod_remarks || '';
    const vodPlayFrom = item.vod_play_from || '';
    const vodPlayUrl = item.vod_play_url || '';

    const year = normalizer.normalizeYear(item.vod_year);
    if (!year) return null;

    const title = await normalizer.normalizeTitle(item.vod_name);
    if (!title) return null;

    const { sources, episodes: epGroups } = parsePlayInfo(vodPlayFrom, vodPlayUrl);

    const rawGenres = typeName.split(/[,，/]/).filter(Boolean);
    const allGenreTexts = [...rawGenres, remarks, title];
    if (isBlacklisted(BLACKLIST_KEYWORDS, ...allGenreTexts)) {
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
    if (mediaType === 'TV') {
      if (normalizer.isShortDramaByMeta(genres, description, title)) {
        isShortDrama = true;
      } else {
        const duration = normalizer.extractDurationFromSummary(description);
        if (duration !== null && normalizer.isShortDramaByDuration(duration)) {
          isShortDrama = true;
        }
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
      viewCount: existing?.viewCount || 0,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.db.upsertMedia(media);

    if (!existing) {
      await this.db.deleteEpisodesByMediaId(mediaId);
      await this.db.deletePlaySourcesByMediaId(mediaId);
    }

    const createdEpisodes: Map<string, Episode> = new Map();

    for (let sourceIdx = 0; sourceIdx < epGroups.length; sourceIdx++) {
      const sourceNameFromList = sources[sourceIdx] || `线路${sourceIdx + 1}`;
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

        let episode = createdEpisodes.get(episodeKey);
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
          createdEpisodes.set(episodeKey, episode);
        }

        const playSourceId = `ps_${episode.id}_${sourceId}_${sourceIdx}`;
        const playSource: PlaySource = {
          id: playSourceId,
          episodeId: episode.id,
          sourceId,
          sourceName: sourceNameFromList,
          url: ep.url,
          quality: null,
        };

        await this.db.upsertPlaySource(playSource);
      }
    }

    return media;
  }

  async collectFromSource(
    sourceId: string,
    baseUrl: string,
    rateLimit: number,
    page: number = 1,
    pageSize: number = 20
  ): Promise<{ media: Media[]; total: number }> {
    const adapter = new CMSAdapter(baseUrl, rateLimit);
    const response = await adapter.getList(page, pageSize);

    const results: Media[] = [];
    for (const item of response.list) {
      try {
        const media = await this.processItem(item, sourceId, '');
        if (media) {
          results.push(media);
        }
      } catch (err) {
        console.error(`处理视频 ${item.vod_name} 失败:`, err);
      }
    }

    return {
      media: results,
      total: response.total,
    };
  }

  async collectByKeyword(keyword: string): Promise<Media[]> {
    const sources = await this.db.getEnabledVideoSources();
    const results: Media[] = [];
    const seenFingerprints = new Set<string>();

    for (const source of sources) {
      try {
        const adapter = new CMSAdapter(source.baseUrl, source.rateLimit);
        const response = await adapter.search(keyword, 1);

        for (const item of response.list) {
          try {
            const media = await this.processItem(item, source.id, source.name);
            if (media && !seenFingerprints.has(media.fingerprint)) {
              seenFingerprints.add(media.fingerprint);
              results.push(media);
            }
          } catch (err) {
            console.error(`处理搜索结果失败:`, err);
          }
        }
      } catch (err) {
        console.error(`搜索源 ${source.name} 失败:`, err);
      }
    }

    return results;
  }

  async collectLatest(page: number = 1, pageSize: number = 20): Promise<Media[]> {
    const sources = await this.db.getEnabledVideoSources();
    const results: Media[] = [];
    const seenFingerprints = new Set<string>();

    for (const source of sources.slice(0, 3)) {
      try {
        const { media } = await this.collectFromSource(source.id, source.baseUrl, source.rateLimit, page, pageSize);
        for (const m of media) {
          if (!seenFingerprints.has(m.fingerprint)) {
            seenFingerprints.add(m.fingerprint);
            results.push(m);
          }
        }
      } catch (err) {
        console.error(`采集源 ${source.name} 失败:`, err);
      }
    }

    return results;
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
}
