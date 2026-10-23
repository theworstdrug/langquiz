import { useEffect } from 'react';
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

export default function App() {
  const settings = useSettings();

  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  if (!settings) return null;
  if (!settings.activeLang) return <Onboarding />;

  const lang = settings.activeLang;
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          LangQuiz
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>
            Library
          </NavLink>
          <NavLink to="/import">Import</NavLink>
          <NavLink to="/vocabulary">Vocabulary</NavLink>
          <NavLink to="/review">Review</NavLink>
          <NavLink to="/stats">Stats</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="topbar-right">
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

