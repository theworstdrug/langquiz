import { useState } from 'react';
import { languageName } from '../lib/languages';
import { downloadCalendarReminder, needsHomeScreenOnIos, notifyPermission, requestNotifyPermission, setBackgroundChecks, testReminder, type NotifyPermission } from '../lib/reminders';
import { updateSettings, type Settings } from '../lib/settings';
import type { ReminderSettings as Reminder } from '../reminders-core';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ReminderSettings({ settings }: { settings: Settings }) {
  const r = settings.reminder;
  const [perm, setPerm] = useState<NotifyPermission>(notifyPermission());
  const [background, setBackground] = useState<'on' | 'off' | 'unavailable' | null>(null);
  const [note, setNote] = useState('');
  const lang = languageName(settings.activeLang);

  const save = (patch: Partial<Reminder>) => updateSettings({ reminder: { ...r, ...patch } });

  const toggle = async (enabled: boolean) => {
    setNote('');
    if (enabled && perm !== 'granted') {
      const p = await requestNotifyPermission();
      setPerm(p);
      if (p !== 'granted') {
        setNote(p === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser\'s site settings, or use the calendar reminder below.' : 'Notifications are not available here; use the calendar reminder below.');
        return;
      }
    }
    await save({ enabled });
    setBackground(await setBackgroundChecks(enabled));
  };

  return (
    <section className="card form" id="reminders">
      <h2>Study reminders</h2>
      <p className="muted small">
        Get a nudge at your study time, saying how many LingQs are left for today's goal and how many reviews are due. Reminders are set per device.
      </p>

      <label className="row">
        <input type="checkbox" checked={r.enabled && perm === 'granted'} disabled={perm === 'unsupported'} onChange={(e) => toggle(e.target.checked)} />
        Send me a notification
      </label>

      <div className="reminder-grid">
        <label>
          Time
          <input type="time" value={r.time} onChange={(e) => e.target.value && save({ time: e.target.value })} />
        </label>
        <div>
          <div className="label-text">Days</div>
          <div className="day-picker" role="group" aria-label="Days">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                aria-pressed={r.days.includes(i)}
                className={r.days.includes(i) ? 'on' : ''}
                onClick={() => save({ days: r.days.includes(i) ? r.days.filter((x) => x !== i) : [...r.days, i].sort() })}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>
      <label className="row">
        <input type="checkbox" checked={r.onlyIfGoalUnmet} onChange={(e) => save({ onlyIfGoalUnmet: e.target.checked })} />
        Skip the reminder if I've already met today's goal ({settings.dailyGoal} LingQs)
      </label>

      {perm === 'granted' && (
        <div className="row">
          <button onClick={async () => setNote((await testReminder()) ? 'Sent a test notification.' : 'The background worker isn\'t running yet. Reload the page and try again.')}>Send a test notification</button>
        </div>
      )}
      {note && <div className="muted small">{note}</div>}

      <div className="reminder-notes small muted">
        {perm === 'unsupported' && <p>This browser can't show notifications from web apps. Use the calendar reminder instead.</p>}
        {needsHomeScreenOnIos() && (
          <p>
            On iPhone and iPad, notifications only work after you add LangQuiz to your Home Screen (Share → Add to Home Screen) and open it from there. Even then, iOS doesn't let web apps check in the background, so the calendar reminder is the reliable option.
          </p>
        )}
        {r.enabled && perm === 'granted' && (
          <p>
            {background === 'on'
              ? 'Background checks are on: your browser will look in now and then, even with LangQuiz closed. The browser decides how often, so the reminder may arrive a little after your set time.'
              : 'Notifications arrive on time while LangQuiz is open in a tab (it can be in the background). With the app closed, they only arrive if LangQuiz is installed as an app in Chrome or Edge, so the browser can check in the background. For a reminder that always fires, add it to your calendar.'}
          </p>
        )}
      </div>

      <div className="row">
        <button onClick={() => downloadCalendarReminder(r, lang)}>📅 Add reminder to my calendar</button>
        <span className="muted small">Repeats at {r.time} on the days above. Works on every device.</span>
      </div>
    </section>
  );
}
