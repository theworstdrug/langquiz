import { db, deviceId, uuid, KNOWN, termKey, type Activity, type Deletion, type Lesson, type Status, type SyncedTable, type Term } from './db';
import { newSrsFields, scheduleForStatus } from './srs';
import { uniqueWords } from './tokenize';

export function today(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type Counter = 'wordsRead' | 'lingqsCreated' | 'knownAdded' | 'listeningSeconds' | 'reviews' | 'lessonsCompleted';

export async function bumpActivity(lang: string, field: Counter, amount = 1) {
  if (!amount) return;
  const date = today();
  const device = deviceId();
  await db.transaction('rw', db.activity, async () => {
    const row = await db.activity.where({ lang, date, device }).first();
    if (row) {
      await db.activity.update(row.id!, { [field]: (row[field] ?? 0) + amount });
    } else {
      const fresh: Activity = {
        lang,
        date,
        device,
        updatedAt: Date.now(),
        wordsRead: 0,
        lingqsCreated: 0,
        knownAdded: 0,
        listeningSeconds: 0,
        reviews: 0,
        lessonsCompleted: 0,
      };
      fresh[field] = amount;
      await db.activity.add(fresh);
    }
  });
}

export async function getTerm(lang: string, term: string) {
  return db.terms.where({ lang, term }).first();
}

/** Create or update a term. Tracks LingQ/known counters for stats. */
export async function upsertTerm(
  lang: string,
  term: string,
  patch: Partial<Term>,
  context: { fragment?: string; lessonId?: number } = {},
): Promise<Term> {
  const now = Date.now();
  const existing = await getTerm(lang, term);
  if (existing) {
    const next: Partial<Term> = { ...patch, updatedAt: now };
    if (patch.status !== undefined && patch.status !== existing.status) {
      Object.assign(next, scheduleForStatus(patch.status, now));
      if (patch.status === KNOWN && existing.status !== KNOWN) await bumpActivity(lang, 'knownAdded');
    }
    await db.terms.update(existing.id!, next);
    return { ...existing, ...next };
  }
  const status: Status = patch.status ?? 1;
  const fresh: Term = {
    lang,
    term,
    status,
    isPhrase: term.includes(' '),
    meanings: [],
    notes: '',
    tags: [],
    fragment: context.fragment ?? '',
    lessonId: context.lessonId,
    createdAt: now,
    updatedAt: now,
    ...newSrsFields(now),
    ...scheduleForStatus(status, now),
    ...patch,
  };
  const id = await db.terms.add(fresh);
  if (status >= 1 && status <= 4) await bumpActivity(lang, 'lingqsCreated');
  if (status === KNOWN) await bumpActivity(lang, 'knownAdded');
  return { ...fresh, id };
}

/** LingQ's "page turn": every still-blue word on the page becomes known. */
export async function markWordsKnown(lang: string, words: string[]) {
  const unique = [...new Set(words)];
  if (!unique.length) return 0;
  const now = Date.now();
  const existing = await db.terms.where('[lang+term]').anyOf(unique.map((w) => [lang, w])).toArray();
  const have = new Set(existing.map((t) => t.term));
  const fresh: Term[] = unique
    .filter((w) => !have.has(w))
    .map((term) => ({
      lang,
      term,
      status: KNOWN,
      isPhrase: false,
      meanings: [],
      notes: '',
      tags: [],
      fragment: '',
      createdAt: now,
      updatedAt: now,
      ...newSrsFields(now),
      ...scheduleForStatus(KNOWN, now),
    }));
  await db.terms.bulkAdd(fresh);
  await bumpActivity(lang, 'knownAdded', fresh.length);
  return fresh.length;
}

function tombstones(table: SyncedTable, keys: string[]): Deletion[] {
  const deletedAt = Date.now();
  return keys.map((recordKey) => ({ key: `${table}:${recordKey}`, table, recordKey, deletedAt }));
}

export async function deleteTerms(ids: number[]) {
  await db.transaction('rw', db.terms, db.deletions, async () => {
    const terms = (await db.terms.bulkGet(ids)).filter((t): t is Term => !!t);
    await db.deletions.bulkPut(tombstones('terms', terms.map(termKey)));
    await db.terms.bulkDelete(ids);
  });
}

export async function deleteTerm(id: number) {
  await deleteTerms([id]);
}

export async function createLesson(
  input: Pick<Lesson, 'lang' | 'title' | 'text'> & Partial<Lesson>,
): Promise<number> {
  const now = Date.now();
  const { unique, count } = uniqueWords(input.text, input.lang);
  const order = input.courseId ? await db.lessons.where({ courseId: input.courseId }).count() : 0;
  return db.lessons.add({
    uid: uuid(),
    updatedAt: now,
    tags: [],
    createdAt: now,
    page: 0,
    completed: false,
    timesCompleted: 0,
    order,
    ...input,
    uniqueWords: unique,
    wordCount: count,
  });
}

export async function updateLessonText(id: number, lang: string, patch: Partial<Lesson>) {
  if (patch.text !== undefined) {
    const { unique, count } = uniqueWords(patch.text, lang);
    patch = { ...patch, uniqueWords: unique, wordCount: count };
  }
  await db.lessons.update(id, patch);
}

export async function deleteLesson(id: number) {
  await db.transaction('rw', db.lessons, db.deletions, async () => {
    const lesson = await db.lessons.get(id);
    if (lesson) await db.deletions.bulkPut(tombstones('lessons', [lesson.uid]));
    await db.lessons.delete(id);
  });
}

export async function deleteCourse(id: number, withLessons: boolean) {
  await db.transaction('rw', db.courses, db.lessons, db.deletions, async () => {
    const course = await db.courses.get(id);
    const lessons = await db.lessons.where({ courseId: id }).toArray();
    if (withLessons) {
      await db.deletions.bulkPut(tombstones('lessons', lessons.map((l) => l.uid)));
      await db.lessons.bulkDelete(lessons.map((l) => l.id!));
    } else await db.lessons.where({ courseId: id }).modify({ courseId: undefined });
    if (course) await db.deletions.bulkPut(tombstones('courses', [course.uid]));
    await db.courses.delete(id);
  });
}

export async function ensureCourse(lang: string, title: string, uid = uuid()): Promise<number> {
  const existing = await db.courses.where({ lang }).filter((c) => c.title === title).first();
  if (existing) return existing.id!;
  const now = Date.now();
  return db.courses.add({ uid, updatedAt: now, lang, title, description: '', createdAt: now });
}

/** Fraction of a lesson's unique words that are still new (no term record). */
export function newWordStats(lesson: Pick<Lesson, 'uniqueWords'>, terms: Map<string, Term>) {
  let fresh = 0;
  let lingqs = 0;
  for (const w of lesson.uniqueWords) {
    const t = terms.get(w);
    if (!t) fresh++;
    else if (t.status >= 1 && t.status <= 4) lingqs++;
  }
  const total = lesson.uniqueWords.length || 1;
  return { fresh, lingqs, pctNew: Math.round((fresh / total) * 100) };
}
