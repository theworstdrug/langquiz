import { useState } from 'react';
import { LANGUAGES } from '../lib/languages';
import { getSettings, updateSettings } from '../lib/settings';
import { seedSample } from '../lib/sample';
import { clientId, connectDriveApi, connectFolder, folderSupported, isMobileDevice, setClientId } from '../lib/sync';

export default function Onboarding() {
  const [target, setTarget] = useState('es');
  const [native, setNative] = useState('en');
  const [sample, setSample] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [cid, setCid] = useState(clientId());
  const [error, setError] = useState('');

  const restore = async (connect: () => Promise<void>) => {
    setError('');
    setRestoring(true);
    try {
      await connect();
      const s = await getSettings();
      if (!s.languages.length) {
        throw new Error('Connected, but there is no LangQuiz data there yet. Finish the setup above; this device will sync from now on.');
      }
      // The active language is per device, so pick one from the synced list.
      await updateSettings({ activeLang: s.languages[0] });
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="onboarding card">
      <h1>Welcome to LangQuiz</h1>
      <p className="muted">
        Learn a language by reading and listening to content you love. Click any word to look it up and save it as a
        LingQ; everything you don't save becomes known as you turn the page.
      </p>
      <label>
        I want to learn
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        My native language
        <select value={native} onChange={(e) => setNative(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="row">
        <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} />
        Add a sample lesson (if available for this language)
      </label>
      <button
        className="primary"
        onClick={async () => {
          if (sample) await seedSample(target);
          await updateSettings({ activeLang: target, nativeLang: native, languages: [target] });
        }}
      >
        Start learning
      </button>
      <details className="restore">
        <summary>Already use LangQuiz on another device? Restore your data</summary>
        <div className="form">
          <p className="muted small">Use the same sync method as your other devices.</p>
          {folderSupported() && !isMobileDevice() && (
            <button onClick={() => restore(connectFolder)} disabled={restoring}>
              📁 Choose your sync folder…
            </button>
          )}
          {!clientId() && (
            <label>
              Google client ID (the same one your other devices use)
              <input value={cid} onChange={(e) => setCid(e.target.value)} placeholder="….apps.googleusercontent.com" />
            </label>
          )}
          <button
            onClick={() => {
              if (cid.trim() !== clientId()) setClientId(cid);
              restore(connectDriveApi);
            }}
            disabled={restoring || !cid.trim()}
          >
            {restoring ? 'Syncing…' : 'Sign in to Google Drive'}
          </button>
          {error && <div className="error small">{error}</div>}
        </div>
      </details>
    </div>
  );
}
