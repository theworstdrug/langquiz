/**
 * Pure study-reminder logic, shared by the service worker (which shows the
 * notification) and tests. Must not import app modules: it is bundled into
 * sw.js on its own.
 */

export interface ReminderSettings {
  enabled: boolean;
  /** Local time, "HH:MM". */
  time: string;
  /** Days of week to remind on, 0 = Sunday. */
  days: number[];
  onlyIfGoalUnmet: boolean;
}

export const DEFAULT_REMINDER: ReminderSettings = { enabled: false, time: '19:00', days: [0, 1, 2, 3, 4, 5, 6], onlyIfGoalUnmet: true };

export interface DayActivity {
  date: string;
  lingqsCreated: number;
  wordsRead: number;
  reviews: number;
  listeningSeconds: number;
}

export interface ReminderInput {
  now: Date;
  reminder: ReminderSettings;
  /** Local date (YYYY-MM-DD) a reminder was last shown, so it fires at most once a day. */
  lastShown?: string;
  goal: number;
  langName: string;
  /** Activity rows for the active language (any device; summed per day here). */
  activity: DayActivity[];
  dueReviews: number;
}

export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function totals(rows: DayActivity[]) {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.date, (byDay.get(r.date) ?? 0) + (r.lingqsCreated ?? 0));
  return byDay;
}

/** Consecutive days before today on which the LingQ goal was met. */
export function streakBeforeToday(rows: DayActivity[], goal: number, now: Date): number {
  const byDay = totals(rows);
  const d = new Date(now);
  let n = 0;
  for (;;) {
    d.setDate(d.getDate() - 1);
    if ((byDay.get(localDate(d)) ?? 0) >= goal) n++;
    else return n;
  }
}

export function shouldRemind(i: ReminderInput): boolean {
  const { reminder: r, now } = i;
  if (!r.enabled || !r.days.includes(now.getDay())) return false;
  const today = localDate(now);
  if (i.lastShown === today) return false;
  const [h, m] = r.time.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return false;
  if (r.onlyIfGoalUnmet && (totals(i.activity).get(today) ?? 0) >= i.goal) return false;
  return true;
}

export function reminderMessage(i: ReminderInput): { title: string; body: string; url: string } {
  const done = totals(i.activity).get(localDate(i.now)) ?? 0;
  const left = Math.max(0, i.goal - done);
  const streak = streakBeforeToday(i.activity, i.goal, i.now);
  const parts: string[] = [];
  if (left > 0) parts.push(done === 0 ? `Your goal today is ${i.goal} LingQs.` : `${left} more LingQ${left === 1 ? '' : 's'} to reach today's goal.`);
  if (i.dueReviews > 0) parts.push(`${i.dueReviews} review${i.dueReviews === 1 ? '' : 's'} due.`);
  if (streak > 0 && left > 0) parts.push(`Keep your ${streak}-day streak going! 🔥`);
  if (!parts.length) parts.push('A few minutes of reading keeps the momentum going.');
  return {
    title: `Time to study ${i.langName} 📚`,
    body: parts.join(' '),
    url: i.dueReviews > 0 ? './#/review' : './',
  };
}

const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** A repeating calendar event with an alert: the one reminder that works on every device. */
export function reminderIcs(r: ReminderSettings, langName: string, appUrl: string, uid: string, now = new Date()): string {
  const [h, m] = r.time.split(':');
  const start = new Date(now);
  start.setDate(start.getDate() + 1);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const days = (r.days.length ? r.days : [0, 1, 2, 3, 4, 5, 6]).map((d) => ICS_DAYS[d]).join(',');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LangQuiz//Study reminder//EN',
    'BEGIN:VEVENT',
    `UID:${uid}@langquiz`,
    `DTSTAMP:${stamp}`,
    // Floating local time: the alert follows the device's time zone.
    `DTSTART:${localDate(start).replace(/-/g, '')}T${h}${m}00`,
    'DURATION:PT20M',
    `RRULE:FREQ=WEEKLY;BYDAY=${days}`,
    `SUMMARY:Study ${langName} with LangQuiz`,
    `DESCRIPTION:Read a lesson and review your LingQs: ${appUrl}`,
    `URL:${appUrl}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:PT0M',
    `DESCRIPTION:Time to study ${langName}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
