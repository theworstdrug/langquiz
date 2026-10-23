import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { createLesson, ensureCourse } from '../lib/actions';
import { importEpub, importUrl, parseSubtitles, htmlToText, parseHtml, splitIntoLessons } from '../lib/importers';
import { getSettings } from '../lib/settings';
import type { TimedSegment } from '../lib/tokenize';
import { fetchYouTubeTitle, mergeCues, parseYouTubeId, parseYouTubeTranscript, youtubeThumb } from '../lib/youtube';

type Mode = 'text' | 'file' | 'url' | 'youtube';

export default function Import({ lang }: { lang: string }) {
  const nav = useNavigate();
  const courses = useLiveQuery(() => db.courses.where({ lang }).toArray(), [lang]);
  const [mode, setMode] = useState<Mode>('text');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [segments, setSegments] = useState<TimedSegment[] | undefined>();
  const [course, setCourse] = useState('');
  const [newCourse, setNewCourse] = useState('');
  const [tags, setTags] = useState('');
  const [audio, setAudio] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [url, setUrl] = useState('');
  const [split, setSplit] = useState(false);
  const [splitWords, setSplitWords] = useState(1500);
  const [busy, setBusy] = useState('');
  const [ytUrl, setYtUrl] = useState('');
  const [ytId, setYtId] = useState<string | null>(null);
  const [rawCues, setRawCues] = useState<TimedSegment[] | null>(null);
  const [merge, setMerge] = useState(true);
  const [error, setError] = useState('');

  const resolveCourse = async (): Promise<number | undefined> => {
    if (course === '__new' && newCourse.trim()) return ensureCourse(lang, newCourse.trim());
    if (course && course !== '__new') return Number(course);
    return undefined;
  };

  const onFile = async (file: File) => {
    setError('');
    const name = file.name.replace(/\.[^.]+$/, '');
    const ext = file.name.split('.').pop()?.toLowerCase();
    try {
      if (ext === 'epub') {
        setBusy('Reading EPUB…');
        const book = await importEpub(file);
        if (!book.chapters.length) throw new Error('No readable chapters found in this EPUB.');
        if (!confirm(`Import "${book.title}" as a course with ${book.chapters.length} lessons?`)) return;
        const courseId = await ensureCourse(lang, book.title);
        if (book.author) await db.courses.update(courseId, { description: `by ${book.author}` });
        for (const ch of book.chapters) {
          for (const [i, part] of splitIntoLessons(ch.text, splitWords).entries()) {
            await createLesson({ lang, courseId, title: i ? `${ch.title} (${i + 1})` : ch.title, text: part, tags: ['book'] });
          }
        }
        nav('/');
        return;
      }
      const src = await file.text();
      if (ext === 'srt' || ext === 'vtt') {
        const segs = parseSubtitles(src);
        setSegments(segs);
        setText(segs.map((s) => s.text).join('\n'));
      } else if (ext === 'html' || ext === 'htm' || ext === 'xhtml') {
        setSegments(undefined);
        setText(htmlToText(parseHtml(src)));
      } else {
        setSegments(undefined);
        setText(src);
      }
      if (!title) setTitle(name);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy('');
    }
  };

  const onFetchUrl = async () => {
    setError('');
    setBusy('Fetching…');
    try {
      const s = await getSettings();
      const page = await importUrl(url, s.corsProxy);
      setTitle(page.title);
      setText(page.text);
      setSegments(undefined);
    } catch (e) {
      setError(
        `Could not fetch that page (${(e as Error).message}). Most sites block cross-origin requests from the browser — ` +
          'set a CORS proxy in Settings, or copy the article text and paste it under "Text".',
      );
    } finally {
      setBusy('');
    }
  };

  const applyCues = (cues: TimedSegment[], doMerge = merge) => {
    setRawCues(cues);
    const segs = doMerge ? mergeCues(cues) : cues;
    setSegments(segs);
    setText(segs.map((x) => x.text).join('\n'));
  };

  const onYouTubeUrl = async (value: string) => {
    setYtUrl(value);
    const vid = parseYouTubeId(value);
    setYtId(vid);
    if (vid && !title) {
      const t = await fetchYouTubeTitle(vid);
      if (t) setTitle((cur) => cur || t);
    }
  };

  const save = async () => {
    setError('');
    if (!text.trim()) return setError(mode === 'youtube' ? 'Paste the video transcript (or upload subtitles) first.' : 'Add some text first.');
    if (mode === 'youtube' && !ytId) return setError('Enter a valid YouTube link.');
    setBusy('Saving…');
    try {
      let courseId = await resolveCourse();
      const base = {
        lang,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        audio: audio ?? undefined,
        audioName: audio?.name,
        mediaUrl: parseYouTubeId(mediaUrl) ? undefined : mediaUrl.trim() || undefined,
        sourceUrl: mode === 'url' ? url : mode === 'youtube' ? ytUrl : undefined,
        // A YouTube link in the media URL field also gets the embedded player.
        youtubeId: (mode === 'youtube' ? ytId : parseYouTubeId(mediaUrl)) ?? undefined,
      };
      const t = title.trim() || text.trim().slice(0, 40);
      if (split && mode !== 'youtube' && !segments && text.split(/\s+/).length > splitWords) {
        courseId ??= await ensureCourse(lang, t);
        const parts = splitIntoLessons(text, splitWords);
        for (const [i, part] of parts.entries()) {
          await createLesson({ ...base, courseId, title: `${t} — Part ${i + 1}`, text: part });
        }
        nav('/');
      } else {
        const id = await createLesson({ ...base, courseId, title: t, text: text.trim(), segments });
        nav(`/lesson/${id}`);
      }
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="import">
      <h1>Import a lesson</h1>
      <div className="tabs">
        {(['text', 'file', 'url', 'youtube'] as Mode[]).map((m) => (
          <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
            {m === 'text' ? 'Paste text' : m === 'file' ? 'Upload file' : m === 'url' ? 'From web page' : 'YouTube'}
          </button>
        ))}
      </div>

      <div className="card form">
        {mode === 'file' && (
          <label>
            File (.txt, .epub, .srt, .vtt, .html)
            <input type="file" accept=".txt,.md,.epub,.srt,.vtt,.html,.htm,.xhtml" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <span className="muted small">EPUB books become a course with one lesson per chapter. Subtitles keep their timestamps for audio sync.</span>
          </label>
        )}
        {mode === 'url' && (
          <label>
            Web page URL
            <div className="row">
              <input type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
              <button onClick={onFetchUrl} disabled={!url}>
                Fetch
              </button>
            </div>
          </label>
        )}

        {mode === 'youtube' && (
          <>
            <label>
              YouTube link
              <input type="url" placeholder="https://www.youtube.com/watch?v=…" value={ytUrl} onChange={(e) => onYouTubeUrl(e.target.value)} />
            </label>
            {ytId && (
              <div className="yt-preview">
                <img src={youtubeThumb(ytId)} alt="" />
                <ol className="muted small">
                  <li>
                    On YouTube, open the video, click <strong>…more</strong> under it, then <strong>Show transcript</strong>.
                  </li>
                  <li>Pick the language you're learning from the transcript menu if there's a choice.</li>
                  <li>Select the whole transcript, copy it, and paste it below. Timestamps are kept so the text follows the video.</li>
                </ol>
              </div>
            )}
            <label>
              Transcript
              <textarea
                rows={6}
                placeholder={'0:00\nHola a todos…\n0:04\nBienvenidos…'}
                onChange={(e) => {
                  const cues = parseYouTubeTranscript(e.target.value);
                  if (cues.length) applyCues(cues);
                  else {
                    setRawCues(null);
                    setSegments(undefined);
                    setText(e.target.value);
                  }
                }}
              />
              <span className="muted small">
                …or upload subtitles (.srt/.vtt):{' '}
                <input
                  type="file"
                  accept=".srt,.vtt"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) applyCues(parseSubtitles(await f.text()));
                  }}
                />
              </span>
            </label>
            {rawCues && (
              <label className="row">
                <input
                  type="checkbox"
                  checked={merge}
                  onChange={(e) => {
                    setMerge(e.target.checked);
                    applyCues(rawCues, e.target.checked);
                  }}
                />
                Join short caption lines into sentences ({rawCues.length} lines → {mergeCues(rawCues).length})
              </label>
            )}
          </>
        )}

        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lesson title" />
        </label>
        <label>
          Text {segments && <span className="pill">{segments.length} timed subtitle lines</span>}
          <textarea
            rows={12}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSegments(undefined);
            }}
            placeholder="Paste the text you want to read…"
          />
        </label>

        <div className="cols">
          <label>
            Course
            <select value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">— none —</option>
              {courses?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
              <option value="__new">+ New course…</option>
            </select>
            {course === '__new' && <input placeholder="Course name" value={newCourse} onChange={(e) => setNewCourse(e.target.value)} />}
          </label>
          <label>
            Tags (comma separated)
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="news, podcast…" />
          </label>
        </div>

        {mode !== 'youtube' && <div className="cols">
          <label>
            Audio file (optional)
            <input type="file" accept="audio/*,video/*" onChange={(e) => setAudio(e.target.files?.[0] ?? null)} />
          </label>
          <label>
            …or audio/video URL
            <input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://…/episode.mp3 or a YouTube link" />
          </label>
        </div>}

        {!segments && mode !== 'youtube' && (
          <label className="row">
            <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
            Split long text into a course of lessons of about
            <input type="number" min={200} step={100} value={splitWords} onChange={(e) => setSplitWords(Number(e.target.value))} style={{ width: 90 }} />
            words
          </label>
        )}

        {error && <div className="error">{error}</div>}
        <div className="row">
          <button className="primary" onClick={save} disabled={!!busy}>
            {busy || 'Save & open'}
          </button>
          <span className="muted small">{text ? `${text.split(/\s+/).filter(Boolean).length} words` : ''}</span>
        </div>
      </div>
    </div>
  );
}
