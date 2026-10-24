# LangQuiz

A local-first web app for learning languages by reading and listening, built to match the core features of [LingQ](https://www.lingq.com). There's no account and no server: your lessons, vocabulary and stats live in your browser's IndexedDB. Optional sync, through a cloud-synced folder or Google Drive, keeps several devices in step.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # static build in dist/
```

The build is a static site. `.github/workflows/deploy.yml` publishes it to GitHub Pages on every push to `master`/`main`. To turn that on, set **Settings → Pages → Source** to **GitHub Actions**. The app also works offline as an installable PWA once it has been loaded.

## Cloud sync

Sync keeps several devices in step. There are two methods; choose one in **Settings → Cloud sync** and use the same method on all your devices, because each stores its data in a different place.

| | Sync folder | Google Drive (sign-in) |
| --- | --- | --- |
| How | You pick a folder that Google Drive for desktop, Dropbox, OneDrive, iCloud Drive, Syncthing… already keeps in sync. LangQuiz reads and writes plain JSON files there. | LangQuiz signs in to Google and keeps one file, `LangQuiz sync.json.gz`, in your Drive through the Drive API. |
| Setup | None | A one-time Google OAuth client ID (below) |
| Works on | Chrome or Edge on a computer | Any browser, including phones |
| Re-authorising | Chrome asks once per visit to allow the folder, unless you choose "Allow on every visit" | One click about every hour (Google sign-in expiry) |

Both methods merge per record rather than overwriting:

- Each word, lesson, course and setting keeps its most recent edit.
- A deletion leaves a marker, so the item doesn't come back from another device.
- Daily stats are kept per device and added together.
- Audio files you upload stay on the device you added them on. Lesson text, YouTube links and audio URLs do sync.
- The active language, theme, font and voice are per device.

Sync runs on connect, about 15 seconds after an edit, when you return to the app, and every minute (folder) or every 5 minutes (Drive API).

### Sync folder layout

```
LangQuiz/
  devices/<device-id>/index.json          list of this device's files with content hashes
  devices/<device-id>/meta.json           courses, settings, stats, deletion markers
  devices/<device-id>/terms-<lang>.json   vocabulary, one file per language
  devices/<device-id>/lessons/<id>.json   one file per lesson
```

Each device writes only inside its own folder and reads everyone else's. File-sync apps therefore never see two devices editing the same file, which is what produces "conflict copy" files. A device folder whose files are still downloading (hashes don't match its index yet) is skipped and picked up on the next round. Only files whose content changed are rewritten.

### Google client ID (Drive sign-in method only)

Google requires every app that uses the Drive API to have its own OAuth client ID. Because this app has no server, you create one yourself:

1. In the [Google Cloud console](https://console.cloud.google.com/projectcreate), create a project.
2. Enable the [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com).
3. Set up the [OAuth consent screen](https://console.cloud.google.com/auth/overview) as **External** and add your Google account as a **test user** under *Audience*.
4. Under [Clients](https://console.cloud.google.com/auth/clients), create a **Web application** client. Add every address you open LangQuiz from as an *Authorized JavaScript origin*, for example `https://theworstdrug.github.io` and `http://localhost:5173`.
5. Choose one:
   - Paste the client ID into **Settings → Cloud sync** on each device, or
   - add it once as a repository variable named `GOOGLE_CLIENT_ID` (**Settings → Secrets and variables → Actions → Variables**) so the Pages build includes it.

The client ID is not a secret: it only identifies the app to Google. It uses the `drive.file` permission, so LangQuiz can only see files it created.

On a new device, choose **"Already use LangQuiz on another device? Restore your data"** on the welcome screen.

## Study reminders

Set these up in **Settings → Study reminders**: a time, which days, and whether to skip the reminder once you've met today's goal. The notification says how many LingQs are left, how many reviews are due and your current streak. Tapping it opens Review if anything is due, otherwise the Library. Reminders are per device and fire at most once a day.

A static site has no push server, so how a reminder can reach you depends on the browser:

| Where | How it arrives |
| --- | --- |
| LangQuiz open in any tab (even in the background) | On time; the app checks every minute |
| LangQuiz installed as an app in Chrome or Edge (desktop or Android) | Also while it's closed, through periodic background checks. The browser decides how often, so it may come a little late |
| iPhone and iPad | Only after **Add to Home Screen**, and only while the app is open; iOS doesn't allow background checks |
| Anywhere | **Add reminder to my calendar** downloads a repeating `.ics` event with an alert. This is the option that always fires |

## Themes and layouts

- **Themes:** System, Light, Dark and **OLED black**. OLED uses true black so the pixels switch off on OLED screens. The browser's address bar and status bar color follows the theme.
- **Phones (under 600 px):** a bottom tab bar, the word panel as a bottom sheet, sticky page controls, larger tap targets, and slightly smaller reading text.
- **Tablets:** the word panel is a bottom sheet when held upright and a side panel in landscape, with slightly larger reading text.
- **Desktops:** the reading column is limited to a comfortable line length with the word panel beside it. Wide screens (1440 px and up) get a wider column and larger text.
- **Touch screens:** controls that only appear on hover with a mouse are always visible, and safe areas (notches, home indicator) are respected.

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
| Dark mode, font size, line height, mobile layout | ✅ | Plus OLED black; separate phone, tablet and desktop layouts |
| Offline / installable | ✅ | Service worker + manifest |
| Backup and restore | ✅ | JSON (audio files are not included) |
| Shared community library, community hints, tutors, forum | ❌ | These need a server and other users |
| Sync across devices | ✅ | Through a synced folder (no setup) or Google Drive sign-in (works on phones) |
| Automatic YouTube captions, Netflix | ❌ | YouTube blocks caption downloads from browsers, so the transcript is pasted in one step instead |
| Web page import from any site | ⚠️ | Most sites block reads from the browser; set a CORS proxy in Settings or paste the text |

## Project layout

- `src/lib/`: the logic, written as plain TypeScript. It covers tokenizing and pagination, phrase matching, the Dexie database schema, the SRS scheduler, importers, dictionary lookups, TTS, backups and stats. Unit tests are in `src/lib/__tests__/`.
- `src/lib/sync/`: sync. `snapshot.ts` handles snapshots, merging and applying. `engine.ts` runs one round with the Drive API, and `folder.ts` handles the sync-folder layout and the browser's file-access interface. These are tested with simulated devices. `drive.ts` talks to Google, and `index.ts` handles method choice, scheduling and status.
- `src/pages/`: Library, Import, Reader, Vocabulary, Review, Stats, Settings and Onboarding.
- `src/components/`: the word panel, the daily-goal widget, the bar chart, and the sync and reminder settings.
- `src/sw.ts`: the service worker, which handles offline caching and reminder checks. `src/reminders-core.ts` holds the reminder logic and is unit-tested. The worker is built separately (`vite.sw.config.ts`) as one self-contained script.
