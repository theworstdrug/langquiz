import { useState } from 'react';
import { clientId, disconnect, setClientId, syncNow, useSyncStatus } from '../lib/sync';
import { SYNC_FILE_NAME } from '../lib/sync/drive';
import { timeAgo } from './SyncIndicator';

export default function SyncSettings() {
  const s = useSyncStatus();
  const [error, setError] = useState('');
  const [idInput, setIdInput] = useState(clientId());
  const [showSetup, setShowSetup] = useState(!s.clientId);
  const origin = location.origin;

  const run = async () => {
    setError('');
    try {
      await syncNow(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="card form" id="sync">
      <h2>Cloud sync (Google Drive)</h2>
      <p className="muted small">
        Keep your lessons, vocabulary, stats and settings in step across your devices. LangQuiz stores one file, <code>{SYNC_FILE_NAME}</code>, in your own Google Drive and can only see files it created. Changes from different devices are merged: each word or lesson keeps its most recent edit. Audio files you uploaded stay on the device you added them on.
      </p>

      {s.state === 'off' ? (
        <div className="row">
          <button className="primary" onClick={run} disabled={!s.clientId}>
            Connect Google Drive
          </button>
          {!s.clientId && <span className="muted small">Add a client ID below first.</span>}
        </div>
      ) : (
        <>
          <div className="sync-summary">
            <div>
              <strong>{s.email ?? 'Google Drive'}</strong>
              <div className="muted small">
                {s.state === 'syncing' ? 'Syncing…' : `Last synced ${timeAgo(s.lastSyncAt)}`}
                {s.state === 'idle' && ' · syncs automatically'}
              </div>
            </div>
            <div className="row">
              <button className="primary" onClick={run} disabled={s.state === 'syncing'}>
                {s.state === 'reconnect' ? 'Reconnect' : 'Sync now'}
              </button>
              <button onClick={() => confirm('Stop syncing this device? Your data stays here and in Drive.') && disconnect()}>Disconnect</button>
            </div>
          </div>
          {(s.state === 'error' || s.state === 'reconnect') && s.message && <div className={s.state === 'error' ? 'error' : 'muted small'}>{s.message}</div>}
        </>
      )}
      {error && <div className="error">{error}</div>}

      <details open={showSetup} onToggle={(e) => setShowSetup((e.target as HTMLDetailsElement).open)}>
        <summary className="small">{s.clientId ? 'Google client ID' : 'One-time setup: create a Google client ID (about 5 minutes)'}</summary>
        <ol className="setup-steps small">
          <li>
            Open the <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud console</a> and create a project (any name, e.g. "LangQuiz").
          </li>
          <li>
            Enable the <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">Google Drive API</a> for it.
          </li>
          <li>
            Set up the <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">OAuth consent screen</a>: choose <em>External</em>, fill in the app name and your email, then under <em>Audience</em> add your Google account as a test user.
          </li>
          <li>
            Go to <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Clients</a> → <em>Create client</em> → <em>Web application</em>. Under <em>Authorized JavaScript origins</em> add <code>{origin}</code> (and any other address you open LangQuiz from).
          </li>
          <li>Copy the client ID (it ends in <code>.apps.googleusercontent.com</code>) and paste it here. Do this once on each device, or bake it into the hosted site (see the README).</li>
        </ol>
        <div className="row">
          <input value={idInput} onChange={(e) => setIdInput(e.target.value)} placeholder="1234567890-abc….apps.googleusercontent.com" />
          <button
            onClick={() => {
              setClientId(idInput);
              setError('');
            }}
            disabled={idInput.trim() === clientId()}
          >
            Save
          </button>
        </div>
        {idInput && !/\.apps\.googleusercontent\.com$/.test(idInput.trim()) && <div className="error small">That doesn't look like a Google OAuth client ID.</div>}
      </details>
    </section>
  );
}
