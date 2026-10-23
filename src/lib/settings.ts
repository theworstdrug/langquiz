import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';

export interface DictionarySource {
  name: string;
  /** URL template; {word}, {from}, {to} are substituted. */
  url: string;
}

export interface Settings {
  activeLang: string;
  nativeLang: string;
  languages: string[];
  dailyGoal: number; // LingQs created per day, LingQ's "daily goal"
  wordsPerPage: number;
  autoKnownOnPageTurn: boolean;
  fontSize: number;
  lineHeight: number;
  theme: 'system' | 'light' | 'dark';
  ttsRate: number;
  ttsVoice: Record<string, string>;
  autoTranslate: boolean;
  autoPronounce: boolean;
  dictionaries: DictionarySource[];
  corsProxy: string;
}

export const DEFAULT_DICTIONARIES: DictionarySource[] = [
  { name: 'Google Translate', url: 'https://translate.google.com/?sl={from}&tl={to}&text={word}&op=translate' },
  { name: 'DeepL', url: 'https://www.deepl.com/translator#{from}/{to}/{word}' },
  { name: 'Wiktionary', url: 'https://en.wiktionary.org/wiki/{word}' },
  { name: 'Reverso Context', url: 'https://context.reverso.net/translation/{fromName}-{toName}/{word}' },
  { name: 'Forvo (pronunciation)', url: 'https://forvo.com/word/{word}/#{from}' },
  { name: 'Images', url: 'https://www.google.com/search?tbm=isch&q={word}' },
];

export const DEFAULT_SETTINGS: Settings = {
  activeLang: '',
  nativeLang: 'en',
  languages: [],
  dailyGoal: 20,
  wordsPerPage: 200,
  autoKnownOnPageTurn: true,
  fontSize: 20,
  lineHeight: 1.8,
  theme: 'system',
  ttsRate: 1,
  ttsVoice: {},
  autoTranslate: true,
  autoPronounce: false,
  dictionaries: DEFAULT_DICTIONARIES,
  corsProxy: '',
};

export async function getSettings(): Promise<Settings> {
  const rows = await db.settings.toArray();
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s as unknown as Settings;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  await db.settings.put({ key, value });
}

export async function updateSettings(patch: Partial<Settings>) {
  await db.settings.bulkPut(Object.entries(patch).map(([key, value]) => ({ key, value })));
}

export function useSettings(): Settings | undefined {
  return useLiveQuery(getSettings, []);
}
