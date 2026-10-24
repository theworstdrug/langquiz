import { SYNC_TX, termKey, type Activity, type Course, type Deletion, type LangDB, type Lesson, type Setting, type Term } from '../db';

export type SyncTerm = Omit<Term, 'id' | 'lessonId'> & { lessonUid?: string };
export type SyncCourse = Omit<Course, 'id'>;
export type SyncLesson = Omit<Lesson, 'id' | 'courseId' | 'audio'> & { courseUid?: string };
export type SyncActivity = Omit<Activity, 'id'>;
export type SyncSetting = Required<Setting>;

export interface SyncFile {
  app: 'langquiz-sync';
  version: 1;
  updatedAt: number;
  terms: SyncTerm[];
  courses: SyncCourse[];
  lessons: SyncLesson[];
  activity: SyncActivity[];
  settings: SyncSetting[];
  deletions: Deletion[];
}

/** Settings that describe this device rather than the learner, so they stay local. */
export const LOCAL_ONLY_SETTINGS = new Set(['activeLang', 'theme', 'ttsVoice', 'fontSize', 'lineHeight', 'reminder', 'reminderLastShown']);

const TOMBSTONE_TTL = 365 * 86_400_000;

const activityKey = (a: Pick<Activity, 'lang' | 'date' | 'device'>) => `${a.lang}|${a.date}|${a.device}`;

export async function buildSnapshot(db: LangDB): Promise<SyncFile> {
  const [terms, courses, lessons, activity, settings, deletions] = await Promise.all([
    db.terms.toArray(),
    db.courses.toArray(),
    db.lessons.toArray(),
    db.activity.toArray(),
    db.settings.toArray(),
    db.deletions.toArray(),
  ]);
  const courseUid = new Map(courses.map((c) => [c.id!, c.uid]));
  const lessonUid = new Map(lessons.map((l) => [l.id!, l.uid]));
  return {
    app: 'langquiz-sync',
    version: 1,
    updatedAt: Date.now(),
    terms: terms.map(({ id: _id, lessonId, ...t }) => ({ ...t, lessonUid: lessonId ? lessonUid.get(lessonId) : undefined })),
    courses: courses.map(({ id: _id, ...c }) => c),
    // Audio files stay on the device they were added on; they are too large to sync.
    lessons: lessons.map(({ id: _id, courseId, audio: _audio, ...l }) => ({ ...l, courseUid: courseId ? courseUid.get(courseId) : undefined })),
    activity: activity.map(({ id: _id, ...a }) => a),
    settings: settings.filter((s) => !LOCAL_ONLY_SETTINGS.has(s.key)).map((s) => ({ ...s, updatedAt: s.updatedAt ?? 0 })),
    deletions,
  };
}

