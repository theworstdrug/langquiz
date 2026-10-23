import { useState } from 'react';
import { LANGUAGES } from '../lib/languages';
import { updateSettings } from '../lib/settings';
import { seedSample } from '../lib/sample';

export default function Onboarding() {
  const [target, setTarget] = useState('es');
  const [native, setNative] = useState('en');
  const [sample, setSample] = useState(true);

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
    </div>
  );
}
