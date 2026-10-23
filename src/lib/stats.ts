import type { Activity } from './db';
import { today } from './actions';

/** Consecutive days (ending today or yesterday) on which `met` holds. */
export function streak(rows: Activity[], met: (a: Activity) => boolean, now = new Date()): number {
  const good = new Set(rows.filter(met).map((r) => r.date));
  const d = new Date(now);
  if (!good.has(today(d))) d.setDate(d.getDate() - 1); // today not done yet doesn't break the streak
  let n = 0;
  while (good.has(today(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function lastNDays(n: number, now = new Date()): string[] {
  const out: string[] = [];
  const d = new Date(now);
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    out.push(today(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
