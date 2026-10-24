import Dexie, { type Table } from 'dexie';
import { useSyncExternalStore } from 'react';
import { db, deviceId, onLocalChange } from '../db';
import { driveStore, fetchAccountEmail, loadGoogleIdentity, NeedsAuthError, requestToken, revokeToken, type StoredToken } from './drive';
import { syncOnce } from './engine';
import { folderPermission, folderSupported, handleDir, isMobileDevice, pickFolder, syncFolderOnce, syncRoot } from './folder';

export type SyncMethod = 'folder' | 'drive-api';

/** Per-device sync configuration (localStorage, never synced itself). */
interface SyncConfig {
  enabled: boolean;
  method?: SyncMethod;
  dirty?: boolean;
  lastSyncAt?: number;
  // Drive API
  clientId?: string;
  email?: string;
  fileId?: string;
  version?: string;
  token?: StoredToken;
  // Folder
  folderName?: string;
  seen?: Record<string, number>;
  devices?: number;
}

export type SyncState = 'off' | 'idle' | 'syncing' | 'error' | 'reconnect';

export interface SyncStatus {
  state: SyncState;
  method?: SyncMethod;
  message?: string;
  /** Google account (Drive API) or folder name (folder sync). */
  where?: string;
  devices?: number;
  lastSyncAt?: number;
  clientId: string;
}

/** Device-local storage for the folder handle (handles can't go in localStorage). */
class LocalDB extends Dexie {
  kv!: Table<{ key: string; value: unknown }, string>;
  constructor() {
    super('langquiz-local');
    this.version(1).stores({ kv: 'key' });
  }
}
const local = new LocalDB();
let folderHandle: FileSystemDirectoryHandle | undefined;
/** Loaded from IndexedDB once per session, then kept in memory. */
const getHandle = async () => (folderHandle ??= (await local.kv.get('folder'))?.value as FileSystemDirectoryHandle | undefined);

const KEY = 'langquiz-sync';
const BUILT_IN_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

function load(): SyncConfig {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? '') as SyncConfig;
    return { ...c, method: c.method ?? (c.enabled ? 'drive-api' : undefined) };
  } catch {
    return { enabled: false };
  }
}

let config: SyncConfig = load();
let status: SyncStatus = makeStatus(config.enabled ? 'idle' : 'off');
const listeners = new Set<() => void>();

function save(patch: Partial<SyncConfig>) {
  config = { ...config, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // storage unavailable: sync still works for this session
  }
}

function makeStatus(state: SyncState, message?: string): SyncStatus {
  return {
    state,
    message,
    method: config.enabled ? config.method : undefined,
    where: config.method === 'folder' ? config.folderName : config.email,
    devices: config.method === 'folder' ? config.devices : undefined,
    lastSyncAt: config.lastSyncAt,
    clientId: clientId(),
  };
}

function setStatus(state: SyncState, message?: string) {
  status = makeStatus(state, message);
  listeners.forEach((fn) => fn());
}

export function clientId(): string {
  return config.clientId || BUILT_IN_CLIENT_ID;
}

export function setClientId(id: string) {
  save({ clientId: id.trim() || undefined });
  setStatus(status.state, status.message);
}

export { folderSupported, isMobileDevice };

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => status,
  );
}

function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'ChromeOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : 'Browser';
  return `${browser} on ${os}`;
}

class NeedsPermissionError extends Error {}

let running: Promise<void> | null = null;

async function runFolder(interactive: boolean, dirty: boolean) {
  const handle = await getHandle();
  if (!handle) throw new Error('The sync folder was forgotten by the browser. Choose it again.');
  if ((await folderPermission(handle, interactive)) !== 'granted') {
    throw new NeedsPermissionError(`Allow LangQuiz to use the "${handle.name}" folder again to keep syncing`);
  }
  setStatus('syncing');
  const root = await syncRoot(handleDir(handle));
  const r = await syncFolderOnce(db, root, deviceId(), deviceName(), dirty, config.seen ?? {});
  save({ seen: r.seen, devices: r.devices });
}

