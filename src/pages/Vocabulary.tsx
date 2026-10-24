import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, KNOWN, STATUS_LABELS, type Status, type Term } from '../lib/db';
import { deleteTerms, upsertTerm } from '../lib/actions';
import { download, parseCsv, toCsv } from '../lib/backup';
import { normalize } from '../lib/tokenize';
import { speak } from '../lib/tts';
import type { Settings } from '../lib/settings';
import { scheduleForStatus } from '../lib/srs';

type StatusFilter = 'lingqs' | 'all' | 'known' | 'ignored' | `${Status}`;
type SortKey = 'updated' | 'created' | 'alpha' | 'status' | 'due';

const PAGE = 100;

export default function Vocabulary({ settings }: { settings: Settings }) {
  const lang = settings.activeLang;
  const all = useLiveQuery(() => db.terms.where({ lang }).toArray(), [lang]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('lingqs');
  const [kind, setKind] = useState<'all' | 'words' | 'phrases'>('all');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<number | null>(null);

  const tags = useMemo(() => [...new Set((all ?? []).flatMap((t) => t.tags))].sort(), [all]);

  const rows = useMemo(() => {
    if (!all) return [];
    const ql = q.toLowerCase();
    const list = all.filter((t) => {
      if (status === 'lingqs' && !(t.status >= 1 && t.status <= 4)) return false;
      if (status === 'known' && t.status !== KNOWN) return false;
      if (status === 'ignored' && t.status !== 0) return false;
      if (/^\d$/.test(status) && t.status !== Number(status)) return false;
      if (kind === 'words' && t.isPhrase) return false;
      if (kind === 'phrases' && !t.isPhrase) return false;
      if (tag && !t.tags.includes(tag)) return false;
      if (ql && !t.term.includes(ql) && !t.meanings.some((m) => m.toLowerCase().includes(ql)) && !t.notes.toLowerCase().includes(ql)) return false;
      return true;
    });
    const cmp: Record<SortKey, (a: Term, b: Term) => number> = {
      updated: (a, b) => b.updatedAt - a.updatedAt,
      created: (a, b) => b.createdAt - a.createdAt,
      alpha: (a, b) => a.term.localeCompare(b.term, lang),
      status: (a, b) => a.status - b.status,
      due: (a, b) => a.due - b.due,
    };
    return list.sort(cmp[sort]);
  }, [all, q, status, kind, tag, sort, lang]);

  if (!all) return <p className="muted">Loading…</p>;

  const counts = {
    lingqs: all.filter((t) => t.status >= 1 && t.status <= 4).length,
    known: all.filter((t) => t.status === KNOWN).length,
  };

  const bulk = async (patch: Partial<Term>) => {
    const ids = [...selected];
    const now = Date.now();
    const extra = patch.status !== undefined ? scheduleForStatus(patch.status, now) : {};
    await db.terms.bulkUpdate(ids.map((id) => ({ key: id, changes: { ...patch, ...extra, updatedAt: now } })));
    setSelected(new Set());
  };

  const exportCsv = (anki: boolean) => {
    const list = selected.size ? rows.filter((r) => selected.has(r.id!)) : rows;
    if (anki) {
      // Anki-friendly TSV: Front, Back, Tags
      const tsv = list
        .map((t) => [t.term, [t.meanings.join('; '), t.fragment && `<i>${t.fragment}</i>`].filter(Boolean).join('<br>'), t.tags.join(' ')].map((c) => c.replace(/[\t\n]/g, ' ')).join('\t'))
        .join('\n');
      download(new Blob([tsv], { type: 'text/tab-separated-values' }), `langquiz-${lang}-anki.txt`);
    } else {
      const csv = toCsv([
        ['term', 'meaning', 'status', 'tags', 'notes', 'example'],
        ...list.map((t) => [t.term, t.meanings.join('; '), String(t.status), t.tags.join(' '), t.notes, t.fragment]),
      ]);
      download(new Blob([csv], { type: 'text/csv' }), `langquiz-${lang}-vocabulary.csv`);
    }
  };

  const importCsv = async (file: File) => {
    const rows = parseCsv(await file.text());
    const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
    const hasHeader = header.includes('term');
    const col = (name: string, fallback: number) => (hasHeader ? header.indexOf(name) : fallback);
    const [ti, mi, si, gi, ni] = [col('term', 0), col('meaning', 1), col('status', 2), col('tags', 3), col('notes', 4)];
    let n = 0;
    for (const r of rows.slice(hasHeader ? 1 : 0)) {
      const term = normalize(r[ti] ?? '', lang);
      if (!term) continue;
      const st = Number(r[si]);
      await upsertTerm(lang, term, {
        meanings: (r[mi] ?? '').split(';').map((m) => m.trim()).filter(Boolean),
        status: (st >= 0 && st <= 5 ? st : 1) as Status,
        tags: gi >= 0 ? (r[gi] ?? '').split(/\s+/).filter(Boolean) : [],
        notes: ni >= 0 ? r[ni] ?? '' : '',
        isPhrase: term.includes(' '),
      });
      n++;
    }
    alert(`Imported ${n} terms.`);
  };

  const toggle = (id: number) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  return (
    <div>
      <div className="page-head">
        <h1>Vocabulary</h1>
        <div className="row">
          <span className="pill yellow">{counts.lingqs} LingQs</span>
          <span className="pill">{counts.known} known</span>
        </div>
      </div>
      <div className="toolbar wrap">
        <input placeholder="Search terms, meanings, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="lingqs">All LingQs (1–4)</option>
          {[1, 2, 3, 4].map((s) => (
            <option key={s} value={String(s)}>
              {s} · {STATUS_LABELS[s as Status]}
            </option>
          ))}
          <option value="known">Known</option>
          <option value="ignored">Ignored</option>
          <option value="all">Everything</option>
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="all">Words & phrases</option>
          <option value="words">Words</option>
          <option value="phrases">Phrases</option>
        </select>
        {tags.length > 0 && (
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Any tag</option>
            {tags.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="updated">Recently changed</option>
          <option value="created">Newest</option>
          <option value="alpha">A → Z</option>
          <option value="status">Status</option>
          <option value="due">Next review</option>
        </select>
      </div>
      <div className="toolbar wrap">
        <span className="muted small">{rows.length} terms{selected.size ? ` · ${selected.size} selected` : ''}</span>
        {selected.size > 0 && (
          <>
            {[1, 2, 3, 4].map((s) => (
              <button key={s} className={`status-btn s${s}`} onClick={() => bulk({ status: s as Status })}>
                {s}
              </button>
            ))}
            <button className="status-btn known" onClick={() => bulk({ status: KNOWN })}>
              ✓
            </button>
            <button className="status-btn ignore" onClick={() => bulk({ status: 0 })}>
              🚫
            </button>
            <button
              className="danger"
              onClick={async () => {
                if (!confirm(`Delete ${selected.size} terms? They become new (blue) words again.`)) return;
                await deleteTerms([...selected]);
                setSelected(new Set());
              }}
            >
              Delete
            </button>
            <Link className="btn" to={`/review?ids=${[...selected].join(',')}`}>
              Review selected
            </Link>
          </>
        )}
        <span className="spacer" />
        <button onClick={() => exportCsv(false)}>Export CSV</button>
        <button onClick={() => exportCsv(true)}>Export for Anki</button>
        <label className="btn">
          Import CSV
          <input type="file" accept=".csv,.tsv,.txt" hidden onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
        </label>
      </div>

      <div className="card table-wrap">
        <table className="vocab">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={rows.length > 0 && rows.every((r) => selected.has(r.id!))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id!)) : new Set())}
                />
              </th>
              <th>Term</th>
              <th>Meaning</th>
              <th>Status</th>
              <th className="hide-sm">Tags</th>
              <th className="hide-sm">Example</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((t) => (
              <tr key={t.id}>
                <td>
                  <input type="checkbox" checked={selected.has(t.id!)} onChange={() => toggle(t.id!)} />
                </td>
                <td>
                  <button className="link" onClick={() => speak(t.term, lang, { rate: settings.ttsRate, voice: settings.ttsVoice[lang] })} title="Pronounce">
                    {t.term}
                  </button>
                  {t.isPhrase && <span className="pill small">phrase</span>}
                </td>
                <td onClick={() => setEditing(t.id!)}>
                  {editing === t.id ? (
                    <input
                      autoFocus
                      defaultValue={t.meanings.join('; ')}
                      onBlur={(e) => {
                        upsertTerm(lang, t.term, { meanings: e.target.value.split(';').map((m) => m.trim()).filter(Boolean) });
                        setEditing(null);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  ) : (
                    t.meanings.join('; ') || <span className="muted small">click to add</span>
                  )}
                </td>
                <td>
                  <select value={t.status} className={`status-select s${t.status}`} onChange={(e) => upsertTerm(lang, t.term, { status: Number(e.target.value) as Status })}>
                    {[1, 2, 3, 4, 5, 0].map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s as Status]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="hide-sm small">{t.tags.join(', ')}</td>
                <td className="hide-sm small muted fragment-cell">{t.fragment}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > limit && (
          <button className="block" onClick={() => setLimit(limit + PAGE)}>
            Show more ({rows.length - limit} remaining)
          </button>
        )}
        {rows.length === 0 && <p className="muted center">No terms match. Click words while reading to create LingQs.</p>}
      </div>
    </div>
  );
}
