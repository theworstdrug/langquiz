export function ttsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function voicesFor(lang: string): SpeechSynthesisVoice[] {
  if (!ttsSupported()) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
}

export function speak(
  text: string,
  lang: string,
  opts: { rate?: number; voice?: string; onEnd?: () => void } = {},
) {
  if (!ttsSupported()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = opts.rate ?? 1;
  const voice = voicesFor(lang).find((v) => v.name === opts.voice) ?? voicesFor(lang)[0];
  if (voice) u.voice = voice;
  if (opts.onEnd) u.onend = opts.onEnd;
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (ttsSupported()) speechSynthesis.cancel();
}
