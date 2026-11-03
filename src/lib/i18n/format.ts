import { uiLocaleToIntl, type UiLocale } from "./locale.ts";

/**
 * Formato numérico de presentación con Intl.
 * La moneda real del documento se conserva: solo cambia la
 * agrupación/decimales (es-CL ↔ en-US). Nunca convierte importes
 * ni reinterpreta los datos ingresados.
 */
export function formatCurrencyValue(locale: UiLocale, value: number): string {
  return new Intl.NumberFormat(uiLocaleToIntl(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumberValue(locale: UiLocale, value: number): string {
  return new Intl.NumberFormat(uiLocaleToIntl(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Formatters memoizables para render (misma firma que los antiguos fmt*). */
export function getLocaleFormatters(locale: UiLocale) {
  const currency = new Intl.NumberFormat(uiLocaleToIntl(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const number = new Intl.NumberFormat(uiLocaleToIntl(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return {
    fmtCurrency: { format: (v: number) => currency.format(v) },
    fmtNumber: { format: (v: number) => number.format(v) },
  };
}
