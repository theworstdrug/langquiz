import type { TimedSegment } from './tokenize';

/** Extract an 11-character video id from any common YouTube URL form (or a bare id). */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    if (host === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v) return v.slice(0, 11);
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    // not a URL
  }
  return null;
}

export function youtubeThumb(id: string) {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

/** Video title via YouTube's oEmbed endpoint (CORS-enabled). */
export async function fetchYouTubeTitle(id: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
    if (!res.ok) return null;
    return (await res.json()).title ?? null;
  } catch {
    return null;
  }
}

const TIMESTAMP = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/;
// YouTube's transcript panel adds screen-reader lines like "1 minute, 5 seconds".
const SPOKEN_DURATION = /^\d+\s+(?:hours?|minutes?|seconds?)(?:,\s*\d+\s+(?:hours?|minutes?|seconds?))*$/i;

function toSeconds(m: RegExpMatchArray) {
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Parse a transcript copied from YouTube's "Show transcript" panel. Handles
 * timestamps on their own line or at the start of the text line.
 */
export function parseYouTubeTranscript(src: string): TimedSegment[] {
  const cues: { start: number; text: string[] }[] = [];
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || SPOKEN_DURATION.test(line)) continue;
    const alone = line.match(TIMESTAMP);
    if (alone) {
      cues.push({ start: toSeconds(alone), text: [] });
      continue;
    }
    const inline = line.match(/^((?:\d+:)?\d{1,2}:\d{2})\s+(.+)$/);
    if (inline) {
      cues.push({ start: toSeconds(inline[1].match(TIMESTAMP)!), text: [inline[2]] });
      continue;
    }
    if (cues.length) cues[cues.length - 1].text.push(line);
  }
  const filled = cues.filter((c) => c.text.length);
  return filled.map((c, i) => ({
    start: c.start,
    end: filled[i + 1]?.start ?? c.start + 5,
    text: c.text.join(' ').replace(/\s+/g, ' ').trim(),
  }));
}

/** Join choppy caption cues into sentence-sized segments so the reader isn't one line per fragment. */
export function mergeCues(segs: TimedSegment[], maxChars = 160): TimedSegment[] {
  const out: TimedSegment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && !/[.!?。！？…]["”»)]?$/.test(last.text) && last.text.length + s.text.length < maxChars) {
      last.text += ' ' + s.text;
      last.end = s.end;
    } else out.push({ ...s });
  }
  return out;
}

interface YTPlayer {
  getCurrentTime(): number;
  seekTo(t: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number;
  setPlaybackRate(r: number): void;
  destroy(): void;
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: object) => YTPlayer; PlayerState: { PLAYING: number } };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<NonNullable<Window['YT']>> | null = null;

export function loadYouTubeApi(): Promise<NonNullable<Window['YT']>> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('Could not load the YouTube player'));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

export type { YTPlayer };
