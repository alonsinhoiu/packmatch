"use client";

import { useUiLocale } from "@/lib/i18n/UiLocaleContext";
import type { UiLocale } from "@/lib/i18n/locale";

/**
 * Selector global del idioma de interfaz (Español / English).
 * Visible en la cabecera tanto al inicio como durante la revisión.
 * Sin banderas, con estado comunicado (radiogroup + aria-checked),
 * teclado nativo y persistencia en localStorage (packmatch.uiLocale).
 * No toca memoLang: ambos idiomas son independientes.
 */
export function UiLocaleSwitcher({ id = "ui-locale" }: { id?: string }) {
  const { locale, setLocale, dict } = useUiLocale();
  const options: UiLocale[] = ["es", "en"];
  const labelFor = (l: UiLocale) => (l === "es" ? dict.header.spanish : dict.header.english);

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
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next: UiLocale = locale === "es" ? "en" : "es";
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
