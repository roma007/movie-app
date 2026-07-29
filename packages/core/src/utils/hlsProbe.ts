import { getVideoFetchFn } from '../services/videoDurationService';

export type HlsStreamType = 'master' | 'media' | 'unknown';

export interface HlsProbeResult {
  url: string;
  streamType: HlsStreamType;
  variantCount: number;
  variants: {
    bandwidth?: number;
    resolution?: string;
    codecs?: string;
    url: string;
  }[];
  totalDuration: number | null;
  error: string | null;
}

export async function probeHlsStream(url: string, timeoutMs: number = 15000): Promise<HlsProbeResult> {
  const result: HlsProbeResult = {
    url,
    streamType: 'unknown',
    variantCount: 0,
    variants: [],
    totalDuration: null,
    error: null,
  };

  try {
    const fetchFn = getVideoFetchFn() || fetch.bind(globalThis);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetchFn(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Referer: new URL(url).origin,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
      return result;
    }

    const content = await response.text();
    const lines = content.split('\n');

    let hasStreamInf = false;
    let hasExtInf = false;
    let pendingStreamInf: { bandwidth?: number; resolution?: string; codecs?: string } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#')) {
        const streamInfMatch = line.match(/#EXT-X-STREAM-INF:([^]*)/);
        if (streamInfMatch) {
          hasStreamInf = true;
          const attrs = streamInfMatch[1];
          const bandwidthMatch = attrs.match(/BANDWIDTH=(\d+)/);
          const resolutionMatch = attrs.match(/RESOLUTION=([\d x]+)/);
          const codecsMatch = attrs.match(/CODECS="([^"]+)"/);

          pendingStreamInf = {
            bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1]) : undefined,
            resolution: resolutionMatch ? resolutionMatch[1] : undefined,
            codecs: codecsMatch ? codecsMatch[1] : undefined,
          };
        }

        const extInfMatch = line.match(/#EXTINF:([\d\.]+)/);
        if (extInfMatch) {
          hasExtInf = true;
          result.totalDuration = (result.totalDuration || 0) + parseFloat(extInfMatch[1]);
        }
        continue;
      }

      if (!line) continue;

      if (pendingStreamInf) {
        result.variants.push({
          ...pendingStreamInf,
          url: line.startsWith('http') ? line : new URL(line, url).href,
        });
        pendingStreamInf = null;
      }
    }

    if (hasStreamInf) {
      result.streamType = 'master';
      result.variantCount = result.variants.length;
    } else if (hasExtInf) {
      result.streamType = 'media';
      result.variantCount = 1;
    } else {
      result.streamType = 'unknown';
    }

    return result;
  } catch (err: any) {
    result.error = err?.name === 'AbortError' ? `timeout(${timeoutMs}ms)` : err?.message || 'unknown error';
    return result;
  }
}

export async function probeMultipleHlsStreams(urls: string[], timeoutMs: number = 15000): Promise<HlsProbeResult[]> {
  const results: HlsProbeResult[] = [];
  for (const url of urls) {
    results.push(await probeHlsStream(url, timeoutMs));
  }
  return results;
}

export function summarizeProbeResults(results: HlsProbeResult[]): {
  total: number;
  master: number;
  media: number;
  unknown: number;
  errors: number;
  multiBitrateSources: string[];
} {
  const summary = {
    total: results.length,
    master: 0,
    media: 0,
    unknown: 0,
    errors: 0,
    multiBitrateSources: [] as string[],
  };

  for (const r of results) {
    if (r.error) {
      summary.errors++;
    } else if (r.streamType === 'master') {
      summary.master++;
      if (r.variantCount > 1) {
        summary.multiBitrateSources.push(r.url);
      }
    } else if (r.streamType === 'media') {
      summary.media++;
    } else {
      summary.unknown++;
    }
  }

  return summary;
}
