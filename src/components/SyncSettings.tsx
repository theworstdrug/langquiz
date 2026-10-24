import { useState } from 'react';
import { clientId, connectDriveApi, connectFolder, disconnect, folderSupported, isMobileDevice, setClientId, syncNow, useSyncStatus, type SyncMethod } from '../lib/sync';
import { SYNC_FILE_NAME } from '../lib/sync/drive';
import { timeAgo } from './SyncIndicator';

const METHOD_LABEL: Record<SyncMethod, string> = { folder: 'Sync folder', 'drive-api': 'Google Drive (sign-in)' };

export default function SyncSettings() {
  const s = useSyncStatus();
  const folderOk = folderSupported() && !isMobileDevice();
  const [choice, setChoice] = useState<SyncMethod>(folderOk ? 'folder' : 'drive-api');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      // Closing the folder picker is not an error worth showing.
      if ((e as DOMException).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card form" id="sync">
      <h2>Cloud sync</h2>
      <p className="muted small">
        Keep lessons, vocabulary, stats and settings in step across your devices. Edits from different devices are merged: each word or lesson keeps its most recent change. Audio files you uploaded stay on the device you added them on.
      </p>

      {s.state === 'off' ? (
        <>
          <div className="method-picker" role="radiogroup" aria-label="Sync method">
            <MethodCard
              id="folder"
              choice={choice}
              onChoose={setChoice}
              title="Sync folder"
              badge="No setup"
              disabled={!folderOk}
              body={
                folderOk
                  ? 'Pick a folder that Google Drive for desktop (or Dropbox, OneDrive, iCloud Drive…) already syncs. LangQuiz keeps plain JSON files there. Computers only.'
                  : isMobileDevice()
                    ? 'Computers only: phone apps for Drive, Dropbox and others don\'t keep a local folder in sync.'
                    : 'Not available in this browser. It needs Chrome or Edge on a computer (Firefox and Safari can\'t open folders).'
              }
            />
            <MethodCard
              id="drive-api"
              choice={choice}
              onChoose={setChoice}
              title="Google Drive (sign-in)"
              badge="Works on phones"
              body={`Sign in with Google; LangQuiz keeps one file, ${SYNC_FILE_NAME}, in your Drive. Works in every browser, but needs a one-time Google client ID.`}
            />
          </div>

          <p className="muted small">
            The two methods keep their data in different places, so use the same one on all your devices. If you want to sync a phone, choose Google Drive sign-in everywhere.
          </p>

          {choice === 'folder' ? (
            <>
              <ol className="setup-steps small">
                <li>
                  Install <a href="https://www.google.com/drive/download/" target="_blank" rel="noreferrer">Google Drive for desktop</a> (or use any folder another sync app keeps up to date).
                </li>
                <li>
                  Click below and choose a folder inside it, for example <em>Google Drive → My Drive</em>. LangQuiz creates a <code>LangQuiz</code> folder there.
                </li>
                <li>On your other computers, pick the same folder.</li>
              </ol>
              <div className="row">
                <button className="primary" disabled={!folderOk || busy} onClick={() => run(connectFolder)}>
                  {busy ? 'Syncing…' : 'Choose sync folder…'}
                </button>
              </div>
            </>
          ) : (
            <>
              <ClientIdSetup />
              <div className="row">
                <button className="primary" disabled={!s.clientId || busy} onClick={() => run(connectDriveApi)}>
                  {busy ? 'Syncing…' : 'Connect Google Drive'}
                </button>
                {!s.clientId && <span className="muted small">Add a client ID above first.</span>}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="sync-summary">
            <div>
              <div className="muted small">{s.method && METHOD_LABEL[s.method]}</div>
              <strong>{s.method === 'folder' ? `📁 ${s.where ?? 'Folder'}` : s.where ?? 'Google Drive'}</strong>
              <div className="muted small">
                {s.state === 'syncing' ? 'Syncing…' : `Last synced ${timeAgo(s.lastSyncAt)}`}
                {s.state === 'idle' && ' · syncs automatically'}
                {s.devices ? ` · ${s.devices} device${s.devices === 1 ? '' : 's'} in this folder` : ''}
              </div>
            </div>
            <div className="row">
              <button className="primary" onClick={() => run(() => syncNow(true))} disabled={s.state === 'syncing'}>
                {s.state === 'reconnect' ? (s.method === 'folder' ? 'Allow folder access' : 'Reconnect') : 'Sync now'}
              </button>
              <button onClick={() => confirm('Stop syncing this device? Your data stays here and in the synced copy.') && disconnect()}>Disconnect</button>
            </div>
          </div>
          {(s.state === 'error' || s.state === 'reconnect') && s.message && <div className={s.state === 'error' ? 'error' : 'muted small'}>{s.message}</div>}
          {s.method === 'drive-api' && (
            <details className="small">
              <summary>Google client ID</summary>
              <ClientIdSetup />
            </details>
          )}
        </>
      )}
      {error && <div className="error">{error}</div>}
    </section>
  );
}

function MethodCard({ id, choice, onChoose, title, badge, body, disabled }: { id: SyncMethod; choice: SyncMethod; onChoose: (m: SyncMethod) => void; title: string; badge: string; body: string; disabled?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={choice === id} className={`method-card ${choice === id ? 'on' : ''}`} disabled={disabled} onClick={() => onChoose(id)}>
      <span className="row between">
        <strong>{title}</strong>
        <span className="pill">{badge}</span>
      </span>
      <span className="muted small">{body}</span>
    </button>
  );
}

export function ClientIdSetup() {
  const [idInput, setIdInput] = useState(clientId());
  const origin = location.origin;
  return (
    <div className="form">
      {!clientId() && (
        <ol className="setup-steps small">
          <li>
            Open the <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud console</a> and create a project (any name, e.g. "LangQuiz").
          </li>
          <li>
            Enable the <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">Google Drive API</a> for it.
          </li>
          <li>
            Set up the <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">OAuth consent screen</a>: choose <em>External</em>, then under <em>Audience</em> add your Google account as a test user.
          </li>
          <li>
            In <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Clients</a>, create a <em>Web application</em> client with <code>{origin}</code> as an authorized JavaScript origin.
          </li>
          <li>Paste the client ID (ending in <code>.apps.googleusercontent.com</code>) here.</li>
        </ol>
      )}
      <div className="row">
        <input value={idInput} onChange={(e) => setIdInput(e.target.value)} placeholder="1234567890-abc….apps.googleusercontent.com" aria-label="Google client ID" />
        <button onClick={() => setClientId(idInput)} disabled={idInput.trim() === clientId()}>
          Save
        </button>
      </div>
      {idInput && !/\.apps\.googleusercontent\.com$/.test(idInput.trim()) && <div className="error small">That doesn't look like a Google OAuth client ID.</div>}
    </div>
  );
}
