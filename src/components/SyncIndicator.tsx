import { Link } from 'react-router-dom';
import { syncNow, useSyncStatus } from '../lib/sync';

export function timeAgo(ts?: number) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function SyncIndicator() {
  const s = useSyncStatus();
  if (s.state === 'off') return null;
  if (s.state === 'reconnect') {
    return (
      <button className="sync-chip warn" onClick={() => syncNow(true).catch(() => {})} title={s.message}>
        ☁ Reconnect
      </button>
    );
  }
  const label = s.state === 'syncing' ? 'Syncing…' : s.state === 'error' ? `Sync failed: ${s.message}` : `Synced ${timeAgo(s.lastSyncAt)}`;
  return (
    <Link to="/settings" className={`sync-chip ${s.state}`} title={label} aria-label={label}>
      <span className={s.state === 'syncing' ? 'spin' : ''}>☁</span>
      {s.state === 'error' ? '!' : s.state === 'idle' ? '✓' : ''}
    </Link>
  );
}
