import { describe, expect, it } from 'vitest';
import { mergeCues, parseYouTubeId, parseYouTubeTranscript } from '../youtube';

describe('parseYouTubeId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('%s', (url, id) => expect(parseYouTubeId(url)).toBe(id));

  it('rejects non-YouTube links', () => {
    expect(parseYouTubeId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('https://cdn.example.com/episode.mp3')).toBeNull();
  });
});

describe('parseYouTubeTranscript', () => {
  it('parses the current panel format with screen-reader duration lines', () => {
    const src = '0:00\n2 seconds\nHola a todos,\n0:04\n4 seconds\nbienvenidos al canal.\n1:02:03\n1 hour, 2 minutes, 3 seconds\nAdiós.';
    expect(parseYouTubeTranscript(src)).toEqual([
      { start: 0, end: 4, text: 'Hola a todos,' },
      { start: 4, end: 3723, text: 'bienvenidos al canal.' },
      { start: 3723, end: 3728, text: 'Adiós.' },
    ]);
  });

  it('parses inline timestamps and multi-line cues', () => {
    expect(parseYouTubeTranscript('0:01 Bonjour\ntout le monde\n0:05 Ça va ?')).toEqual([
      { start: 1, end: 5, text: 'Bonjour tout le monde' },
      { start: 5, end: 10, text: 'Ça va ?' },
    ]);
  });

  it('returns nothing for plain text', () => {
    expect(parseYouTubeTranscript('Just some text\nwithout times')).toEqual([]);
  });
});

describe('mergeCues', () => {
  it('joins fragments until a sentence ends', () => {
    const merged = mergeCues([
      { start: 0, end: 2, text: 'hola a todos' },
      { start: 2, end: 4, text: 'y bienvenidos.' },
      { start: 4, end: 6, text: 'Hoy hablamos' },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 4, text: 'hola a todos y bienvenidos.' },
      { start: 4, end: 6, text: 'Hoy hablamos' },
    ]);
  });
});
