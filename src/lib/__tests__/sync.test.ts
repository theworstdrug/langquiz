import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LangDB, type Term } from '../db';
import type { RemoteFile, RemoteStore } from '../sync/drive';
import { syncOnce } from '../sync/engine';
import { applySnapshot, buildSnapshot } from '../sync/snapshot';
import { dailyTotals } from '../stats';

/** In-memory stand-in for Google Drive. */
function fakeDrive() {
  const files = new Map<string, { data: ArrayBuffer; version: number }>();
  let n = 0;
  const store: RemoteStore & { files: typeof files } = {
    files,
    async list() {
      return [...files.entries()].map(([id, f]) => ({ id, version: String(f.version) }));
    },
    async download(id) {
      return files.get(id)!.data;
    },
    async upload(blob, id): Promise<RemoteFile> {
      const fid = id ?? `file${++n}`;
      const version = (files.get(fid)?.version ?? 0) + 1;
      files.set(fid, { data: await blob.arrayBuffer(), version });
      return { id: fid, version: String(version) };
    },
    async remove(id) {
      files.delete(id);
    },
  };
  return store;
}

const term = (t: Partial<Term> & { term: string }): Term => ({
  lang: 'es', status: 1, isPhrase: false, meanings: [], notes: '', tags: [], fragment: '',
  createdAt: 1, updatedAt: 1, due: 0, interval: 0, reps: 0, lapses: 0, ...t,
});

let a: LangDB;
let b: LangDB;
let drive: ReturnType<typeof fakeDrive>;
const state = { a: {} as { fileId?: string; version?: string }, b: {} as { fileId?: string; version?: string } };
let k = 0;

async function sync(dev: 'a' | 'b', dirty = true) {
  const r = await syncOnce(dev === 'a' ? a : b, drive, state[dev], dirty);
  state[dev] = { fileId: r.file.id, version: r.file.version };
  return r;
}
const getTerm = (db: LangDB, t: string) => db.terms.where({ lang: 'es', term: t }).first();

beforeEach(() => {
  k++;
  a = new LangDB(`devA${k}`);
  b = new LangDB(`devB${k}`);
  drive = fakeDrive();
  state.a = {};
  state.b = {};
});
afterEach(async () => {
  await a.delete();
  await b.delete();
});

