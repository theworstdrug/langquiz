import type { Status, Term } from './db';

const DAY = 86_400_000;

/** Base review interval (days) for each LingQ status. */
const STATUS_INTERVAL: Record<number, number> = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 60 };

export function newSrsFields(now = Date.now()) {
  return { due: now, interval: 0, reps: 0, lapses: 0 };
}

export type Grade = 'again' | 'hard' | 'good' | 'easy';

/**
 * LingQ-style review: answering correctly raises the status (1→4, then known),
 * a miss drops it back to 1. Intervals grow with status and repetitions.
 */
export function review(term: Term, grade: Grade, now = Date.now()): Partial<Term> {
  let status = term.status as number;
  let interval: number;
  let lapses = term.lapses;
  if (grade === 'again') {
    status = 1;
    lapses += 1;
    return { status: status as Status, interval: 0, due: now + 10 * 60_000, lapses, reps: term.reps + 1, updatedAt: now };
  }
  if (grade === 'hard') {
    interval = Math.max(1, Math.round((term.interval || 1) * 1.2));
  } else {
    const step = grade === 'easy' ? 2 : 1;
    status = Math.min(4, Math.max(1, status) + step);
    const base = STATUS_INTERVAL[status] ?? 1;
    interval = Math.max(base, Math.round((term.interval || 0) * (grade === 'easy' ? 2.5 : 1.8)));
  }
  return {
    status: status as Status,
    interval,
    due: now + interval * DAY,
    reps: term.reps + 1,
    lapses,
    updatedAt: now,
  };
}

/** Rescheduling applied when a status is set manually (e.g. from the reader). */
export function scheduleForStatus(status: Status, now = Date.now()): Pick<Term, 'due' | 'interval'> {
  const interval = STATUS_INTERVAL[status] ?? 1;
  return { interval: status === 1 ? 0 : interval, due: status === 1 ? now : now + interval * DAY };
}

export function isDue(term: Term, now = Date.now()): boolean {
  return term.status >= 1 && term.status <= 4 && term.due <= now;
}
