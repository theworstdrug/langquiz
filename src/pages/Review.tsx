import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db, STATUS_LABELS, type Term } from '../lib/db';
import { bumpActivity } from '../lib/actions';
import { isDue, review, type Grade } from '../lib/srs';
import { normalize } from '../lib/tokenize';
import { speak } from '../lib/tts';
import type { Settings } from '../lib/settings';

type Mode = 'mixed' | 'flashcard' | 'reverse' | 'choice' | 'cloze' | 'dictation' | 'listening';
type Source = 'due' | 'all' | 'status1' | 'recent';

const MODE_LABELS: Record<Mode, string> = {
  mixed: 'Mixed',
  flashcard: 'Flashcards',
  reverse: 'Reverse flashcards',
  choice: 'Multiple choice',
  cloze: 'Fill in the blank',
  dictation: 'Dictation',
  listening: 'Listening',
};

interface Card {
  term: Term;
  mode: Exclude<Mode, 'mixed'>;
  choices?: string[];
}

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');

function clozeOf(t: Term): string | null {
  if (!t.fragment) return null;
  const idx = t.fragment.toLowerCase().indexOf(t.term.toLowerCase());
  if (idx < 0) return null;
  return t.fragment.slice(0, idx) + '_____' + t.fragment.slice(idx + t.term.length);
}

function buildCards(terms: Term[], pool: Term[], mode: Mode): Card[] {
  const meanings = [...new Set(pool.flatMap((t) => t.meanings.slice(0, 1)))];
  return terms.map((term) => {
    const possible: Card['mode'][] = ['flashcard', 'dictation'];
    if (term.meanings.length) possible.push('reverse');
    if (term.meanings.length && meanings.length >= 4) possible.push('choice', 'listening');
    if (clozeOf(term)) possible.push('cloze');
    let m: Card['mode'] = mode === 'mixed' ? possible[Math.floor(Math.random() * possible.length)] : mode;
    // Fall back when a card lacks the data a mode needs.
    if (!possible.includes(m)) m = 'flashcard';
    let choices: string[] | undefined;
    if (m === 'choice' || m === 'listening') {
      const right = term.meanings[0];
      const wrong = shuffle(meanings.filter((x) => !term.meanings.includes(x))).slice(0, 3);
      choices = shuffle([right, ...wrong]);
    }
    return { term, mode: m, choices };
  });
}

