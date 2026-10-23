import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db, IGNORED, KNOWN, type Lesson, type Status, type Term } from '../lib/db';
import { bumpActivity, markWordsKnown, updateLessonText, upsertTerm } from '../lib/actions';
import { useTermMap } from '../lib/hooks';
import { getLanguage } from '../lib/languages';
import { translate } from '../lib/dictionary';
import { speak, stopSpeaking } from '../lib/tts';
import { updateSettings, type Settings } from '../lib/settings';
import { findPhrases, paginate, phraseKey, sentenceAround, splitSentences, type Paragraph } from '../lib/tokenize';
import WordPanel, { type Selection } from '../components/WordPanel';

interface Range {
  p: number;
  s: number;
  e: number;
}

const SENTENCE_END = /[.!?。！？]/;

/** Split a page into sentences, keeping (paragraph, token range) addresses. */
function pageSentences(page: Paragraph[]): Range[] {
  const out: Range[] = [];
  page.forEach((para, p) => {
    let s = 0;
    para.tokens.forEach((t, i) => {
      if (SENTENCE_END.test(t.text) && !t.isWord) {
        // include trailing quotes/brackets
        let e = i;
        while (e + 1 < para.tokens.length && /^[”"»)\]’']+$/.test(para.tokens[e + 1].text)) e++;
        if (para.tokens.slice(s, e + 1).some((x) => x.isWord)) out.push({ p, s, e });
        s = e + 1;
      }
    });
    if (para.tokens.slice(s).some((x) => x.isWord)) out.push({ p, s, e: para.tokens.length - 1 });
  });
  return out;
}

function rangeText(page: Paragraph[], r: Range) {
  return page[r.p].tokens
    .slice(r.s, r.e + 1)
    .map((t) => t.text)
    .join('')
    .trim();
}

async function translateLong(text: string, from: string, to: string) {
  // MyMemory accepts ~500 chars per request; translate sentence by sentence.
  const parts = text.length <= 450 ? [text] : splitSentences(text, from);
  const out: string[] = [];
  for (const part of parts) out.push((await translate(part.trim(), from, to))[0] ?? '');
  return out.join(' ');
}

export default function Reader({ settings }: { settings: Settings }) {
  const { id } = useParams();
  const lessonId = Number(id);
  const lesson = useLiveQuery(() => db.lessons.get(lessonId), [lessonId]);
  const lang = lesson?.lang ?? settings.activeLang;
  const terms = useTermMap(lang);
  const rtl = getLanguage(lang).rtl;

  const pages = useMemo(
    () => (lesson ? paginate(lesson.text, lesson.lang, settings.wordsPerPage, lesson.segments) : []),
    // segments is a fresh array on every live-query refresh; its length is a sufficient identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lesson?.id, lesson?.text, lesson?.segments?.length, settings.wordsPerPage],
  );

  const [pageIdx, setPageIdx] = useState<number | null>(null);
  const [range, setRange] = useState<Range | null>(null);
  const [phraseSel, setPhraseSel] = useState<Selection | null>(null);
  const [drag, setDrag] = useState<Range | null>(null);
  const [sentenceMode, setSentenceMode] = useState(false);
  const [sentIdx, setSentIdx] = useState(0);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [speakingPara, setSpeakingPara] = useState<number | null>(null);
  const [completed, setCompleted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string>();
  const [audioTime, setAudioTime] = useState(0);
  const [followAudio, setFollowAudio] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const listened = useRef({ last: 0, pending: 0 });

  // Initialise page from the saved position and record the visit.
  useEffect(() => {
    if (lesson && pageIdx === null) {
      setPageIdx(Math.min(lesson.page, Math.max(0, pages.length - 1)));
      db.lessons.update(lessonId, { lastOpenedAt: Date.now() });
    }
  }, [lesson, pageIdx, pages.length, lessonId]);

  // Load audio once per lesson (Blob identity changes on every live-query refresh).
  useEffect(() => {
    let url: string | undefined;
    db.lessons.get(lessonId).then((l) => {
      if (l?.audio) url = URL.createObjectURL(l.audio);
      setAudioUrl(url ?? l?.mediaUrl);
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [lessonId, lesson?.mediaUrl, lesson?.audioName]);

  // Flush listening time.
  const flushListening = useCallback(() => {
    const secs = Math.round(listened.current.pending);
    if (secs > 0 && lesson) {
      listened.current.pending -= secs;
      bumpActivity(lesson.lang, 'listeningSeconds', secs);
    }
  }, [lesson]);
  useEffect(() => () => flushListening(), [flushListening]);
  useEffect(() => () => stopSpeaking(), []);

  const page = pages[pageIdx ?? 0] ?? [];
  const sentences = useMemo(() => pageSentences(page), [page]);

  const phraseTerms = useMemo(() => (terms ? [...terms.values()].filter((t) => t.isPhrase && t.status !== IGNORED) : []), [terms]);
  const phraseMatches = useMemo(
    () => page.map((para) => findPhrases(para.tokens, phraseTerms.map((t) => t.term), lang)),
    [page, phraseTerms, lang],
  );

  const selection: Selection | null = useMemo(() => {
    if (phraseSel) return phraseSel;
    if (!range) return null;
    const tokens = page[range.p]?.tokens;
    if (!tokens) return null;
    const slice = tokens.slice(range.s, range.e + 1);
    const words = slice.filter((t) => t.isWord);
    if (!words.length) return null;
    const fragment = sentenceAround(tokens, range.s);
    if (words.length === 1) return { key: words[0].norm, display: words[0].text, isPhrase: false, fragment };
    return { key: phraseKey(slice, lang), display: slice.map((t) => t.text).join('').trim(), isPhrase: true, fragment };
  }, [range, phraseSel, page, lang]);

  const select = (r: Range | null) => {
    setPhraseSel(null);
    setRange(r);
  };

  const turnPage = useCallback(
    async (delta: number) => {
      if (!lesson || pageIdx === null || !terms) return;
      stopSpeaking();
      setSpeakingPara(null);
      if (delta > 0) {
        const words = page.flatMap((p) => p.tokens.filter((t) => t.isWord));
        if (settings.autoKnownOnPageTurn) await markWordsKnown(lang, words.filter((t) => !terms.has(t.norm)).map((t) => t.norm));
        await bumpActivity(lang, 'wordsRead', words.length);
      }
      const next = pageIdx + delta;
      if (next >= pages.length) {
        await db.lessons.update(lessonId, { completed: true, timesCompleted: (lesson.timesCompleted ?? 0) + 1, page: 0 });
        await bumpActivity(lang, 'lessonsCompleted');
        setCompleted(true);
        select(null);
        return;
      }
      if (next < 0) return;
      setPageIdx(next);
      setSentIdx(delta > 0 ? 0 : -1);
      select(null);
      db.lessons.update(lessonId, { page: next });
      window.scrollTo({ top: 0 });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lesson, pageIdx, terms, page, pages.length, settings.autoKnownOnPageTurn, lang, lessonId],
  );

  // Sentence index -1 means "last sentence of the page" (after going back).
  useEffect(() => {
    if (sentIdx === -1 && sentences.length) setSentIdx(sentences.length - 1);
  }, [sentIdx, sentences.length]);

  const wordPositions = useMemo(() => {
    const out: Range[] = [];
    page.forEach((para, p) =>
      para.tokens.forEach((t, i) => {
        if (t.isWord) out.push({ p, s: i, e: i });
      }),
    );
    return out;
  }, [page]);

  const moveWord = useCallback(
    (dir: 1 | -1) => {
      if (!terms) return;
      const cur = range ? wordPositions.findIndex((w) => w.p === range.p && w.s === range.s) : -1;
      for (let i = cur + dir; i >= 0 && i < wordPositions.length; i += dir) {
        const w = wordPositions[i];
        const t = terms.get(page[w.p].tokens[w.s].norm);
        if (!t || (t.status >= 1 && t.status <= 4)) {
          select(w);
          return;
        }
      }
    },
    [range, wordPositions, terms, page],
  );

  const setStatus = useCallback(
    (status: Status) => {
      if (!selection) return;
      upsertTerm(lang, selection.key, { status, isPhrase: selection.isPhrase }, { fragment: selection.fragment, lessonId });
    },
    [selection, lang, lessonId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || completed || editing) return;
      if (e.key === 'ArrowRight' && e.shiftKey) turnPage(1);
      else if (e.key === 'ArrowLeft' && e.shiftKey) turnPage(-1);
      else if (e.key === 'ArrowRight') moveWord(1);
      else if (e.key === 'ArrowLeft') moveWord(-1);
      else if (e.key === 'Escape') select(null);
      else if (['1', '2', '3', '4'].includes(e.key)) setStatus(Number(e.key) as Status);
      else if (e.key === 'k' || e.key === 'K') setStatus(KNOWN);
      else if (e.key === 'x' || e.key === 'X') setStatus(IGNORED);
      else if ((e.key === 'p' || e.key === 'P') && selection) speak(selection.display, lang, { rate: settings.ttsRate, voice: settings.ttsVoice[lang] });
      else if (e.key === ' ' && audioRef.current) {
        e.preventDefault();
        audioRef.current.paused ? audioRef.current.play() : audioRef.current.pause();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turnPage, moveWord, setStatus, selection, lang, settings, completed, editing]);

  // Finish a drag-selection anywhere on the page.
  useEffect(() => {
    const up = () => {
      if (!drag) return;
      const r = { p: drag.p, s: Math.min(drag.s, drag.e), e: Math.max(drag.s, drag.e) };
      setDrag(null);
      select(r);
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [drag]);

  // Audio ↔ subtitle sync.
  const activeSeg = useMemo(() => {
    if (!lesson?.segments) return null;
    for (let pi = 0; pi < pages.length; pi++) {
      const idx = pages[pi].findIndex((p) => p.start !== undefined && audioTime >= p.start && audioTime < (p.end ?? Infinity));
      if (idx >= 0) return { page: pi, para: idx };
    }
    return null;
  }, [audioTime, pages, lesson?.segments]);

  useEffect(() => {
    if (followAudio && activeSeg && activeSeg.page !== pageIdx && audioRef.current && !audioRef.current.paused) {
      setPageIdx(activeSeg.page);
      db.lessons.update(lessonId, { page: activeSeg.page });
    }
  }, [activeSeg, followAudio, pageIdx, lessonId]);

  if (lesson === undefined || !terms || pageIdx === null) {
    return lesson === undefined ? <p className="muted">Loading…</p> : null;
  }
  if (!lesson) return <p>Lesson not found. <Link to="/">Back to library</Link></p>;

  const term = selection ? terms.get(selection.key) : undefined;

  const renderTokens = (p: number, from = 0, to = page[p].tokens.length - 1) => {
    const para = page[p];
    const inPhrase = new Map<number, Term>();
    for (const m of phraseMatches[p]) {
      const t = terms.get(m.key);
      if (t) for (let i = m.start; i <= m.end; i++) inPhrase.set(i, t);
    }
    const dragR = drag && drag.p === p ? { s: Math.min(drag.s, drag.e), e: Math.max(drag.s, drag.e) } : null;
    const selR = !phraseSel && range && range.p === p ? range : null;
    const out = [];
    for (let i = from; i <= to; i++) {
      const tok = para.tokens[i];
      const ph = inPhrase.get(i);
      const selected = (selR && i >= selR.s && i <= selR.e) || (dragR && i >= dragR.s && i <= dragR.e);
      const phCls = ph ? ` ph ph-s${ph.status}` : '';
      if (!tok.isWord) {
        out.push(
          <span key={i} className={(selected ? 'sel' : '') + (ph && inPhrase.get(i + 1) === ph ? phCls : '')}>
            {tok.text}
          </span>,
        );
        continue;
      }
      const t = terms.get(tok.norm);
      const cls = !t ? 'new' : t.status >= 1 && t.status <= 4 ? `s${t.status}` : '';
      out.push(
        <span
          key={i}
          className={`w ${cls}${phCls}${selected ? ' sel' : ''}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            if (e.shiftKey && range && range.p === p) {
              select({ p, s: Math.min(range.s, i), e: Math.max(range.e, i) });
              return;
            }
            setDrag({ p, s: i, e: i });
          }}
          onPointerEnter={() => drag && drag.p === p && setDrag({ ...drag, e: i })}
        >
          {tok.text}
        </span>,
      );
    }
    return out;
  };

  const translateKey = (r: Range) => `${pageIdx}:${r.p}:${r.s}`;
  const toggleTranslation = async (r: Range) => {
    const k = translateKey(r);
    if (translations[k] !== undefined) {
      const { [k]: _, ...rest } = translations;
      setTranslations(rest);
      return;
    }
    setTranslations((x) => ({ ...x, [k]: '…' }));
    try {
      const t = await translateLong(rangeText(page, r), lang, settings.nativeLang);
      setTranslations((x) => ({ ...x, [k]: t || '(no translation)' }));
    } catch (e) {
      setTranslations((x) => ({ ...x, [k]: `Translation failed: ${(e as Error).message}` }));
    }
  };

  const playParagraph = (p: number) => {
    const para = page[p];
    if (para.start !== undefined && audioRef.current) {
      audioRef.current.currentTime = para.start;
      audioRef.current.play();
      return;
    }
    const readFrom = (i: number) => {
      if (i >= page.length) return setSpeakingPara(null);
      setSpeakingPara(i);
      speak(rangeText(page, { p: i, s: 0, e: page[i].tokens.length - 1 }), lang, {
        rate: settings.ttsRate,
        voice: settings.ttsVoice[lang],
        onEnd: () => readFrom(i + 1),
      });
    };
    readFrom(p);
  };

  const pageWordCount = page.reduce((n, p) => n + p.tokens.filter((t) => t.isWord).length, 0);
  const pageNew = new Set(page.flatMap((p) => p.tokens.filter((t) => t.isWord && !terms.has(t.norm)).map((t) => t.norm))).size;

  if (completed) {
    return <Completion lessonId={lessonId} lang={lang} onReread={() => { setCompleted(false); setPageIdx(0); }} />;
  }

  if (editing) {
    return <EditLesson lesson={lesson} onDone={() => setEditing(false)} />;
  }

  const sent = sentences[Math.max(0, Math.min(sentIdx, sentences.length - 1))];

  return (
    <div className={`reader ${selection ? 'has-panel' : ''}`}>
      <div className="reader-main">
        <div className="reader-head">
          <div>
            <Link to="/" className="muted small">
              ← Library
            </Link>
            <h1 className="lesson-h">{lesson.title}</h1>
          </div>
          <div className="reader-tools">
            <button className={sentenceMode ? 'active' : ''} onClick={() => setSentenceMode(!sentenceMode)} title="Sentence mode">
              {sentenceMode ? '📄 Page' : '💬 Sentence'}
            </button>
            <button onClick={() => updateSettings({ fontSize: Math.max(12, settings.fontSize - 2) })} title="Smaller text">
              A−
            </button>
            <button onClick={() => updateSettings({ fontSize: Math.min(40, settings.fontSize + 2) })} title="Larger text">
              A+
            </button>
            <button onClick={() => (speakingPara !== null ? (stopSpeaking(), setSpeakingPara(null)) : playParagraph(0))} title="Read page aloud (text-to-speech)">
              {speakingPara !== null ? '⏹' : '🔈'}
            </button>
            <button onClick={() => setEditing(true)} title="Edit lesson">
              ✎
            </button>
          </div>
        </div>

        <div
          className="reader-text"
          dir={rtl ? 'rtl' : undefined}
          lang={lang}
          style={{ fontSize: settings.fontSize, lineHeight: settings.lineHeight }}
          onPointerDown={(e) => (e.target as HTMLElement).classList.contains('reader-text') && select(null)}
        >
          {sentenceMode ? (
            sent ? (
              <div className="sentence-view">
                <p className="para">{renderTokens(sent.p, sent.s, sent.e)}</p>
                {translations[translateKey(sent)] && <p className="translation">{translations[translateKey(sent)]}</p>}
                <div className="row center">
                  <button onClick={() => (sentIdx > 0 ? setSentIdx(sentIdx - 1) : turnPage(-1))} disabled={sentIdx <= 0 && pageIdx === 0}>
                    ← Prev
                  </button>
                  <button onClick={() => speak(rangeText(page, sent), lang, { rate: settings.ttsRate, voice: settings.ttsVoice[lang] })}>🔊</button>
                  <button onClick={() => toggleTranslation(sent)}>🌐 Translate</button>
                  <button className="primary" onClick={() => (sentIdx < sentences.length - 1 ? setSentIdx(sentIdx + 1) : turnPage(1))}>
                    Next →
                  </button>
                </div>
                <div className="muted small center">
                  Sentence {Math.min(sentIdx, sentences.length - 1) + 1} / {sentences.length}
                </div>
              </div>
            ) : (
              <p className="muted">Empty page.</p>
            )
          ) : (
            page.map((para, p) => {
              const r = { p, s: 0, e: para.tokens.length - 1 };
              const active = (activeSeg && activeSeg.page === pageIdx && activeSeg.para === p) || speakingPara === p;
              return (
                <div key={p} className={`para-wrap ${active ? 'active' : ''}`}>
                  <p className="para">{renderTokens(p)}</p>
                  <div className="para-tools">
                    <button className="icon small" title={para.start !== undefined && audioUrl ? 'Play from here' : 'Read aloud'} onClick={() => playParagraph(p)}>
                      ▶
                    </button>
                    <button className="icon small" title="Translate paragraph" onClick={() => toggleTranslation(r)}>
                      🌐
                    </button>
                  </div>
                  {translations[translateKey(r)] && <p className="translation">{translations[translateKey(r)]}</p>}
                </div>
              );
            })
          )}
        </div>

        {!sentenceMode && (
          <div className="pager">
            <button onClick={() => turnPage(-1)} disabled={pageIdx === 0}>
              ← Previous
            </button>
            <span className="muted small">
              Page {pageIdx + 1} / {pages.length} · {pageWordCount} words · {pageNew} new
            </span>
            <button className="primary" onClick={() => turnPage(1)} title={settings.autoKnownOnPageTurn ? 'Remaining blue words become known' : ''}>
              {pageIdx + 1 >= pages.length ? 'Complete lesson ✓' : 'Next page →'}
            </button>
          </div>
        )}
        {settings.autoKnownOnPageTurn && !sentenceMode && pageNew > 0 && (
          <p className="muted small center">Turning the page marks the {pageNew} remaining blue words as known.</p>
        )}

        {audioUrl && (
          <div className="audio-bar">
            <audio
              ref={audioRef}
              src={audioUrl}
              controls
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                const d = t - listened.current.last;
                if (d > 0 && d < 2) listened.current.pending += d;
                listened.current.last = t;
                setAudioTime(t);
                if (listened.current.pending >= 30) flushListening();
              }}
              onPause={flushListening}
            />
            <select
              aria-label="Playback speed"
              defaultValue="1"
              onChange={(e) => audioRef.current && (audioRef.current.playbackRate = Number(e.target.value))}
            >
              {[0.5, 0.75, 0.9, 1, 1.25, 1.5].map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
            <button className="icon" title="Back 5s" onClick={() => audioRef.current && (audioRef.current.currentTime -= 5)}>
              ⏪
            </button>
            {lesson.segments && (
              <label className="small row">
                <input type="checkbox" checked={followAudio} onChange={(e) => setFollowAudio(e.target.checked)} /> follow
              </label>
            )}
          </div>
        )}
      </div>

      {selection && (
        <WordPanel
          selection={selection}
          term={term}
          lang={lang}
          lessonId={lessonId}
          settings={settings}
          relatedPhrases={
            selection.isPhrase || !range
              ? []
              : phraseMatches[range.p]
                  .filter((m) => range.s >= m.start && range.s <= m.end)
                  .map((m) => terms.get(m.key)!)
                  .filter(Boolean)
          }
          onSelectPhrase={(t) => setPhraseSel({ key: t.term, display: t.term, isPhrase: true, fragment: t.fragment || selection.fragment })}
          onExtend={
            range && !phraseSel
              ? (dir) => {
                  const toks = page[range.p].tokens;
                  let i = dir > 0 ? range.e + 1 : range.s - 1;
                  while (i >= 0 && i < toks.length && !toks[i].isWord) i += dir;
                  if (i < 0 || i >= toks.length) return;
                  select(dir > 0 ? { ...range, e: i } : { ...range, s: i });
                }
              : undefined
          }
          onClose={() => select(null)}
        />
      )}
    </div>
  );
}

function Completion({ lessonId, lang, onReread }: { lessonId: number; lang: string; onReread: () => void }) {
  const data = useLiveQuery(async () => {
    const lesson = await db.lessons.get(lessonId);
    const known = await db.terms.where({ lang, status: KNOWN }).count();
    const lingqs = await db.terms.where({ lang }).filter((t) => t.lessonId === lessonId && t.status >= 1 && t.status <= 4).count();
    const next = lesson?.courseId
      ? (await db.lessons.where({ courseId: lesson.courseId }).sortBy('order')).find((l) => l.order > lesson.order && !l.completed)
      : undefined;
    return { lesson, known, lingqs, next };
  }, [lessonId, lang]);
  if (!data?.lesson) return null;
  return (
    <div className="card completion">
      <h1>🎉 Lesson complete!</h1>
      <p>
        <strong>{data.lesson.title}</strong>
      </p>
      <div className="stat-grid">
        <div>
          <div className="big">{data.lesson.wordCount}</div>
          <div className="muted small">words read</div>
        </div>
        <div>
          <div className="big">{data.lingqs}</div>
          <div className="muted small">LingQs from this lesson</div>
        </div>
        <div>
          <div className="big">{data.known}</div>
          <div className="muted small">known words total</div>
        </div>
      </div>
      <div className="row center">
        {data.lingqs > 0 && (
          <Link className="btn primary" to={`/review?lesson=${lessonId}`}>
            Review this lesson's LingQs
          </Link>
        )}
        {data.next && (
          <Link className="btn" to={`/lesson/${data.next.id}`}>
            Next lesson: {data.next.title} →
          </Link>
        )}
        <button onClick={onReread}>Read again</button>
        <Link className="btn" to="/">
          Library
        </Link>
      </div>
    </div>
  );
}

function EditLesson({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const [title, setTitle] = useState(lesson.title);
  const [text, setText] = useState(lesson.text);
  const nav = useNavigate();
  return (
    <div className="card form">
      <h2>Edit lesson</h2>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Text
        <textarea rows={20} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {lesson.segments && <p className="muted small">Editing the text removes subtitle timing.</p>}
      <div className="row">
        <button
          className="primary"
          onClick={async () => {
            const patch: Parameters<typeof updateLessonText>[2] = { title };
            if (text !== lesson.text) Object.assign(patch, { text, segments: undefined, page: 0 });
            await updateLessonText(lesson.id!, lesson.lang, patch);
            onDone();
          }}
        >
          Save
        </button>
        <button onClick={onDone}>Cancel</button>
        <button
          className="danger"
          onClick={async () => {
            if (!confirm('Delete this lesson?')) return;
            await db.lessons.delete(lesson.id!);
            nav('/');
          }}
        >
          Delete lesson
        </button>
      </div>
    </div>
  );
}
