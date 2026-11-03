"use client";

import { Copy, Download } from "lucide-react";
import { useUiLocale } from "@/lib/i18n/UiLocaleContext";

type PackMatchMemoProps = {
  supplierMemo: string;
  canExport: boolean;
  memoLang: "es" | "en";
  onLangChange: (lang: "es" | "en") => void;
  copiedMemo: boolean;
  onCopy: () => void;
  onDownload: () => void;
  compact?: boolean;
};

/**
 * Panel lateral "Mensaje al proveedor" (minuta + CSV).
 * Presentacional: recibe texto ya generado y callbacks de copia/descarga/idioma.
 * Las etiquetas de interfaz usan uiLocale; el contenido de la minuta usa
 * memoLang y se marca con su atributo lang correspondiente.
 */
export function PackMatchMemo({
  supplierMemo,
  canExport,
  memoLang,
  onLangChange,
  copiedMemo,
  onCopy,
  onDownload,
  compact = false,
}: PackMatchMemoProps) {
  const { dict } = useUiLocale();
  const t = dict.memoPanel;
  return (
    <aside aria-label={t.asideLabel} className="bg-white rounded-2xl border border-(--pm-border) p-5 flex flex-col gap-4">
      <h3 className="text-lg font-bold text-(--pm-ink)">{t.title}</h3>
      <div role="group" aria-label={t.langGroup} className="flex rounded-full border border-(--pm-border) overflow-hidden w-fit">
        <button type="button" aria-pressed={memoLang === "es"} onClick={() => onLangChange("es")} className={`btn-press px-4 py-2 text-sm font-bold cursor-pointer ${memoLang === "es" ? "bg-(--pm-ink) text-white" : "bg-white text-(--pm-text-secondary)"}`}>{t.spanish}</button>
        <button type="button" aria-pressed={memoLang === "en"} onClick={() => onLangChange("en")} className={`btn-press px-4 py-2 text-sm font-bold cursor-pointer ${memoLang === "en" ? "bg-(--pm-ink) text-white" : "bg-white text-(--pm-text-secondary)"}`}>{t.english}</button>
      </div>
      {canExport ? (
        <pre lang={memoLang} className={`whitespace-pre-wrap break-words rounded-xl border border-dashed border-(--pm-dark-secondary) bg-(--pm-paper) p-4 text-(--pm-ink) leading-relaxed overflow-auto ${compact ? "text-[11px] max-h-[420px]" : "text-xs max-h-[520px]"}`}>{supplierMemo}</pre>
      ) : (
        <div className="rounded-xl border border-dashed border-(--pm-border) bg-(--pm-paper) px-4 py-10 text-center text-sm text-(--pm-text-secondary)">{t.empty}</div>
      )}
      <button type="button" onClick={onCopy} disabled={!canExport} className="btn-press inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold disabled:bg-(--pm-selection) disabled:text-(--pm-text-secondary) cursor-pointer disabled:cursor-not-allowed"><Copy className="w-4 h-4" aria-hidden="true" /> {copiedMemo ? t.copied : t.copy}</button>
      <button type="button" onClick={onDownload} disabled={!canExport} className="btn-press inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-(--pm-border) bg-white hover:bg-(--pm-selection) text-(--pm-ink) text-sm font-bold disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"><Download className="w-4 h-4" aria-hidden="true" /> {t.downloadCsv}</button>
    </aside>
  );
}
