import { describe, expect, it } from 'vitest';
import { chunkText, matchesLang, pickVoice } from '../tts';

const v = (name: string, lang: string, extra: Partial<{ default: boolean; localService: boolean }> = {}) => ({ name, lang, default: false, localService: false, ...extra });

describe('voice matching', () => {
  it('handles underscore tags and regions', () => {
    expect(matchesLang('es_ES', 'es')).toBe(true);
    expect(matchesLang('es-MX', 'es')).toBe(true);
    expect(matchesLang('en-US', 'es')).toBe(false);
  });
  it('knows platform aliases', () => {
    expect(matchesLang('nb-NO', 'no')).toBe(true);
    expect(matchesLang('iw-IL', 'he')).toBe(true);
    expect(matchesLang('in_ID', 'id')).toBe(true);
    expect(matchesLang('cmn-CN', 'zh')).toBe(true);
  });
  it('does not confuse similar codes', () => {
    expect(matchesLang('fil-PH', 'fi')).toBe(false);
  });
});

describe('pickVoice', () => {
  const voices = [v('Google US English', 'en-US', { default: true }), v('Mónica', 'es-ES', { localService: true }), v('Google español', 'es-ES'), v('Paulina', 'es_MX')];
  it("uses the user's choice", () => expect(pickVoice(voices, 'es', 'Paulina')?.name).toBe('Paulina'));
  it('prefers an on-device voice otherwise', () => expect(pickVoice(voices, 'es')?.name).toBe('Mónica'));
  it('falls back when the saved voice is gone', () => expect(pickVoice(voices, 'es', 'Removed voice')?.name).toBe('Mónica'));
  it('returns nothing when no voice speaks the language', () => expect(pickVoice(voices, 'ja')).toBeUndefined());
});

describe('chunkText', () => {
  it('splits into sentences', () => {
    expect(chunkText('Hola. ¿Qué tal? Muy bien.')).toEqual(['Hola.', '¿Qué tal?', 'Muy bien.']);
  });
  it('keeps every chunk under the limit, breaking at spaces', () => {
    const long = 'palabra '.repeat(60).trim();
    const chunks = chunkText(long, 50);
    expect(chunks.every((c) => c.length <= 50)).toBe(true);
    expect(chunks.join(' ')).toBe(long);
  });
  it('handles text without punctuation and CJK punctuation', () => {
    expect(chunkText('sin puntuación')).toEqual(['sin puntuación']);
    expect(chunkText('你好。再见！')).toEqual(['你好。', '再见！']);
  });
});
