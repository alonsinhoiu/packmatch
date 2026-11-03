"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  persistUiLocale,
  resolveInitialUiLocale,
  type UiLocale,
} from "./locale.ts";
import { getDictionary, type Dictionary } from "./dictionaries.ts";

interface UiLocaleContextValue {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
  dict: Dictionary;
  ready: boolean;
}

const UiLocaleContext = createContext<UiLocaleContextValue>({
  locale: "es",
  setLocale: () => {},
  dict: getDictionary("es"),
  ready: false,
});

function applyDocumentLocale(locale: UiLocale) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
    document.title = getDictionary(locale).meta.title;
  }
}

/**
 * Proveedor del idioma de interfaz. Persistencia en
 * localStorage (`packmatch.uiLocale`), español por defecto,
 * acceso seguro y sin errores de hidratación: el primer render
 * es siempre "es" y la preferencia guardada se aplica en efecto.
 */
export function UiLocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>("es");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = resolveInitialUiLocale();
    setLocaleState(stored);
    applyDocumentLocale(stored);
    setReady(true);
  }, []);

  const setLocale = useCallback((next: UiLocale) => {
    setLocaleState(next);
    persistUiLocale(next);
    applyDocumentLocale(next);
  }, []);

  const value = useMemo<UiLocaleContextValue>(
    () => ({ locale, setLocale, dict: getDictionary(locale), ready }),
    [locale, setLocale, ready]
  );

  return <UiLocaleContext.Provider value={value}>{children}</UiLocaleContext.Provider>;
}

export function useUiLocale(): UiLocaleContextValue {
  return useContext(UiLocaleContext);
}
