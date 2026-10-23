import { describe, expect, it } from 'vitest';
import { isDue, review, scheduleForStatus } from '../srs';
import type { Term } from '../db';

const base: Term = {
  lang: 'es', term: 'perro', status: 1, isPhrase: false, meanings: ['dog'], notes: '', tags: [], fragment: '',
  createdAt: 0, updatedAt: 0, due: 0, interval: 0, reps: 0, lapses: 0,
};

describe('srs', () => {
  it('raises status on a correct answer and schedules into the future', () => {
    const r = review(base, 'good', 1000);
    expect(r.status).toBe(2);
    expect(r.due!).toBeGreaterThan(1000 + 86_400_000);
  });

  it('caps status at 4', () => {
    expect(review({ ...base, status: 4 }, 'easy').status).toBe(4);
  });

  it('drops back to status 1 on a miss', () => {
    const r = review({ ...base, status: 3, interval: 7 }, 'again', 0);
    expect(r.status).toBe(1);
    expect(r.lapses).toBe(1);
    expect(r.interval).toBe(0);
  });

  it('only LingQs (1-4) are ever due', () => {
    expect(isDue({ ...base, status: 5, due: 0 }, 10)).toBe(false);
    expect(isDue({ ...base, status: 0, due: 0 }, 10)).toBe(false);
    expect(isDue({ ...base, status: 2, due: 0 }, 10)).toBe(true);
  });

  it('status 1 is due immediately', () => {
    expect(scheduleForStatus(1, 50).due).toBe(50);
  });
});
