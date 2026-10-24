import { useLiveQuery } from 'dexie-react-hooks';
import { db, KNOWN, type Activity } from '../lib/db';
import { today } from '../lib/actions';
import { dailyTotals, lastNDays, streak } from '../lib/stats';
import { languageName } from '../lib/languages';
import type { Settings } from '../lib/settings';
import BarChart from '../components/BarChart';

const fmtMinutes = (s: number) => (s < 60 ? `${Math.round(s)}s` : `${Math.round(s / 60)} min`);

export default function Stats({ settings }: { settings: Settings }) {
  const lang = settings.activeLang;
  const data = useLiveQuery(async () => {
    const [activity, known, lingqs, lessons] = await Promise.all([
      db.activity.where({ lang }).toArray(),
      db.terms.where({ lang, status: KNOWN }).count(),
      db.terms.where({ lang }).filter((t) => t.status >= 1 && t.status <= 4).count(),
      db.lessons.where({ lang }).toArray(),
    ]);
    return { activity: dailyTotals(activity), known, lingqs, lessons };
  }, [lang]);
  if (!data) return <p className="muted">Loading…</p>;

  const byDate = new Map(data.activity.map((a) => [a.date, a]));
  const days = lastNDays(30);
  const series = (f: keyof Activity) => days.map((d) => ({ label: d, value: Number(byDate.get(d)?.[f] ?? 0) }));
  const t = byDate.get(today());
  const sum = (f: keyof Activity) => data.activity.reduce((n, a) => n + Number(a[f] ?? 0), 0);
  const goalStreak = streak(data.activity, (a) => a.lingqsCreated >= settings.dailyGoal);
  const anyStreak = streak(data.activity, (a) => a.wordsRead + a.lingqsCreated + a.reviews + a.listeningSeconds > 0);

  return (
    <div>
      <h1>{languageName(lang)} progress</h1>
      <div className="stat-grid tiles">
        <Tile big={data.known.toLocaleString()} label="Known words" />
        <Tile big={data.lingqs.toLocaleString()} label="LingQs (learning)" />
        <Tile big={`${t?.lingqsCreated ?? 0} / ${settings.dailyGoal}`} label="Today's LingQ goal" />
        <Tile big={`🔥 ${goalStreak}`} label={`Goal streak · ${anyStreak}-day activity streak`} />
        <Tile big={sum('wordsRead').toLocaleString()} label="Words read" />
        <Tile big={fmtMinutes(sum('listeningSeconds'))} label="Listening" />
        <Tile big={sum('reviews').toLocaleString()} label="Reviews" />
        <Tile big={`${data.lessons.filter((l) => l.completed).length} / ${data.lessons.length}`} label="Lessons completed" />
      </div>
      <h2>Last 30 days</h2>
      <div className="charts">
        <BarChart title="LingQs created" data={series('lingqsCreated')} />
        <BarChart title="Words learned (marked known)" data={series('knownAdded')} />
        <BarChart title="Words read" data={series('wordsRead')} />
        <BarChart title="Listening" data={series('listeningSeconds')} format={fmtMinutes} />
        <BarChart title="Reviews" data={series('reviews')} />
      </div>
    </div>
  );
}

function Tile({ big, label }: { big: string; label: string }) {
  return (
    <div className="card tile">
      <div className="big">{big}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}