describe('Drive sync', () => {
  it('copies lessons, courses and terms to a new device with links intact', async () => {
    const courseId = await a.courses.add({ uid: 'c1', updatedAt: 1, lang: 'es', title: 'Book', description: '', createdAt: 1 });
    const lessonId = await a.lessons.add({
      uid: 'l1', updatedAt: 1, lang: 'es', courseId, title: 'Ch 1', text: 'hola', tags: [], uniqueWords: ['hola'], wordCount: 1,
      createdAt: 1, page: 0, completed: false, timesCompleted: 0, order: 0,
    });
    await a.terms.add(term({ term: 'hola', meanings: ['hello'], lessonId }));
    await sync('a');
    await sync('b');
    const lesson = await b.lessons.where({ uid: 'l1' }).first();
    const course = await b.courses.where({ uid: 'c1' }).first();
    expect(lesson?.courseId).toBe(course?.id);
    expect((await getTerm(b, 'hola'))?.lessonId).toBe(lesson?.id);
    expect(drive.files.size).toBe(1);
  });

  it('merges independent edits from both devices', async () => {
    await a.terms.add(term({ term: 'perro' }));
    await sync('a');
    await sync('b');
    await a.terms.add(term({ term: 'gato', updatedAt: 10 }));
    await b.terms.add(term({ term: 'casa', updatedAt: 10 }));
    await sync('a');
    await sync('b');
    await sync('a');
    for (const db of [a, b]) expect((await db.terms.toArray()).map((t) => t.term).sort()).toEqual(['casa', 'gato', 'perro']);
  });

  it('resolves a conflicting edit with the newest change', async () => {
    await a.terms.add(term({ term: 'perro' }));
    await sync('a');
    await sync('b');
    await a.terms.where({ lang: 'es', term: 'perro' }).modify({ status: 3, updatedAt: 100 });
    await b.terms.where({ lang: 'es', term: 'perro' }).modify({ status: 5, updatedAt: 200 });
    await sync('a');
    await sync('b');
    await sync('a');
    expect((await getTerm(a, 'perro'))?.status).toBe(5);
    expect((await getTerm(b, 'perro'))?.status).toBe(5);
  });

  it('propagates deletions and does not resurrect older copies', async () => {
    await a.terms.add(term({ term: 'perro' }));
    await sync('a');
    await sync('b');
    const id = (await getTerm(a, 'perro'))!.id!;
    await a.deletions.put({ key: 'terms:es|perro', table: 'terms', recordKey: 'es|perro', deletedAt: Date.now() });
    await a.terms.delete(id);
    await sync('a');
    await sync('b');
    expect(await getTerm(b, 'perro')).toBeUndefined();
    await sync('a');
    expect(await getTerm(a, 'perro')).toBeUndefined();
  });

  it('keeps a word re-added after it was deleted elsewhere', async () => {
    await a.deletions.put({ key: 'terms:es|perro', table: 'terms', recordKey: 'es|perro', deletedAt: 100 });
    await sync('a');
    await b.terms.add(term({ term: 'perro', updatedAt: 200 }));
    await sync('b');
    await sync('a');
    expect(await getTerm(a, 'perro')).toBeDefined();
  });

  it('keeps local audio when a lesson is updated from another device', async () => {
    const base = { uid: 'l1', lang: 'es', title: 'Ep', text: 'hola', tags: [], uniqueWords: ['hola'], wordCount: 1, createdAt: 1, page: 0, completed: false, timesCompleted: 0, order: 0 };
    await a.lessons.add({ ...base, updatedAt: 1 });
    await sync('a');
    await sync('b');
    await b.lessons.where({ uid: 'l1' }).modify({ audio: new Blob(['x']), audioName: 'ep.mp3', updatedAt: 2 });
    await a.lessons.where({ uid: 'l1' }).modify({ page: 3, updatedAt: 5 });
    await sync('a');
    await sync('b');
    const l = await b.lessons.where({ uid: 'l1' }).first();
    expect(l?.page).toBe(3);
    expect(l?.audioName).toBe('ep.mp3');
    expect(l?.audio).toBeDefined();
  });

  it('adds up activity from different devices on the same day', async () => {
    const row = { lang: 'es', date: '2026-10-24', wordsRead: 0, knownAdded: 0, listeningSeconds: 0, reviews: 0, lessonsCompleted: 0 };
    await a.activity.add({ ...row, device: 'phone', lingqsCreated: 5, updatedAt: 1 });
    await b.activity.add({ ...row, device: 'laptop', lingqsCreated: 7, updatedAt: 1 });
    await sync('a');
    await sync('b');
    expect(dailyTotals(await b.activity.toArray())[0].lingqsCreated).toBe(12);
  });

  it('keeps device-specific settings local', async () => {
    await a.settings.bulkPut([{ key: 'activeLang', value: 'fr' }, { key: 'dailyGoal', value: 40 }]);
    await b.settings.put({ key: 'activeLang', value: 'de' });
    await sync('a');
    await sync('b');
    expect((await b.settings.get('activeLang'))?.value).toBe('de');
    expect((await b.settings.get('dailyGoal'))?.value).toBe(40);
  });

  it('skips the download when nothing changed', async () => {
    await a.terms.add(term({ term: 'perro' }));
    await sync('a');
    expect((await sync('a', false)).skipped).toBe(true);
  });

  it('does not delete local records that are merely missing from the merged copy', async () => {
    const snap = await buildSnapshot(a);
    await a.terms.add(term({ term: 'nuevo' })); // created while a sync is in flight
    await applySnapshot(a, snap);
    expect(await getTerm(a, 'nuevo')).toBeDefined();
  });

  it('folds duplicate sync files created by two devices at once', async () => {
    await a.terms.add(term({ term: 'uno' }));
    await b.terms.add(term({ term: 'dos' }));
    await drive.upload(new Blob([JSON.stringify(await buildSnapshot(a))]));
    await drive.upload(new Blob([JSON.stringify(await buildSnapshot(b))]));
    await sync('a');
    expect(drive.files.size).toBe(1);
    expect((await a.terms.toArray()).map((t) => t.term).sort()).toEqual(['dos', 'uno']);
  });

  it('stamps local writes with updatedAt automatically', async () => {
    await a.settings.put({ key: 'dailyGoal', value: 10 });
    const before = (await a.settings.get('dailyGoal'))!.updatedAt!;
    await new Promise((r) => setTimeout(r, 5));
    await a.settings.put({ key: 'dailyGoal', value: 11 });
    expect((await a.settings.get('dailyGoal'))!.updatedAt!).toBeGreaterThan(before);
  });
});

describe('schema upgrade', () => {
  it('gives existing lessons, courses and activity sync metadata', async () => {
    const { default: Dexie } = await import('dexie');
    const old = new Dexie('upgrade-test');
    old.version(1).stores({
      terms: '++id, &[lang+term], lang, status, isPhrase, due, createdAt, updatedAt',
      courses: '++id, lang, createdAt',
      lessons: '++id, lang, courseId, createdAt, lastOpenedAt',
      activity: '++id, &[lang+date], lang, date',
      settings: 'key',
    });
    await old.table('courses').add({ lang: 'es', title: 'Old', description: '', createdAt: 5 });
    await old.table('lessons').add({ lang: 'es', title: 'Old lesson', text: 'hola', tags: [], uniqueWords: [], wordCount: 1, createdAt: 7, page: 2, completed: false, timesCompleted: 0, order: 0 });
    await old.table('activity').add({ lang: 'es', date: '2026-10-01', wordsRead: 3, lingqsCreated: 1, knownAdded: 0, listeningSeconds: 0, reviews: 0, lessonsCompleted: 0 });
    old.close();

    const upgraded = new LangDB('upgrade-test');
    const [lesson] = await upgraded.lessons.toArray();
    const [course] = await upgraded.courses.toArray();
    const [act] = await upgraded.activity.toArray();
    expect(lesson.uid).toBeTruthy();
    expect(lesson.updatedAt).toBe(7);
    expect(lesson.page).toBe(2);
    expect(course.uid).toBeTruthy();
    expect(act.device).toBeTruthy();
    expect(act.wordsRead).toBe(3);
    await upgraded.delete();
  });
});
