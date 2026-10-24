import { useEffect, useRef } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { languageName } from './lib/languages';
import { updateSettings, useSettings } from './lib/settings';
import Library from './pages/Library';
import Import from './pages/Import';
import Reader from './pages/Reader';
import Vocabulary from './pages/Vocabulary';
import Review from './pages/Review';
import Stats from './pages/Stats';
import SettingsPage from './pages/Settings';
import Onboarding from './pages/Onboarding';
import DailyGoal from './components/DailyGoal';
import NavIcon from './components/NavIcon';
import SyncIndicator from './components/SyncIndicator';
import { startAutoSync } from './lib/sync';
import { startReminderChecks } from './lib/reminders';

const NAV: [string, string, string][] = [
  ['/', 'Library', 'library'],
  ['/import', 'Import', 'import'],
  ['/vocabulary', 'Vocabulary', 'vocabulary'],
  ['/review', 'Review', 'review'],
  ['/stats', 'Stats', 'stats'],
  ['/settings', 'Settings', 'settings'],
];

export default function App() {
  const settings = useSettings();

  useEffect(() => {
    startAutoSync();
    startReminderChecks();
  }, []);

  // Expose the top bar's height so sticky elements (e.g. a pinned video) can sit below it.
  const topbar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = topbar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [settings?.activeLang]);

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    // Match the browser/OS chrome (address bar, status bar) to the page background.
    const meta = document.querySelector('meta[name="theme-color"]');
    const apply = () => meta?.setAttribute('content', getComputedStyle(root).getPropertyValue('--chrome').trim() || '#fcfcfb');
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings]);

  if (!settings) return null;
  if (!settings.activeLang) return <Onboarding />;

  const lang = settings.activeLang;
  return (
    <div className="app">
      <header className="topbar" ref={topbar}>
        <NavLink to="/" className="brand">
          LangQuiz
        </NavLink>
        <nav className="nav" aria-label="Main">
          {NAV.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <NavIcon name={icon} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          <SyncIndicator />
          <DailyGoal lang={lang} goal={settings.dailyGoal} />
          <select
            aria-label="Language you are learning"
            value={lang}
            onChange={(e) => {
              if (e.target.value === '__add') {
                location.hash = '#/settings';
                return;
              }
              updateSettings({ activeLang: e.target.value });
            }}
          >
            {settings.languages.map((l) => (
              <option key={l} value={l}>
                {languageName(l)}
              </option>
            ))}
            <option value="__add">+ Add language…</option>
          </select>
        </div>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Library lang={lang} />} />
          <Route path="/import" element={<Import lang={lang} />} />
          <Route path="/lesson/:id" element={<Reader settings={settings} />} />
          <Route path="/vocabulary" element={<Vocabulary settings={settings} />} />
          <Route path="/review" element={<Review settings={settings} />} />
          <Route path="/stats" element={<Stats settings={settings} />} />
          <Route path="/settings" element={<SettingsPage settings={settings} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

