// The language picker.
//
// Each language is written in its own language — a menu that offers "Dutch"
// to someone who only reads Dutch has failed at the one job it has — and the
// change lands immediately, because a setting that needs a restart to be
// believed is a setting people stop trusting.
import { Card } from "./SettingsPrimitives";
import { useLanguage } from "./Language";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n";

export function LanguageCard() {
  const { locale, setLocale, t } = useLanguage();

  return (
    <Card title={t("settings.language")} subtitle={t("settings.languageHint")}>
      <div className="flex flex-wrap gap-2">
        {LOCALES.map((option: Locale) => {
          const active = option === locale;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setLocale(option)}
              aria-pressed={active}
              lang={option}
              className={[
                "rounded-lg border px-3 py-2 text-[14px] transition-colors",
                active
                  ? "border-hairline bg-inset text-ink"
                  : "border-hairline/40 text-ink-secondary hover:border-hairline hover:text-ink",
              ].join(" ")}
            >
              {LOCALE_NAMES[option]}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
