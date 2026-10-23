export interface Language {
  code: string;
  name: string;
  /** Script has no spaces between words (word segmentation is dictionary-based). */
  noSpaces?: boolean;
  rtl?: boolean;
}

export const LANGUAGES: Language[] = [
  { code: 'ar', name: 'Arabic', rtl: true },
  { code: 'zh', name: 'Chinese', noSpaces: true },
  { code: 'cs', name: 'Czech' },
  { code: 'da', name: 'Danish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'en', name: 'English' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew', rtl: true },
  { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese', noSpaces: true },
  { code: 'ko', name: 'Korean' },
  { code: 'la', name: 'Latin' },
  { code: 'no', name: 'Norwegian' },
  { code: 'fa', name: 'Persian', rtl: true },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'es', name: 'Spanish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'th', name: 'Thai', noSpaces: true },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'vi', name: 'Vietnamese' },
];

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

export function getLanguage(code: string): Language {
  return LANGUAGES.find((l) => l.code === code) ?? { code, name: code };
}
