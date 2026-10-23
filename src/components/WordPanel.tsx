import { useEffect, useState } from 'react';
import { IGNORED, KNOWN, STATUS_LABELS, type Status, type Term } from '../lib/db';
import { deleteTerm, upsertTerm } from '../lib/actions';
import { dictionaryUrl, translate, wiktionary, type Definition } from '../lib/dictionary';
import { speak } from '../lib/tts';
import type { Settings } from '../lib/settings';

export interface Selection {
  key: string; // normalized term
  display: string; // as written in the text
  isPhrase: boolean;
  fragment: string;
}

interface Props {
  selection: Selection;
  term?: Term;
  lang: string;
  lessonId?: number;
  settings: Settings;
  /** Saved phrases on the page containing the selected word. */
  relatedPhrases: Term[];
  onSelectPhrase: (t: Term) => void;
  onExtend?: (dir: -1 | 1) => void;
  onClose: () => void;
}

export default function WordPanel({ selection, term, lang, lessonId, settings, relatedPhrases, onSelectPhrase, onExtend, onClose }: Props) {
  const [translations, setTranslations] = useState<string[] | null>(null);
  const [defs, setDefs] = useState<Definition[] | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [meaning, setMeaning] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [notes, setNotes] = useState(term?.notes ?? '');

  useEffect(() => setNotes(term?.notes ?? ''), [term?.id, term?.notes]);

  const lookup = () => {
    setTranslations(null);
    setDefs(null);
    setLookupError('');
    translate(selection.display, lang, settings.nativeLang)
      .then(setTranslations)
      .catch((e) => {
        setTranslations([]);
        setLookupError(String(e.message ?? e));
      });
    if (!selection.isPhrase && settings.nativeLang === 'en') {
      wiktionary(selection.key, lang).then(setDefs).catch(() => setDefs([]));
    } else setDefs([]);
  };

  useEffect(() => {
    setMeaning('');
    setTranslations(null);
    setDefs(null);
    if (settings.autoTranslate) lookup();
    if (settings.autoPronounce) speak(selection.display, lang, { rate: settings.ttsRate, voice: settings.ttsVoice[lang] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.key, lang]);

  const ctx = { fragment: selection.fragment, lessonId };
  const save = (patch: Partial<Term>) => upsertTerm(lang, selection.key, { isPhrase: selection.isPhrase, ...patch }, ctx);
  const status = term?.status;
  const isLingq = status !== undefined && status >= 1 && status <= 4;

  const addMeaning = (m: string) => {
    const v = m.trim();
    if (!v) return;
    const meanings = [...(term?.meanings ?? [])];
    if (!meanings.includes(v)) meanings.push(v);
    // Adding a meaning to a new/known word turns it into a LingQ (like LingQ does).
    save({ meanings, status: isLingq ? status : 1 });
    setMeaning('');
  };

  return (
    <aside className="word-panel card" aria-label="Word details">
      <div className="wp-head">
        <div>
          <div className="wp-term">{selection.display}</div>
          <div className="muted small">
            {term ? (status === undefined ? '' : STATUS_LABELS[status]) : 'New word'}
            {selection.isPhrase && ' · phrase'}
          </div>
        </div>
        <div className="row">
          <button className="icon" title="Pronounce (P)" onClick={() => speak(selection.display, lang, { rate: settings.ttsRate, voice: settings.ttsVoice[lang] })}>
            🔊
          </button>
          <button className="icon" title="Close (Esc)" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="status-row" role="group" aria-label="Status">
        {([1, 2, 3, 4] as Status[]).map((s) => (
          <button key={s} className={`status-btn s${s} ${status === s ? 'on' : ''}`} title={`${STATUS_LABELS[s]} (${s})`} onClick={() => save({ status: s })}>
            {s}
          </button>
        ))}
        <button className={`status-btn known ${status === KNOWN ? 'on' : ''}`} title="Known (K)" onClick={() => save({ status: KNOWN })}>
          ✓
        </button>
        <button className={`status-btn ignore ${status === IGNORED ? 'on' : ''}`} title="Ignore — names, numbers, etc. (X)" onClick={() => save({ status: IGNORED })}>
          🚫
        </button>
      </div>

      {term && term.meanings.length > 0 && (
        <ul className="meanings">
          {term.meanings.map((m, i) => (
            <li key={i}>
              <span>{m}</span>
              <button className="icon small" title="Remove meaning" onClick={() => save({ meanings: term.meanings.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          addMeaning(meaning);
        }}
      >
        <input value={meaning} onChange={(e) => setMeaning(e.target.value)} placeholder={isLingq ? 'Add another meaning…' : 'Type a meaning to create a LingQ…'} />
        <button type="submit" className="primary">
          Add
        </button>
      </form>

      <div className="suggestions">
        <div className="muted small row">
          Suggested meanings {translations === null && defs === null && !settings.autoTranslate && <button onClick={lookup}>Look up</button>}
        </div>
        {translations === null && settings.autoTranslate && <div className="muted small">Looking up…</div>}
        {translations?.map((t) => (
          <button key={t} className="suggestion" onClick={() => addMeaning(t)} title="Use this meaning">
            + {t}
          </button>
        ))}
        {defs?.map((d, i) => (
          <div key={i} className="def">
            <em className="muted small">{d.partOfSpeech}</em>
            {d.definitions.map((x) => (
              <button key={x} className="suggestion" onClick={() => addMeaning(x)}>
                + {x}
              </button>
            ))}
          </div>
        ))}
        {translations?.length === 0 && defs?.length === 0 && <div className="muted small">{lookupError || 'No suggestions found.'}</div>}
      </div>

      {onExtend && (
        <div className="row small">
          <span className="muted">Make a phrase:</span>
          <button onClick={() => onExtend(-1)}>← add previous word</button>
          <button onClick={() => onExtend(1)}>add next word →</button>
        </div>
      )}

      {relatedPhrases.length > 0 && (
        <div>
          <div className="muted small">Phrases with this word</div>
          {relatedPhrases.map((p) => (
            <button key={p.id} className="suggestion" onClick={() => onSelectPhrase(p)}>
              {p.term} {p.meanings[0] && <span className="muted">— {p.meanings[0]}</span>}
            </button>
          ))}
        </div>
      )}

      {term && (
        <>
          <label className="small">
            Notes
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== term.notes && save({ notes })} />
          </label>
          <div className="tags">
            {term.tags.map((t) => (
              <span key={t} className="pill">
                {t}{' '}
                <button className="icon small" onClick={() => save({ tags: term.tags.filter((x) => x !== t) })}>
                  ✕
                </button>
              </span>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const t = tagInput.trim();
                if (t && !term.tags.includes(t)) save({ tags: [...term.tags, t] });
                setTagInput('');
              }}
            >
              <input className="tag-input" value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="+ tag" />
            </form>
          </div>
        </>
      )}

      {selection.fragment && <blockquote className="fragment">{selection.fragment}</blockquote>}

      <div className="dict-links">
        {settings.dictionaries.map((d) => (
          <a key={d.name} href={dictionaryUrl(d, selection.display, lang, settings.nativeLang)} target="_blank" rel="noreferrer">
            {d.name} ↗
          </a>
        ))}
      </div>

      {term && (
        <button
          className="danger small"
          onClick={() => {
            deleteTerm(term.id!);
          }}
        >
          Delete (make word new again)
        </button>
      )}
    </aside>
  );
}
