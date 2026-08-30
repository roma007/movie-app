import { create } from 'zustand';
import { SystemConfigService, type Episode, type Media, type PlaySource, type WatchHistory } from '@movie-app/core';
import { getProvider, getStore } from '../init';
import { prefetchManager } from '../components/player/PrefetchManager';

export interface PlaybackSession {
  episodeId: string;
  media: Media | null;
  episode: Episode | null;
  sources: PlaySource[];
  playSourceId: string | null;
  selectedSourceId: string | null;
  currentTime: number;
  loading: boolean;
  nextEpisode: { id: string; title?: string | null; episodeNumber: number } | null;
  outroThresholdMinutes: number;
  showNextEpisodeOverlay: boolean;
  watchedEpisodes: string[];
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PlayerState {
  session: PlaybackSession | null;
  slotRect: Rect | null;
  miniPos: { x: number; y: number } | null;
  miniSize: { width: number; height: number };
  collapsed: boolean;
  miniPrefsInitialized: boolean;
  volume: number;
  muted: boolean;

  setVolume: (volume: number, muted: boolean) => void;
  openPlayback: (episodeId: string, opts?: { sourceId?: string | null; playSourceId?: string | null; keepPipActive?: boolean }) => Promise<void>;
  switchEpisode: (episodeId: string, opts?: { keepPipActive?: boolean }) => Promise<void>;
  closePlayback: () => Promise<void>;
  switchCmsSource: (sourceId: string) => Promise<void>;
  handleSourceChange: (source: PlaySource) => void;
  switchLineWithResume: (lineId: string) => Promise<void>;
  flushProgress: () => Promise<void>;
  handleTimeUpdate: (currentTime: number, duration: number) => void;
  updateNextEpisode: () => void;
  setSlotRect: (rect: Rect | null) => void;
  setMiniPos: (pos: { x: number; y: number }) => void;
  setMiniSize: (size: { width: number; height?: number }) => void;
  setCollapsed: (collapsed: boolean) => void;
  initMiniPrefs: () => void;
  miniPlayerEnabled: boolean;
  setMiniPlayerEnabled: (enabled: boolean) => void;
  loadMiniPlayerPref: () => Promise<void>;

  pipActive: boolean;
  pipResumePlay: boolean;
  pipStartPaused: boolean;
  setPipActive: (active: boolean, opts?: { resumePlay?: boolean }) => void;
  applyPipTime: (currentTime: number, duration: number) => void;
}

const MINI_POS_KEY = 'movie_app_mini_pos';
const MINI_SIZE_KEY = 'movie_app_mini_size';
const VOLUME_KEY = 'movie_app_volume';
const MINI_HEADER_H = 36;
const MINI_WIDTH_MIN = 240;
const MINI_HEIGHT_MIN = 160;

const currentTimeRef = { value: 0 };
const durationRef = { value: 0 };
const lastSaveRef = { value: 0 };
let loadSeq = 0;

async function finalSave(session: PlaybackSession | null): Promise<void> {
  if (!session || !session.media) return;
  const dur = durationRef.value;
  if (dur <= 0) return;
  try {
    await getStore()
      .getState()
      .saveWatchProgress(
        session.media.id,
        session.episodeId || null,
        Math.floor(currentTimeRef.value),
        Math.floor(dur),
        session.selectedSourceId ?? session.episode?.sourceId ?? null,
        session.playSourceId ?? null,
      );
    getStore().getState().scheduleRecommendationRecompute();
  } catch (err) {
    console.error('[playerStore] 最终保存观看进度失败:', err);
  }
}

function clampMiniSize(size: { width: number; height?: number }): { width: number; height: number } {
  const maxW = Math.max(MINI_WIDTH_MIN, Math.floor(window.innerWidth));
  const w = Math.min(maxW, Math.max(MINI_WIDTH_MIN, Math.round(size.width)));
  const maxH = Math.max(MINI_HEIGHT_MIN, Math.floor(window.innerHeight));
  const h = Math.min(
    maxH,
    Math.max(MINI_HEIGHT_MIN, Math.round(size.height ?? (w * 9) / 16 + MINI_HEADER_H)),
  );
  return { width: w, height: h };
}

function loadVolumePrefs(): { volume: number; muted: boolean } {
  try {
    const p = localStorage.getItem(VOLUME_KEY);
    if (p) {
      const parsed = JSON.parse(p);
      const volume = typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : 1;
      const muted = parsed.muted === true;
      return { volume, muted };
    }
  } catch {}
  return { volume: 1, muted: false };
}

function saveVolumePrefs(volume: number, muted: boolean): void {
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume, muted }));
  } catch {}
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  const volumePrefs = loadVolumePrefs();
  return {
    session: null,
    slotRect: null,
    miniPos: null,
    miniSize: { width: 400, height: Math.round((400 * 9) / 16) + MINI_HEADER_H },
    collapsed: false,
    miniPrefsInitialized: false,
    miniPlayerEnabled: true,
    volume: volumePrefs.volume,
    muted: volumePrefs.muted,

    setVolume: (volume, muted) => {
      set({ volume, muted });
      saveVolumePrefs(volume, muted);
    },

    initMiniPrefs: () => {
    if (get().miniPrefsInitialized) return;
    let pos = null;
    let size = null;
    try {
      const p = localStorage.getItem(MINI_POS_KEY);
      if (p) pos = JSON.parse(p);
      const s = localStorage.getItem(MINI_SIZE_KEY);
      if (s) size = JSON.parse(s);
    } catch {}
    set({
      miniPos: pos && typeof pos.x === 'number' && typeof pos.y === 'number' ? pos : null,
      miniSize: size && typeof size.width === 'number' ? clampMiniSize(size) : { width: 400, height: Math.round((400 * 9) / 16) + MINI_HEADER_H },
      miniPrefsInitialized: true,
    });
  },

    setMiniPos: (pos) => set({ miniPos: pos }),
    setMiniSize: (size) => set({ miniSize: clampMiniSize(size) }),
    setCollapsed: (collapsed) => set({ collapsed }),

    setMiniPlayerEnabled: (enabled) => set({ miniPlayerEnabled: enabled }),

    loadMiniPlayerPref: async () => {
      try {
        const configService = new SystemConfigService(getProvider());
        const cfg = await configService.getPlaybackConfig();
        set({ miniPlayerEnabled: cfg.miniPlayerEnabled });
      } catch (err) {
        console.error('[playerStore] 读取小窗播放偏好失败:', err);
      }
    },

  setSlotRect: (rect) => {
    const cur = get().slotRect;
    if (
      cur &&
      rect &&
      cur.left === rect.left &&
      cur.top === rect.top &&
      cur.width === rect.width &&
      cur.height === rect.height
    ) {
      return;
    }
    set({ slotRect: rect });
  },

  openPlayback: async (episodeId, opts) => {
    const seq = ++loadSeq;
    const provider = getProvider();
    const prev = get().session;
    await finalSave(prev);
    set({
      ...(opts?.keepPipActive ? {} : { pipActive: false, pipResumePlay: false, pipStartPaused: false }),
      session: {
        episodeId,
        media: null,
        episode: null,
        sources: [],
        playSourceId: null,
        selectedSourceId: null,
        currentTime: 0,
        loading: true,
        nextEpisode: null,
        outroThresholdMinutes: prev?.outroThresholdMinutes ?? 10,
        showNextEpisodeOverlay: prev?.showNextEpisodeOverlay ?? true,
        watchedEpisodes: [],
      },
    });

    try {
      const ep = await provider.getEpisodeById(episodeId);
      if (seq !== loadSeq) return;
      if (!ep) {
        set((s) =>
          s.session && s.session.episodeId === episodeId
            ? { session: { ...s.session, loading: false, episode: null, media: null, sources: [] } }
            : s,
        );
        return;
      }

      const [media, ps] = await Promise.all([
        provider.getMediaById(ep.mediaId),
        provider.getPlaySourcesByEpisodeId(ep.id),
      ]);
      if (seq !== loadSeq) return;

      const activePs = ps;
      const effective = opts?.sourceId ?? ep.sourceId ?? null;

      let savedEp: WatchHistory | null = null;
      let resume = 0;
      let watched: string[] = [];
      let outro = 10;
      let showOverlay = true;
      if (media) {
        const configService = new SystemConfigService(provider);
        try {
          const [allHistory, playbackConfig] = await Promise.all([
            provider.getAllWatchHistoryByMediaId(media.id),
            configService.getPlaybackConfig(),
          ]);
          if (seq !== loadSeq) return;
          outro = playbackConfig.outroThresholdMinutes;
          showOverlay = playbackConfig.showNextEpisodeOverlay;
          prefetchManager.setConcurrency(playbackConfig.prefetchConcurrency);
          watched = allHistory
            .filter(
              (h) =>
                h.episodeId &&
                h.episodeId !== media.id &&
                (h.progress > 60 || (h.duration > 0 && h.progress / h.duration >= 0.1)),
            )
            .map((h) => h.episodeId as string);
          savedEp = await provider.getWatchHistoryByEpisodeId(media.id, ep.id);
        } catch (err) {
          console.error('[playerStore] 读取观看配置/历史失败:', err);
        }
      }
      if (seq !== loadSeq) return;

      // 播放线路恢复：显式传入线路 → 该集历史上一次线路（progress>0）→ 该源首条。
      // 匹配要求该线路属于解析出的有效源，防止跨源串线。
      let playSourceId: string | null = null;
      const prefLine =
        opts?.playSourceId ??
        (savedEp && savedEp.progress > 0 ? savedEp.playSourceId : null) ??
        null;
      if (prefLine) {
        const byLine = activePs.find(
          (p) => p.id === prefLine && (!effective || p.sourceId === effective),
        );
        playSourceId = byLine?.id ?? null;
      }
      if (!playSourceId) {
        const byCms = effective
          ? activePs.find((p) => p.sourceId === effective) ||
            ps.find((p) => p.sourceId === effective)
          : undefined;
        playSourceId = byCms?.id ?? activePs[0]?.id ?? null;
      }
      const selectedSourceId = playSourceId ? ps.find((p) => p.id === playSourceId)?.sourceId ?? null : null;

      // 续播判定：优先按「定稿线路自己的记忆」进度续播（路线切换后互不覆盖）。
      // 线路记忆缺失（存量数据/无线路）时回退旧逻辑（同媒体+同源+同线路的历史行）。
      let lineSaved: WatchHistory | null = null;
      if (media && playSourceId) {
        try {
          lineSaved = await provider.getWatchLineProgressByPlaySource(media.id, ep.id, playSourceId);
        } catch (err) {
          console.error('[playerStore] 读取线路记忆失败:', err);
        }
        if (seq !== loadSeq) return;
      }
      if (lineSaved && lineSaved.progress > 0) {
        const nearEnd = lineSaved.duration > 0 && lineSaved.progress >= lineSaved.duration - 5;
        if (!nearEnd) resume = lineSaved.progress;
      } else if (savedEp && savedEp.progress > 0) {
        const sameSource = !savedEp.sourceId || savedEp.sourceId === ep.sourceId;
        const sameLine = !savedEp.playSourceId || savedEp.playSourceId === playSourceId;
        const nearEnd = savedEp.duration > 0 && savedEp.progress >= savedEp.duration - 5;
        if (sameSource && sameLine && !nearEnd) resume = savedEp.progress;
      }
      if (seq !== loadSeq) return;

      if (!get().session) return;
      set({
        session: {
          episodeId,
          media,
          episode: ep,
          sources: ps,
          playSourceId,
          selectedSourceId,
          currentTime: resume,
          loading: false,
          nextEpisode: null,
          outroThresholdMinutes: outro,
          showNextEpisodeOverlay: showOverlay,
          watchedEpisodes: watched,
        },
      });
      get().updateNextEpisode();
    } catch (err) {
      console.error('[playerStore] openPlayback 失败:', err);
      if (seq === loadSeq) {
        set((s) =>
          s.session && s.session.episodeId === episodeId
            ? { session: { ...s.session, loading: false } }
            : s,
        );
      }
    }
  },

  switchEpisode: async (episodeId, opts) => {
    const s = get().session;
    if (s?.episodeId === episodeId) return;
    await get().openPlayback(episodeId, opts);
  },

  switchCmsSource: async (sourceId) => {
    const s = get().session;
    if (!s) return;
    const matching = s.sources.find((p) => p.sourceId === sourceId);
    if (matching && matching.id !== s.playSourceId) {
      await get().switchLineWithResume(matching.id);
      return;
    }
    set({ session: { ...s, selectedSourceId: sourceId, playSourceId: matching?.id ?? s.playSourceId } });
  },

  handleSourceChange: (source) => {
    const s = get().session;
    if (!s) return;
    set({ session: { ...s, playSourceId: source.id, selectedSourceId: source.sourceId } });
  },

  switchLineWithResume: async (lineId) => {
    const s = get().session;
    if (!s || !s.media || !s.episode) return;
    const target = s.sources.find((p) => p.id === lineId);
    if (!target) return;
    if (s.playSourceId === lineId && s.selectedSourceId === target.sourceId) return;
    // 1) 先把当前线路的真实进度落库（保存旧线路记忆，返回后恢复该线路进度）
    await finalSave(s);
    // 2) 读取目标线路自己的记忆，续播到该位置（无记忆从头）
    let resume = 0;
    try {
      const mem = await getProvider().getWatchLineProgressByPlaySource(
        s.media.id,
        s.episode.id,
        lineId,
      );
      if (mem && mem.progress > 0) {
        const nearEnd = mem.duration > 0 && mem.progress >= mem.duration - 5;
        if (!nearEnd) resume = mem.progress;
      }
    } catch (err) {
      console.error('[playerStore] 读取线路记忆失败:', err);
    }
    set({
      session: {
        ...s,
        playSourceId: lineId,
        selectedSourceId: target.sourceId,
        currentTime: resume,
      },
    });
    get().updateNextEpisode();
  },

  flushProgress: async () => {
    await finalSave(get().session);
  },

  handleTimeUpdate: (currentTime, duration) => {
    currentTimeRef.value = currentTime;
    durationRef.value = duration;
    const s = get().session;
    if (!s || s.loading || !s.media || duration <= 0) return;
    const now = Date.now();
    if (now - lastSaveRef.value >= 10000 || Math.floor(currentTime) >= Math.floor(duration) - 2) {
      lastSaveRef.value = now;
      void getStore()
        .getState()
        .saveWatchProgress(
          s.media.id,
          s.episodeId || null,
          Math.floor(currentTime),
          Math.floor(duration),
          s.selectedSourceId ?? s.episode?.sourceId ?? null,
          s.playSourceId ?? null,
        );
      getStore().getState().scheduleRecommendationRecompute();
    }
  },

  updateNextEpisode: () => {
    const s = get().session;
    if (!s || !s.episode) return;
    const setNext = (next: PlaybackSession['nextEpisode']) => {
      if ((s.nextEpisode === null) !== (next === null) || s.nextEpisode?.id !== next?.id) {
        set({ session: { ...s, nextEpisode: next } });
      }
    };
    if (!s.media || s.media.type === 'MOVIE') {
      setNext(null);
      return;
    }
    const app = getStore().getState();
    let eps = app.episodes;
    if (s.selectedSourceId) eps = eps.filter((e: any) => e.sourceId === s.selectedSourceId);
    const idx = eps.findIndex((e: any) => e.id === s.episode!.id);
    if (idx < 0 || idx >= eps.length - 1) {
      setNext(null);
      return;
    }
    const next = eps[idx + 1];
    setNext({ id: next.id, title: next.title, episodeNumber: next.episodeNumber });
  },

  closePlayback: async () => {
    await finalSave(get().session);
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
    } catch {}
    currentTimeRef.value = 0;
    durationRef.value = 0;
    lastSaveRef.value = 0;
    set({ session: null, slotRect: null, collapsed: false });
  },

  pipActive: false,
  pipResumePlay: false,
  pipStartPaused: false,

  setPipActive: (active, opts) => {
    if (active) {
      set({ pipActive: true, pipResumePlay: false, pipStartPaused: false });
    } else {
      set((s) => ({
        pipActive: false,
        pipResumePlay: opts?.resumePlay === true,
        pipStartPaused: s.pipActive ? opts?.resumePlay !== true : s.pipStartPaused,
      }));
    }
  },

  applyPipTime: (currentTime, duration) => {
    currentTimeRef.value = currentTime;
    durationRef.value = duration;
    const s = get().session;
    if (!s || s.loading) return;
    const cur = s.currentTime;
    if (Math.abs(cur - currentTime) > 0.499) set({ session: { ...s, currentTime } });
    get().handleTimeUpdate(currentTime, duration);
  },
  };
});
