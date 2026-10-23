# LangQuiz

A local-first web app for learning languages by reading and listening, built to match the core features of [LingQ](https://www.lingq.com). There's no account and no server: your lessons, vocabulary and stats live in your browser's IndexedDB.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # static build in dist/
```

The build is a static site. `.github/workflows/deploy.yml` publishes it to GitHub Pages on every push to `master`/`main`. To turn that on, set **Settings → Pages → Source** to **GitHub Actions**. The app also works offline as an installable PWA once it has been loaded.

## How it works

1. **Import** something you want to read: pasted text, a web page, an EPUB book, subtitles (SRT/VTT) or a text file. You can attach an audio file or URL.
2. **Read.** Words you haven't seen are **blue**. Click one to see suggested meanings, then pick one (or type your own) to create a **LingQ** (yellow). Drag across words, or shift-click, to save a **phrase**.
3. **Turn the page.** Every blue word you didn't LingQ becomes **known**. This is how LingQ counts your known words.
4. **Review** LingQs with spaced repetition. A correct answer moves a LingQ up from status 1 to 4; a miss sends it back to 1.
5. **Track** known words, your daily LingQ goal, streaks, words read and listening time.

### Reader keyboard shortcuts

| Key | Action |
| --- | --- |
| `←` / `→` | Previous / next blue or yellow word |
| `Shift+←` / `Shift+→` | Previous / next page |
| `1`–`4` | Set LingQ status |
| `K` | Mark known |
| `X` | Ignore (names, numbers…) |
| `P` | Pronounce the selection |
| `Space` | Play/pause audio |
| `Esc` | Close the word panel |

## LingQ feature parity

| LingQ feature | Status | Notes |
| --- | --- | --- |
| Blue/yellow/known word highlighting | ✅ | Statuses 1–4, known, ignored |
| Click word → hints, add meaning, create LingQ | ✅ | Suggested meanings come from MyMemory translation and Wiktionary |
| Phrase LingQs | ✅ | Drag/shift-click or "add next word"; phrases are underlined wherever they appear |
| Mark remaining words known on page turn | ✅ | Can be turned off in Settings |
| Notes, tags, example sentence per LingQ | ✅ | |
| External dictionaries | ✅ | Google Translate, DeepL, Wiktionary, Reverso, Forvo, images; add your own |
| Lesson library, courses, % new words per lesson | ✅ | Search, sort by fewest new words, "continue studying" |
| Import text / web page / ebook / subtitles | ✅ | EPUB → course with one lesson per chapter; split long texts into lessons |
| Audio with lessons, speed control | ✅ | Upload a file or link to one |
| Subtitle-synced audio (highlight + click to seek) | ✅ | From SRT/VTT imports |
| Text-to-speech | ✅ | Words, sentences, read a whole page aloud; voice and speed per language |
| Sentence mode | ✅ | One sentence at a time with translate and TTS |
| Sentence/paragraph translation | ✅ | |
| Lesson completion summary, next lesson in course | ✅ | |
| Vocabulary list: filter, sort, bulk edit, delete | ✅ | |
| Export vocabulary (CSV, Anki) / import CSV | ✅ | |
| SRS review: flashcards, reverse, multiple choice, cloze, dictation, listening | ✅ | Mixed mode; review due, recent, per-lesson or selected terms |
| Daily goal, streak, known-word count, activity stats | ✅ | 30-day charts |
| Multiple languages, RTL scripts, Chinese/Japanese/Thai segmentation | ✅ | Uses `Intl.Segmenter` |
| Dark mode, font size, line height, mobile layout | ✅ | |
| Offline / installable | ✅ | Service worker + manifest |
| Backup and restore | ✅ | JSON (audio files are not included) |
| Shared community library, community hints, tutors, forum | ❌ | These need a server and other users |
| Sync across devices | ❌ | Move data between devices with backup/restore |
| YouTube / Netflix / podcast import | ❌ | Needs a server-side fetcher; use subtitle files plus an audio URL instead |
| Web page import from any site | ⚠️ | Most sites block reads from the browser; set a CORS proxy in Settings or paste the text |

## Project layout

- `src/lib/`: the logic, written as plain TypeScript. It covers tokenizing and pagination, phrase matching, the Dexie database schema, the SRS scheduler, importers, dictionary lookups, TTS, backups and stats. Unit tests are in `src/lib/__tests__/`.
- `src/pages/`: Library, Import, Reader, Vocabulary, Review, Stats, Settings and Onboarding.
- `src/components/`: the word panel, the daily-goal widget and the bar chart.
