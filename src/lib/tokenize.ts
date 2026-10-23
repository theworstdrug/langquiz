import { getLanguage } from './languages';

export interface Token {
  text: string;
  /** True for word-like tokens that can be looked up / marked. */
  isWord: boolean;
  /** Normalized form used as the vocabulary key (only for words). */
  norm: string;
}

export interface Paragraph {
  tokens: Token[];
  /** Optional media timing (subtitle cues). */
  start?: number;
  end?: number;
}

const segmenters = new Map<string, Intl.Segmenter>();

function wordSegmenter(lang: string): Intl.Segmenter {
  let s = segmenters.get(lang);
  if (!s) {
    s = new Intl.Segmenter(lang, { granularity: 'word' });
    segmenters.set(lang, s);
  }
  return s;
}

// Letters or numbers anywhere means "word-like". Pure numbers are not vocabulary.
const HAS_LETTER = /\p{L}/u;

export function normalize(word: string, lang: string): string {
  return word
    .normalize('NFC')
    .replace(/[’ʼ]/g, "'")
    .toLocaleLowerCase(lang)
    .trim();
}

export function tokenize(text: string, lang: string): Token[] {
  const out: Token[] = [];
  for (const seg of wordSegmenter(lang).segment(text)) {
    const isWord = !!seg.isWordLike && HAS_LETTER.test(seg.segment);
    out.push({ text: seg.segment, isWord, norm: isWord ? normalize(seg.segment, lang) : '' });
  }
  return out;
}

export function uniqueWords(text: string, lang: string): { unique: string[]; count: number } {
  const set = new Set<string>();
  let count = 0;
  for (const t of tokenize(text, lang)) {
    if (t.isWord) {
      set.add(t.norm);
      count++;
    }
  }
  return { unique: [...set], count };
}

export function splitSentences(text: string, lang: string): string[] {
  const seg = new Intl.Segmenter(lang, { granularity: 'sentence' });
  return [...seg.segment(text)].map((s) => s.segment).filter((s) => s.trim().length > 0);
}

export interface TimedSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Split a lesson into pages of roughly `wordsPerPage` words, breaking at
 * paragraph boundaries (and at sentence boundaries for oversized paragraphs).
 */
export function paginate(
  text: string,
  lang: string,
  wordsPerPage: number,
  segments?: TimedSegment[],
): Paragraph[][] {
  const paragraphs: Paragraph[] = [];
  if (segments && segments.length) {
    for (const s of segments) paragraphs.push({ tokens: tokenize(s.text, lang), start: s.start, end: s.end });
  } else {
    for (const raw of text.split(/\n\s*\n|\r?\n/)) {
      if (!raw.trim()) continue;
      const tokens = tokenize(raw.trim(), lang);
      const words = tokens.filter((t) => t.isWord).length;
      if (words <= wordsPerPage) {
        paragraphs.push({ tokens });
      } else {
        // Break huge paragraphs at sentence boundaries.
        let buf = '';
        let bufWords = 0;
        for (const sentence of splitSentences(raw.trim(), lang)) {
          const n = tokenize(sentence, lang).filter((t) => t.isWord).length;
          if (bufWords + n > wordsPerPage && buf) {
            paragraphs.push({ tokens: tokenize(buf.trim(), lang) });
            buf = '';
            bufWords = 0;
          }
          buf += sentence;
          bufWords += n;
        }
        if (buf.trim()) paragraphs.push({ tokens: tokenize(buf.trim(), lang) });
      }
    }
  }

  const pages: Paragraph[][] = [];
  let page: Paragraph[] = [];
  let pageWords = 0;
  for (const p of paragraphs) {
    const n = p.tokens.filter((t) => t.isWord).length;
    if (pageWords + n > wordsPerPage && page.length) {
      pages.push(page);
      page = [];
      pageWords = 0;
    }
    page.push(p);
    pageWords += n;
  }
  if (page.length) pages.push(page);
  return pages.length ? pages : [[]];
}

/** Join tokens back into a phrase key, collapsing whitespace. */
export function phraseKey(tokens: Token[], lang: string): string {
  const joiner = getLanguage(lang).noSpaces ? '' : ' ';
  return tokens
    .filter((t) => t.isWord)
    .map((t) => t.norm)
    .join(joiner);
}

export interface PhraseMatch {
  start: number; // token index of first word
  end: number; // token index of last word (inclusive)
  key: string;
}

/**
 * Find occurrences of saved phrases inside a token list. Phrases are matched
 * on their word sequence, ignoring the punctuation/whitespace between words.
 */
export function findPhrases(tokens: Token[], phrases: string[], lang: string): PhraseMatch[] {
  if (!phrases.length) return [];
  const noSpaces = !!getLanguage(lang).noSpaces;
  const byFirst = new Map<string, string[][]>();
  for (const p of phrases) {
    const words = noSpaces
      ? tokenize(p, lang).filter((t) => t.isWord).map((t) => t.norm)
      : p.split(' ');
    if (words.length < 2) continue;
    const list = byFirst.get(words[0]) ?? [];
    list.push(words);
    byFirst.set(words[0], list);
  }
  const wordIdx: number[] = [];
  tokens.forEach((t, i) => t.isWord && wordIdx.push(i));
  const matches: PhraseMatch[] = [];
  for (let w = 0; w < wordIdx.length; w++) {
    const cands = byFirst.get(tokens[wordIdx[w]].norm);
    if (!cands) continue;
    for (const words of cands) {
      if (w + words.length > wordIdx.length) continue;
      let ok = true;
      for (let k = 1; k < words.length; k++) {
        const ti = wordIdx[w + k];
        // A phrase may not cross a sentence boundary / line break.
        const between = tokens.slice(wordIdx[w + k - 1] + 1, ti).map((t) => t.text).join('');
        if (tokens[ti].norm !== words[k] || /[.!?。！？\n]/.test(between)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matches.push({ start: wordIdx[w], end: wordIdx[w + words.length - 1], key: words.join(noSpaces ? '' : ' ') });
      }
    }
  }
  return matches;
}

/** Return the sentence surrounding a token index in a paragraph. */
export function sentenceAround(tokens: Token[], index: number): string {
  let s = index;
  while (s > 0 && !/[.!?。！？]/.test(tokens[s - 1].text)) s--;
  let e = index;
  while (e < tokens.length - 1 && !/[.!?。！？]/.test(tokens[e].text)) e++;
  return tokens
    .slice(s, e + 1)
    .map((t) => t.text)
    .join('')
    .trim();
}
