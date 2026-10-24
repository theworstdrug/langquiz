import { describe, expect, it } from 'vitest';
import { DEFAULT_REMINDER, reminderIcs, reminderMessage, shouldRemind, streakBeforeToday, type ReminderInput } from '../../reminders-core';

const day = (date: string, lingqsCreated: number) => ({ date, lingqsCreated, wordsRead: 0, reviews: 0, listeningSeconds: 0 });
// Saturday 24 Oct 2026, 19:30 local
const now = new Date(2026, 9, 24, 19, 30);
const base: ReminderInput = { now, reminder: { ...DEFAULT_REMINDER, enabled: true }, goal: 20, langName: 'Spanish', activity: [], dueReviews: 0 };

describe('shouldRemind', () => {
  it('fires after the reminder time when the goal is not met', () => {
    expect(shouldRemind(base)).toBe(true);
  });
  it('waits until the reminder time', () => {
    expect(shouldRemind({ ...base, now: new Date(2026, 9, 24, 18, 59) })).toBe(false);
  });
  it('fires at most once a day', () => {
    expect(shouldRemind({ ...base, lastShown: '2026-10-24' })).toBe(false);
    expect(shouldRemind({ ...base, lastShown: '2026-10-23' })).toBe(true);
  });
  it('stays quiet once the goal is met, summing all devices', () => {
    expect(shouldRemind({ ...base, activity: [day('2026-10-24', 12), day('2026-10-24', 8)] })).toBe(false);
  });
  it('can remind even when the goal is met', () => {
    expect(shouldRemind({ ...base, reminder: { ...base.reminder, onlyIfGoalUnmet: false }, activity: [day('2026-10-24', 30)] })).toBe(true);
  });
  it('respects the chosen days and the on/off switch', () => {
    expect(shouldRemind({ ...base, reminder: { ...base.reminder, days: [1, 2, 3, 4, 5] } })).toBe(false); // Saturday
    expect(shouldRemind({ ...base, reminder: { ...base.reminder, enabled: false } })).toBe(false);
  });
});

describe('reminderMessage', () => {
  it('mentions what is left, reviews due and the streak', () => {
    const msg = reminderMessage({ ...base, dueReviews: 8, activity: [day('2026-10-24', 8), day('2026-10-23', 20), day('2026-10-22', 25)] });
    expect(msg.title).toBe('Time to study Spanish 📚');
    expect(msg.body).toBe("12 more LingQs to reach today's goal. 8 reviews due. Keep your 2-day streak going! 🔥");
    expect(msg.url).toBe('./#/review');
  });
  it('opens the library when nothing is due', () => {
    expect(reminderMessage(base).url).toBe('./');
    expect(reminderMessage(base).body).toBe('Your goal today is 20 LingQs.');
  });
});

describe('streakBeforeToday', () => {
  it('counts back from yesterday until a missed day', () => {
    expect(streakBeforeToday([day('2026-10-23', 20), day('2026-10-22', 20), day('2026-10-20', 20)], 20, now)).toBe(2);
  });
});

describe('reminderIcs', () => {
  it('builds a weekly repeating event with an alert', () => {
    const ics = reminderIcs({ ...DEFAULT_REMINDER, time: '07:45', days: [1, 3, 5] }, 'Spanish', 'https://x.test/', 'dev1', now);
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(ics).toContain('DTSTART:20261025T074500');
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});
