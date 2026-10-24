/** Google Drive storage for the sync file, using Google Identity Services in the browser. */

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const SYNC_FILE_NAME = 'LangQuiz sync.json.gz';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export class NeedsAuthError extends Error {
  constructor(message = 'Sign in to Google Drive to sync') {
    super(message);
  }
}

export interface RemoteFile {
  id: string;
  version: string;
}

/** Storage the sync engine talks to; Drive in the app, an in-memory fake in tests. */
export interface RemoteStore {
  list(): Promise<RemoteFile[]>;
  download(id: string): Promise<ArrayBuffer>;
  upload(data: Blob, id?: string): Promise<RemoteFile>;
  remove(id: string): Promise<void>;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(opts?: { prompt?: string }): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

let gisPromise: Promise<void> | null = null;

export function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('Could not load Google sign-in. Check your connection or content blockers.'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

export interface StoredToken {
  accessToken: string;
  expiresAt: number;
}

/** Opens Google's consent popup. Must be called from a click handler. */
export async function requestToken(clientId: string, firstTime: boolean): Promise<StoredToken> {
  await loadGoogleIdentity();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) reject(new Error(r.error_description || r.error || 'Google sign-in failed'));
        else resolve({ accessToken: r.access_token, expiresAt: Date.now() + ((r.expires_in ?? 3600) - 60) * 1000 });
      },
      error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Sign-in window was closed' : e.message || e.type)),
    });
    client.requestAccessToken({ prompt: firstTime ? 'consent' : '' });
  });
}

export function revokeToken(token: string) {
  window.google?.accounts.oauth2.revoke(token);
}

export function driveStore(token: string): RemoteStore {
  const call = async (url: string, init: RequestInit = {}) => {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
    if (res.status === 401) throw new NeedsAuthError('Your Google session expired — reconnect to keep syncing');
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json())?.error?.message ?? '';
      } catch {
        // non-JSON error body
      }
      throw new Error(`Google Drive error ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return res;
  };

  return {
    async list() {
      const q = encodeURIComponent(`name = '${SYNC_FILE_NAME}' and trashed = false`);
      const res = await call(`${API}/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,version)`);
      return (await res.json()).files ?? [];
    },
    async download(id) {
      return (await call(`${API}/files/${id}?alt=media`)).arrayBuffer();
    },
    async upload(data, id) {
      if (id) {
        const res = await call(`${UPLOAD}/files/${id}?uploadType=media&fields=id,version`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/gzip' },
          body: data,
        });
        return res.json();
      }
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({ name: SYNC_FILE_NAME, mimeType: 'application/gzip' })], { type: 'application/json' }));
      form.append('file', data);
      const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id,version`, { method: 'POST', body: form });
      return res.json();
    },
    async remove(id) {
      await call(`${API}/files/${id}`, { method: 'DELETE' });
    },
  };
}

export async function fetchAccountEmail(token: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${API}/about?fields=user(emailAddress)`, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok ? (await res.json()).user?.emailAddress : undefined;
  } catch {
    return undefined;
  }
}
