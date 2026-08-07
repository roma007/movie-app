import { create } from 'zustand';
import { SystemConfigService, type Episode, type Media, type PlaySource } from '@movie-app/core';
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
  openPlayback: (episodeId: string, opts?: { sourceId?: string | null }) => Promise<void>;
  switchEpisode: (episodeId: string) => Promise<void>;
  closePlayback: () => Promise<void>;
  switchCmsSource: (sourceId: string) => void;
  handleSourceChange: (source: PlaySource) => void;
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
      .saveWatchProgress(session.media.id, session.episodeId || null, Math.floor(currentTimeRef.value), Math.floor(dur));
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
      session: {
        episodeId,
        media: prev?.media ?? null,
        episode: prev?.episode ?? null,
        sources: prev?.sources ?? [],
        playSourceId: prev?.playSourceId ?? null,
        selectedSourceId: prev?.selectedSourceId ?? null,
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
      let playSourceId: string | null = null;
      if (effective) {
        const byCms =
          activePs.find((p) => p.sourceId === effective) || ps.find((p) => p.sourceId === effective);
        playSourceId = byCms?.id ?? activePs[0]?.id ?? null;
      } else {
        playSourceId = activePs[0]?.id ?? null;
      }
      const selectedSourceId = playSourceId ? ps.find((p) => p.id === playSourceId)?.sourceId ?? null : null;

      let resume = 0;
      let watched: string[] = [];
      let outro = 10;
      let showOverlay = true;
      if (media) {
        const configService = new SystemConfigService(provider);
        try {
          const [saved, allHistory, playbackConfig] = await Promise.all([
            provider.getWatchHistoryByMediaId(media.id),
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
          if (saved && saved.progress > 0) {
            const matchEpisode = !saved.episodeId || saved.episodeId === ep.id;
            const nearEnd = saved.duration > 0 && saved.progress >= saved.duration - 5;
            if (matchEpisode && !nearEnd) resume = saved.progress;
          }
        } catch (err) {
          console.error('[playerStore] 读取观看配置/历史失败:', err);
        }
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

  switchEpisode: async (episodeId) => {
    const s = get().session;
    if (s?.episodeId === episodeId) return;
    await get().openPlayback(episodeId);
  },

  switchCmsSource: (sourceId) => {
    const s = get().session;
    if (!s) return;
    const matching = s.sources.find((p) => p.sourceId === sourceId);
    set({ session: { ...s, selectedSourceId: sourceId, playSourceId: matching?.id ?? s.playSourceId } });
  },

  handleSourceChange: (source) => {
    const s = get().session;
    if (!s) return;
    set({ session: { ...s, playSourceId: source.id, selectedSourceId: source.sourceId } });
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
        .saveWatchProgress(s.media.id, s.episodeId || null, Math.floor(currentTime), Math.floor(duration));
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
  };
});
