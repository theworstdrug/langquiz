import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LangDB, type Term } from '../db';
import { syncFolderOnce, syncRoot, type Dir } from '../sync/folder';

type Node = { files: Map<string, string>; dirs: Map<string, Node> };
const node = (): Node => ({ files: new Map(), dirs: new Map() });

/** In-memory folder, standing in for a Drive-for-desktop/Dropbox folder. */
function memDir(n: Node, name: string, writes: string[], path = name): Dir {
  return {
    name,
    async dir(child, create) {
      if (!n.dirs.has(child)) {
        if (!create) return null;
        n.dirs.set(child, node());
      }
      return memDir(n.dirs.get(child)!, child, writes, `${path}/${child}`);
    },
    async entries() {
      return [...[...n.files.keys()].map((k) => ({ name: k, kind: 'file' as const })), ...[...n.dirs.keys()].map((k) => ({ name: k, kind: 'directory' as const }))];
    },
    async read(f) {
      return n.files.get(f) ?? null;
    },
    async write(f, text) {
      writes.push(`${path}/${f}`);
      n.files.set(f, text);
    },
    async remove(f) {
      n.files.delete(f);
    },
  };
}

const term = (t: Partial<Term> & { term: string }): Term => ({
  lang: 'es', status: 1, isPhrase: false, meanings: [], notes: '', tags: [], fragment: '',
  createdAt: 1, updatedAt: 1, due: 0, interval: 0, reps: 0, lapses: 0, ...t,
});
const lesson = (uid: string, text = 'hola') => ({
  uid, updatedAt: 1, lang: 'es', title: uid, text, tags: [], uniqueWords: [], wordCount: 1, createdAt: 1, page: 0, completed: false, timesCompleted: 0, order: 0,
});

let a: LangDB;
let b: LangDB;
let tree: Node;
let writes: string[];
let root: Dir;
const seen: Record<string, Record<string, number>> = { a: {}, b: {} };
let k = 0;

async function sync(dev: 'a' | 'b', dirty = true) {
  const r = await syncFolderOnce(dev === 'a' ? a : b, root, `dev-${dev}`, dev, dirty, seen[dev]);
  seen[dev] = r.seen;
  return r;
}

beforeEach(async () => {
  k++;
  a = new LangDB(`fA${k}`);
  b = new LangDB(`fB${k}`);
  tree = node();
  writes = [];
  root = await syncRoot(memDir(tree, 'My Drive', writes));
  seen.a = {};
  seen.b = {};
});
afterEach(async () => {
  await a.delete();
  await b.delete();
});

describe('folder sync', () => {
  it('creates a LangQuiz folder with one subfolder per device', async () => {
    await a.terms.add(term({ term: 'hola' }));
    await sync('a');
    await sync('b');
    const devices = tree.dirs.get('LangQuiz')!.dirs.get('devices')!;
    expect([...devices.dirs.keys()].sort()).toEqual(['dev-a', 'dev-b']);
    expect([...devices.dirs.get('dev-a')!.files.keys()].sort()).toEqual(['index.json', 'meta.json', 'terms-es.json']);
    expect(await b.terms.where({ lang: 'es', term: 'hola' }).count()).toBe(1);
  });

  it('never writes into another device folder', async () => {
    await a.terms.add(term({ term: 'uno' }));
    await sync('a');
    writes.length = 0;
    await b.terms.add(term({ term: 'dos' }));
    await sync('b');
    expect(writes.every((w) => w.includes('/dev-b/'))).toBe(true);
  });

  it('merges edits made on both devices', async () => {
    await a.terms.add(term({ term: 'uno' }));
    await b.terms.add(term({ term: 'dos' }));
    await sync('a');
    await sync('b');
    await sync('a');
    for (const db of [a, b]) expect((await db.terms.toArray()).map((t) => t.term).sort()).toEqual(['dos', 'uno']);
  });

  it('stores lessons as separate files and only rewrites what changed', async () => {
    await a.lessons.bulkAdd([lesson('l1'), lesson('l2')]);
    await sync('a');
    writes.length = 0;
    await a.lessons.where({ uid: 'l2' }).modify({ page: 4 });
    await sync('a');
    expect(writes.filter((w) => w.includes('/lessons/'))).toEqual(['My Drive/LangQuiz/devices/dev-a/lessons/l2.json']);
  });

  it('removes the file of a deleted lesson everywhere', async () => {
    await a.lessons.bulkAdd([lesson('l1'), lesson('l2')]);
    await sync('a');
    await sync('b');
    const l1 = (await a.lessons.where({ uid: 'l1' }).first())!;
    await a.deletions.put({ key: 'lessons:l1', table: 'lessons', recordKey: 'l1', deletedAt: Date.now() });
    await a.lessons.delete(l1.id!);
    await sync('a');
    await sync('b');
    const devices = tree.dirs.get('LangQuiz')!.dirs.get('devices')!;
    expect([...devices.dirs.get('dev-a')!.dirs.get('lessons')!.files.keys()]).toEqual(['l2.json']);
    expect([...devices.dirs.get('dev-b')!.dirs.get('lessons')!.files.keys()]).toEqual(['l2.json']);
    expect(await b.lessons.where({ uid: 'l1' }).count()).toBe(0);
  });

  it('skips a device whose files have not finished syncing, then picks it up', async () => {
    await a.terms.add(term({ term: 'uno' }));
    await sync('a');
    const devA = tree.dirs.get('LangQuiz')!.dirs.get('devices')!.dirs.get('dev-a')!;
    const good = devA.files.get('terms-es.json')!;
    devA.files.set('terms-es.json', good.slice(0, 10)); // half-downloaded by the sync app
    await sync('b');
    expect(await b.terms.count()).toBe(0);
    devA.files.set('terms-es.json', good);
    await sync('b', false);
    expect(await b.terms.count()).toBe(1);
  });

  it('skips work when nothing changed anywhere', async () => {
    await a.terms.add(term({ term: 'uno' }));
    await sync('a');
    await sync('b');
    expect((await sync('b', false)).skipped).toBe(true);
    await a.terms.add(term({ term: 'dos' }));
    await sync('a');
    expect((await sync('b', false)).skipped).toBe(false);
    expect(await b.terms.count()).toBe(2);
  });

  it('uses the picked folder directly when it already is the LangQuiz folder', async () => {
    const t = node();
    const r = await syncRoot(memDir(t, 'LangQuiz', []));
    expect(r.name).toBe('LangQuiz');
    expect(t.dirs.size).toBe(0);
  });
});
