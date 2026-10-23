import { describe, expect, it } from 'vitest';
import { parseSubtitles, splitIntoLessons } from '../importers';
import { parseCsv, toCsv } from '../backup';

describe('parseSubtitles', () => {
  it('parses SRT', () => {
    const srt = `1\n00:00:01,000 --> 00:00:02,500\nHola <i>amigo</i>\n\n2\n00:00:03,000 --> 00:00:04,000\n¿Qué tal?\n`;
    expect(parseSubtitles(srt)).toEqual([
      { start: 1, end: 2.5, text: 'Hola amigo' },
      { start: 3, end: 4, text: '¿Qué tal?' },
    ]);
  });

  it('parses WebVTT with short timestamps and cue settings', () => {
    const vtt = `WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nBonjour\n`;
    expect(parseSubtitles(vtt)).toEqual([{ start: 1, end: 2, text: 'Bonjour' }]);
  });
});

describe('splitIntoLessons', () => {
  it('chunks by paragraphs', () => {
    const text = ['a b c', 'd e f', 'g h i'].join('\n\n');
    expect(splitIntoLessons(text, 6)).toEqual(['a b c\n\nd e f', 'g h i']);
  });
});

describe('csv', () => {
  it('round-trips quotes, commas and newlines', () => {
    const rows = [['term', 'meaning'], ['hola', 'hello, hi'], ['x', 'say "yes"\nok']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
