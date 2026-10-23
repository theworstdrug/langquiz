import { db } from './db';

export async function exportBackup(): Promise<Blob> {
  const [terms, courses, lessons, activity, settings] = await Promise.all([
    db.terms.toArray(),
    db.courses.toArray(),
    db.lessons.toArray(),
    db.activity.toArray(),
    db.settings.toArray(),
  ]);
  // Audio blobs are not serialisable to JSON; they are omitted from backups.
  const plainLessons = lessons.map(({ audio: _audio, ...rest }) => rest);
  const payload = { app: 'langquiz', version: 1, exportedAt: new Date().toISOString(), terms, courses, lessons: plainLessons, activity, settings };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export async function importBackup(json: string) {
  const data = JSON.parse(json);
  if (data?.app !== 'langquiz') throw new Error('Not a langquiz backup file');
  await db.transaction('rw', [db.terms, db.courses, db.lessons, db.activity, db.settings], async () => {
    await Promise.all([db.terms.clear(), db.courses.clear(), db.lessons.clear(), db.activity.clear(), db.settings.clear()]);
    await db.terms.bulkAdd(data.terms ?? []);
    await db.courses.bulkAdd(data.courses ?? []);
    await db.lessons.bulkAdd(data.lessons ?? []);
    await db.activity.bulkAdd(data.activity ?? []);
    await db.settings.bulkAdd(data.settings ?? []);
  });
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(s: string) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

export function parseCsv(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === '\t') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}
