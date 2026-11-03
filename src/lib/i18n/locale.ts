export type UiLocale = "es" | "en" | "zh";

export const UI_LOCALE_STORAGE_KEY = "packmatch.uiLocale";

export const UI_LOCALES: UiLocale[] = ["es", "en", "zh"];

export function isUiLocale(value: unknown): value is UiLocale {
  return value === "es" || value === "en" || value === "zh";
}

function readStorage(): string | null {
  try {
    if (typeof window === "undefined" || !("localStorage" in window)) return null;
    return window.localStorage.getItem(UI_LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getStoredUiLocale(): UiLocale | null {
  const raw = readStorage();
  return isUiLocale(raw) ? raw : null;
}

/** Español por defecto cuando no exista una preferencia válida. Nunca lanza. */
export function resolveInitialUiLocale(): UiLocale {
  return getStoredUiLocale() ?? "es";
}

export function persistUiLocale(locale: UiLocale): void {
  try {
    if (typeof window === "undefined" || !("localStorage" in window)) return;
    window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    // localStorage bloqueado (modo privado, cookies desactivadas): se ignora
    // y la preferencia solo vive en memoria durante la sesión.
  }
}

export function uiLocaleToIntl(locale: UiLocale): string {
  if (locale === "en") return "en-US";
  if (locale === "zh") return "zh-CN";
  return "es-CL";
}
