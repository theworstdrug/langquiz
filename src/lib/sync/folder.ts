/**
 * Sync through a folder that another app (Google Drive for desktop, Dropbox,
 * OneDrive, iCloud Drive, Syncthing…) keeps in step between computers.
 *
 * Layout inside the chosen folder:
 *   LangQuiz/
 *     devices/<deviceId>/index.json        { shards: { path: hash }, updatedAt, deviceName }
 *     devices/<deviceId>/meta.json         courses, activity, settings, deletions
 *     devices/<deviceId>/terms-<lang>.json
 *     devices/<deviceId>/lessons/<uid>.json
 *
 * Every device writes only inside its own folder, so file-sync apps never see
 * two devices editing the same file. Each device reads all folders and merges.
 */
import type { LangDB } from '../db';
import { applySnapshot, buildSnapshot, mergeSnapshots, type SyncFile, type SyncLesson, type SyncTerm } from './snapshot';

/** Minimal directory abstraction: File System Access API in the app, in-memory in tests. */
export interface Dir {
  name: string;
  dir(name: string, create: boolean): Promise<Dir | null>;
  entries(): Promise<{ name: string; kind: 'file' | 'directory' }[]>;
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export const ROOT_NAME = 'LangQuiz';

interface FolderIndex {
  app: 'langquiz-folder';
  version: 1;
  device: string;
  deviceName: string;
  updatedAt: number;
  shards: Record<string, string>;
}

interface Meta {
  courses: SyncFile['courses'];
  activity: SyncFile['activity'];
  settings: SyncFile['settings'];
  deletions: SyncFile['deletions'];
}

/** cyrb53: small, fast, good-enough content hash for change detection. */
export function hash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Split a snapshot into files, so unchanged lessons are never rewritten. */
export function toShards(f: SyncFile): Map<string, string> {
  const shards = new Map<string, string>();
  const meta: Meta = { courses: f.courses, activity: f.activity, settings: f.settings, deletions: f.deletions };
  shards.set('meta.json', JSON.stringify(meta));
  const byLang = new Map<string, SyncTerm[]>();
  for (const t of f.terms) byLang.set(t.lang, [...(byLang.get(t.lang) ?? []), t]);
  for (const [lang, terms] of byLang) {
    terms.sort((a, b) => (a.term < b.term ? -1 : 1));
    shards.set(`terms-${lang}.json`, JSON.stringify(terms));
  }
  for (const l of f.lessons) shards.set(`lessons/${l.uid}.json`, JSON.stringify(l));
  return shards;
}

async function readPath(dir: Dir, path: string): Promise<string | null> {
  const parts = path.split('/');
  let d: Dir | null = dir;
  for (const p of parts.slice(0, -1)) {
    d = await d.dir(p, false);
    if (!d) return null;
  }
  return d.read(parts[parts.length - 1]);
}

/** Read one device's data. Returns null while its files are still arriving (hash mismatch). */
export async function readDevice(dir: Dir): Promise<{ index: FolderIndex; file: SyncFile } | null> {
  const raw = await dir.read('index.json');
  if (!raw) return null;
  let index: FolderIndex;
  try {
    index = JSON.parse(raw);
  } catch {
    return null;
  }
  if (index.app !== 'langquiz-folder') return null;
  const file: SyncFile = { app: 'langquiz-sync', version: 1, updatedAt: index.updatedAt, terms: [], courses: [], lessons: [], activity: [], settings: [], deletions: [] };
  for (const [path, h] of Object.entries(index.shards)) {
    const text = await readPath(dir, path);
    if (text === null || hash(text) !== h) return null; // partially synced; try again next round
    const data = JSON.parse(text);
    if (path === 'meta.json') Object.assign(file, data as Meta);
    else if (path.startsWith('terms-')) file.terms.push(...(data as SyncTerm[]));
    else if (path.startsWith('lessons/')) file.lessons.push(data as SyncLesson);
  }
  return { index, file };
}

/** Write this device's folder, touching only files whose content changed. */
export async function writeDevice(dir: Dir, device: string, deviceName: string, f: SyncFile): Promise<number> {
  const prevRaw = await dir.read('index.json');
  const prev: Record<string, string> = prevRaw ? (JSON.parse(prevRaw) as FolderIndex).shards ?? {} : {};
  const shards = toShards(f);
  const lessonsDir = await dir.dir('lessons', true);
  const next: Record<string, string> = {};
  let written = 0;
  for (const [path, text] of shards) {
    const h = hash(text);
    next[path] = h;
    if (prev[path] === h) continue;
    if (path.startsWith('lessons/')) await lessonsDir!.write(path.slice('lessons/'.length), text);
    else await dir.write(path, text);
    written++;
  }
  // Index last, so other devices never see an index pointing at files not yet written.
  const index: FolderIndex = { app: 'langquiz-folder', version: 1, device, deviceName, updatedAt: Date.now(), shards: next };
  if (written || Object.keys(prev).some((p) => !(p in next)) || !prevRaw) await dir.write('index.json', JSON.stringify(index));
  for (const path of Object.keys(prev)) {
    if (path in next) continue;
    if (path.startsWith('lessons/')) await lessonsDir!.remove(path.slice('lessons/'.length));
    else await dir.remove(path);
  }
  return written;
}

export interface FolderSyncResult {
  pulled: number;
  written: number;
  devices: number;
  skipped: boolean;
  /** updatedAt of every device index seen, for the next round's change check. */
  seen: Record<string, number>;
}

/** Use the picked folder itself if it is the LangQuiz folder, otherwise a LangQuiz subfolder in it. */
export async function syncRoot(picked: Dir): Promise<Dir> {
  if (picked.name === ROOT_NAME || (await picked.dir('devices', false))) return picked;
  return (await picked.dir(ROOT_NAME, true))!;
}

export async function syncFolderOnce(
  db: LangDB,
  root: Dir,
  device: string,
  deviceName: string,
  dirty: boolean,
  lastSeen: Record<string, number>,
): Promise<FolderSyncResult> {
  const devicesDir = (await root.dir('devices', true))!;
  const names = (await devicesDir.entries()).filter((e) => e.kind === 'directory').map((e) => e.name);

  // Cheap check: if no other device has written since last time and nothing changed here, stop.
  const indexes: Record<string, number> = {};
  for (const name of names) {
    if (name === device) continue;
    const raw = await (await devicesDir.dir(name, false))?.read('index.json');
    try {
      if (raw) indexes[name] = (JSON.parse(raw) as FolderIndex).updatedAt;
    } catch {
      // half-written index from a file-sync app; picked up next round
    }
  }
  const ownExists = names.includes(device);
  const unchanged = Object.keys(indexes).length === Object.keys(lastSeen).length && Object.entries(indexes).every(([k, v]) => lastSeen[k] === v);
  if (!dirty && ownExists && unchanged) return { pulled: 0, written: 0, devices: names.length, skipped: true, seen: lastSeen };

  let remote: SyncFile | null = null;
  const seen: Record<string, number> = {};
  for (const name of names) {
    if (name === device) continue;
    const got = await readDevice((await devicesDir.dir(name, false))!);
    if (!got) continue; // still syncing in; leave it out of `seen` so we retry
    seen[name] = got.index.updatedAt;
    remote = remote ? mergeSnapshots(remote, got.file) : got.file;
  }

  const local = await buildSnapshot(db);
  const merged = remote ? mergeSnapshots(local, remote) : local;
  const { changed } = await applySnapshot(db, merged);
  const own = (await devicesDir.dir(device, true))!;
  const written = await writeDevice(own, device, deviceName, merged);
  return { pulled: changed, written, devices: new Set([...names, device]).size, skipped: false, seen };
}

// ---------- File System Access API adapter ----------

type DirHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterable<[string, FileSystemHandle]>;
  queryPermission(opts: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(opts: { mode: 'readwrite' }): Promise<PermissionState>;
};

export function folderSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** Phones and tablets have no desktop sync client keeping a local folder up to date. */
export function isMobileDevice(): boolean {
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  return !!uaData?.mobile || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  return picker({ id: 'langquiz-sync', mode: 'readwrite' });
}

/** 'granted' | 'prompt' | 'denied'. Asking (requestPermission) needs a click. */
export async function folderPermission(h: FileSystemDirectoryHandle, ask: boolean): Promise<PermissionState> {
  const d = h as DirHandle;
  const state = await d.queryPermission({ mode: 'readwrite' });
  if (state === 'granted' || !ask) return state;
  return d.requestPermission({ mode: 'readwrite' });
}

export function handleDir(h: FileSystemDirectoryHandle): Dir {
  const d = h as DirHandle;
  return {
    name: h.name,
    async dir(name, create) {
      try {
        return handleDir(await h.getDirectoryHandle(name, { create }));
      } catch (e) {
        if ((e as DOMException).name === 'NotFoundError' || (e as DOMException).name === 'TypeMismatchError') return null;
        throw e;
      }
    },
    async entries() {
      const out: { name: string; kind: 'file' | 'directory' }[] = [];
      for await (const [name, entry] of d.entries()) out.push({ name, kind: entry.kind });
      return out;
    },
    async read(name) {
      try {
        return await (await (await h.getFileHandle(name)).getFile()).text();
      } catch (e) {
        if ((e as DOMException).name === 'NotFoundError') return null;
        throw e;
      }
    },
    async write(name, text) {
      const w = await (await h.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    },
    async remove(name) {
      try {
        await h.removeEntry(name);
      } catch (e) {
        if ((e as DOMException).name !== 'NotFoundError') throw e;
      }
    },
  };
}
