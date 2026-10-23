import Dexie, { type Table } from 'dexie';
import type { TimedSegment } from './tokenize';

/**
 * Term status, mirroring LingQ:
 *  1–4 = LingQ (new → learned), 5 = known, 0 = ignored.
 * Words with no Term record are "new" (blue).
 */
export type Status = 0 | 1 | 2 | 3 | 4 | 5;
export const IGNORED: Status = 0;
export const KNOWN: Status = 5;

export const STATUS_LABELS: Record<Status, string> = {
  0: 'Ignored',
  1: 'New',
  2: 'Recognized',
  3: 'Familiar',
  4: 'Learned',
  5: 'Known',
};

export interface Term {
  id?: number;
  lang: string;
  term: string; // normalized key
  status: Status;
  isPhrase: boolean;
  meanings: string[];
  notes: string;
  tags: string[];
  /** Example sentence the term was saved from. */
  fragment: string;
  lessonId?: number;
  createdAt: number;
  updatedAt: number;
  // Spaced repetition
  due: number;
  interval: number; // days
  reps: number;
  lapses: number;
}

export interface Course {
  id?: number;
  lang: string;
  title: string;
  description: string;
  createdAt: number;
}

export interface Lesson {
  id?: number;
  lang: string;
  courseId?: number;
  title: string;
  text: string;
  segments?: TimedSegment[];
  audio?: Blob;
  audioName?: string;
  mediaUrl?: string;
  sourceUrl?: string;
  tags: string[];
  uniqueWords: string[];
  wordCount: number;
  createdAt: number;
  lastOpenedAt?: number;
  page: number;
  completed: boolean;
  timesCompleted: number;
  order: number;
}

export interface Activity {
  id?: number;
  lang: string;
  date: string; // YYYY-MM-DD (local)
  wordsRead: number;
  lingqsCreated: number;
  knownAdded: number;
  listeningSeconds: number;
  reviews: number;
  lessonsCompleted: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

export class LangDB extends Dexie {
  terms!: Table<Term, number>;
  courses!: Table<Course, number>;
  lessons!: Table<Lesson, number>;
  activity!: Table<Activity, number>;
  settings!: Table<Setting, string>;

  constructor(name = 'langquiz') {
    super(name);
    this.version(1).stores({
      terms: '++id, &[lang+term], lang, status, isPhrase, due, createdAt, updatedAt',
      courses: '++id, lang, createdAt',
      lessons: '++id, lang, courseId, createdAt, lastOpenedAt',
      activity: '++id, &[lang+date], lang, date',
      settings: 'key',
    });
  }
}

export const db = new LangDB();
