"use client";

import { useUiLocale } from "@/lib/i18n/UiLocaleContext";
import { UI_LOCALES, type UiLocale } from "@/lib/i18n/locale";

const LABEL_KEY: Record<UiLocale, "spanish" | "english" | "chinese"> = {
  es: "spanish",
  en: "english",
  zh: "chinese",
};

/**
 * Selector global del idioma de interfaz (Español / English / 简体中文).
 * Visible en la cabecera tanto al inicio como durante la revisión.
 * Sin banderas, con estado comunicado (radiogroup + aria-checked),
 * teclado nativo y persistencia en localStorage (packmatch.uiLocale).
 * Las flechas recorren los tres idiomas de forma cíclica.
 * No toca memoLang: ambos idiomas son independientes.
 */
export function UiLocaleSwitcher({ id = "ui-locale" }: { id?: string }) {
  const { locale, setLocale, dict } = useUiLocale();
  const options: UiLocale[] = [...UI_LOCALES];
  const labelFor = (l: UiLocale) => dict.header[LABEL_KEY[l]];

  function stepLocale(from: UiLocale, delta: 1 | -1): UiLocale {
    const idx = options.indexOf(from);
    return options[(idx + delta + options.length) % options.length];
  }

  return (
    <div
      role="radiogroup"
      aria-label={dict.header.languageLabel}
      className="flex items-center rounded-full border border-white/25 overflow-hidden shrink-0"
    >
      {options.map((l) => {
        const active = locale === l;
        return (
          <button
            key={l}
            id={`${id}-${l}`}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={labelFor(l)}
            title={labelFor(l)}
            onClick={() => setLocale(l)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                const next = stepLocale(locale, 1);
                setLocale(next);
                document.getElementById(`${id}-${next}`)?.focus();
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                const next = stepLocale(locale, -1);
                setLocale(next);
                document.getElementById(`${id}-${next}`)?.focus();
              }
            }}
            className={`btn-press px-3 py-1.5 text-xs font-bold cursor-pointer whitespace-nowrap transition-colors ${
              active ? "bg-white text-(--pm-ink)" : "text-white/80 hover:text-white hover:bg-white/10"
            }`}
          >
            {labelFor(l)}
          </button>
        );
      })}
    </div>
  );
}
