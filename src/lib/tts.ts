/**
 * Text-to-speech on the Web Speech API, hardened against the usual browser quirks:
 * voices that load late, Chrome dropping speech right after cancel(), Chrome
 * cutting off utterances after ~15 s, iOS requiring a tap before the first
 * sound, and voice language tags that don't match our codes (es_ES, nb-NO…).
 */

export function ttsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** Voice tags some platforms use for our language codes. */
const ALIASES: Record<string, string[]> = {
  no: ['no', 'nb', 'nn'],
  he: ['he', 'iw'],
  id: ['id', 'in'],
  zh: ['zh', 'cmn', 'yue'],
  fa: ['fa', 'pes'],
};

/** "es_ES" → "es-es". */
export const normLang = (tag: string) => tag.replace(/_/g, '-').toLowerCase();

type VoiceLike = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'default' | 'localService'>;

export function matchesLang(voiceLang: string, lang: string): boolean {
  const tag = normLang(voiceLang);
  return (ALIASES[lang] ?? [lang]).some((code) => tag === code || tag.startsWith(`${code}-`));
}

/** Best voice for a language: the user's pick, then the platform default, then an on-device voice. */
export function pickVoice<V extends VoiceLike>(voices: V[], lang: string, preferred?: string): V | undefined {
  const forLang = voices.filter((v) => matchesLang(v.lang, lang));
  return (
    forLang.find((v) => v.name === preferred) ??
    forLang.find((v) => v.default) ??
    forLang.find((v) => v.localService) ??
    forLang[0]
  );
}

/**
 * Split text into sentence-sized pieces (≤ max chars), so long passages don't
 * hit Chrome's cut-off and stopping is responsive.
 */
export function chunkText(text: string, max = 180): string[] {
  const sentences = text.match(/[^.!?。！？…]+[.!?。！？…]+["'”»)]*\s*|[^.!?。！？…]+$/g) ?? [text];
  const out: string[] = [];
  for (const raw of sentences) {
    let s = raw.trim();
    while (s.length > max) {
      // Break at the last comma/space before the limit.
      const cut = Math.max(s.lastIndexOf(', ', max), s.lastIndexOf(' ', max));
      const at = cut > max / 3 ? cut + 1 : max;
      out.push(s.slice(0, at).trim());
      s = s.slice(at).trim();
    }
    if (s) out.push(s);
  }
  return out.filter(Boolean);
}

export function voicesFor(lang: string): SpeechSynthesisVoice[] {
  if (!ttsSupported()) return [];
  return speechSynthesis.getVoices().filter((v) => matchesLang(v.lang, lang));
}

/** Voices load asynchronously (empty on first call in Chrome/Safari); wait briefly for them. */
export function loadVoices(timeout = 2000): Promise<SpeechSynthesisVoice[]> {
  if (!ttsSupported()) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      clearInterval(poll);
      clearTimeout(timer);
      speechSynthesis.removeEventListener('voiceschanged', done);
      resolve(speechSynthesis.getVoices());
    };
    // Some browsers never fire voiceschanged, so poll as well.
    const poll = setInterval(() => speechSynthesis.getVoices().length && done(), 100);
    const timer = setTimeout(done, timeout);
    speechSynthesis.addEventListener('voiceschanged', done);
  });
}

export type TtsProblem = 'unsupported' | 'no-voice' | 'failed' | 'blocked';

export interface TtsErrorDetail {
  problem: TtsProblem;
  lang: string;
  message: string;
}

/** Fires `tts-error` events so the UI can explain why nothing was heard. */
export const ttsEvents = new EventTarget();

function report(problem: TtsProblem, lang: string, message: string) {
  ttsEvents.dispatchEvent(new CustomEvent<TtsErrorDetail>('tts-error', { detail: { problem, lang, message } }));
}

let generation = 0;
// Chrome garbage-collects utterances that are still queued unless something references them.
let live: SpeechSynthesisUtterance[] = [];
let keepAlive: ReturnType<typeof setInterval> | undefined;

interface SpeakOptions {
  rate?: number;
  voice?: string;
  onEnd?: () => void;
}

