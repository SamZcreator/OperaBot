// Language, as React sees it.
//
// Deliberately the same shape as DesktopCapabilities: one context, one
// provider near the root, one hook. Nothing here knows what the messages
// say — that is `src/lib/i18n.ts` and the dictionaries beside it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  bcp47,
  detectLocale,
  saveLocale,
  translate,
  type Locale,
  type MessageKey,
} from "@/lib/i18n";

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

type LanguageState = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
};

const initial = detectLocale();

const LanguageContext = createContext<LanguageState>({
  locale: initial,
  setLocale: () => {},
  t: (key, vars) => translate(initial, key, vars),
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());

  // `<html lang>` is not decoration: it picks the screen reader's voice and
  // the hyphenation dictionary, and it is wrong until we set it.
  useEffect(() => {
    document.documentElement.lang = bcp47(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    saveLocale(next);
    setLocaleState(next);
  }, []);

  // `t` is depended on by every component that renders text, so it has to be
  // stable per locale — a new identity each render would defeat every memo
  // downstream of it.
  const value = useMemo<LanguageState>(
    () => ({ locale, setLocale, t: (key, vars) => translate(locale, key, vars) }),
    [locale, setLocale],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** Everything a component needs to render text in the chosen language. */
export function useLanguage(): LanguageState {
  return useContext(LanguageContext);
}

/** The common case: just the translate function. */
export function useT(): Translate {
  return useContext(LanguageContext).t;
}
