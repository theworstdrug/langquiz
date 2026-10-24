import { reminderIcs, type ReminderSettings } from '../reminders-core';
import { deviceId } from './db';
import { download } from './backup';

export type NotifyPermission = NotificationPermission | 'unsupported';

export function notifyPermission(): NotifyPermission {
  return typeof Notification === 'undefined' || !('serviceWorker' in navigator) ? 'unsupported' : Notification.permission;
}

/** iPhone/iPad only allow web notifications for apps added to the Home Screen. */
export function needsHomeScreenOnIos(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  return ios && !matchMedia('(display-mode: standalone)').matches;
}

export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (notifyPermission() === 'unsupported') return 'unsupported';
  return Notification.requestPermission();
}

type PeriodicReg = ServiceWorkerRegistration & {
  periodicSync?: { register(tag: string, o: { minInterval: number }): Promise<void>; unregister(tag: string): Promise<void> };
};

/**
 * Ask the browser to wake the service worker in the background. Only installed
 * Chromium apps get this, and the browser decides the actual frequency.
 */
export async function setBackgroundChecks(on: boolean): Promise<'on' | 'off' | 'unavailable'> {
  try {
    const reg = (await navigator.serviceWorker?.getRegistration()) as PeriodicReg | undefined;
    if (!reg?.periodicSync) return 'unavailable';
    if (!on) {
      await reg.periodicSync.unregister('study-reminder');
      return 'off';
    }
    const perm = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });
    if (perm.state !== 'granted') return 'unavailable';
    await reg.periodicSync.register('study-reminder', { minInterval: 60 * 60 * 1000 });
    return 'on';
  } catch {
    return 'unavailable';
  }
}

async function postToWorker(type: string): Promise<boolean> {
  const reg = await navigator.serviceWorker?.getRegistration();
  const target = navigator.serviceWorker?.controller ?? reg?.active;
  if (!target) return false;
  target.postMessage({ type });
  return true;
}

/** Show a sample reminder now (ignores time, days and goal). */
export async function testReminder(): Promise<boolean> {
  return postToWorker('test-reminder');
}

let started = false;

/** While the app is open (even in a background tab), check every minute whether a reminder is due. */
export function startReminderChecks() {
  if (started || !('serviceWorker' in navigator)) return;
  started = true;
  const ping = () => {
    if (notifyPermission() === 'granted') postToWorker('check-reminder');
  };
  setInterval(ping, 60_000);
  document.addEventListener('visibilitychange', ping);
  navigator.serviceWorker.ready.then(ping);
}

export function downloadCalendarReminder(r: ReminderSettings, langName: string) {
  const appUrl = location.href.split('#')[0];
  const ics = reminderIcs(r, langName, appUrl, `reminder-${deviceId()}`);
  download(new Blob([ics], { type: 'text/calendar' }), 'langquiz-study-reminder.ics');
}
