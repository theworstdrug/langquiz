import { describe, expect, it } from 'vitest';
import { findPhrases, paginate, phraseKey, sentenceAround, tokenize, uniqueWords } from '../tokenize';

describe('tokenize', () => {
  it('separates words from punctuation and normalizes case', () => {
    const toks = tokenize('¡Hola, Mundo!', 'es');
    const words = toks.filter((t) => t.isWord);
    expect(words.map((t) => t.norm)).toEqual(['hola', 'mundo']);
    expect(toks.map((t) => t.text).join('')).toBe('¡Hola, Mundo!');
  });

  it('does not treat numbers as vocabulary', () => {
    expect(tokenize('Tengo 25 años', 'es').filter((t) => t.isWord).map((t) => t.norm)).toEqual(['tengo', 'años']);
  });

  it('segments languages without spaces', () => {
    const words = tokenize('我喜欢学习中文', 'zh').filter((t) => t.isWord);
    expect(words.length).toBeGreaterThan(1);
  });

  it('counts unique words', () => {
    expect(uniqueWords('El perro y el gato.', 'es')).toEqual({ unique: ['el', 'perro', 'y', 'gato'], count: 5 });
  });
});

describe('paginate', () => {
  it('splits at paragraph boundaries', () => {
    const text = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} has some words in it here.`).join('\n\n');
    const pages = paginate(text, 'en', 20);
    expect(pages.length).toBe(3);
    expect(pages.every((p) => p.length === 2)).toBe(true);
  });

  it('splits oversized paragraphs at sentences', () => {
    const text = Array.from({ length: 10 }, () => 'One two three four five.').join(' ');
    const pages = paginate(text, 'en', 12);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      const n = page.reduce((a, p) => a + p.tokens.filter((t) => t.isWord).length, 0);
      expect(n).toBeLessThanOrEqual(12);
    }
  });

  it('keeps subtitle timings', () => {
    const pages = paginate('', 'en', 100, [
      { start: 0, end: 1, text: 'Hello there' },
      { start: 1, end: 2, text: 'General Kenobi' },
    ]);
    expect(pages[0].map((p) => p.start)).toEqual([0, 1]);
  });
});

describe('phrases', () => {
  const toks = tokenize('Por lo tanto, llego tarde. Por lo menos hoy.', 'es');

  it('builds a phrase key from a token range', () => {
    expect(phraseKey(toks.slice(0, 5), 'es')).toBe('por lo tanto');
  });

  it('finds saved phrases ignoring punctuation and case', () => {
    const m = findPhrases(toks, ['por lo tanto', 'lo menos'], 'es');
    expect(m.map((x) => x.key)).toEqual(['por lo tanto', 'lo menos']);
  });

  it('does not match across sentence boundaries', () => {
    expect(findPhrases(toks, ['tarde por'], 'es')).toEqual([]);
  });

  it('extracts the surrounding sentence', () => {
    const i = toks.findIndex((t) => t.norm === 'llego');
    expect(sentenceAround(toks, i)).toBe('Por lo tanto, llego tarde.');
  });
});