function run(text: string, lang: string, voices: SpeechSynthesisVoice[], opts: SpeakOptions, gen: number) {
  if (gen !== generation) return;
  const voice = pickVoice(voices, lang, opts.voice);
  if (!voice && voices.length) {
    report('no-voice', lang, 'No voice for this language is installed on this device.');
    // Still try: some engines handle the language without listing a voice for it.
  }
  const chunks = chunkText(text);
  live = [];
  let started = false;
  // Some engines accept the request and then say nothing (e.g. no voices installed at all).
  setTimeout(() => {
    if (gen !== generation || started) return;
    if (!voice) report('no-voice', lang, 'No voice for this language is installed on this device.');
    else report('failed', lang, 'Nothing played. Check that your device volume is up and not muted.');
  }, 4000);
  chunks.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk);
    u.onstart = () => (started = true);
    if (voice) u.voice = voice;
    u.lang = voice?.lang.replace(/_/g, '-') ?? lang;
    u.rate = opts.rate ?? 1;
    u.onerror = (e) => {
      if (gen !== generation || e.error === 'interrupted' || e.error === 'canceled') return;
      if (e.error === 'not-allowed') report('blocked', lang, 'The browser blocked speech until you tap something on the page. Tap the speaker button again.');
      else if (e.error === 'language-unavailable' || e.error === 'voice-unavailable' || (!voice && e.error === 'synthesis-failed')) {
        report('no-voice', lang, 'No voice for this language is installed on this device.');
      }
      else report('failed', lang, `Speech failed (${e.error}).`);
    };
    if (i === chunks.length - 1) {
      u.onend = () => {
        if (gen !== generation) return;
        clearInterval(keepAlive);
        opts.onEnd?.();
      };
    }
    live.push(u);
    speechSynthesis.speak(u);
  });
  // Chrome on desktop stops long online-voice speech unless it is nudged now and then.
  clearInterval(keepAlive);
  keepAlive = setInterval(() => {
    if (gen !== generation || !speechSynthesis.speaking) return clearInterval(keepAlive);
    if (!speechSynthesis.paused) {
      speechSynthesis.pause();
      speechSynthesis.resume();
    }
  }, 10_000);
}

export function speak(text: string, lang: string, opts: SpeakOptions = {}) {
  if (!ttsSupported()) {
    report('unsupported', lang, "This browser can't speak text.");
    return;
  }
  if (!text.trim()) return;
  const gen = ++generation;
  const wasBusy = speechSynthesis.speaking || speechSynthesis.pending;
  speechSynthesis.cancel();
  speechSynthesis.resume(); // clears Chrome's occasional stuck "paused" state
  const voices = speechSynthesis.getVoices();
  if (voices.length && !wasBusy) {
    // Speak synchronously so iOS still counts it as part of the tap.
    run(text, lang, voices, opts, gen);
    return;
  }
  // Chrome silently drops an utterance queued right after cancel(); give it a moment.
  const go = (v: SpeechSynthesisVoice[]) => setTimeout(() => run(text, lang, v, opts, gen), wasBusy ? 60 : 0);
  if (voices.length) go(voices);
  else loadVoices().then(go);
}

export function stopSpeaking() {
  generation++;
  clearInterval(keepAlive);
  if (ttsSupported()) speechSynthesis.cancel();
}

let unlocked = false;

/** iOS only allows speech after a user gesture; prime the engine on the first tap anywhere. */
export function unlockSpeechOnFirstTap() {
  if (unlocked || !ttsSupported()) return;
  const unlock = () => {
    unlocked = true;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
    loadVoices();
  };
  document.addEventListener('pointerdown', unlock, { once: true, capture: true });
}

/** A short phrase per language for the "Test voice" button. */
export const SAMPLE_PHRASES: Record<string, string> = {
  ar: 'مرحبا، كيف حالك؟', zh: '你好，你今天怎么样？', cs: 'Ahoj, jak se máš?', da: 'Hej, hvordan har du det?', nl: 'Hallo, hoe gaat het met je?',
  en: 'Hello, how are you today?', fi: 'Hei, mitä kuuluu?', fr: 'Bonjour, comment ça va ?', de: 'Hallo, wie geht es dir?', el: 'Γεια σου, τι κάνεις;',
  he: 'שלום, מה שלומך?', hi: 'नमस्ते, आप कैसे हैं?', hu: 'Szia, hogy vagy?', id: 'Halo, apa kabar?', it: 'Ciao, come stai?', ja: 'こんにちは、お元気ですか？',
  ko: '안녕하세요, 어떻게 지내세요?', la: 'Salve, quid agis?', no: 'Hei, hvordan har du det?', fa: 'سلام، حال شما چطور است؟', pl: 'Cześć, jak się masz?',
  pt: 'Olá, como você está?', ro: 'Bună, ce mai faci?', ru: 'Привет, как дела?', es: 'Hola, ¿qué tal estás hoy?', sv: 'Hej, hur mår du?',
  th: 'สวัสดี สบายดีไหม', tr: 'Merhaba, nasılsın?', uk: 'Привіт, як справи?', vi: 'Xin chào, bạn khỏe không?',
};
