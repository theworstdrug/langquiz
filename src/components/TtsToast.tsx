import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { languageName } from '../lib/languages';
import { ttsEvents, type TtsErrorDetail } from '../lib/tts';

/** Explains why speech wasn't heard, instead of failing silently. */
export default function TtsToast() {
  const [err, setErr] = useState<TtsErrorDetail | null>(null);
  useEffect(() => {
    const shown = new Set<string>();
    let timer: number | undefined;
    const on = (e: Event) => {
      const d = (e as CustomEvent<TtsErrorDetail>).detail;
      const key = `${d.problem}|${d.lang}`;
      if (d.problem === 'no-voice' && shown.has(key)) return; // once per language per visit
      shown.add(key);
      setErr(d);
      clearTimeout(timer);
      timer = window.setTimeout(() => setErr(null), 8000);
    };
    ttsEvents.addEventListener('tts-error', on);
    return () => ttsEvents.removeEventListener('tts-error', on);
  }, []);
  if (!err) return null;
  return (
    <div className="toast" role="status">
      <span>
        🔇 {err.problem === 'no-voice' ? `No ${languageName(err.lang)} voice is installed on this device.` : err.message}
      </span>
      {(err.problem === 'no-voice' || err.problem === 'failed') && (
        <Link to="/settings" onClick={() => setErr(null)}>
          How to fix
        </Link>
      )}
      <button className="icon small" aria-label="Dismiss" onClick={() => setErr(null)}>
        ✕
      </button>
    </div>
  );
}
