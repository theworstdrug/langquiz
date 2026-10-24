import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { LANGUAGES, languageName } from '../lib/languages';
import { DEFAULT_DICTIONARIES, updateSettings, type Settings } from '../lib/settings';
import { download, exportBackup, importBackup } from '../lib/backup';
import { seedSample } from '../lib/sample';
import { speak, ttsSupported, voicesFor } from '../lib/tts';
import SyncSettings from '../components/SyncSettings';

export default function SettingsPage({ settings }: { settings: Settings }) {
  const lang = settings.activeLang;
  const [addLang, setAddLang] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!ttsSupported()) return;
    const load = () => setVoices(voicesFor(lang));
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, [lang]);

  const set = (patch: Partial<Settings>) => updateSettings(patch);

  return (
    <div className="settings">
      <h1>Settings</h1>

      <section className="card form">
        <h2>Languages</h2>
        <div className="tags">
          {settings.languages.map((l) => (
            <span key={l} className={`pill ${l === lang ? 'yellow' : ''}`}>
              <button className="link" onClick={() => set({ activeLang: l })}>
                {languageName(l)}
              </button>
              {settings.languages.length > 1 && (
                <button
                  className="icon small"
                  title="Remove from list (data is kept)"
                  onClick={() => {
                    const languages = settings.languages.filter((x) => x !== l);
                    set({ languages, activeLang: l === lang ? languages[0] : lang });
                  }}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="row">
          <select value={addLang} onChange={(e) => setAddLang(e.target.value)}>
            <option value="">Add a language…</option>
            {LANGUAGES.filter((l) => !settings.languages.includes(l.code)).map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
          <button
            disabled={!addLang}
            onClick={async () => {
              await seedSample(addLang);
              await set({ languages: [...settings.languages, addLang], activeLang: addLang });
              setAddLang('');
            }}
          >
            Add & switch
          </button>
        </div>
        <label>
          Native language (for translations)
          <select value={settings.nativeLang} onChange={(e) => set({ nativeLang: e.target.value })}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <SyncSettings />

      <section className="card form">
        <h2>Reading</h2>
        <label>
          Daily goal (LingQs created per day)
          <input type="number" min={1} value={settings.dailyGoal} onChange={(e) => set({ dailyGoal: Math.max(1, Number(e.target.value)) })} />
        </label>
        <label>
          Words per page
          <input type="number" min={50} step={50} value={settings.wordsPerPage} onChange={(e) => set({ wordsPerPage: Math.max(50, Number(e.target.value)) })} />
        </label>
        <label className="row">
          <input type="checkbox" checked={settings.autoKnownOnPageTurn} onChange={(e) => set({ autoKnownOnPageTurn: e.target.checked })} />
          Mark remaining blue words as known when turning the page
        </label>
        <label className="row">
          <input type="checkbox" checked={settings.autoTranslate} onChange={(e) => set({ autoTranslate: e.target.checked })} />
          Look up suggested meanings automatically when clicking a word
        </label>
        <label className="row">
          <input type="checkbox" checked={settings.autoPronounce} onChange={(e) => set({ autoPronounce: e.target.checked })} />
          Pronounce words when clicked
        </label>
        <label>
          Font size: {settings.fontSize}px
          <input type="range" min={12} max={40} value={settings.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
        </label>
        <label>
          Line height: {settings.lineHeight}
          <input type="range" min={1.2} max={2.6} step={0.1} value={settings.lineHeight} onChange={(e) => set({ lineHeight: Number(e.target.value) })} />
        </label>
        <label>
          Theme
          <select value={settings.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </section>

      <section className="card form">
        <h2>Text-to-speech</h2>
        {!ttsSupported() ? (
          <p className="muted">Your browser does not support speech synthesis.</p>
        ) : (
          <>
            <label>
              Voice for {languageName(lang)}
              <select value={settings.ttsVoice[lang] ?? ''} onChange={(e) => set({ ttsVoice: { ...settings.ttsVoice, [lang]: e.target.value } })}>
                <option value="">Default</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
              {voices.length === 0 && <span className="muted small">No {languageName(lang)} voices installed on this device.</span>}
            </label>
            <label>
              Speed: {settings.ttsRate}×
              <input type="range" min={0.5} max={1.5} step={0.05} value={settings.ttsRate} onChange={(e) => set({ ttsRate: Number(e.target.value) })} />
            </label>
            <button onClick={() => speak(LANGUAGES.find((l) => l.code === lang)?.name ?? 'Hello', lang, { rate: settings.ttsRate, voice: settings.ttsVoice[lang] })}>Test voice</button>
          </>
        )}
      </section>

      <section className="card form">
        <h2>Dictionaries</h2>
        <p className="muted small">
          Links shown in the word panel. Use <code>{'{word}'}</code>, <code>{'{from}'}</code>, <code>{'{to}'}</code>, <code>{'{fromName}'}</code>, <code>{'{toName}'}</code>.
        </p>
        {settings.dictionaries.map((d, i) => (
          <div key={i} className="row">
            <input
              value={d.name}
              style={{ maxWidth: 160 }}
              onChange={(e) => set({ dictionaries: settings.dictionaries.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
            />
            <input value={d.url} onChange={(e) => set({ dictionaries: settings.dictionaries.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
            <button className="icon danger" onClick={() => set({ dictionaries: settings.dictionaries.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
        <div className="row">
          <button onClick={() => set({ dictionaries: [...settings.dictionaries, { name: 'New dictionary', url: 'https://example.com/?q={word}' }] })}>+ Add dictionary</button>
          <button onClick={() => set({ dictionaries: DEFAULT_DICTIONARIES })}>Reset to defaults</button>
        </div>
        <label>
          CORS proxy for web-page import (optional)
          <input value={settings.corsProxy} onChange={(e) => set({ corsProxy: e.target.value })} placeholder="https://your-proxy.example/?url={url}" />
          <span className="muted small">Browsers block reading most websites directly. If you run a proxy, enter its URL with {'{url}'} as the placeholder.</span>
        </label>
      </section>

      <section className="card form">
        <h2>Your data</h2>
        <p className="muted small">
          Everything is stored in this browser (IndexedDB), and in your Google Drive if cloud sync is on. Audio files are not included in backups or sync.
        </p>
        <div className="row">
          <button onClick={async () => download(await exportBackup(), `langquiz-backup-${new Date().toISOString().slice(0, 10)}.json`)}>Export backup</button>
          <label className="btn">
            Restore backup…
            <input
              type="file"
              accept=".json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f || !confirm('Restoring replaces ALL current data. Continue?')) return;
                try {
                  await importBackup(await f.text());
                } catch (err) {
                  alert((err as Error).message);
                }
              }}
            />
          </label>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm('Delete ALL lessons, vocabulary and stats on this device? This cannot be undone. (If cloud sync is on, your Drive copy is kept and will sync back.)')) return;
              await db.delete();
              location.reload();
            }}
          >
            Reset everything
          </button>
        </div>
      </section>
    </div>
  );
}
