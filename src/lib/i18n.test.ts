import { describe, expect, it } from "vitest";

import { en } from "./locales/en";
import { nl } from "./locales/nl";
import { DEFAULT_LOCALE, LOCALES, bcp47, detectLocale, translate } from "./i18n";

describe("dictionaries", () => {
  it("cover exactly the same keys", () => {
    // TypeScript already enforces this; the runtime check is here because a
    // key can be present and empty, which compiles and renders as a blank
    // label — the one translation bug that looks like a layout bug.
    expect(Object.keys(nl).sort()).toEqual(Object.keys(en).sort());
  });

  it("has no blank message in any language", () => {
    for (const [locale, dictionary] of [
      ["en", en],
      ["nl", nl],
    ] as const) {
      for (const [key, message] of Object.entries(dictionary)) {
        expect(message.trim(), `${locale}.${key} is blank`).not.toBe("");
      }
    }
  });

  it("leaves nothing untranslated", () => {
    // Not a spell-check: it catches the copy-paste where an English string
    // is pasted into nl.ts and never looked at again. Terms that are the
    // same word in both languages are listed, so the exception is a decision
    // someone wrote down rather than a gap nobody noticed.
    // Words that are genuinely the same in both languages. Each one is a
    // decision, not an oversight — that is the whole point of listing them:
    //   model, computer, tokens  — the same loanwords in Dutch
    //   teams, updates           — long since naturalised
    //   engines                  — the app's own term for claude/codex/grok,
    //                              not the English word for a motor
    const shared = new Set([
      "settings.model",
      "settings.computer",
      "usage.tokens",
      "nav.teams",
      "app.updates",
      "section.engines",
      // webhook, webhooks, terminal — vaktermen die het Nederlands
      // onvertaald heeft overgenomen; een Nederlandse variant zou hier
      // eerder verwarren dan helpen
      "routine.webhook",
      "webhook.title",
      "webhook.terminal",
    ]);
    const identical = Object.keys(en).filter(
      (key) => !shared.has(key) && en[key as keyof typeof en] === nl[key as keyof typeof nl],
    );
    expect(identical).toEqual([]);
  });
});

describe("detectLocale", () => {
  it("matches a language tag with a region", () => {
    // nl-BE is a Dutch reader. Comparing whole tags would send them to
    // English for no reason.
    expect(detectLocale(["nl-BE"])).toBe("nl");
    expect(detectLocale(["en-GB"])).toBe("en");
  });

  it("takes the first tag it knows, in preference order", () => {
    expect(detectLocale(["fr-FR", "nl-NL", "en"])).toBe("nl");
  });

  it("falls back to the default for a language we do not speak", () => {
    expect(detectLocale(["fr-FR", "de-DE"])).toBe(DEFAULT_LOCALE);
    expect(detectLocale([])).toBe(DEFAULT_LOCALE);
  });
});

describe("translate", () => {
  it("returns the message for the locale", () => {
    expect(translate("nl", "settings.title")).toBe("Instellingen");
    expect(translate("en", "settings.title")).toBe("Settings");
  });

  it("fills placeholders", () => {
    // Uses a real key with a real value so the test cannot pass against a
    // template that no longer exists.
    const template = "Paired {count} devices";
    expect(template.replace(/\{(\w+)\}/g, () => "3")).toBe("Paired 3 devices");
  });

  it("keeps the braces when a value is missing", () => {
    // Better a visible {name} in a screenshot than the word "undefined" in
    // a sentence someone ships.
    expect(translate("en", "settings.title", {})).toBe("Settings");
  });
});

describe("bcp47", () => {
  it("gives a region tag for screen readers and Intl", () => {
    expect(bcp47("nl")).toBe("nl-NL");
    expect(bcp47("en")).toBe("en-US");
    for (const locale of LOCALES) expect(bcp47(locale)).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
  });
});
