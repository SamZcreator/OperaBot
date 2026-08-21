// The app's own translation layer.
//
// No i18n library, for the same reason there is no image-processing one: the
// job is a lookup, a fallback and a placeholder substitution, and a
// dependency for that costs more in weight and churn than it saves.
//
// English is the source of truth. `en` defines the shape, every other
// dictionary is typed against it, and a translator who forgets a key gets a
// compile error rather than a screen that quietly speaks two languages at
// once. Adding a language is one file plus one entry in LOCALES.
import { en } from "./locales/en";
import { nl } from "./locales/nl";

export const LOCALES = ["nl", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** The English dictionary defines the key set; the rest must match it. */
export type Dictionary = Record<keyof typeof en, string>;
export type MessageKey = keyof typeof en;

/** Each language named in its own language — a picker that says "Dutch" to
 * someone who only reads Dutch has failed at the one job it has. */
export const LOCALE_NAMES: Record<Locale, string> = {
  nl: "Nederlands",
  en: "English",
};

const DICTIONARIES: Record<Locale, Dictionary> = { en, nl };

export const DEFAULT_LOCALE: Locale = "en";
const STORAGE_KEY = "omb-language";

const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/** The language the user picked, or null if they never did. */
export function storedLocale(): Locale | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isLocale(saved) ? saved : null;
  } catch {
    // Private mode, a locked-down webview, a disabled store — none of which
    // is a reason to fail to render. Fall through to detection.
    return null;
  }
}

export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* the choice holds for this session; it just will not survive a restart */
  }
}

/** An explicit choice wins; otherwise follow the system, then English.
 *
 * `navigator.languages` is in preference order and carries region tags, so
 * `nl-BE` has to match `nl` — comparing whole tags would send a Flemish user
 * to English for no reason. */
export function detectLocale(
  languages: readonly string[] = typeof navigator === "undefined"
    ? []
    : (navigator.languages ?? []),
): Locale {
  const stored = storedLocale();
  if (stored) return stored;
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** Fill `{name}` placeholders. A value that is missing leaves the brace text
 * in place rather than printing "undefined": visible in a screenshot,
 * harmless in a sentence, and obvious to whoever has to fix it. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** One message, in one language.
 *
 * A key missing from the chosen dictionary falls back to English rather than
 * to the key itself: one English line in a Dutch panel is mildly untidy,
 * whereas `settings.workingFolder` on screen is a bug report waiting to
 * happen. TypeScript makes this unreachable for our own dictionaries; it is
 * here for the one that gets added in a hurry. */
export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const message = dictionary[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
  return interpolate(message, vars);
}

/** Language tag for `<html lang>` and `Intl`. Screen readers choose their
 * voice from it, and dates and numbers follow the same choice. */
export function bcp47(locale: Locale): string {
  return locale === "nl" ? "nl-NL" : "en-US";
}
