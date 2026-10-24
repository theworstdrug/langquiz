/// <reference lib="webworker" />
/**
 * Service worker: offline caching plus study reminders. Built as its own
 * bundle (dist/sw.js), so it only imports self-contained modules.
 */
import { DEFAULT_REMINDER, localDate, reminderMessage, shouldRemind, type DayActivity, type ReminderSettings } from './reminders-core';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = 'langquiz-v1';

sw.addEventListener('install', () => sw.skipWaiting());
sw.addEventListener('activate', (e) => e.waitUntil(sw.clients.claim()));

// Network-first: always fresh when online, the last loaded version when offline.
sw.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== sw.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(async () => (await caches.match(req)) ?? (await caches.match('./')) ?? Response.error()),
  );
});

// ---------- Study reminders ----------

/** Open the app's IndexedDB without ever creating it (an empty DB would break the app's upgrade). */
function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => req.transaction?.abort();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const LANG_NAMES: Record<string, string> = {
  ar: 'Arabic', zh: 'Chinese', cs: 'Czech', da: 'Danish', nl: 'Dutch', en: 'English', fi: 'Finnish', fr: 'French', de: 'German',
  el: 'Greek', he: 'Hebrew', hi: 'Hindi', hu: 'Hungarian', id: 'Indonesian', it: 'Italian', ja: 'Japanese', ko: 'Korean', la: 'Latin',
  no: 'Norwegian', fa: 'Persian', pl: 'Polish', pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', es: 'Spanish', sv: 'Swedish',
  th: 'Thai', tr: 'Turkish', uk: 'Ukrainian', vi: 'Vietnamese',
};

let checking: Promise<void> | null = null;

async function checkReminder(force = false): Promise<void> {
  const db = await openExisting('langquiz');
  if (!db) return;
  try {
    const tx = db.transaction(['settings', 'activity', 'terms'], 'readonly');
    const setting = async <T>(key: string, fallback: T) => ((await request(tx.objectStore('settings').get(key)))?.value as T | undefined) ?? fallback;
    const reminder = { ...DEFAULT_REMINDER, ...(await setting<Partial<ReminderSettings>>('reminder', {})) };
    const lang = await setting('activeLang', '');
    if (!lang || (!reminder.enabled && !force)) return;
    const now = new Date();
    const activity = ((await request(tx.objectStore('activity').index('lang').getAll(lang))) as DayActivity[]) ?? [];
    const due = (await request(tx.objectStore('terms').index('due').getAll(IDBKeyRange.upperBound(now.getTime())))) as { lang: string; status: number }[];
    const input = {
      now,
      reminder: force ? { ...reminder, enabled: true, days: [0, 1, 2, 3, 4, 5, 6], time: '00:00', onlyIfGoalUnmet: false } : reminder,
      lastShown: force ? undefined : await setting<string | undefined>('reminderLastShown', undefined),
      goal: await setting('dailyGoal', 20),
      langName: LANG_NAMES[lang] ?? lang,
      activity,
      dueReviews: due.filter((t) => t.lang === lang && t.status >= 1 && t.status <= 4).length,
    };
    if (!shouldRemind(input)) return;
    const msg = reminderMessage(input);
    await sw.registration.showNotification(msg.title, {
      body: msg.body,
      icon: './icon.svg',
      badge: './icon.svg',
      tag: 'study-reminder', // replaces rather than stacks
      data: { url: msg.url },
    });
    if (!force) {
      // Device-local setting (excluded from sync), so each device reminds independently.
      const w = db.transaction('settings', 'readwrite');
      w.objectStore('settings').put({ key: 'reminderLastShown', value: localDate(now) });
    }
  } finally {
    db.close();
  }
}

function check(force = false) {
  checking ??= checkReminder(force).finally(() => (checking = null));
  return checking;
}

// The open app pings every minute; installed apps also get periodic background checks.
sw.addEventListener('message', (e) => {
  const type = (e.data as { type?: string })?.type;
  if (type === 'check-reminder') e.waitUntil(check());
  if (type === 'test-reminder') e.waitUntil(check(true));
});

sw.addEventListener('periodicsync', ((e: Event & { tag: string; waitUntil(p: Promise<unknown>): void }) => {
  if (e.tag === 'study-reminder') e.waitUntil(check());
}) as EventListener);

sw.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data as { url?: string })?.url ?? './', sw.registration.scope).href;
  e.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => w.url.startsWith(sw.registration.scope));
      if (win) return win.focus().then((w) => w.navigate(url));
      return sw.clients.openWindow(url);
    }),
  );
});
