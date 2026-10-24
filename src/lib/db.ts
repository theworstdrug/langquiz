import Dexie, { type Table, type Transaction } from 'dexie';
import type { TimedSegment } from './tokenize';

/**
 * Term status, mirroring LingQ:
 *  1–4 = LingQ (new → learned), 5 = known, 0 = ignored.
 * Words with no Term record are "new" (blue).
 */
export type Status = 0 | 1 | 2 | 3 | 4 | 5;
export const IGNORED: Status = 0;
export const KNOWN: Status = 5;

export const STATUS_LABELS: Record<Status, string> = {
  0: 'Ignored',
  1: 'New',
  2: 'Recognized',
  3: 'Familiar',
  4: 'Learned',
  5: 'Known',
};

export interface Term {
  id?: number;
  lang: string;
  term: string; // normalized key
  status: Status;
  isPhrase: boolean;
  meanings: string[];
  notes: string;
  tags: string[];
  /** Example sentence the term was saved from. */
  fragment: string;
  lessonId?: number;
  createdAt: number;
  updatedAt: number;
  // Spaced repetition
  due: number;
  interval: number; // days
  reps: number;
  lapses: number;
}

export interface Course {
  id?: number;
  /** Stable id shared across synced devices. */
  uid: string;
  updatedAt: number;
  lang: string;
  title: string;
  description: string;
  createdAt: number;
}

export interface Lesson {
  id?: number;
  /** Stable id shared across synced devices. */
  uid: string;
  updatedAt: number;
  lang: string;
  courseId?: number;
  title: string;
  text: string;
  segments?: TimedSegment[];
  audio?: Blob;
  audioName?: string;
  mediaUrl?: string;
  youtubeId?: string;
  sourceUrl?: string;
  tags: string[];
  uniqueWords: string[];
  wordCount: number;
  createdAt: number;
  lastOpenedAt?: number;
  page: number;
  completed: boolean;
  timesCompleted: number;
  order: number;
}

export interface Activity {
  id?: number;
  lang: string;
  date: string; // YYYY-MM-DD (local)
  /** Each device keeps its own counters so synced totals add up instead of overwriting. */
  device: string;
  updatedAt: number;
  wordsRead: number;
  lingqsCreated: number;
  knownAdded: number;
  listeningSeconds: number;
  reviews: number;
  lessonsCompleted: number;
}

export interface Setting {
  key: string;
  value: unknown;
  updatedAt?: number;
}

export type SyncedTable = 'terms' | 'lessons' | 'courses';

/** Tombstone so a deletion propagates to other devices instead of being undone by them. */
export interface Deletion {
  key: string; // `${table}:${recordKey}`
  table: SyncedTable;
  recordKey: string;
  deletedAt: number;
}

export function uuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

let memoryDeviceId: string | undefined;

/** Per-browser id, kept outside IndexedDB so it is never synced. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('langquiz-device');
    if (!id) {
      id = uuid();
      localStorage.setItem('langquiz-device', id);
    }
    return id;
  } catch {
    return (memoryDeviceId ??= uuid());
  }
}

export const termKey = (t: Pick<Term, 'lang' | 'term'>) => `${t.lang}|${t.term}`;

type ChangeListener = () => void;
const changeListeners = new Set<ChangeListener>();

/** Notified after local edits (not sync writes), used to schedule a sync. */
export function onLocalChange(fn: ChangeListener) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/** Marks a transaction as applying remote data, so hooks keep remote timestamps. */
export const SYNC_TX = Symbol('sync');
const isSyncTx = (tx: Transaction | undefined) => !!(tx as unknown as Record<symbol, boolean> | undefined)?.[SYNC_TX];

export class LangDB extends Dexie {
  terms!: Table<Term, number>;
  courses!: Table<Course, number>;
  lessons!: Table<Lesson, number>;
  activity!: Table<Activity, number>;
  settings!: Table<Setting, string>;
  deletions!: Table<Deletion, string>;

  constructor(name = 'langquiz') {
    super(name);
    this.version(1).stores({
      terms: '++id, &[lang+term], lang, status, isPhrase, due, createdAt, updatedAt',
      courses: '++id, lang, createdAt',
      lessons: '++id, lang, courseId, createdAt, lastOpenedAt',
      activity: '++id, &[lang+date], lang, date',
      settings: 'key',
    });
    this.version(2)
      .stores({
        courses: '++id, &uid, lang, createdAt',
        lessons: '++id, &uid, lang, courseId, createdAt, lastOpenedAt',
        activity: '++id, &[lang+date+device], lang, date',
        deletions: 'key, table',
      })
      .upgrade(async (tx) => {
        const now = Date.now();
        const device = deviceId();
        await tx.table('courses').toCollection().modify((c) => {
          c.uid ??= uuid();
          c.updatedAt ??= c.createdAt ?? now;
        });
        await tx.table('lessons').toCollection().modify((l) => {
          l.uid ??= uuid();
          l.updatedAt ??= l.lastOpenedAt ?? l.createdAt ?? now;
        });
        await tx.table('activity').toCollection().modify((a) => {
          a.device ??= device;
          a.updatedAt ??= now;
        });
        await tx.table('settings').toCollection().modify((r) => {
          r.updatedAt ??= now;
        });
      });

    // Stamp every write with uid/updatedAt so sync can resolve conflicts (newest wins).
    const notified = new WeakSet<Transaction>();
    const notify = (tx: Transaction | undefined) => {
      if (!tx || isSyncTx(tx) || notified.has(tx)) return;
      notified.add(tx);
      tx.on('complete', () => changeListeners.forEach((fn) => fn()));
    };
    for (const name of ['terms', 'courses', 'lessons', 'activity', 'settings'] as const) {
      const table = this.table(name);
      table.hook('creating', (_key, obj, tx) => {
        const o = obj as { uid?: string; updatedAt?: number; device?: string };
        if ((name === 'courses' || name === 'lessons') && !o.uid) o.uid = uuid();
        if (name === 'activity' && !o.device) o.device = deviceId();
        o.updatedAt ??= Date.now();
        notify(tx);
      });
      table.hook('updating', (mods, _key, _obj, tx) => {
        notify(tx);
        // put() diffs against the stored row, so an omitted updatedAt arrives as `undefined` (= remove it).
        if (isSyncTx(tx) || (mods as { updatedAt?: number }).updatedAt !== undefined) return undefined;
        return { updatedAt: Date.now() };
      });
      table.hook('deleting', (_key, _obj, tx) => notify(tx));
    }
  }
}

export const db = new LangDB();
