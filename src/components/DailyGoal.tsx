import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../lib/db';
import { today } from '../lib/actions';
import { streak } from '../lib/stats';

export default function DailyGoal({ lang, goal }: { lang: string; goal: number }) {
  const rows = useLiveQuery(() => db.activity.where({ lang }).toArray(), [lang]);
  if (!rows) return null;
  const t = rows.find((r) => r.date === today());
  const done = t?.lingqsCreated ?? 0;
  const s = streak(rows, (r) => r.lingqsCreated >= goal);
  const pct = Math.min(100, Math.round((done / Math.max(1, goal)) * 100));
  return (
    <Link to="/stats" className="goal" title={`Daily goal: ${done}/${goal} LingQs today · ${s}-day streak`}>
      <span className="goal-ring" style={{ ['--pct' as string]: `${pct}%` }}>
        <span>{done}</span>
      </span>
      <span className="streak">🔥 {s}</span>
    </Link>
  );
}