async function runDriveApi(interactive: boolean, dirty: boolean) {
  if (!clientId()) throw new Error('Add a Google OAuth client ID first (see the setup steps).');
  if (!config.token || config.token.expiresAt <= Date.now()) {
    if (!interactive) throw new NeedsAuthError();
    save({ token: await requestToken(clientId(), !config.enabled) });
    if (!config.email) save({ email: await fetchAccountEmail(config.token!.accessToken) });
  }
  setStatus('syncing');
  const result = await syncOnce(db, driveStore(config.token!.accessToken), config, dirty);
  save({ fileId: result.file.id, version: result.file.version });
}

/**
 * Run a sync. `interactive` must only be true inside a click handler: it may
 * open Google's sign-in popup or the browser's folder-permission prompt.
 */
export function syncNow(interactive = false): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      if (!config.enabled || !config.method) return;
      const dirty = config.dirty !== false;
      save({ dirty: false }); // edits made during this round set it again
      try {
        if (config.method === 'folder') await runFolder(interactive, dirty);
        else await runDriveApi(interactive, dirty);
      } catch (e) {
        if (dirty) save({ dirty: true });
        throw e;
      }
      save({ lastSyncAt: Date.now() });
      setStatus('idle');
    } catch (e) {
      if (e instanceof NeedsAuthError) save({ token: undefined });
      const needsClick = e instanceof NeedsAuthError || e instanceof NeedsPermissionError;
      setStatus(needsClick ? 'reconnect' : 'error', (e as Error).message);
      if (interactive) throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Start syncing with Google Drive through the API (must be called from a click). */
export async function connectDriveApi() {
  save({ enabled: true, method: 'drive-api', dirty: true, lastSyncAt: undefined });
  try {
    await syncNow(true);
  } catch (e) {
    if (!config.lastSyncAt) disconnect();
    throw e;
  }
}

/** Start syncing through a folder kept in sync by Drive for desktop, Dropbox… (must be called from a click). */
export async function connectFolder() {
  const handle = await pickFolder();
  folderHandle = handle;
  await local.kv.put({ key: 'folder', value: handle });
  save({ enabled: true, method: 'folder', folderName: handle.name, seen: {}, dirty: true, lastSyncAt: undefined, devices: undefined });
  try {
    await syncNow(true);
  } catch (e) {
    if (!config.lastSyncAt) disconnect();
    throw e;
  }
}

export function disconnect() {
  if (config.token) revokeToken(config.token.accessToken);
  folderHandle = undefined;
  local.kv.delete('folder').catch(() => {});
  save({
    enabled: false, method: undefined, token: undefined, email: undefined, fileId: undefined, version: undefined,
    folderName: undefined, seen: undefined, devices: undefined, lastSyncAt: undefined, dirty: true,
  });
  setStatus('off');
}

let started = false;

/** Keep this device in sync: after local edits, when the app regains focus, and periodically. */
export function startAutoSync() {
  if (started) return;
  started = true;
  if (config.enabled && config.method === 'drive-api' && clientId()) loadGoogleIdentity().catch(() => {});

  let debounce: number | undefined;
  onLocalChange(() => {
    if (!config.dirty) save({ dirty: true });
    if (!config.enabled) return;
    clearTimeout(debounce);
    debounce = window.setTimeout(() => syncNow(), 15_000);
  });

  document.addEventListener('visibilitychange', () => {
    if (!config.enabled) return;
    // Push pending edits when leaving; pull others' edits when coming back.
    if (document.visibilityState === 'hidden' ? config.dirty : Date.now() - (config.lastSyncAt ?? 0) > 60_000) syncNow();
  });

  // A folder is cheap to check (local disk), so check it every minute; the Drive API every 5.
  window.setInterval(() => {
    if (!config.enabled || document.visibilityState !== 'visible') return;
    if (config.method === 'folder' || Date.now() - (config.lastSyncAt ?? 0) >= 5 * 60_000) syncNow();
  }, 60_000);

  if (config.enabled) syncNow();
}
