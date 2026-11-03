import { es, type Dictionary } from "./dictionaries-es.ts";
import { en } from "./dictionaries-en.ts";
import { zh } from "./dictionaries-zh.ts";
import type { UiLocale } from "./locale.ts";

export type { Dictionary };
export { es, en, zh };

const MAP: Record<UiLocale, Dictionary> = { es, en, zh };

export function getDictionary(locale: UiLocale): Dictionary {
  return MAP[locale] ?? es;
}

/** Interpolación simple `{var}` para plantillas del diccionario. */
export function formatTemplate(
  template: string,
  vars: Record<string, string | number> = {}
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match
  );
}

export function t(
  locale: UiLocale,
  pick: (d: Dictionary) => string,
  vars?: Record<string, string | number>
): string {
  return formatTemplate(pick(getDictionary(locale)), vars);
}
