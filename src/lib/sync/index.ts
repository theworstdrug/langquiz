import { useSyncExternalStore } from 'react';
import { db, onLocalChange } from '../db';
import { driveStore, fetchAccountEmail, loadGoogleIdentity, NeedsAuthError, requestToken, revokeToken, type StoredToken } from './drive';
import { syncOnce } from './engine';

/** Per-device sync configuration (localStorage, never synced itself). */
interface SyncConfig {
  enabled: boolean;
  clientId?: string;
  email?: string;
  fileId?: string;
  version?: string;
  lastSyncAt?: number;
  token?: StoredToken;
  dirty?: boolean;
}

export type SyncState = 'off' | 'idle' | 'syncing' | 'error' | 'reconnect';

export interface SyncStatus {
  state: SyncState;
  message?: string;
  email?: string;
  lastSyncAt?: number;
  clientId: string;
}

const KEY = 'langquiz-sync';
const BUILT_IN_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

function load(): SyncConfig {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '') as SyncConfig;
  } catch {
    return { enabled: false };
  }
}

function save(patch: Partial<SyncConfig>) {
  config = { ...config, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // storage unavailable: sync still works for this session
  }
}

let config: SyncConfig = load();
let status: SyncStatus = makeStatus(config.enabled ? 'idle' : 'off');
const listeners = new Set<() => void>();

function makeStatus(state: SyncState, message?: string): SyncStatus {
  return { state, message, email: config.email, lastSyncAt: config.lastSyncAt, clientId: clientId() };
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

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => status,
  );
}

const tokenValid = () => !!config.token && config.token.expiresAt > Date.now();

let running: Promise<void> | null = null;

/**
 * Run a sync. `interactive` must only be true inside a click handler: it may
 * open Google's sign-in popup when the session has expired.
 */
export function syncNow(interactive = false): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      if (!config.enabled && !interactive) return;
      if (!clientId()) throw new Error('Add a Google OAuth client ID first (see the setup steps below).');
      if (!tokenValid()) {
        if (!interactive) throw new NeedsAuthError();
        const firstTime = !config.enabled;
        save({ token: await requestToken(clientId(), firstTime), enabled: true });
        if (!config.email) save({ email: await fetchAccountEmail(config.token!.accessToken) });
      }
      setStatus('syncing');
      const dirty = config.dirty !== false;
      save({ dirty: false }); // edits made during this round set it again
      const result = await syncOnce(db, driveStore(config.token!.accessToken), config, dirty);
      save({ fileId: result.file.id, version: result.file.version, lastSyncAt: Date.now() });
      setStatus('idle');
    } catch (e) {
      if (e instanceof NeedsAuthError) {
        save({ token: undefined, dirty: true });
        setStatus(config.enabled ? 'reconnect' : 'off', e.message);
      } else {
        save({ dirty: true });
        setStatus(config.enabled ? 'error' : 'off', (e as Error).message);
      }
      if (interactive) throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

export function disconnect() {
  if (config.token) revokeToken(config.token.accessToken);
  save({ enabled: false, token: undefined, email: undefined, fileId: undefined, version: undefined, lastSyncAt: undefined, dirty: true });
  setStatus('off');
}

let started = false;

/** Keep this device in sync: after local edits, when the app regains focus, and periodically. */
export function startAutoSync() {
  if (started) return;
  started = true;
  if (config.enabled && clientId()) loadGoogleIdentity().catch(() => {});

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

  window.setInterval(() => {
    if (config.enabled && document.visibilityState === 'visible') syncNow();
  }, 5 * 60_000);

  if (config.enabled) syncNow();
}
