import { File, Paths } from 'expo-file-system';

const FILE_NAME = 'play_trace.log';
const MAX_LINES = 2000;
const FLUSH_INTERVAL = 800;

let buffer: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function fmt(args: unknown[]): string {
  const text = args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  return `[${new Date().toISOString()}] ${text}`;
}

async function flush() {
  timer = null;
  const lines = buffer;
  buffer = [];
  if (lines.length === 0) return;
  try {
    const f = new File(Paths.document, FILE_NAME);
    let existing: string[] = [];
    if (f.exists) {
      const raw = await f.text();
      existing = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    } else {
      f.create({ overwrite: false, intermediates: true });
    }
    const all = [...existing, ...lines].slice(-MAX_LINES);
    f.write(all.join('\n') + '\n');
  } catch {}
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    flush();
  }, FLUSH_INTERVAL);
}

export function appendPlayTrace(...args: unknown[]) {
  try {
    buffer.push(fmt(args));
    scheduleFlush();
  } catch {}
}

export function clearPlayTrace() {
  buffer = [];
  try {
    const f = new File(Paths.document, FILE_NAME);
    if (f.exists) f.delete();
  } catch {}
}