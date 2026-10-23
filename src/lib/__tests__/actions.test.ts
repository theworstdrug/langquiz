import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, KNOWN } from '../db';
import { createLesson, markWordsKnown, newWordStats, upsertTerm } from '../actions';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('term actions', () => {
  it('creating a LingQ counts towards daily activity', async () => {
    await upsertTerm('es', 'perro', { meanings: ['dog'] });
    const t = await db.terms.where({ lang: 'es', term: 'perro' }).first();
    expect(t?.status).toBe(1);
    const act = await db.activity.toArray();
    expect(act[0].lingqsCreated).toBe(1);
  });

  it('page turn marks only new words as known', async () => {
    await upsertTerm('es', 'perro', { status: 2 });
    const added = await markWordsKnown('es', ['perro', 'gato', 'gato', 'casa']);
    expect(added).toBe(2);
    expect((await db.terms.where({ lang: 'es', term: 'perro' }).first())?.status).toBe(2);
    expect((await db.terms.where({ lang: 'es', term: 'gato' }).first())?.status).toBe(KNOWN);
    expect((await db.activity.toArray())[0].knownAdded).toBe(2);
  });

  it('computes new-word percentage for a lesson', async () => {
    const id = await createLesson({ lang: 'es', title: 't', text: 'el perro y el gato' });
    const lesson = (await db.lessons.get(id))!;
    expect(lesson.wordCount).toBe(5);
    await markWordsKnown('es', ['el', 'y']);
    await upsertTerm('es', 'perro', {});
    const terms = new Map((await db.terms.toArray()).map((t) => [t.term, t]));
    expect(newWordStats(lesson, terms)).toEqual({ fresh: 1, lingqs: 1, pctNew: 25 });
  });
});