export default function Review({ settings }: { settings: Settings }) {
  const lang = settings.activeLang;
  const [params] = useSearchParams();
  const lessonId = params.get('lesson');
  const ids = params.get('ids');
  const [mode, setMode] = useState<Mode>('mixed');
  const [source, setSource] = useState<Source>('due');
  const [size, setSize] = useState(20);
  const [pool, setPool] = useState<Term[] | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<{ term: Term; correct: boolean }[]>([]);

  useEffect(() => {
    db.terms.where({ lang }).toArray().then(setPool);
  }, [lang, cards]);

  const candidates = useMemo(() => {
    if (!pool) return [];
    const lingqs = pool.filter((t) => t.status >= 1 && t.status <= 4);
    if (ids) {
      const set = new Set(ids.split(',').map(Number));
      return pool.filter((t) => set.has(t.id!));
    }
    if (lessonId) return lingqs.filter((t) => t.lessonId === Number(lessonId));
    switch (source) {
      case 'due':
        return lingqs.filter((t) => isDue(t)).sort((a, b) => a.due - b.due);
      case 'all':
        return shuffle(lingqs);
      case 'status1':
        return lingqs.filter((t) => t.status === 1);
      case 'recent':
        return [...lingqs].sort((a, b) => b.createdAt - a.createdAt);
    }
  }, [pool, source, ids, lessonId]);

  const start = () => {
    setCards(buildCards(candidates.slice(0, size), pool ?? [], mode));
    setI(0);
    setResults([]);
  };

  const answer = async (grade: Grade) => {
    if (!cards) return;
    const card = cards[i];
    const patch = review(card.term, grade);
    await db.terms.update(card.term.id!, patch);
    await bumpActivity(lang, 'reviews');
    setResults((r) => [...r, { term: { ...card.term, ...patch }, correct: grade !== 'again' }]);
    setI(i + 1);
  };

  if (!pool) return <p className="muted">Loading…</p>;

  if (!cards) {
    const dueCount = pool.filter((t) => isDue(t)).length;
    return (
      <div className="review-setup">
        <h1>Review</h1>
        <p className="muted">
          {dueCount} LingQs due for review. Correct answers raise a LingQ's status (1 → 4); misses send it back to 1.
        </p>
        <div className="card form">
          {ids || lessonId ? (
            <p>
              Reviewing <strong>{candidates.length}</strong> {ids ? 'selected terms' : "LingQs from this lesson"}.
            </p>
          ) : (
            <label>
              What to review
              <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
                <option value="due">Due now ({dueCount})</option>
                <option value="recent">Most recent LingQs</option>
                <option value="status1">Status 1 (new) only</option>
                <option value="all">All LingQs (random)</option>
              </select>
            </label>
          )}
          <label>
            Activity
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              {Object.entries(MODE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cards per session
            <input type="number" min={5} max={200} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </label>
          <button className="primary" disabled={!candidates.length} onClick={start}>
            Start ({Math.min(size, candidates.length)} cards)
          </button>
          {!candidates.length && <p className="muted small">Nothing to review here yet — create LingQs while reading.</p>}
        </div>
      </div>
    );
  }

  if (i >= cards.length) {
    const right = results.filter((r) => r.correct).length;
    return (
      <div className="card completion">
        <h1>Session complete</h1>
        <p className="big">
          {right} / {results.length} correct
        </p>
        <ul className="results">
          {results.map((r, k) => (
            <li key={k} className={r.correct ? 'ok' : 'bad'}>
              {r.correct ? '✓' : '✗'} <strong>{r.term.term}</strong> — {r.term.meanings[0] ?? ''}{' '}
              <span className="muted small">→ {STATUS_LABELS[r.term.status]}</span>
            </li>
          ))}
        </ul>
        <div className="row center">
          <button className="primary" onClick={() => setCards(null)}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="review">
      <div className="row between">
        <span className="muted small">
          {i + 1} / {cards.length} · {MODE_LABELS[cards[i].mode]}
        </span>
        <button onClick={() => setCards(null)}>End session</button>
      </div>
      <div className="bar">
        <div style={{ width: `${(i / cards.length) * 100}%` }} />
      </div>
      <CardView key={i} card={cards[i]} lang={lang} settings={settings} onAnswer={answer} />
    </div>
  );
}

function CardView({ card, lang, settings, onAnswer }: { card: Card; lang: string; settings: Settings; onAnswer: (g: Grade) => void }) {
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const t = card.term;
  const say = () => speak(t.term, lang, { rate: settings.ttsRate, voice: settings.ttsVoice[lang] });

  useEffect(() => {
    if (card.mode === 'dictation' || card.mode === 'listening') say();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter') && (card.mode === 'flashcard' || card.mode === 'reverse')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        onAnswer((['again', 'hard', 'good', 'easy'] as Grade[])[Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, card.mode, onAnswer]);

  const back = (
    <div className="card-back">
      <div className="card-term">
        {t.term}{' '}
        <button className="icon" onClick={say}>
          🔊
        </button>
      </div>
      <div className="card-meaning">{t.meanings.join('; ') || <span className="muted">(no meaning saved)</span>}</div>
      {t.fragment && <blockquote className="fragment">{t.fragment}</blockquote>}
      {t.notes && <p className="muted small">{t.notes}</p>}
    </div>
  );

  const grades = (
    <div className="grades">
      <button className="danger" onClick={() => onAnswer('again')}>
        1 · Again
      </button>
      <button onClick={() => onAnswer('hard')}>2 · Hard</button>
      <button className="primary" onClick={() => onAnswer('good')}>
        3 · Good
      </button>
      <button onClick={() => onAnswer('easy')}>4 · Easy</button>
    </div>
  );

  if (card.mode === 'flashcard' || card.mode === 'reverse') {
    return (
      <div className="card review-card">
        {!revealed ? (
          <>
            {card.mode === 'flashcard' ? (
              <div className="card-term">
                {t.term}{' '}
                <button className="icon" onClick={say}>
                  🔊
                </button>
              </div>
            ) : (
              <div className="card-meaning">{t.meanings.join('; ')}</div>
            )}
            <button className="primary" onClick={() => setRevealed(true)}>
              Show answer (space)
            </button>
          </>
        ) : (
          <>
            {back}
            {grades}
          </>
        )}
      </div>
    );
  }

  if (card.mode === 'choice' || card.mode === 'listening') {
    const right = t.meanings[0];
    return (
      <div className="card review-card">
        {card.mode === 'choice' ? (
          <div className="card-term">{t.term}</div>
        ) : (
          <button className="big-play" onClick={say}>
            🔊 Play
          </button>
        )}
        <div className="choices">
          {card.choices!.map((c) => (
            <button
              key={c}
              className={picked ? (c === right ? 'correct' : c === picked ? 'wrong' : '') : ''}
              disabled={!!picked}
              onClick={() => setPicked(c)}
            >
              {c}
            </button>
          ))}
        </div>
        {picked && (
          <>
            {back}
            <button className="primary" autoFocus onClick={() => onAnswer(picked === right ? 'good' : 'again')}>
              Continue
            </button>
          </>
        )}
      </div>
    );
  }

  // Typed answers: cloze & dictation.
  const target = normalize(t.term, lang);
  const guess = normalize(typed, lang);
  const exact = guess === target;
  const close = !exact && stripAccents(guess) === stripAccents(target);
  return (
    <div className="card review-card">
      {card.mode === 'cloze' ? (
        <>
          <p className="cloze">{clozeOf(t)}</p>
          {t.meanings[0] && <p className="muted">Hint: {t.meanings[0]}</p>}
        </>
      ) : (
        <button className="big-play" onClick={say}>
          🔊 Play again
        </button>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!revealed) setRevealed(true);
          else onAnswer(exact || close ? 'good' : 'again');
        }}
      >
        <input autoFocus value={typed} disabled={revealed} onChange={(e) => setTyped(e.target.value)} placeholder="Type what you hear / the missing word" lang={lang} />
        <button className="primary" type="submit">
          {revealed ? 'Continue' : 'Check'}
        </button>
      </form>
      {revealed && (
        <>
          <p className={exact || close ? 'ok' : 'bad'}>{exact ? '✓ Correct!' : close ? '✓ Almost — check the accents.' : `✗ The answer was “${t.term}”.`}</p>
          {back}
        </>
      )}
    </div>
  );
}
