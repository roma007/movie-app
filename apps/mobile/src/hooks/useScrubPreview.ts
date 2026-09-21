import { useCallback, useRef, useState } from 'react';
import { PixelRatio } from 'react-native';
import type { RefObject } from 'react';
import type { VideoThumbnail } from 'expo-video';

export interface ScrubPreviewState {
  thumbnail: VideoThumbnail | null;
  /** 预览帧对应的时间（秒），用于气泡内时间显示；生成失败时为请求时刻 */
  previewTime: number | null;
  loading: boolean;
}

/**
 * 拖动进度条实时帧预览共享 hook。
 * 拖动调用 requestPreview(sec)：节流（目标秒变化≥1s 或距上次≥250ms 才触发），
 * 递增序号丢弃过期 Promise（避免帧乱序回跳），同一时刻尽量只保留一个原生取帧请求。
 * 生成失败静默降级：保留 previewTime、无 thumbnail。
 * 结束拖动 / 换源 / 卸载调用 reset() 清理。
 */
export function useScrubPreview(
  playerRef: RefObject<any> | undefined,
  previewPixelWidth?: () => number,
) {
  const seqRef = useRef(0);
  const lastSecRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const inFlightRef = useRef(false);
  const [state, setState] = useState<ScrubPreviewState>({
    thumbnail: null,
    previewTime: null,
    loading: false,
  });

  const requestPreview = useCallback((sec: number) => {
    const p = playerRef?.current;
    if (!p || typeof p.generateThumbnailsAsync !== 'function') return;
    if (!isFinite(sec)) return;
    const now = Date.now();
    const sameSec =
      lastSecRef.current != null && Math.abs(lastSecRef.current - sec) < 1.0;
    if (sameSec && now - lastTsRef.current < 250) return;
    if (inFlightRef.current && now - lastTsRef.current < 400) return;
    lastSecRef.current = sec;
    lastTsRef.current = now;
    const seq = ++seqRef.current;
    inFlightRef.current = true;
    setState((s) => ({ ...s, previewTime: sec, loading: true }));
    const logicalW = Math.max(80, previewPixelWidth?.() ?? 240);
    const maxWidth = Math.round(logicalW * PixelRatio.get());
    let promise: Promise<VideoThumbnail[] | undefined>;
    try {
      promise = Promise.resolve(p.generateThumbnailsAsync([sec], { maxWidth }));
    } catch (e) {
      promise = Promise.reject(e);
    }
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled || seqRef.current !== seq) return;
      settled = true;
      setState((s) => ({
        thumbnail: null,
        previewTime: s.previewTime ?? sec,
        loading: false,
      }));
      inFlightRef.current = false;
    }, 2000);
    promise
      .then((res: VideoThumbnail[] | undefined) => {
        if (seqRef.current !== seq) return;
        settled = true;
        clearTimeout(timeoutId);
        const t = Array.isArray(res) ? res[0] : null;
        setState({
          thumbnail: t,
          previewTime: t ? t.requestedTime : sec,
          loading: false,
        });
      })
      .catch((err) => {
        if (seqRef.current !== seq) return;
        settled = true;
        clearTimeout(timeoutId);
        setState((s) => ({
          thumbnail: null,
          previewTime: s.previewTime ?? sec,
          loading: false,
        }));
      })
      .finally(() => {
        if (seqRef.current === seq) inFlightRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerRef, previewPixelWidth]);

  const reset = useCallback(() => {
    seqRef.current++;
    inFlightRef.current = false;
    lastSecRef.current = null;
    setState({ thumbnail: null, previewTime: null, loading: false });
  }, []);

  return { ...state, requestPreview, reset };
}