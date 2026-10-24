# LangQuiz

A local-first web app for learning languages by reading and listening, built to match the core features of [LingQ](https://www.lingq.com). There's no account and no server: your lessons, vocabulary and stats live in your browser's IndexedDB. Optional Google Drive sync keeps several devices in step.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # static build in dist/
```

The build is a static site. `.github/workflows/deploy.yml` publishes it to GitHub Pages on every push to `master`/`main`. To turn that on, set **Settings → Pages → Source** to **GitHub Actions**. The app also works offline as an installable PWA once it has been loaded.

## Cloud sync with Google Drive

LangQuiz keeps one compressed file, `LangQuiz sync.json.gz`, in your own Google Drive. It uses the `drive.file` permission, so it can only see files it created. The sync is two-way and merges per record:

- Each word, lesson, course and setting keeps its most recent edit, so changes made on different devices combine instead of overwriting each other.
- Deleting something records a marker, so the deletion spreads to your other devices instead of the item coming back.
- Daily stats are kept per device and added together.
- Audio files you upload stay on the device you added them on. Lesson text, YouTube links and audio URLs do sync.
- The active language, theme, font and voice are per device.

Sync runs when you connect, about 15 seconds after an edit, when you come back to the app, and every 5 minutes. Google's sign-in lasts about an hour. After that a **Reconnect** button appears in the top bar; it takes one click.

### One-time setup

Google requires every app that uses Drive to have its own OAuth client ID. Because this app has no server, you create one yourself:

1. In the [Google Cloud console](https://console.cloud.google.com/projectcreate), create a project.
2. Enable the [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com).
3. Set up the [OAuth consent screen](https://console.cloud.google.com/auth/overview) as **External** and add your Google account as a **test user** under *Audience*.
4. Under [Clients](https://console.cloud.google.com/auth/clients), create a **Web application** client. Add every address you open LangQuiz from as an *Authorized JavaScript origin*, for example `https://theworstdrug.github.io` and `http://localhost:5173`.
5. Choose one:
   - Paste the client ID into **Settings → Cloud sync** on each device, or
   - add it once as a repository variable named `GOOGLE_CLIENT_ID` (**Settings → Secrets and variables → Actions → Variables**). The Pages build then includes it, and every device only needs to click **Connect Google Drive**.

The client ID is not a secret: it only identifies the app to Google.

On a new device, choose **"Already use LangQuiz on another device? Sync from Google Drive"** on the welcome screen to pull everything down.

## How it works

1. **Import** something you want to read: pasted text, a web page, an EPUB book, subtitles (SRT/VTT), a text file or a YouTube video. You can attach an audio file or URL.
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
| YouTube lessons | ✅ | Embedded player; paste the transcript from YouTube's "Show transcript" panel (or upload SRT/VTT). The text highlights in sync with the video and you can click a line to jump to it |
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
| Sync across devices | ✅ | Through your Google Drive (one-time client ID setup; see above) |
| Automatic YouTube captions, Netflix | ❌ | YouTube blocks caption downloads from browsers, so the transcript is pasted in one step instead |
| Web page import from any site | ⚠️ | Most sites block reads from the browser; set a CORS proxy in Settings or paste the text |

## Project layout

- `src/lib/`: the logic, written as plain TypeScript. It covers tokenizing and pagination, phrase matching, the Dexie database schema, the SRS scheduler, importers, dictionary lookups, TTS, backups and stats. Unit tests are in `src/lib/__tests__/`.
- `src/lib/sync/`: Drive sync. `snapshot.ts` (snapshot, merge, apply) and `engine.ts` (one sync round) are independent of Google and are tested with simulated devices. `drive.ts` talks to Google, and `index.ts` handles scheduling and status.
- `src/pages/`: Library, Import, Reader, Vocabulary, Review, Stats, Settings and Onboarding.
- `src/components/`: the word panel, the daily-goal widget and the bar chart.
