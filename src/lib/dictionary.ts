import { languageName } from './languages';
import type { DictionarySource } from './settings';

export interface Definition {
  partOfSpeech: string;
  definitions: string[];
}

const cache = new Map<string, Promise<unknown>>();

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    const p = fn().catch((e) => {
      cache.delete(key);
      throw e;
    });
    cache.set(key, p);
  }
  return cache.get(key) as Promise<T>;
}

/** Machine translation via the free MyMemory API (no key required). */
export function translate(text: string, from: string, to: string): Promise<string[]> {
  return cached(`tr|${from}|${to}|${text}`, async () => {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Translation failed (${res.status})`);
    const data = await res.json();
    const out = new Set<string>();
    const main = data?.responseData?.translatedText;
    if (main && !/MYMEMORY WARNING|INVALID/i.test(main)) out.add(String(main).trim());
    for (const m of data?.matches ?? []) {
      const t = String(m.translation ?? '').trim();
      if (t && t.toLowerCase() !== text.toLowerCase() && m.quality !== '0' && out.size < 5) out.add(t);
    }
    return [...out];
  });
}

function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

/** English-language definitions from Wiktionary for a word in `lang`. */
export function wiktionary(word: string, lang: string): Promise<Definition[]> {
  return cached(`wk|${lang}|${word}`, async () => {
    const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Wiktionary failed (${res.status})`);
    const data = await res.json();
    const entries: { partOfSpeech: string; definitions: { definition: string }[] }[] = data?.[lang] ?? [];
    return entries
      .map((e) => ({
        partOfSpeech: e.partOfSpeech,
        definitions: e.definitions.map((d) => stripHtml(d.definition)).filter(Boolean).slice(0, 4),
      }))
      .filter((e) => e.definitions.length);
  });
}

export function dictionaryUrl(src: DictionarySource, word: string, from: string, to: string) {
  return src.url
    .replace(/\{word\}/g, encodeURIComponent(word))
    .replace(/\{from\}/g, from)
    .replace(/\{to\}/g, to)
    .replace(/\{fromName\}/g, languageName(from).toLowerCase())
    .replace(/\{toName\}/g, languageName(to).toLowerCase());
}