function newest<T extends { updatedAt: number }>(a: T[], b: T[], key: (x: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  for (const x of [...a, ...b]) {
    const k = key(x);
    const cur = out.get(k);
    if (!cur || (x.updatedAt ?? 0) > (cur.updatedAt ?? 0)) out.set(k, x);
  }
  return out;
}

/**
 * Merge two snapshots. Each record resolves independently: the most recently
 * changed copy wins, and a deletion wins over any copy changed before it.
 */
export function mergeSnapshots(a: SyncFile, b: SyncFile, now = Date.now()): SyncFile {
  const deletions = new Map<string, Deletion>();
  for (const d of [...a.deletions, ...b.deletions]) {
    if (now - d.deletedAt > TOMBSTONE_TTL) continue;
    const cur = deletions.get(d.key);
    if (!cur || d.deletedAt > cur.deletedAt) deletions.set(d.key, d);
  }
  const alive = <T extends { updatedAt: number }>(table: Deletion['table'], key: (x: T) => string) => (x: T): boolean => {
    const d = deletions.get(`${table}:${key(x)}`);
    return !d || (x.updatedAt ?? 0) > d.deletedAt;
  };
  const uid = (x: { uid: string }) => x.uid;
  return {
    app: 'langquiz-sync',
    version: 1,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    terms: [...newest(a.terms, b.terms, termKey).values()].filter(alive<SyncTerm>('terms', termKey)),
    courses: [...newest(a.courses, b.courses, uid).values()].filter(alive<SyncCourse>('courses', uid)),
    lessons: [...newest(a.lessons, b.lessons, uid).values()].filter(alive<SyncLesson>('lessons', uid)),
    activity: [...newest(a.activity, b.activity, activityKey).values()],
    settings: [...newest(a.settings, b.settings, (s) => s.key).values()].filter((s) => !LOCAL_ONLY_SETTINGS.has(s.key)),
    deletions: [...deletions.values()],
  };
}

/** Comparable fingerprint of a snapshot's data (ignores the file timestamp and ordering). */
export function fingerprint(f: SyncFile): string {
  const sorted = <T>(xs: T[], key: (x: T) => string) => [...xs].sort((x, y) => (key(x) < key(y) ? -1 : 1));
  return JSON.stringify([
    sorted(f.terms, termKey),
    sorted(f.courses, (c) => c.uid),
    sorted(f.lessons, (l) => l.uid),
    sorted(f.activity, activityKey),
    sorted(f.settings, (s) => s.key),
    sorted(f.deletions, (d) => d.key),
  ]);
}

/** Write a merged snapshot into the local database, changing only what differs. */
export async function applySnapshot(db: LangDB, merged: SyncFile): Promise<{ changed: number }> {
  let changed = 0;
  await db.transaction('rw', [db.terms, db.courses, db.lessons, db.activity, db.settings, db.deletions], async (tx) => {
    (tx as unknown as Record<symbol, boolean>)[SYNC_TX] = true;

    const isNewer = (remote: { updatedAt: number }, local?: { updatedAt?: number }) => !local || remote.updatedAt > (local.updatedAt ?? 0);
    // Only an explicit tombstone removes a local record: anything else missing from the
    // snapshot may simply have been created on this device while the sync was running.
    const tomb = new Map(merged.deletions.map((d) => [d.key, d.deletedAt]));
    const deleted = (table: Deletion['table'], key: string, local: { updatedAt?: number }) =>
      (tomb.get(`${table}:${key}`) ?? -1) >= (local.updatedAt ?? 0);

    // Courses
    const localCourses = new Map((await db.courses.toArray()).map((c) => [c.uid, c]));
    const coursePuts = merged.courses.filter((c) => isNewer(c, localCourses.get(c.uid))).map((c) => ({ ...c, id: localCourses.get(c.uid)?.id }));
    const courseDeletes = [...localCourses.values()].filter((c) => deleted('courses', c.uid, c)).map((c) => c.id!);
    await db.courses.bulkPut(coursePuts);
    await db.courses.bulkDelete(courseDeletes);
    changed += coursePuts.length + courseDeletes.length;
    const courseId = new Map((await db.courses.toArray()).map((c) => [c.uid, c.id!]));

    // Lessons (keep this device's audio, which is never synced)
    const localLessons = new Map((await db.lessons.toArray()).map((l) => [l.uid, l]));
    const lessonPuts: Lesson[] = merged.lessons
      .filter((l) => isNewer(l, localLessons.get(l.uid)))
      .map(({ courseUid, ...l }) => {
        const local = localLessons.get(l.uid);
        return {
          ...l,
          id: local?.id,
          courseId: courseUid ? courseId.get(courseUid) : undefined,
          audio: local?.audio,
          audioName: local?.audio ? local.audioName : l.audioName,
        };
      });
    const lessonDeletes = [...localLessons.values()].filter((l) => deleted('lessons', l.uid, l)).map((l) => l.id!);
    await db.lessons.bulkPut(lessonPuts);
    await db.lessons.bulkDelete(lessonDeletes);
    changed += lessonPuts.length + lessonDeletes.length;
    const lessonId = new Map((await db.lessons.toArray()).map((l) => [l.uid, l.id!]));

    // Terms
    const localTerms = new Map((await db.terms.toArray()).map((t) => [termKey(t), t]));
    const termPuts: Term[] = merged.terms
      .filter((t) => isNewer(t, localTerms.get(termKey(t))))
      .map(({ lessonUid, ...t }) => ({ ...t, id: localTerms.get(termKey(t))?.id, lessonId: lessonUid ? lessonId.get(lessonUid) : undefined }));
    const termDeletes = [...localTerms.entries()].filter(([k, t]) => deleted('terms', k, t)).map(([, t]) => t.id!);
    await db.terms.bulkPut(termPuts);
    await db.terms.bulkDelete(termDeletes);
    changed += termPuts.length + termDeletes.length;

    // Activity
    const localActivity = new Map((await db.activity.toArray()).map((a) => [activityKey(a), a]));
    const activityPuts = merged.activity
      .filter((a) => isNewer(a, localActivity.get(activityKey(a))))
      .map((a) => ({ ...a, id: localActivity.get(activityKey(a))?.id }));
    await db.activity.bulkPut(activityPuts);
    changed += activityPuts.length;

    // Settings
    const localSettings = new Map((await db.settings.toArray()).map((s) => [s.key, s]));
    const settingPuts = merged.settings.filter((s) => isNewer(s, localSettings.get(s.key)));
    await db.settings.bulkPut(settingPuts);
    changed += settingPuts.length;

    // Union, so a deletion made on this device mid-sync is kept for the next round.
    await db.deletions.bulkPut(merged.deletions);
  });
  return { changed };
}

export async function compress(f: SyncFile): Promise<Blob> {
  const json = new Blob([JSON.stringify(f)]);
  if (typeof CompressionStream === 'undefined') return json;
  return new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

export async function decompress(data: ArrayBuffer): Promise<SyncFile> {
  const bytes = new Uint8Array(data);
  const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = gz
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(bytes);
  const f = JSON.parse(text);
  if (f?.app !== 'langquiz-sync') throw new Error('The Drive sync file is not a LangQuiz sync file');
  return f;
}
