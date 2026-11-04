"use client";

import { parseInvoicePaste, parsePackingPaste } from "@/lib/paste-import";
import { workspaceIssues } from "@/lib/workspace-validation";
import { comparableQuantities } from "@/lib/reconcile-presentation";
import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  PRELOADED_CASES,
  WORST_CASE_BREAK_UI_SHIPMENT,
  type PreloadedCase,
} from "@/lib/preloaded-cases";
import {
  reconcileShipment,
  LBS_PER_KG,
  type InvoiceData,
  type InvoiceLine,
  type PackingListData,
  type PackingListRow,
  type ReconciliationFinding as Finding,
  type SkuReconciliationSummary,
} from "@/lib/reconcile";
import {
  generateSupplierMemo,
  generateReconciliationCsv,
  type AuditLogEntry,
} from "@/lib/supplier-memo";
import { BrandLogo } from "@/components/BrandLogo";
import { PackMatchStepper } from "@/components/PackMatchStepper";
import { PackMatchMemo } from "@/components/PackMatchMemo";
import { UiLocaleSwitcher } from "@/components/UiLocaleSwitcher";
import { UiLocaleProvider, useUiLocale } from "@/lib/i18n/UiLocaleContext";
import { formatTemplate, getDictionary } from "@/lib/i18n/dictionaries";
import { getLocaleFormatters } from "@/lib/i18n/format";
import {
  describeFinding,
  formatOriginLabel,
  shortFindingLabel,
  shortFindingTitle,
} from "@/lib/i18n/findings";
import type { UiLocale } from "@/lib/i18n/locale";
import { isPdfFile, pdfFirstPageToPngDataUrl } from "@/lib/pdf-to-image";
import { classifyFetchError, EXTRACTION_TIMEOUTS, readExtractResponse } from "@/lib/extract-response";
import { snapDocumentRows } from "@/lib/bbox-grid";
import {
  Plus, RotateCcw, FileText, Package, ArrowRight, ArrowLeft, X, Copy, Download,
  AlertCircle, CheckCircle2, HelpCircle, Trash2, ChevronDown, ExternalLink, Info, Weight,
} from "lucide-react";

/* ==========================================================================
   Formato numérico localizado (es-CL / en-US) + etiquetas humanas
   ========================================================================== */

function formatNowTime(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function humanLabelFor(
  caseId: string,
  locale: UiLocale,
  dictCases: Record<string, { number: string; name: string; summary: string }>
): { number: string; name: string; summary: string } {
  const found = PRELOADED_CASES.find((c) => c.case_id === caseId);
  return (
    dictCases[caseId] || {
      number: caseId.split("_")[0],
      name: found?.title ?? caseId,
      subtitle: found?.subtitle ?? "",
    }
  );
}

function shortCaseCode(caseId: string): string {
  const m = caseId.match(/^C(\d+)/);
  if (m) return `C${String(Number(m[1])).padStart(2, "0")}`;
  return caseId.split("_")[0];
}

/** Localiza un error de extracción del servidor por código estable; nunca oculta fallos. */
function localizeExtractError(
  locale: UiLocale,
  code: string | null,
  rawMessage: string,
  retrySeconds?: number,
  httpStatus?: number
): string {
  const e = getDictionary(locale).extractErrors;
  switch (code) {
    case "PAYLOAD_TOO_LARGE":
      return e.payloadTooLarge;
    case "MISSING_API_KEY":
      return e.missingApiKey;
    case "MISSING_DOCUMENTS":
      return e.missingDocuments;
    case "RATE_LIMITED": {
      let seconds = retrySeconds;
      if (seconds === undefined) {
        const m = rawMessage.match(/(\d+)\s*(segundos|seconds)/i);
        seconds = m ? Number(m[1]) : 60;
      }
      return formatTemplate(e.rateLimited, { seconds: seconds ?? 60 });
    }
    case "META_HTTP_ERROR":
      return formatTemplate(e.metaHttp, { status: httpStatus ?? "" });
    case "NON_JSON_RESPONSE":
      return e.nonJson;
    case "PROVIDER_TIMEOUT":
      return formatTemplate(e.timeout, { seconds: retrySeconds ?? 15 });
    case "DUPLICATE_IN_FLIGHT":
      return formatTemplate(e.rateLimited, { seconds: retrySeconds ?? 10 });
    case "PROVIDER_UNREACHABLE":
      return e.unreachable;
    case "MALFORMED_PROVIDER_OUTPUT":
      return e.malformed;
    case "META_EMPTY_CHOICE":
      return e.metaEmptyChoice;
    case "TRUNCATED_OUTPUT":
      return e.truncated;
    case "EXTRACTION_FAILED":
      return e.unknown;
    case "INVALID_INVOICE_FILE":
    case "INVALID_PACKING_FILE":
      return formatTemplate(e.invalidFile, { message: rawMessage });
    default:
      return e.unknown;
  }
}

/* ==========================================================================
   Estado en blanco + importación desde Excel/CSV (Opción B)
   ========================================================================== */

type ShipmentMode = "empty" | "workspace" | "demo";

function createEmptyInvoice(): InvoiceData {
  return {
    invoice_no: "BORRADOR",
    incoterm: "",
    currency: "USD",
    declared_total_amount: 0,
    declared_total_net_kg: 0,
    declared_total_gross_kg: 0,
    declared_total_cartons: 0,
    lines: [],
  };
}

function createEmptyPackingList(): PackingListData {
  return {
    packing_list_no: "BORRADOR",
    incoterm: "",
    declared_total_cartons: 0,
    declared_total_net_kg: 0,
    declared_total_gross_kg: 0,
    rows: [],
  };
}

function nextInvoiceLineId(lines: InvoiceLine[]): string {
  let max = 0;
  for (const l of lines) {
    const m = l.line_id.match(/^INV-L(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `INV-L${max + 1}`;
}

function nextPackingRowId(rows: PackingListRow[]): string {
  let max = 0;
  for (const r of rows) {
    const m = r.row_id.match(/^PL-R(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `PL-R${max + 1}`;
}

/* ==========================================================================
   Zona Drag & Drop reutilizable (Opción A del hub)
   ========================================================================== */

function DropZone({
  inputId, title, hint, loadedLabel, onFile, icon,
}: {
  inputId: string; title: string; hint: string; loadedLabel: string | null;
  onFile: (file: File) => void; icon: React.ReactNode;
}) {
  const [dragOver, setDragOver] = useState(false);
  const { dict } = useUiLocale();
  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      className={`block rounded-xl border border-dashed p-5 cursor-pointer transition-colors min-h-[240px] ${dragOver ? "border-(--pm-sage) bg-(--pm-dark-raised)" : loadedLabel ? "border-(--pm-sage) bg-(--pm-dark-raised)" : "border-(--pm-dark-dashed) bg-(--pm-dark-inset) hover:border-(--pm-sage)"}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-(--pm-dark-raised) text-(--pm-sage)">{icon}</span>
        <span className="text-[10px] tracking-widest text-(--pm-dark-secondary)">{dict.landing.dropFormats}</span>
      </span>
      <span className="block mt-8 text-base font-bold text-(--pm-paper)">{title}</span>
      <span className="block mt-1 text-sm text-(--pm-dark-secondary)">{hint} {dict.landing.dropOr} <span className="underline underline-offset-2 text-(--pm-paper)">{dict.landing.dropChoose}</span></span>
      {loadedLabel && <span className="inline-block mt-3 text-xs font-semibold px-3 py-1 rounded-full bg-(--pm-primary) text-white">{formatTemplate(dict.landing.dropLoaded, { name: loadedLabel })}</span>}
      <input id={inputId} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </label>
  );
}

/* ==========================================================================
   Componente principal
   ========================================================================== */

function PackMatchWorkbench() {
  const { locale, dict } = useUiLocale();
  const { fmtCurrency, fmtNumber } = useMemo(() => getLocaleFormatters(locale), [locale]);
  const pluralS = (_n: number) => (locale === "zh" ? "" : _n === 1 ? "" : "s");
  // El espacio de trabajo arranca vacío ("desde ceros"): el usuario elige cómo
  // ingresar su embarque en el Hub de Entrada Tri-Modal.
  const [shipmentMode, setShipmentMode] = useState<ShipmentMode>("empty");
  const [selectedCaseId, setSelectedCaseId] = useState<string>(
    PRELOADED_CASES[5].case_id
  );
  const [dataMode, setDataMode] = useState<"demo" | "worst">("demo");

  const activeCaseMeta: PreloadedCase = useMemo(() => {
    if (dataMode === "worst") return WORST_CASE_BREAK_UI_SHIPMENT;
    return (
      PRELOADED_CASES.find((c) => c.case_id === selectedCaseId) ||
      PRELOADED_CASES[0]
    );
  }, [selectedCaseId, dataMode]);

  const [invoice, setInvoice] = useState<InvoiceData>(() =>
    createEmptyInvoice()
  );
  const [packingList, setPackingList] = useState<PackingListData>(() =>
    createEmptyPackingList()
  );
  const [invoiceImgUrl, setInvoiceImgUrl] = useState<string>("");
  const [packingImgUrl, setPackingImgUrl] = useState<string>("");

  const [highlightedOrigins, setHighlightedOrigins] = useState<string[]>([]);
  const [auditTrail, setAuditTrail] = useState<AuditLogEntry[]>([]);
  const [memoLang, setMemoLang] = useState<"es" | "en">("es");
  const [copiedMemo, setCopiedMemo] = useState<boolean>(false);

  // Subida de documentos propios (hub de entrada, Opción A)
  const [customInvDataUrl, setCustomInvDataUrl] = useState<string | null>(null);
  const [customPlDataUrl, setCustomPlDataUrl] = useState<string | null>(null);
  const [customInvName, setCustomInvName] = useState<string | null>(null);
  const [customPlName, setCustomPlName] = useState<string | null>(null);
  const [isExtractingLive, setIsExtractingLive] = useState<boolean>(false);
  // Single-flight síncrono + secuencia anti-obsoletos (ver handleRunLiveExtraction).
  const extractInFlightRef = useRef(false);
  const extractSeqRef = useRef(0);
  const [extractError, setExtractError] = useState<string | null>(null);

  // Pegado desde Excel/CSV (hub de entrada, Opción B)
  const [showPasteModal, setShowPasteModal] = useState<boolean>(false);
  const [pasteInvoiceText, setPasteInvoiceText] = useState<string>("");
  const [pastePackingText, setPastePackingText] = useState<string>("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  // Tablas editables + modal de marca (solo desde el pie de página)
  const [showEditableTables, setShowEditableTables] = useState<boolean>(false);

  // Progressive Workflow Stepper: un solo foco visual protagonista por fase.
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1);
  const [matrixFilter, setMatrixFilter] = useState<"all" | "disc" | "match">(
    "all"
  );
  const [focusFindingIdx, setFocusFindingIdx] = useState<number | "all">("all");
  const [selectedFindingIdx, setSelectedFindingIdx] = useState(0);
  const [undoHistory, setUndoHistory] = useState<Array<{ invoice: InvoiceData; packingList: PackingListData; auditTrail: AuditLogEntry[] }>>([]);
  const [factorDrafts, setFactorDrafts] = useState<Record<string, string>>({});
  const [editTab, setEditTab] = useState<"invoice" | "packing">("invoice");

  /** Navegación secuencial con retorno suave al inicio (un foco, sin scroll perdido). */
  function goToStep(step: 1 | 2 | 3 | 4) {
    setActiveStep(step);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("data") === "worst") {
        loadCaseObject(WORST_CASE_BREAK_UI_SHIPMENT, "worst");
      } else {
        const caseParam = params.get("case");
        if (caseParam) {
          const found = PRELOADED_CASES.find(
            (c) => c.case_id === caseParam || c.case_id.startsWith(caseParam)
          );
          if (found) {
            loadCaseObject(found, "demo");
          }
        }
      }
      const stepParam = params.get("step");
      if (stepParam && ["1", "2", "3", "4"].includes(stepParam)) {
        setActiveStep(Number(stepParam) as 1 | 2 | 3 | 4);
      }
      const filterParam = params.get("filter");
      if (filterParam && ["all", "disc", "match"].includes(filterParam)) {
        setMatrixFilter(filterParam as "all" | "disc" | "match");
      }
      // ?lang= controla exclusivamente el idioma de la minuta (se conserva).
      const langParam = params.get("lang");
      if (langParam === "en" || langParam === "es") {
        setMemoLang(langParam);
      }
    }
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setHighlightedOrigins([]);
        setShowPasteModal(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reconciliation = useMemo(() => {
    return reconcileShipment(invoice, packingList);
  }, [invoice, packingList]);

  const supplierMemo = useMemo(() => {
    return generateSupplierMemo(
      invoice,
      packingList,
      reconciliation,
      memoLang,
      auditTrail
    );
  }, [invoice, packingList, reconciliation, memoLang, auditTrail]);

  function appendAudit(
    action: AuditLogEntry["action"],
    targetId: string,
    field: string,
    previousValue: unknown,
    newValue: unknown
  ) {
    if (String(previousValue ?? "") === String(newValue ?? "")) return;
    setUndoHistory((previous) => [...previous, { invoice: structuredClone(invoice), packingList: structuredClone(packingList), auditTrail: [...auditTrail] }]);
    setAuditTrail((prev) => [
      ...prev,
      {
        id: `AUD-${prev.length + 1}`,
        timestamp: formatNowTime(),
        actor: "Operador Pre-Despacho",
        action,
        targetId,
        field,
        previousValue: String(previousValue ?? "null"),
        newValue: String(newValue ?? "null"),
      },
    ]);
  }

  function loadCaseObject(target: PreloadedCase, mode: "demo" | "worst") {
    setDataMode(mode);
    if (mode === "demo") {
      setSelectedCaseId(target.case_id);
    }
    const invCopy = structuredClone(target.extracted.invoice);
    const plCopy = structuredClone(target.extracted.packing_list);
    setInvoice(invCopy);
    setPackingList(plCopy);
    setInvoiceImgUrl(target.invoiceImageUrl);
    setPackingImgUrl(target.packingListImageUrl);
    setAuditTrail([]);
    setUndoHistory([]);
    setFactorDrafts({});
    setExtractError(null);
    setShipmentMode("demo");
    setShowEditableTables(false);
    setActiveStep(1);
    setMatrixFilter("all");
    setFocusFindingIdx("all");
    setSelectedFindingIdx(0);
    const firstFinding = reconcileShipment(invCopy, plCopy).findings[0];
    setHighlightedOrigins(firstFinding ? firstFinding.origins : []);
  }

  function handleSelectCase(caseId: string) {
    const found = PRELOADED_CASES.find((c) => c.case_id === caseId);
    if (!found) return;
    loadCaseObject(found, "demo");
  }

  function handleUndo() {
    const previous = undoHistory.at(-1);
    if (!previous) return;
    setInvoice(previous.invoice);
    setPackingList(previous.packingList);
    setAuditTrail(previous.auditTrail);
    setUndoHistory((history) => history.slice(0, -1));
    setFactorDrafts({});
  }

  /** Botón global "+ Nuevo Embarque": limpia todo y vuelve al hub en blanco. */
  function handleNewShipment() {
    setShipmentMode("empty");
    setEditTab("invoice");
    setInvoice(createEmptyInvoice());
    setPackingList(createEmptyPackingList());
    setInvoiceImgUrl("");
    setPackingImgUrl("");
    setAuditTrail([]);
    setUndoHistory([]);
    setFactorDrafts({});
    setHighlightedOrigins([]);
    setCustomInvDataUrl(null);
    setCustomPlDataUrl(null);
    setCustomInvName(null);
    setCustomPlName(null);
    setExtractError(null);
    setPasteInvoiceText("");
    setPastePackingText("");
    setPasteError(null);
    setShowPasteModal(false);
    setShowEditableTables(false);
    setDataMode("demo");
    setActiveStep(1);
    setMatrixFilter("all");
    setFocusFindingIdx("all");
  }

  /** Opción C del hub: comenzar con tablas vacías para captura manual. */
  function handleStartWithEmptyTables() {
    setInvoice(createEmptyInvoice());
    setPackingList(createEmptyPackingList());
    setInvoiceImgUrl("");
    setPackingImgUrl("");
    setAuditTrail([]);
    setUndoHistory([]);
    setFactorDrafts({});
    setHighlightedOrigins([]);
    setExtractError(null);
    setShipmentMode("workspace");
    setEditTab("invoice");
    setShowEditableTables(true);
    setActiveStep(4);
    setMatrixFilter("all");
    setFocusFindingIdx("all");
  }

  /** Opción B del hub: importar celdas pegadas desde Excel/CSV. */
  function handleImportPastedCells() {
    setPasteError(null);
    let invLines: InvoiceLine[], plRows: PackingListRow[];
    try {
      invLines = parseInvoicePaste(pasteInvoiceText, locale);
      plRows = parsePackingPaste(pastePackingText, locale);
    } catch (error) {
      setPasteError(error instanceof Error ? error.message : formatTemplate(dict.pasteModal.unreadable, {}));
      return;
    }
    if (invLines.length === 0 && plRows.length === 0) {
      setPasteError(dict.pasteModal.noValidRows);
      return;
    }
    // Totales declarados = totales que calcula el motor (caja compartida con
    // peso total repetido cuenta una vez; grupo ambiguo no fabrica kilos).
    const amountSum = invLines.reduce((a, l) => a + l.line_amount, 0);
    const computed = reconcileShipment(
      { ...createEmptyInvoice(), lines: invLines },
      { ...createEmptyPackingList(), rows: plRows }
    ).computedTotals;
    const ctnSum = computed.packingCalculatedCartons;
    const importedInvoice: InvoiceData = {
      invoice_no: "PEGADO-EXCEL",
      incoterm: "",
      currency: "USD",
      declared_total_amount: Number(amountSum.toFixed(2)),
      declared_total_net_kg: computed.packingCalculatedNetKg,
      declared_total_gross_kg: computed.packingCalculatedGrossKg,
      declared_total_cartons: ctnSum,
      lines: invLines,
    };
    const importedPacking: PackingListData = {
      packing_list_no: "PEGADO-EXCEL",
      incoterm: "",
      declared_total_cartons: ctnSum,
      declared_total_net_kg: computed.packingCalculatedNetKg,
      declared_total_gross_kg: computed.packingCalculatedGrossKg,
      rows: plRows,
    };
    setInvoice(importedInvoice);
    setPackingList(importedPacking);
    setInvoiceImgUrl("");
    setPackingImgUrl("");
    setAuditTrail([]);
    setUndoHistory([]);
    setFactorDrafts({});
    setExtractError(null);
    setShipmentMode("workspace");
    setEditTab("invoice");
    setShowEditableTables(false);
    setShowPasteModal(false);
    setActiveStep(1);
    setMatrixFilter("all");
    setFocusFindingIdx("all");
    setSelectedFindingIdx(0);
    const firstFinding = reconcileShipment(importedInvoice, importedPacking).findings[0];
    setHighlightedOrigins(firstFinding ? firstFinding.origins : []);
  }

  function updateInvoiceLine(
    lineIdx: number,
    field: string,
    rawValue: string | number | null
  ) {
    const currentLine = invoice.lines[lineIdx] as unknown as Record<
      string,
      unknown
    >;
    const prevVal = currentLine ? currentLine[field] : "";
    let parsedVal: unknown = rawValue;
    if (
      field === "qty" ||
      field === "unit_price" ||
      field === "line_amount"
    ) {
      parsedVal = Number(rawValue) || 0;
    } else if (
      field === "explicit_pcs_per_set" ||
      field === "operator_pcs_per_set"
    ) {
      const val =
        rawValue === "" || rawValue === null ? null : Number(rawValue);
      parsedVal = val && val > 0 ? val : null;
    } else {
      parsedVal = String(rawValue);
    }

    appendAudit(
      field === "operator_pcs_per_set" ? "FACTOR_CONFIRMED" : "CELL_EDIT",
      String(currentLine?.line_id || `INV-L${lineIdx + 1}`),
      field,
      prevVal,
      parsedVal
    );

    setInvoice((prev) => {
      const next = structuredClone(prev);
      const line = next.lines[lineIdx] as unknown as Record<string, unknown>;
      line[field] = parsedVal;
      return next;
    });
  }

  function setOperatorFactorBySku(sku: string, factor: number | null) {
    const targetLine = invoice.lines.find((l) => l.sku === sku);
    const normalizedFactor = factor && factor > 0 ? factor : null;
    if (targetLine) {
      appendAudit(
        "FACTOR_CONFIRMED",
        targetLine.line_id,
        "operator_pcs_per_set",
        targetLine.operator_pcs_per_set ?? "sin_factor",
        normalizedFactor ? `1 SET = ${normalizedFactor} PCS` : "sin_factor"
      );
    }
    setInvoice((prev) => {
      const next = structuredClone(prev);
      const line = next.lines.find((l) => l.sku === sku);
      if (line) {
        line.operator_pcs_per_set = normalizedFactor;
      }
      return next;
    });
  }

  function addInvoiceLine() {
    appendAudit("CELL_EDIT", nextInvoiceLineId(invoice.lines), "row_added", null, "nueva línea");
    setInvoice((prev) => ({
      ...prev,
      lines: [
        ...prev.lines,
        {
          line_id: nextInvoiceLineId(prev.lines),
          sku: "",
          description: "",
          qty: 0,
          unit: "PCS",
          unit_price: 0,
          line_amount: 0,
          explicit_pcs_per_set: null,
          operator_pcs_per_set: null,
        },
      ],
    }));
  }

  function removeInvoiceLine(lineIdx: number) {
    const target = invoice.lines[lineIdx];
    if (target) {
      appendAudit(
        "CELL_EDIT",
        target.line_id,
        "row_deleted",
        target.sku || "(vacía)",
        "eliminada"
      );
    }
    setInvoice((prev) => ({
      ...prev,
      lines: prev.lines.filter((_, i) => i !== lineIdx),
    }));
  }

  function updatePackingRow(
    rowIdx: number,
    field: string,
    rawValue: string | number | boolean
  ) {
    const currentRow = packingList.rows[rowIdx] as unknown as Record<
      string,
      unknown
    >;
    const prevVal = currentRow
      ? field === "weight_scope"
        ? currentRow.operator_weight_scope ?? currentRow.weight_scope ?? "PER_ROW"
        : currentRow[field]
      : "";
    let parsedVal: unknown = rawValue;
    if (
      field === "carton_count" ||
      field === "qty_per_carton" ||
      field === "total_qty" ||
      field === "net_weight" ||
      field === "gross_weight"
    ) {
      parsedVal = Number(rawValue) || 0;
    } else if (field === "shared_carton") {
      parsedVal = Boolean(rawValue);
    } else if (field === "weight_scope") {
      parsedVal = String(rawValue);
    } else {
      parsedVal = String(rawValue);
    }

    appendAudit(
      "CELL_EDIT",
      String(currentRow?.row_id || `PL-R${rowIdx + 1}`),
      field,
      prevVal,
      parsedVal
    );

    setPackingList((prev) => {
      const next = structuredClone(prev);
      const row = next.rows[rowIdx] as unknown as Record<string, unknown>;
      if (field === "weight_scope") {
        // La resolución del operador no pisa el dato del documento.
        row.operator_weight_scope = parsedVal;
      } else {
        row[field] = parsedVal;
      }
      return next;
    });
  }

  function addPackingRow() {
    appendAudit("CELL_EDIT", nextPackingRowId(packingList.rows), "row_added", null, "nueva fila");
    setPackingList((prev) => {
      const id = nextPackingRowId(prev.rows);
      const n = prev.rows.length + 1;
      return {
        ...prev,
        rows: [
          ...prev.rows,
          {
            row_id: id,
            carton_range: `CTN ${n}`,
            carton_count: 1,
            sku: "",
            qty_per_carton: 0,
            total_qty: 0,
            unit: "PCS",
            net_weight: 0,
            gross_weight: 0,
            weight_unit: "KG",
            shared_carton: false,
            weight_scope: "PER_ROW",
            operator_weight_scope: null,
            explicit_pcs_per_set: null,
            is_packaging_only: false,
          },
        ],
      };
    });
  }

  function removePackingRow(rowIdx: number) {
    const target = packingList.rows[rowIdx];
    if (target) {
      appendAudit(
        "CELL_EDIT",
        target.row_id,
        "row_deleted",
        target.sku || "(vacía)",
        "eliminada"
      );
    }
    setPackingList((prev) => ({
      ...prev,
      rows: prev.rows.filter((_, i) => i !== rowIdx),
    }));
  }

  async function fileToDataUrl(file: File): Promise<string> {
    if (isPdfFile(file)) {
      // Raster en el navegador a ~150 DPI (pdf.js, solo página 1, igual que el
      // servidor): Netlify Functions no dispone de pdftoppm/sips, así el modelo
      // siempre recibe image/png sin depender de binarios del servidor.
      return pdfFirstPageToPngDataUrl(file);
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("read error"));
      reader.readAsDataURL(file);
    });
  }

  async function handleHubFile(file: File, target: "invoice" | "packing") {
    // Conversión/lectura con error gestionado: se muestra un mensaje
    // localizado y accionable, el otro documento (y un archivo anterior
    // válido de este mismo lado) se conservan y se puede reintentar.
    try {
      const dataUrl = await fileToDataUrl(file);
      // Nuevos documentos invalidan una extracción en vuelo (su resultado
      // sería obsoleto y se ignora por secuencia al llegar).
      extractSeqRef.current += 1;
      if (target === "invoice") {
        setCustomInvDataUrl(dataUrl);
        setCustomInvName(file.name);
      } else {
        setCustomPlDataUrl(dataUrl);
        setCustomPlName(file.name);
      }
      setExtractError(null);
    } catch {
      setExtractError(
        formatTemplate(getDictionary(locale).extractErrors.fileLoadFailed, { name: file.name })
      );
    }
  }

  async function handleRunLiveExtraction(invUrl: string, plUrl: string) {
    // Sin reintentos automáticos: cada reintento es un clic manual del
    // operador con la espera indicada. Los setState son asíncronos, así que
    // el guard es un ref síncrono (un doble clic dispararía dos fetch).
    if (extractInFlightRef.current) return;
    extractInFlightRef.current = true;
    const seq = ++extractSeqRef.current;
    setIsExtractingLive(true);
    setExtractError(null);
    try {
      const toDataUrlIfRelative = async (u: string) => {
        if (u.startsWith("data:")) return u;
        const resp = await fetch(u);
        if (!resp.ok) throw { code: "PROVIDER_UNREACHABLE" };
        const blob = await resp.blob();
        return await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
      };

      const invDataUrl = await toDataUrlIfRelative(invUrl);
      const plDataUrl = await toDataUrlIfRelative(plUrl);

      // Sin reintentos automáticos: un reintento podría duplicar el consumo
      // del proveedor. Estado y formato se comprueban antes de parsear JSON
      // (readExtractResponse); un cuerpo HTML nunca llega a JSON.parse del
      // llamador como error crudo ni se muestra al operador.
      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceDataUrl: invDataUrl,
          packingListDataUrl: plDataUrl,
        }),
        signal: AbortSignal.timeout(EXTRACTION_TIMEOUTS.clientMs),
      });
      const data = await readExtractResponse(resp);
      if (seq !== extractSeqRef.current) return; // obsoleta: llegó otra petición después
      if (typeof data.requestId === "string") {
        console.debug(`[extract] seq=${seq} requestId=${data.requestId}`);
      }
      if (!data.extracted || typeof data.extracted !== "object") {
        throw { code: "MALFORMED_PROVIDER_OUTPUT" };
      }
      const extracted = data.extracted as { invoice: InvoiceData; packing_list: PackingListData };
      const invImgUrl = typeof data.normalizedInvoiceDataUrl === "string" ? data.normalizedInvoiceDataUrl : invDataUrl;
      const plImgUrl = typeof data.normalizedPackingListDataUrl === "string" ? data.normalizedPackingListDataUrl : plDataUrl;
      // Anclaje visual: si la imagen tiene rejilla detectable, las bandas se
      // ajustan a sus líneas reales; si no, se conserva el grounding del
      // modelo (con su marca de estimado). Un fallo aquí nunca bloquea.
      let finalInvoice = extracted.invoice;
      let finalPacking = extracted.packing_list;
      try {
        const snappedLines = await snapDocumentRows(extracted.invoice.lines, invImgUrl);
        const snappedRows = await snapDocumentRows(extracted.packing_list.rows, plImgUrl);
        finalInvoice = { ...extracted.invoice, lines: snappedLines };
        finalPacking = { ...extracted.packing_list, rows: snappedRows };
      } catch { /* conservar grounding original */ }
      setInvoice(finalInvoice);
      setPackingList(finalPacking);
      setInvoiceImgUrl(invImgUrl);
      setPackingImgUrl(plImgUrl);
      setAuditTrail([]);
      setUndoHistory([]);
      setFactorDrafts({});
      setShipmentMode("workspace");
      setEditTab("invoice");
      setActiveStep(1);
      setMatrixFilter("all");
      setFocusFindingIdx("all");
      const firstFinding = reconcileShipment(
        finalInvoice,
        finalPacking
      ).findings[0];
      setHighlightedOrigins(firstFinding ? firstFinding.origins : []);
    } catch (err: unknown) {
      if (seq !== extractSeqRef.current) return; // obsoleta
      // Los archivos cargados NO se limpian: el operador puede reintentar.
      const classified = classifyFetchError(err);
      const e = err as { retryAfterSeconds?: number; status?: number; requestId?: string };
      if (e?.requestId) {
        console.debug(`[extract] seq=${seq} failed requestId=${e.requestId} code=${classified.code}`);
      }
      setExtractError(localizeExtractError(locale, classified.code, "", e?.retryAfterSeconds, e?.status));
    } finally {
      if (seq === extractSeqRef.current) {
        extractInFlightRef.current = false;
        setIsExtractingLive(false);
      }
    }
  }

  function handleCopyMemo() {
    if (!canExport) return;
    navigator.clipboard.writeText(supplierMemo);
    setCopiedMemo(true);
    setTimeout(() => setCopiedMemo(false), 2000);
  }

  function handleDownloadCsv() {
    if (!canExport) return;
    const csv = generateReconciliationCsv(reconciliation, invoice);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `packmatch_${invoice.invoice_no}_comparativa.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const discrepanciesCount = reconciliation.findings.filter(
    (f) => f.severity === "DISCREPANCY"
  ).length;
  const ambiguitiesCount = reconciliation.findings.filter(
    (f) => f.severity === "AMBIGUITY"
  ).length;

  const totalSkus = reconciliation.skuSummaries.length;
  const matchedSkus = reconciliation.skuSummaries.filter(
    (s) => s.status === "MATCHED"
  ).length;
  const discrepantSkus = reconciliation.skuSummaries.filter(
    (s) => s.status === "DISCREPANCY"
  ).length;
  const ambiguousSkus = reconciliation.skuSummaries.filter(
    (s) => s.status === "AMBIGUOUS"
  ).length;

  const operatorEditsCount = auditTrail.length;
  const isWorkspaceEmpty =
    invoice.lines.length === 0 && packingList.rows.length === 0;
  const demoHuman =
    shipmentMode === "demo" ? humanLabelFor(activeCaseMeta.case_id, locale, dict.cases) : null;

  const inputIssues = workspaceIssues(invoice, packingList, locale);
  const hasData = !isWorkspaceEmpty;
  const canExport = hasData && inputIssues.length === 0;
  const findings = reconciliation.findings;
  const selIdx = findings.length > 0 ? Math.min(selectedFindingIdx, findings.length - 1) : 0;
  const selFinding = findings.length > 0 ? findings[selIdx] : null;
  const selHuman = selFinding ? describeFinding(selFinding, invoice, packingList, reconciliation.skuSummaries, locale) : null;
  const selSum = selFinding ? reconciliation.skuSummaries.find((x) => x.sku === selFinding.sku) : undefined;
  const selComparable = comparableQuantities(selSum);
  const selInvLine = selFinding ? invoice.lines.find((l) => l.sku === selFinding.sku) : undefined;
  const focusFinding = typeof focusFindingIdx === "number" && findings[focusFindingIdx] ? findings[focusFindingIdx] : null;
  const eyebrow = shipmentMode === "demo" ? formatTemplate(dict.diagnosis.eyebrowExample, { code: shortCaseCode(activeCaseMeta.case_id) }) : shipmentMode === "workspace" ? dict.diagnosis.eyebrowWorkspace : "";
  const currencyCode = invoice.currency || "USD";
  const steps = [
    { n: 1 as const, label: dict.stepper.steps[0] },
    { n: 2 as const, label: dict.stepper.steps[1] },
    { n: 3 as const, label: dict.stepper.steps[2] },
    { n: 4 as const, label: dict.stepper.steps[3] },
  ];
  const discPlural = locale === "en"
    ? discrepanciesCount === 1 ? "y" : "ies"
    : locale === "zh"
      ? ""
      : pluralS(discrepanciesCount);

  const editableTables = (
    <div className="bg-white rounded-2xl border border-(--pm-border) overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4" role="tablist" aria-label={dict.capture.tabsLabel}>
        <button type="button" role="tab" aria-selected={editTab === "invoice"} onClick={() => setEditTab("invoice")} className={`btn-press inline-flex items-center gap-2 px-3 py-2 text-sm font-bold border-b-[3px] cursor-pointer ${editTab === "invoice" ? "border-(--pm-primary) text-(--pm-ink)" : "border-transparent text-(--pm-text-secondary)"}`}>
          <FileText className="w-4 h-4" aria-hidden="true" /> {dict.capture.invoiceTab}
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-(--pm-border) text-(--pm-text-secondary)">{invoice.invoice_no === "BORRADOR" ? dict.capture.draft : formatTemplate(dict.capture.rowsBadge, { count: invoice.lines.length })}</span>
        </button>
        <span className="hidden sm:block w-px h-6 bg-(--pm-border)" aria-hidden="true" />
        <button type="button" role="tab" aria-selected={editTab === "packing"} onClick={() => setEditTab("packing")} className={`btn-press inline-flex items-center gap-2 px-3 py-2 text-sm font-bold border-b-[3px] cursor-pointer ${editTab === "packing" ? "border-(--pm-primary) text-(--pm-ink)" : "border-transparent text-(--pm-text-secondary)"}`}>
          <Package className="w-4 h-4" aria-hidden="true" /> {dict.capture.packingTab}
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-(--pm-border) text-(--pm-text-secondary)">{formatTemplate(dict.capture.rowsBadge, { count: packingList.rows.length })}</span>
        </button>
      </div>
      {editTab === "invoice" ? (
        <div className="p-5">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div><label htmlFor="cap-cartons" className="block text-[11px] font-bold tracking-wide text-(--pm-ink)">{dict.capture.boxesDeclared}</label>
              <input id="cap-cartons" type="number" value={invoice.declared_total_cartons} onChange={(e) => { const v = Number(e.target.value) || 0; appendAudit("CELL_EDIT", "INV-HEADER", "declared_total_cartons", invoice.declared_total_cartons, v); setInvoice((p) => ({ ...p, declared_total_cartons: v })); }} className="mt-1 w-36 px-3 py-2 bg-white border border-(--pm-border) rounded-lg text-sm font-semibold" /></div>
            <div><label htmlFor="cap-net" className="block text-[11px] font-bold tracking-wide text-(--pm-ink)">{dict.capture.netKg}</label>
              <input id="cap-net" type="number" step="0.1" value={invoice.declared_total_net_kg} onChange={(e) => { const v = Number(e.target.value) || 0; appendAudit("CELL_EDIT", "INV-HEADER", "declared_total_net_kg", invoice.declared_total_net_kg, v); setInvoice((p) => ({ ...p, declared_total_net_kg: v })); }} className="mt-1 w-36 px-3 py-2 bg-white border border-(--pm-border) rounded-lg text-sm font-semibold" /></div>
            <div><label htmlFor="cap-gross" className="block text-[11px] font-bold tracking-wide text-(--pm-ink)">{dict.capture.grossKg}</label>
              <input id="cap-gross" type="number" step="0.1" value={invoice.declared_total_gross_kg} onChange={(e) => { const v = Number(e.target.value) || 0; appendAudit("CELL_EDIT", "INV-HEADER", "declared_total_gross_kg", invoice.declared_total_gross_kg, v); setInvoice((p) => ({ ...p, declared_total_gross_kg: v })); }} className="mt-1 w-36 px-3 py-2 bg-white border border-(--pm-border) rounded-lg text-sm font-semibold" /></div>
            <button type="button" onClick={addInvoiceLine} className="btn-press ml-auto inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold cursor-pointer"><Plus className="w-4 h-4" aria-hidden="true" /> {dict.capture.addLine}</button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-(--pm-border)">
            <table className="w-full text-left text-sm min-w-[640px]">
              <thead><tr className="bg-(--pm-selection) text-(--pm-ink) text-xs"><th scope="col" className="py-2.5 px-3">{dict.capture.colLine}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colProduct}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colQty}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colUnit}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colPrice}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colSubtotal}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colPcsPerSet}</th><th scope="col" className="py-2.5 px-3"><span className="sr-only">{dict.capture.colDelete}</span></th></tr></thead>
              <tbody className="divide-y divide-(--pm-border)">
                {invoice.lines.map((line, idx) => (
                  <tr key={line.line_id}>
                    <td className="py-2 px-3 text-(--pm-text-secondary) whitespace-nowrap">{formatTemplate(dict.capture.lineLabel, { index: idx + 1 })}</td>
                    <td className="py-2 px-2"><input type="text" aria-label={formatTemplate(dict.capture.skuAria, { index: idx + 1 })} value={line.sku} onChange={(e) => updateInvoiceLine(idx, "sku", e.target.value)} className="w-28 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><input type="number" aria-label={formatTemplate(dict.capture.qtyAria, { index: idx + 1 })} value={line.qty} onChange={(e) => updateInvoiceLine(idx, "qty", e.target.value)} className="w-20 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><select aria-label={formatTemplate(dict.capture.unitAria, { index: idx + 1 })} value={line.unit} onChange={(e) => updateInvoiceLine(idx, "unit", e.target.value)} className="px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm"><option value="PCS">PCS</option><option value="SETS">SETS</option></select></td>
                    <td className="py-2 px-2"><input type="number" step="0.5" aria-label={formatTemplate(dict.capture.priceAria, { index: idx + 1 })} value={line.unit_price} onChange={(e) => updateInvoiceLine(idx, "unit_price", e.target.value)} className="w-20 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><input type="number" step="1" aria-label={formatTemplate(dict.capture.subtotalAria, { index: idx + 1 })} value={line.line_amount} onChange={(e) => updateInvoiceLine(idx, "line_amount", e.target.value)} className="w-24 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2 whitespace-nowrap">{line.explicit_pcs_per_set ? <span className="text-xs px-2 py-1 rounded-full bg-(--pm-selection) text-(--pm-primary) font-bold">1 SET = {line.explicit_pcs_per_set} PCS</span> : line.unit === "SETS" ? <input type="number" min={1} placeholder={dict.capture.noFactor} aria-label={formatTemplate(dict.capture.pcsPerSetAria, { index: idx + 1 })} value={line.operator_pcs_per_set ?? ""} onChange={(e) => updateInvoiceLine(idx, "operator_pcs_per_set", e.target.value)} className="w-28 px-2 py-1.5 bg-(--pm-warning-bg) border border-(--pm-warning-border) rounded-md text-xs" /> : <span className="text-(--pm-text-secondary)">-</span>}</td>
                    <td className="py-2 px-2"><button type="button" onClick={() => removeInvoiceLine(idx)} aria-label={formatTemplate(dict.capture.deleteLineAria, { index: idx + 1 })} className="btn-press p-2 rounded-lg text-(--pm-error) hover:bg-(--pm-error-bg) cursor-pointer"><Trash2 className="w-4 h-4" aria-hidden="true" /></button></td>
                  </tr>
                ))}
                {invoice.lines.length === 0 && (<tr><td colSpan={8} className="py-10 px-3 text-center text-(--pm-text-secondary) border border-dashed border-(--pm-border) rounded-lg">{dict.capture.noLines}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="p-5">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            {([
              ["declared_total_cartons", dict.capture.packingBoxes],
              ["declared_total_net_kg", dict.capture.packingNet],
              ["declared_total_gross_kg", dict.capture.packingGross],
            ] as const).map(([field, label]) => (
              <div key={field}><label htmlFor={`packing-${field}`} className="block text-[11px] font-bold tracking-wide text-(--pm-ink)">{label}</label>
                <input id={`packing-${field}`} type="number" min={0} step={field === "declared_total_cartons" ? 1 : "any"} value={packingList[field]} onChange={(e) => { const value = Number(e.target.value); if (!Number.isFinite(value) || value < 0 || (field === "declared_total_cartons" && !Number.isInteger(value))) return; appendAudit("CELL_EDIT", "PL-HEADER", field, packingList[field], value); setPackingList((previous) => ({ ...previous, [field]: value })); }} className="mt-1 w-36 px-3 py-2 bg-white border border-(--pm-border) rounded-lg text-sm font-semibold" />
              </div>
            ))}
            <button type="button" onClick={addPackingRow} className="btn-press inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold cursor-pointer"><Plus className="w-4 h-4" aria-hidden="true" /> {dict.capture.addRow}</button></div>
          <div className="overflow-x-auto rounded-xl border border-(--pm-border)">
            <table className="w-full text-left text-sm min-w-[720px]">
              <thead><tr className="bg-(--pm-selection) text-(--pm-ink) text-xs"><th scope="col" className="py-2.5 px-3">{dict.capture.colRow}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colCartons}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colCartonCount}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colProduct}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colUnitsPer}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colTotalUnits}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colPackingUnit}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colNet}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colGross}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colSharedCarton}</th><th scope="col" className="py-2.5 px-3">{dict.capture.colWeightScope}</th><th scope="col" className="py-2.5 px-3"><span className="sr-only">{dict.capture.colDelete}</span></th></tr></thead>
              <tbody className="divide-y divide-(--pm-border)">
                {packingList.rows.map((row, idx) => (
                  <tr key={row.row_id}>
                    <td className="py-2 px-3 text-(--pm-text-secondary) whitespace-nowrap">{formatTemplate(dict.capture.rowLabel, { index: idx + 1 })}</td>
                    <td className="py-2 px-2"><input type="text" aria-label={formatTemplate(dict.capture.rangeAria, { index: idx + 1 })} value={row.carton_range} onChange={(e) => updatePackingRow(idx, "carton_range", e.target.value)} className="w-24 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><input type="number" aria-label={formatTemplate(dict.capture.cartonCountAria, { index: idx + 1 })} value={row.carton_count} onChange={(e) => updatePackingRow(idx, "carton_count", e.target.value)} className="w-16 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><input type="text" aria-label={formatTemplate(dict.capture.packingSkuAria, { index: idx + 1 })} value={row.sku} onChange={(e) => updatePackingRow(idx, "sku", e.target.value)} className="w-28 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><input type="number" aria-label={formatTemplate(dict.capture.unitsPerAria, { index: idx + 1 })} value={row.qty_per_carton} onChange={(e) => updatePackingRow(idx, "qty_per_carton", e.target.value)} className="w-20 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><input type="number" aria-label={formatTemplate(dict.capture.totalUnitsAria, { index: idx + 1 })} value={row.total_qty} onChange={(e) => updatePackingRow(idx, "total_qty", e.target.value)} className="w-20 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm font-bold" /></td>
                    <td className="py-2 px-2"><select aria-label={formatTemplate(dict.capture.packingUnitAria, { index: idx + 1 })} value={row.unit} onChange={(e) => updatePackingRow(idx, "unit", e.target.value)} className="px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm">{row.unit !== "PCS" && row.unit !== "SETS" && <option value={row.unit}>{row.unit}</option>}<option value="PCS">PCS</option><option value="SETS">SETS</option></select></td>
                    <td className="py-2 px-2"><input type="number" step="0.5" aria-label={formatTemplate(dict.capture.netAria, { index: idx + 1 })} value={row.net_weight} onChange={(e) => updatePackingRow(idx, "net_weight", e.target.value)} className="w-20 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><input type="number" step="0.5" aria-label={formatTemplate(dict.capture.grossAria, { index: idx + 1 })} value={row.gross_weight} onChange={(e) => updatePackingRow(idx, "gross_weight", e.target.value)} className="w-20 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><select aria-label={formatTemplate(dict.capture.sharedAria, { index: idx + 1 })} value={row.shared_carton ? "yes" : "no"} onChange={(e) => updatePackingRow(idx, "shared_carton", e.target.value === "yes")} className="px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm"><option value="no">{dict.capture.sharedNo}</option><option value="yes">{dict.capture.sharedYes}</option></select></td>
                    <td className="py-2 px-2"><select aria-label={formatTemplate(dict.capture.weightScopeAria, { index: idx + 1 })} value={row.operator_weight_scope ?? row.weight_scope ?? "PER_ROW"} onChange={(e) => updatePackingRow(idx, "weight_scope", e.target.value)} className="px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm"><option value="PER_ROW">{dict.capture.weightScopePerRow}</option><option value="CARTON_TOTAL">{dict.capture.weightScopeCartonTotal}</option><option value="UNSPECIFIED">{dict.capture.weightScopeUnspecified}</option></select></td>
                    <td className="py-2 px-2"><button type="button" onClick={() => removePackingRow(idx)} aria-label={formatTemplate(dict.capture.deleteRowAria, { index: idx + 1 })} className="btn-press p-2 rounded-lg text-(--pm-error) hover:bg-(--pm-error-bg) cursor-pointer"><Trash2 className="w-4 h-4" aria-hidden="true" /></button></td>
                  </tr>
                ))}
                {packingList.rows.length === 0 && (<tr><td colSpan={12} className="py-10 px-3 text-center text-(--pm-text-secondary)">{dict.capture.noRows}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 px-5 py-3 border-t border-(--pm-border) text-sm text-(--pm-text-secondary)">
        <span className="inline-flex items-center gap-2"><FileText className="w-4 h-4" aria-hidden="true" /> {formatTemplate(dict.capture.productsCount, { count: invoice.lines.length })}</span>
        <span className="w-px h-5 bg-(--pm-border)" aria-hidden="true" />
        <span className="inline-flex items-center gap-2"><Package className="w-4 h-4" aria-hidden="true" /> {formatTemplate(dict.capture.packingRowsCount, { count: packingList.rows.length })}</span>
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen flex flex-col ${shipmentMode === "empty" ? "bg-(--pm-ink) text-(--pm-paper)" : "bg-(--pm-paper) text-(--pm-ink)"}`}>
      <header className="bg-(--pm-ink) text-white border-b border-(--pm-dark-border)">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 min-h-16 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-4 min-w-0">
            <BrandLogo size="sm" theme="dark" />
            <span className="hidden md:inline-block border-l border-white/20 pl-4 text-sm text-(--pm-dark-secondary)">{dict.header.tagline}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <UiLocaleSwitcher />
            {shipmentMode === "empty" && <span className="hidden lg:block text-sm text-(--pm-dark-secondary)">{dict.header.hubHint}</span>}
            {shipmentMode === "demo" && demoHuman && (
              <span className="hidden md:inline-flex items-center gap-2 text-xs text-(--pm-dark-secondary)">
                {dict.header.demo} <strong className="text-white">{shortCaseCode(activeCaseMeta.case_id)}</strong>
                <button type="button" onClick={() => loadCaseObject(activeCaseMeta, dataMode)} className="underline underline-offset-2 hover:text-white cursor-pointer">{dict.header.restart}</button>
              </span>
            )}
            {operatorEditsCount > 0 && shipmentMode !== "empty" && (
              <button type="button" onClick={handleUndo} className="btn-press inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-(--pm-warning-border) text-(--pm-warning-border) text-xs font-bold cursor-pointer"><RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> {formatTemplate(dict.header.undo, { count: operatorEditsCount })}</button>
            )}
            {shipmentMode !== "empty" && (
              <button type="button" onClick={handleNewShipment} className="btn-press inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-(--pm-paper)/60 text-white text-sm font-bold hover:bg-(--pm-dark-surface) cursor-pointer"><Plus className="w-4 h-4" aria-hidden="true" /> {dict.header.newShipment}</button>
            )}
          </div>
        </div>
      </header>

      {inputIssues.length > 0 && shipmentMode !== "empty" && <div role="alert" className="bg-(--pm-warning-bg) border-b border-(--pm-warning-border) px-6 py-3 text-sm text-(--pm-warning-text)"><strong>{dict.alerts.completeData}</strong><ul>{inputIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
      {extractError && <div role="alert" className="bg-(--pm-error-bg) border-b border-(--pm-error-border) px-6 py-2.5 text-sm text-(--pm-error) font-medium">{formatTemplate(dict.alerts.extractFailed, { message: extractError })}</div>}

      {shipmentMode !== "empty" && (
        <PackMatchStepper steps={steps} activeStep={activeStep} onStep={goToStep} />
      )}

      {shipmentMode === "empty" && (
        <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 py-10 sm:py-14">
          <p className="text-[11px] font-bold tracking-[0.22em] text-(--pm-sage)">{dict.landing.eyebrow}</p>
          <h1 className="mt-3 text-4xl sm:text-5xl font-black tracking-tight">{dict.landing.title}</h1>
          <p className="mt-3 text-base text-(--pm-dark-secondary)">{dict.landing.subtitle}</p>

          <div className="mt-10 grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-6 items-stretch">
            <section aria-label={dict.landing.invoiceAria} className="rounded-2xl border border-(--pm-dark-border) bg-(--pm-dark-surface) p-4">
              <div className="flex items-center justify-between px-1 pb-3 text-[11px] tracking-widest text-(--pm-dark-secondary)"><span>{dict.landing.invoiceEyebrow}</span><span>{customInvName ? dict.landing.oneFile : dict.landing.noFile}</span></div>
              <DropZone inputId="hub-invoice-file" title={dict.landing.dropInvoiceTitle} hint={dict.landing.dropHint} loadedLabel={customInvName} onFile={(f) => void handleHubFile(f, "invoice")} icon={<FileText className="w-5 h-5" aria-hidden="true" />} />
            </section>
            <div className="flex lg:flex-col items-center justify-center gap-4 px-2 text-center">
              <span className="hidden lg:block text-(--pm-sage) text-3xl font-light" aria-hidden="true">==</span>
              <div>
                <p className="text-xl font-bold leading-tight">{dict.landing.sameShipment}</p>
                <p className="mt-2 text-sm text-(--pm-dark-secondary) max-w-[180px]">{dict.landing.sameShipmentHint}</p>
                <button type="button" disabled={!customInvDataUrl || !customPlDataUrl || isExtractingLive} onClick={() => customInvDataUrl && customPlDataUrl && void handleRunLiveExtraction(customInvDataUrl, customPlDataUrl)} className="btn-press mt-4 inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-(--pm-sage) text-(--pm-ink) font-bold text-sm disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
                  {isExtractingLive ? dict.landing.analyzing : <>{dict.landing.reconcile} <ArrowRight className="w-4 h-4" aria-hidden="true" /></>}
                </button>
                <p className="mt-2 text-xs text-(--pm-dark-secondary)">{formatTemplate(dict.landing.filesOfTwo, { count: (customInvDataUrl ? 1 : 0) + (customPlDataUrl ? 1 : 0) })}</p>
              </div>
            </div>
            <section aria-label={dict.landing.packingAria} className="rounded-2xl border border-(--pm-dark-border) bg-(--pm-dark-surface) p-4">
              <div className="flex items-center justify-between px-1 pb-3 text-[11px] tracking-widest text-(--pm-dark-secondary)"><span>{dict.landing.packingEyebrow}</span><span>{customPlName ? dict.landing.oneFile : dict.landing.noFile}</span></div>
              <DropZone inputId="hub-packing-file" title={dict.landing.dropPackingTitle} hint={dict.landing.dropHint} loadedLabel={customPlName} onFile={(f) => void handleHubFile(f, "packing")} icon={<Package className="w-5 h-5" aria-hidden="true" />} />
            </section>
          </div>

          <div className="mt-10 pt-6 border-t border-(--pm-dark-border) flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
            <span className="text-(--pm-dark-secondary)">{dict.landing.otherWays}</span>
            <button type="button" onClick={() => { setPasteError(null); setShowPasteModal(true); }} className="btn-press font-semibold text-(--pm-paper) hover:text-(--pm-sage) cursor-pointer">{dict.landing.excelCsv} <span aria-hidden="true">↗</span></button>
            <button type="button" onClick={handleStartWithEmptyTables} className="btn-press font-semibold text-(--pm-paper) hover:text-(--pm-sage) cursor-pointer">{dict.landing.blankTables} <span aria-hidden="true">↗</span></button>
            <label className="ml-auto inline-flex items-center gap-2">
              <span className="sr-only">{dict.landing.tryExampleSr}</span>
              <select aria-label={dict.landing.tryExampleSr} value="" onChange={(e) => { if (e.target.value) handleSelectCase(e.target.value); }} className="h-9 px-3 rounded-lg bg-(--pm-dark-surface) border border-(--pm-dark-border) text-(--pm-paper) text-sm font-semibold cursor-pointer">
                <option value="" disabled>{dict.landing.tryExamplePlaceholder}</option>
                {PRELOADED_CASES.map((c) => { const h = humanLabelFor(c.case_id, locale, dict.cases); return <option key={c.case_id} value={c.case_id}>{h.number} · {h.name}</option>; })}
              </select>
            </label>
          </div>
        </main>
      )}

      {shipmentMode !== "empty" && (
        <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
          {activeStep === 1 && (
            <>
              <div>
                {eyebrow && <p className="text-[11px] font-bold tracking-[0.18em] text-(--pm-primary)">{eyebrow}{shipmentMode === "demo" && demoHuman ? ` · ${demoHuman.name.toUpperCase()}` : ""}</p>}
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  <h1 className="text-3xl sm:text-4xl font-black tracking-tight">{dict.diagnosis.title}</h1>
                  <span className="hidden sm:block w-px h-8 bg-(--pm-border)" aria-hidden="true" />
                  {!hasData ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-border) bg-white text-sm font-bold text-(--pm-text-secondary)">{dict.diagnosis.badgeNoData}</span>
                  ) : inputIssues.length > 0 ? (<span className="text-sm font-bold text-(--pm-warning-text)">{dict.diagnosis.badgeFixData}</span>) : findings.length === 0 ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-primary) bg-(--pm-selection) text-sm font-bold text-(--pm-primary)"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {dict.diagnosis.badgeNoDiff}</span>
                  ) : ambiguitiesCount > 0 && discrepanciesCount === 0 ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-warning-border) bg-(--pm-warning-bg) text-sm font-bold text-(--pm-warning-text)"><HelpCircle className="w-4 h-4" aria-hidden="true" /> {dict.diagnosis.badgePending}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-error-border) bg-(--pm-error-bg) text-sm font-bold text-(--pm-error)"><AlertCircle className="w-4 h-4" aria-hidden="true" /> {dict.diagnosis.badgeReview}</span>
                  )}
                  <span className="text-sm text-(--pm-text-secondary)">{formatTemplate(dict.diagnosis.findingsCount, { count: findings.length, plural: pluralS(findings.length) })}{ambiguitiesCount > 0 ? formatTemplate(dict.diagnosis.doubtsCount, { count: ambiguitiesCount, plural: pluralS(ambiguitiesCount) }) : ""}</span>
                </div>
                <p className="mt-1 text-sm text-(--pm-text-secondary)">{!hasData ? dict.diagnosis.emptyHint : findings.length === 0 ? dict.diagnosis.reviewHint : formatTemplate(dict.diagnosis.shipmentHint, { total: totalSkus, matched: matchedSkus, rest: discrepantSkus + ambiguousSkus > 0 ? formatTemplate(dict.diagnosis.shipmentHintRest, { count: discrepantSkus + ambiguousSkus }) : "." })}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { icon: <FileText className="w-5 h-5" aria-hidden="true" />, label: dict.diagnosis.metricInvoiced, value: `${currencyCode} ${fmtCurrency.format(reconciliation.computedTotals.invoiceLinesSumAmount)}` },
                  { icon: <Package className="w-5 h-5" aria-hidden="true" />, label: dict.diagnosis.metricCartons, value: formatTemplate(dict.diagnosis.cartonsUnit, { count: fmtNumber.format(reconciliation.computedTotals.packingCalculatedCartons) }) },
                  { icon: <Weight className="w-5 h-5" aria-hidden="true" />, label: dict.diagnosis.metricWeight, value: formatTemplate(dict.diagnosis.weightUnit, { net: fmtNumber.format(reconciliation.computedTotals.packingCalculatedNetKg), gross: fmtNumber.format(reconciliation.computedTotals.packingCalculatedGrossKg) }) },
                ].map((m) => (
                  <div key={m.label} className="bg-white rounded-2xl border border-(--pm-border) px-5 py-4 flex items-center gap-4">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-(--pm-selection) text-(--pm-primary) shrink-0">{m.icon}</span>
                    <span><span className="block text-sm text-(--pm-text-secondary)">{m.label}</span><span className="block text-xl font-black">{m.value}</span></span>
                  </div>
                ))}
              </div>

              {!hasData ? (
                <div className="bg-white rounded-2xl border border-(--pm-border) p-8 text-center">
                  <p className="font-bold">{dict.diagnosis.noDataTitle}</p>
                  <p className="text-sm text-(--pm-text-secondary) mt-1">{dict.diagnosis.noDataBody}</p>
                  <button type="button" onClick={() => { setShowEditableTables(true); goToStep(4); }} className="btn-press mt-4 px-5 py-2.5 rounded-lg bg-(--pm-primary) text-white text-sm font-bold cursor-pointer">{dict.diagnosis.goToCapture}</button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5 items-start">
                  <section aria-label={formatTemplate(dict.diagnosis.findingsTitle, { count: findings.length })} className="bg-white rounded-2xl border border-(--pm-border) p-5">
                    <h2 className="text-lg font-bold">{formatTemplate(dict.diagnosis.findingsTitle, { count: findings.length })}</h2>
                    {findings.length === 0 ? (
                      <div className="mt-4">
                        <div className="rounded-xl border border-(--pm-primary) bg-(--pm-selection) p-4 flex gap-3"><CheckCircle2 className="w-6 h-6 text-(--pm-primary) shrink-0" aria-hidden="true" /><span><strong className="block">{dict.diagnosis.noFindingsTitle}</strong><span className="text-sm text-(--pm-text-secondary)">{dict.diagnosis.noFindingsBody}</span></span></div>
                        <ul className="mt-4 divide-y divide-(--pm-border) text-sm">
                          {[[dict.diagnosis.findingRowNoData[0], discrepantSkus], [dict.diagnosis.findingRowNoData[1], findings.length], [dict.diagnosis.findingRowNoData[2], 0], [dict.diagnosis.findingRowNoData[3], 0]].map(([l, v]) => (
                            <li key={String(l)} className="flex items-center justify-between py-2.5"><span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-(--pm-primary)" aria-hidden="true" /> {l}</span><span className="font-bold">{v}</span></li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <ul className="mt-4 flex flex-col gap-3">
                        {findings.map((f, idx) => {
                          const human = describeFinding(f, invoice, packingList, reconciliation.skuSummaries, locale);
                          const isSel = idx === selIdx;
                          const isDisc = f.severity === "DISCREPANCY";
                          return (
                            <li key={`${f.code}-${f.sku}-${idx}`}>
                              <button type="button" aria-pressed={isSel} onClick={() => { setSelectedFindingIdx(idx); setHighlightedOrigins(f.origins); }} className={`btn-press w-full text-left p-4 rounded-xl border cursor-pointer ${isSel ? "border-(--pm-primary) bg-(--pm-selection)" : "border-(--pm-border) bg-white hover:bg-(--pm-paper)"}`}>
                                <span className="flex items-start gap-2.5">
                                  {isDisc ? <AlertCircle className="w-5 h-5 text-(--pm-error) shrink-0 mt-0.5" aria-hidden="true" /> : <HelpCircle className="w-5 h-5 text-(--pm-warning-text) shrink-0 mt-0.5" aria-hidden="true" />}
                                  <span className="min-w-0"><span className="block text-sm font-bold leading-snug"><span className="text-(--pm-text-secondary) mr-1.5">{String(idx + 1).padStart(2, "0")}</span>{shortFindingTitle(f, invoice, reconciliation.skuSummaries, locale)}</span>
                                  <span className="block text-xs text-(--pm-text-secondary) mt-1 leading-relaxed">{human.explanation}</span></span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>

                  <section aria-label={dict.diagnosis.title} className="bg-white rounded-2xl border border-(--pm-border) p-5 sm:p-6">
                    {findings.length === 0 ? (
                      <>
                        <div className="flex items-start gap-3"><CheckCircle2 className="w-8 h-8 text-(--pm-primary) shrink-0" aria-hidden="true" /><h2 className="text-2xl font-black leading-tight">{dict.diagnosis.matchTitle}</h2></div>
                        <div className="flex flex-wrap gap-2 mt-4">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-(--pm-paper) border border-(--pm-border)"><FileText className="w-3.5 h-3.5" aria-hidden="true" /> {dict.diagnosis.invoiceLabel}: <strong>{invoice.invoice_no}</strong></span>
                          <span className="text-(--pm-text-secondary)">/</span>
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-(--pm-paper) border border-(--pm-border)"><Package className="w-3.5 h-3.5" aria-hidden="true" /> {dict.diagnosis.packingLabel}: <strong>{packingList.packing_list_no}</strong></span>
                        </div>
                        {reconciliation.skuSummaries.length > 0 && (
                          <div className="mt-6">
                            <h3 className="text-base font-bold mb-3">{dict.diagnosis.compareByProduct}</h3>
                            <div className="overflow-x-auto rounded-xl border border-(--pm-border)"><table className="w-full text-sm min-w-[520px]"><thead><tr className="bg-(--pm-selection) text-left text-xs"><th scope="col" className="py-2.5 px-3">{dict.diagnosis.colProduct}</th><th scope="col" className="py-2.5 px-3">{dict.diagnosis.colInvoiceQty}</th><th scope="col" className="py-2.5 px-3">{dict.diagnosis.colPackingQty}</th><th scope="col" className="py-2.5 px-3">{dict.diagnosis.colResult}</th></tr></thead>
                            <tbody className="divide-y divide-(--pm-border)">{reconciliation.skuSummaries.map((sm) => (<tr key={sm.sku}><td className="py-2.5 px-3 font-bold">{sm.sku}</td><td className="py-2.5 px-3">{sm.invoiceQty !== null ? `${fmtNumber.format(sm.invoiceQty)} ${sm.invoiceUnit}` : "-"}{sm.conversionFactorUsed ? <span className="block text-xs text-(--pm-text-secondary)">(1 SET = {sm.conversionFactorUsed} PCS)</span> : null}</td><td className="py-2.5 px-3">{fmtNumber.format(sm.packingTotalQty)} {sm.packingUnit}</td><td className="py-2.5 px-3"><span className="inline-flex items-center gap-1 text-(--pm-primary) font-bold text-xs"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {dict.diagnosis.matches}</span></td></tr>))}</tbody></table></div>
                          </div>
                        )}
                      </>
                    ) : selFinding && selHuman ? (
                      <>
                        <div className="flex items-start gap-3">
                          {selFinding.severity === "DISCREPANCY" ? <AlertCircle className="w-8 h-8 text-(--pm-error) shrink-0" aria-hidden="true" /> : <HelpCircle className="w-8 h-8 text-(--pm-warning-text) shrink-0" aria-hidden="true" />}
                          <div><h2 className="text-2xl font-black leading-tight">{shortFindingTitle(selFinding, invoice, reconciliation.skuSummaries, locale)}</h2>
                          {selInvLine?.description && <p className="text-sm text-(--pm-text-secondary) mt-0.5">{selInvLine.description}</p>}</div>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-4">{selFinding.origins.map((origin, i) => (<span key={`${origin}-${i}`} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-(--pm-paper) border border-(--pm-border)">{origin.startsWith("PL") ? <Package className="w-3.5 h-3.5" aria-hidden="true" /> : <FileText className="w-3.5 h-3.5" aria-hidden="true" />} {formatOriginLabel(origin, locale)}</span>))}</div>
                        <p className="mt-4 text-sm leading-relaxed">{selHuman.explanation}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
                          {selFinding.code === "INVOICE_LINE_MATH_ERROR" && selInvLine ? (<>
                            <div className="rounded-xl border border-(--pm-border) p-4"><span className="block text-sm text-(--pm-text-secondary)">{dict.diagnosis.declared}</span><strong className="text-xl">{currencyCode} {fmtCurrency.format(selInvLine.line_amount)}</strong></div>
                            <div className="rounded-xl border border-(--pm-border) p-4"><span className="block text-sm text-(--pm-text-secondary)">{dict.diagnosis.correct}</span><strong className="text-xl">{currencyCode} {fmtCurrency.format(selInvLine.qty * selInvLine.unit_price)}</strong></div>
                            <div className="rounded-xl border border-(--pm-border) p-4 flex items-center text-sm font-semibold">{fmtNumber.format(selInvLine.qty)} × {currencyCode} {fmtCurrency.format(selInvLine.unit_price)} = {currencyCode} {fmtCurrency.format(selInvLine.qty * selInvLine.unit_price)}</div>
                          </>) : selSum ? (<>
                            <div className="rounded-xl border border-(--pm-border) p-4"><span className="block text-sm text-(--pm-text-secondary)">{selSum.conversionFactorUsed ? formatTemplate(dict.diagnosis.invoiceWithFactor, { factor: selSum.conversionFactorUsed }) : dict.diagnosis.invoicePlain}</span><strong className="text-xl">{selSum.invoiceQty !== null ? `${fmtNumber.format(selComparable?.invoiceQty ?? selSum.invoiceQty)} ${selComparable?.unit ?? selSum.invoiceUnit}` : dict.diagnosis.notListed}</strong></div>
                            <div className="rounded-xl border border-(--pm-border) p-4"><span className="block text-sm text-(--pm-text-secondary)">{dict.diagnosis.packingSum}</span><strong className="text-xl">{fmtNumber.format(selSum.packingTotalQty)} {selSum.packingUnit}</strong></div>
                            {selComparable ? (<div className="rounded-xl border border-(--pm-error-border) bg-(--pm-error-bg) p-4"><span className="block text-sm text-(--pm-error)">{dict.diagnosis.difference}</span><strong className="text-xl text-(--pm-error)">{fmtNumber.format(selComparable.difference)} {selSum.packingUnit}</strong></div>) : (<div className="rounded-xl border border-(--pm-border) p-4 text-sm text-(--pm-text-secondary) flex items-center">{dict.diagnosis.notComparable}</div>)}
                          </>) : null}
                        </div>
                        {selFinding.code === "UNIT_AMBIGUITY_UNCONVERTIBLE" && selSum && (() => {
                          const draft = factorDrafts[selFinding.sku] ?? "";
                          const factor = Number(draft);
                          const valid = draft.trim() !== "" && Number.isSafeInteger(factor) && factor > 0;
                          return (
                            <div className="mt-5 rounded-xl bg-(--pm-warning-bg) border border-(--pm-warning-border) px-4 py-3 flex flex-wrap items-center gap-3">
                              <span className="text-sm font-bold">{dict.diagnosis.confirmFactor}</span>
                              <span className="text-sm font-semibold">{dict.diagnosis.oneSetIs}</span>
                              <input type="number" min={1} step={1} value={draft} aria-label={formatTemplate(dict.diagnosis.factorAria, { sku: selFinding.sku })} placeholder={dict.diagnosis.factorPlaceholder} className="w-20 px-2 py-1.5 bg-white border border-(--pm-warning-border) rounded-lg text-sm font-bold" onChange={(e) => setFactorDrafts((prev) => ({ ...prev, [selFinding.sku]: e.target.value }))} />
                              <span className="text-sm font-semibold">{dict.diagnosis.pcs}</span>
                              <button type="button" disabled={!valid} onClick={() => { if (valid) setOperatorFactorBySku(selFinding.sku, factor); }} className="btn-press px-4 py-2 rounded-lg bg-(--pm-primary) text-white text-sm font-bold cursor-pointer">{dict.diagnosis.confirmEquivalence}</button>
                            </div>
                          );
                        })()}
                        <div className="flex flex-wrap items-center justify-between gap-3 mt-6">
                          <span className="text-sm text-(--pm-text-secondary)">{formatTemplate(dict.diagnosis.evidenceOrigin, { origins: selFinding.origins.map((o) => formatOriginLabel(o, locale)).join("  /  ") })}</span>
                          <button type="button" onClick={() => { setHighlightedOrigins(selFinding.origins); setFocusFindingIdx(selIdx); goToStep(2); }} className="btn-press inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold cursor-pointer">{dict.diagnosis.viewEvidence} <ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
                        </div>
                      </>
                    ) : null}
                  </section>
                </div>
              )}
              {hasData && (<div className="flex justify-end"><button type="button" onClick={() => goToStep(2)} className="btn-press inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold cursor-pointer">{dict.diagnosis.inspectDocuments} <ArrowRight className="w-4 h-4" aria-hidden="true" /></button></div>)}
            </>
          )}

          {activeStep === 2 && (
            <>
              <div>
                {eyebrow && <p className="text-[11px] font-bold tracking-[0.18em] text-(--pm-primary)">{eyebrow}</p>}
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  <h1 className="text-3xl sm:text-4xl font-black tracking-tight">{dict.documents.title}</h1>
                  <span className="hidden sm:block w-px h-8 bg-(--pm-border)" aria-hidden="true" />
                  {focusFinding ? (<span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-error-border) bg-(--pm-error-bg) text-sm font-bold text-(--pm-error)"><AlertCircle className="w-4 h-4" aria-hidden="true" /> {shortFindingTitle(focusFinding, invoice, reconciliation.skuSummaries, locale)}</span>) : findings.length > 0 ? (<span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-error-border) bg-(--pm-error-bg) text-sm font-bold text-(--pm-error)"><AlertCircle className="w-4 h-4" aria-hidden="true" /> {dict.documents.badgeReview}</span>) : (<span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-primary) bg-(--pm-selection) text-sm font-bold text-(--pm-primary)"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {dict.documents.badgeNoDiff}</span>)}
                  <span className="text-sm text-(--pm-text-secondary)">{formatTemplate(dict.documents.findingsTotal, { count: findings.length })}</span>
                </div>
                <p className="mt-1 text-sm text-(--pm-text-secondary)">{dict.documents.hint}</p>
                {(invoice.lines.some((l) => l.bbox_estimated) || packingList.rows.some((r) => r.bbox_estimated)) && (
                  <p role="note" className="mt-2 text-sm text-(--pm-warning-text) bg-(--pm-warning-bg) border border-(--pm-warning-border) rounded-lg px-3 py-2">{dict.documents.estimatedNote}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="focus-finding" className="text-sm font-bold">{dict.documents.inspecting}</label>
                <select id="focus-finding" value={typeof focusFindingIdx === "number" && focusFindingIdx < findings.length ? String(focusFindingIdx) : "all"} onChange={(e) => { const v = e.target.value; if (v === "all") { setFocusFindingIdx("all"); setHighlightedOrigins(findings.flatMap((x) => x.origins)); } else { const i = Number(v); setFocusFindingIdx(i); setSelectedFindingIdx(i); const f = findings[i]; if (f) setHighlightedOrigins(f.origins); } }} className="h-10 px-3 rounded-lg bg-white border border-(--pm-border) text-sm font-medium cursor-pointer max-w-full">
                  <option value="all">{dict.documents.allMarks}</option>
                  {findings.map((f, i) => (<option key={`${f.code}-${f.sku}-${i}`} value={String(i)}>{formatTemplate(dict.documents.problemOption, { index: i + 1, sku: f.sku, label: shortFindingLabel(f.code, locale) })}</option>))}
                </select>
                <button type="button" onClick={() => { setFocusFindingIdx("all"); setHighlightedOrigins(findings.flatMap((x) => x.origins)); }} className="btn-press h-10 px-4 rounded-lg border border-(--pm-border) bg-white text-sm font-bold cursor-pointer">{dict.documents.showAll}</button>
                {highlightedOrigins.length > 0 && (<>
                  <span className="text-sm text-(--pm-text-secondary)">{dict.documents.findingOrigin}</span>
                  {highlightedOrigins.map((o) => (<span key={o} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-(--pm-selection) border border-(--pm-border)">{o.startsWith("PL") ? <Package className="w-3.5 h-3.5" aria-hidden="true" /> : <FileText className="w-3.5 h-3.5" aria-hidden="true" />} {formatOriginLabel(o, locale)}</span>))}
                  <button type="button" onClick={() => setHighlightedOrigins([])} className="btn-press inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border border-(--pm-border) bg-white text-sm font-bold cursor-pointer"><X className="w-4 h-4" aria-hidden="true" /> {dict.documents.clearSelection}</button>
                </>)}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <section aria-label={dict.landing.invoiceAria} className="bg-white rounded-2xl border border-(--pm-border) p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div><p className="text-[11px] font-bold tracking-widest text-(--pm-primary)"><span className="inline-block h-2 w-2 rounded-full bg-(--pm-sage) mr-1.5" aria-hidden="true" />{dict.documents.doc1}</p><h2 className="text-base font-bold">{formatTemplate(dict.documents.invoiceDoc, { no: invoice.invoice_no })}</h2></div>
                    {invoiceImgUrl.startsWith("/cases/") && <a href={invoiceImgUrl.replace(".png", ".pdf")} target="_blank" rel="noreferrer" className="btn-press inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full bg-(--pm-selection) text-(--pm-primary) border border-(--pm-border)">{dict.documents.openPdf} <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /></a>}
                  </div>
                  {invoiceImgUrl ? (
                    <div className="relative w-full overflow-hidden rounded-lg border border-(--pm-border) bg-white">
                      <img src={invoiceImgUrl} alt={formatTemplate(dict.documents.invoiceAlt, { no: invoice.invoice_no })} className="w-full block select-none" />
                      {invoice.header_bbox && (<div role="button" tabIndex={0} aria-label={dict.documents.highlightInvoiceHeader} onClick={() => setHighlightedOrigins(["INV-HEADER"])} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setHighlightedOrigins(["INV-HEADER"]); } }} style={{ top: `${invoice.header_bbox[0] / 10}%`, left: `${invoice.header_bbox[1] / 10}%`, height: `${(invoice.header_bbox[2] - invoice.header_bbox[0]) / 10}%`, width: `${(invoice.header_bbox[3] - invoice.header_bbox[1]) / 10}%` }} title={dict.documents.invoiceTotalsTitle} className={`absolute cursor-pointer rounded-sm ${highlightedOrigins.includes("INV-HEADER") ? "border-2 border-(--pm-error) bg-(--pm-highlight)/25 z-10" : "hover:bg-(--pm-primary)/10"}`}>{highlightedOrigins.includes("INV-HEADER") && <span className="absolute -top-5 left-0 bg-(--pm-error) text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">{dict.documents.invoiceTotalsBadge}</span>}</div>)}
                      {invoice.lines.map((line, idx) => { if (!line.bbox) return null; const [ymin, xmin, ymax, xmax] = line.bbox; const active = highlightedOrigins.includes(line.line_id); const summary = reconciliation.skuSummaries.find((sm) => sm.invoiceLineId === line.line_id); return (<div role="button" tabIndex={0} aria-label={formatTemplate(dict.documents.invoiceLineAria, { index: idx + 1, sku: line.sku })} key={`bbox-${line.line_id}`} onClick={() => setHighlightedOrigins([line.line_id, ...(summary?.packingRowIds || [])])} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setHighlightedOrigins([line.line_id, ...(summary?.packingRowIds || [])]); } }} style={{ top: `${ymin / 10}%`, left: `${xmin / 10}%`, height: `${(ymax - ymin) / 10}%`, width: `${(xmax - xmin) / 10}%` }} title={`${formatTemplate(dict.documents.invoiceLineTitle, { index: idx + 1, sku: line.sku, qty: line.qty, unit: line.unit })}${line.bbox_estimated ? dict.documents.estimatedSuffix : ""}`} className={`absolute cursor-pointer rounded-sm ${active ? "border-2 border-(--pm-error) bg-(--pm-highlight)/25 z-10" : "hover:bg-(--pm-primary)/10"}${line.bbox_estimated ? " border border-dashed border-(--pm-primary)/60 opacity-70" : ""}`}>{active && <span className="absolute -top-5 right-0 bg-(--pm-error) text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap max-w-[220px] truncate">{formatTemplate(dict.documents.lineBadge, { index: idx + 1, sku: line.sku, qty: line.qty, unit: line.unit })}</span>}</div>); })}
                    </div>
                  ) : (<div className="rounded-lg border border-dashed border-(--pm-border) bg-(--pm-paper) px-4 py-10 text-center"><p className="text-sm font-semibold">{dict.documents.noInvoiceImage}</p><p className="text-xs text-(--pm-text-secondary) mt-1">{dict.documents.noImageHint}</p></div>)}
                </section>

                <section aria-label={dict.landing.packingAria} className="bg-white rounded-2xl border border-(--pm-border) p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div><p className="text-[11px] font-bold tracking-widest text-(--pm-primary)"><span className="inline-block h-2 w-2 rounded-full bg-(--pm-primary) mr-1.5" aria-hidden="true" />{dict.documents.doc2}</p><h2 className="text-base font-bold">{formatTemplate(dict.documents.packingDoc, { no: packingList.packing_list_no })}</h2></div>
                    {packingImgUrl.startsWith("/cases/") && <a href={packingImgUrl.replace(".png", ".pdf")} target="_blank" rel="noreferrer" className="btn-press inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full bg-(--pm-selection) text-(--pm-primary) border border-(--pm-border)">{dict.documents.openPdf} <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /></a>}
                  </div>
                  {packingImgUrl ? (
                    <div className="relative w-full overflow-hidden rounded-lg border border-(--pm-border) bg-white">
                      <img src={packingImgUrl} alt={formatTemplate(dict.documents.packingAlt, { no: packingList.packing_list_no })} className="w-full block select-none" />
                      {packingList.header_bbox && (<div role="button" tabIndex={0} aria-label={dict.documents.highlightPackingHeader} onClick={() => setHighlightedOrigins(["PL-HEADER"])} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setHighlightedOrigins(["PL-HEADER"]); } }} style={{ top: `${packingList.header_bbox[0] / 10}%`, left: `${packingList.header_bbox[1] / 10}%`, height: `${(packingList.header_bbox[2] - packingList.header_bbox[0]) / 10}%`, width: `${(packingList.header_bbox[3] - packingList.header_bbox[1]) / 10}%` }} title={dict.documents.packingTotalsTitle} className={`absolute cursor-pointer rounded-sm ${highlightedOrigins.includes("PL-HEADER") ? "border-2 border-(--pm-error) bg-(--pm-highlight)/25 z-10" : "hover:bg-(--pm-primary)/10"}`}>{highlightedOrigins.includes("PL-HEADER") && <span className="absolute -top-5 left-0 bg-(--pm-error) text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">{dict.documents.packingTotalsBadge}</span>}</div>)}
                      {packingList.rows.map((row, idx) => { if (!row.bbox) return null; const [ymin, xmin, ymax, xmax] = row.bbox; const active = highlightedOrigins.includes(row.row_id); const summary = reconciliation.skuSummaries.find((sm) => sm.packingRowIds.includes(row.row_id)); return (<div role="button" tabIndex={0} aria-label={formatTemplate(dict.documents.packingRowAria, { index: idx + 1, sku: row.sku })} key={`bbox-${row.row_id}`} onClick={() => setHighlightedOrigins([...(summary?.invoiceLineId ? [summary.invoiceLineId] : []), ...(summary?.packingRowIds || [row.row_id])])} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setHighlightedOrigins([...(summary?.invoiceLineId ? [summary.invoiceLineId] : []), ...(summary?.packingRowIds || [row.row_id])]); } }} style={{ top: `${ymin / 10}%`, left: `${xmin / 10}%`, height: `${(ymax - ymin) / 10}%`, width: `${(xmax - xmin) / 10}%` }} title={`${formatTemplate(dict.documents.packingRowTitle, { index: idx + 1, range: row.carton_range, sku: row.sku, qty: row.total_qty, unit: row.unit })}${row.bbox_estimated ? dict.documents.estimatedSuffix : ""}`} className={`absolute cursor-pointer rounded-sm ${active ? "border-2 border-(--pm-error) bg-(--pm-highlight)/25 z-10" : "hover:bg-(--pm-primary)/10"}${row.bbox_estimated ? " border border-dashed border-(--pm-primary)/60 opacity-70" : ""}`}>{active && <span className="absolute -top-5 left-0 bg-(--pm-error) text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap max-w-[220px] truncate">{formatTemplate(dict.documents.rowBadge, { index: idx + 1, range: row.carton_range, qty: row.total_qty, unit: row.unit })}</span>}</div>); })}
                    </div>
                  ) : (<div className="rounded-lg border border-dashed border-(--pm-border) bg-(--pm-paper) px-4 py-10 text-center"><p className="text-sm font-semibold">{dict.documents.noPackingImage}</p><p className="text-xs text-(--pm-text-secondary) mt-1">{dict.documents.noImageHint}</p></div>)}
                </section>
              </div>

              {focusFinding && focusFinding.code === "QTY_MISMATCH" ? (() => {
                const sm = reconciliation.skuSummaries.find((x) => x.sku === focusFinding.sku);
                const rows = packingList.rows.filter((r) => focusFinding.origins.includes(r.row_id));
                if (!sm) return null;
                return (
                  <section aria-label={dict.documents.unitsTitle} className="bg-white rounded-2xl border border-(--pm-border) p-5 grid grid-cols-1 sm:grid-cols-4 gap-4 items-center">
                    <div className="flex items-center gap-3"><span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-(--pm-selection) text-(--pm-primary)"><Package className="w-5 h-5" aria-hidden="true" /></span><span><strong className="block">{dict.documents.unitsTitle}</strong><span className="text-sm text-(--pm-text-secondary)">{sm.sku}{selInvLine?.description ? ` · ${selInvLine.description}` : ""}</span></span></div>
                    <div><span className="block text-sm text-(--pm-text-secondary)">{dict.documents.invoiceCol}</span><strong className="text-2xl">{sm.invoiceQty !== null ? `${fmtNumber.format(sm.invoiceQty)} ${sm.invoiceUnit}` : "-"}</strong></div>
                    <div><span className="block text-sm text-(--pm-text-secondary)">{dict.documents.packingCol}</span><strong className="text-2xl">{fmtNumber.format(sm.packingTotalQty)} {sm.packingUnit}</strong>{rows.length > 1 && <span className="block text-xs text-(--pm-text-secondary)">{rows.map((r) => fmtNumber.format(r.total_qty)).join(" + ")} = {fmtNumber.format(sm.packingTotalQty)}</span>}</div>
                    <div className="rounded-xl bg-(--pm-error-bg) p-4"><span className="flex items-center gap-2 text-sm font-bold text-(--pm-error)"><AlertCircle className="w-4 h-4" aria-hidden="true" /> {dict.documents.differenceCol}</span><strong className="text-2xl text-(--pm-error)">{sm.invoiceQty !== null ? `${fmtNumber.format(sm.packingTotalQty - sm.invoiceQty)} ${sm.packingUnit}` : "-"}</strong></div>
                  </section>
                );
              })() : (
                <section aria-label={dict.documents.selectedCompare} className="bg-white rounded-2xl border border-(--pm-border) p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h2 className="text-lg font-bold">{dict.documents.selectedCompare}</h2>
                    <div className="flex flex-wrap gap-4 text-sm"><span><span className="text-(--pm-text-secondary) block text-xs">{dict.documents.totalInvoiced}</span><strong>{currencyCode} {fmtCurrency.format(reconciliation.computedTotals.invoiceLinesSumAmount)}</strong></span><span><span className="text-(--pm-text-secondary) block text-xs">{dict.documents.cartons}</span><strong>{formatTemplate(dict.diagnosis.cartonsUnit, { count: fmtNumber.format(reconciliation.computedTotals.packingCalculatedCartons) })}</strong></span><span><span className="text-(--pm-text-secondary) block text-xs">{dict.documents.netGross}</span><strong>{formatTemplate(dict.diagnosis.weightUnit, { net: fmtNumber.format(reconciliation.computedTotals.packingCalculatedNetKg), gross: fmtNumber.format(reconciliation.computedTotals.packingCalculatedGrossKg) })}</strong></span></div>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-(--pm-border)"><table className="w-full text-sm min-w-[760px]"><thead><tr className="bg-(--pm-selection) text-left text-xs"><th scope="col" className="py-2.5 px-3">{dict.documents.colLine}</th><th scope="col" className="py-2.5 px-3">{dict.documents.colSku}</th><th scope="col" className="py-2.5 px-3">{dict.documents.colDescription}</th><th scope="col" className="py-2.5 px-3">{dict.documents.colQty}</th><th scope="col" className="py-2.5 px-3">{dict.documents.colUnitPrice}</th><th scope="col" className="py-2.5 px-3">{dict.documents.colDeclared}</th><th scope="col" className="py-2.5 px-3">{dict.documents.colCorrect}</th><th scope="col" className="py-2.5 px-3">{dict.documents.colStatus}</th></tr></thead>
                  <tbody className="divide-y divide-(--pm-border)">{invoice.lines.map((line, idx) => { const correct = line.qty * line.unit_price; const ok = Math.abs(correct - line.line_amount) < 0.005; const active = highlightedOrigins.includes(line.line_id); return (<tr key={line.line_id} className={active && !ok ? "bg-(--pm-error-bg)" : ""}><td className="py-2.5 px-3">{idx + 1}</td><td className="py-2.5 px-3 font-bold">{line.sku}</td><td className="py-2.5 px-3">{line.description || "-"}</td><td className="py-2.5 px-3">{fmtNumber.format(line.qty)} {line.unit}</td><td className="py-2.5 px-3">{currencyCode} {fmtCurrency.format(line.unit_price)}</td><td className="py-2.5 px-3">{currencyCode} {fmtCurrency.format(line.line_amount)}</td><td className="py-2.5 px-3">{currencyCode} {fmtCurrency.format(correct)}</td><td className="py-2.5 px-3">{ok ? <span className="inline-flex items-center gap-1 text-xs font-bold text-(--pm-primary)"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {dict.documents.amountOk}</span> : <span className="inline-flex items-center gap-1 text-xs font-bold text-(--pm-error)"><AlertCircle className="w-4 h-4" aria-hidden="true" /> {dict.documents.amountBad}</span>}</td></tr>); })}{invoice.lines.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-(--pm-text-secondary)">{dict.documents.noInvoiceLines}</td></tr>}</tbody></table></div>
                </section>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={() => goToStep(1)} className="btn-press inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-(--pm-border) bg-white text-sm font-bold cursor-pointer"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> {dict.documents.backToDiagnosis}</button>
                <button type="button" onClick={() => goToStep(3)} className="btn-press inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold cursor-pointer">{dict.documents.goToMatrix} <ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
              </div>
            </>
          )}

          {activeStep === 3 && (
            <>
              <div>
                {eyebrow && <p className="text-[11px] font-bold tracking-[0.18em] text-(--pm-primary)">{eyebrow}</p>}
                <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
                  <div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl sm:text-4xl font-black tracking-tight">{dict.matrix.title}</h1>
                  {findings.length > 0 && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-error-border) bg-(--pm-error-bg) text-sm font-bold text-(--pm-error)"><AlertCircle className="w-4 h-4" aria-hidden="true" /> {dict.matrix.badgeReview}</span>}</div>
                  <div role="group" aria-label={dict.matrix.filterLabel} className="flex rounded-full border border-(--pm-border) bg-white overflow-hidden">
                    {([["all", formatTemplate(dict.matrix.all, { count: totalSkus })], ["disc", formatTemplate(dict.matrix.disc, { count: discrepantSkus + ambiguousSkus })], ["match", formatTemplate(dict.matrix.match, { count: matchedSkus })]] as const).map(([key, label]) => (
                      <button key={key} type="button" aria-pressed={matrixFilter === key} onClick={() => setMatrixFilter(key)} className={`btn-press px-4 py-2 text-sm font-bold cursor-pointer ${matrixFilter === key ? "bg-(--pm-ink) text-white" : "text-(--pm-text-secondary) hover:bg-(--pm-selection)"}`}>{label}</button>
                    ))}
                  </div>
                </div>
                <p className="mt-1 text-sm text-(--pm-text-secondary)">{dict.matrix.hint}</p>
              </div>

              <div className="bg-white rounded-2xl border border-(--pm-border) px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-2"><Package className="w-5 h-5 text-(--pm-primary)" aria-hidden="true" /> {dict.matrix.products} <strong>{totalSkus}</strong></span>
                <span className="hidden sm:block w-px h-6 bg-(--pm-border)" aria-hidden="true" />
                <span className="inline-flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-(--pm-primary)" aria-hidden="true" /> {dict.matrix.matched} <strong>{matchedSkus}</strong></span>
                <span className="hidden sm:block w-px h-6 bg-(--pm-border)" aria-hidden="true" />
                <span className="inline-flex items-center gap-2"><AlertCircle className="w-5 h-5 text-(--pm-error)" aria-hidden="true" /> {dict.matrix.diff} <strong>{discrepantSkus + ambiguousSkus}</strong></span>
              </div>

              <section aria-label={dict.matrix.compareTitle} className="bg-white rounded-2xl border border-(--pm-border) p-5">
                <h2 className="text-lg font-bold mb-4">{dict.matrix.compareTitle}</h2>
                <div className="overflow-x-auto rounded-xl border border-(--pm-border)">
                  <table className="w-full text-left text-sm min-w-[820px]">
                    <caption className="sr-only">{dict.matrix.caption}</caption>
                    <thead><tr className="bg-(--pm-selection) text-xs text-(--pm-ink)"><th scope="col" className="py-3 px-4">{dict.matrix.colProduct}</th><th scope="col" className="py-3 px-4">{dict.matrix.colDescription}</th><th scope="col" className="py-3 px-4">{dict.matrix.colInvoiced}</th><th scope="col" className="py-3 px-4">{dict.matrix.colPacked}</th><th scope="col" className="py-3 px-4">{dict.matrix.colDiff}</th><th scope="col" className="py-3 px-4">{dict.matrix.colStatus}</th></tr></thead>
                    <tbody className="divide-y divide-(--pm-border)">
                      {reconciliation.skuSummaries.filter((sm) => matrixFilter === "all" ? true : matrixFilter === "match" ? sm.status === "MATCHED" : sm.status !== "MATCHED").map((sm) => {
                        const invLine = invoice.lines.find((l) => l.line_id === sm.invoiceLineId);
                        const effInvQty = comparableQuantities(sm)?.invoiceQty ?? null;
                        const qtyDiff = effInvQty === null ? null : sm.packingTotalQty - effInvQty;
                        const isHighlighted = (sm.invoiceLineId && highlightedOrigins.includes(sm.invoiceLineId)) || sm.packingRowIds.some((r) => highlightedOrigins.includes(r));
                        const otherFinding = sm.status === "MATCHED" ? findings.find((f) => f.sku === sm.sku) : undefined;
                        return (
                          <tr key={`${sm.sku}-${sm.invoiceLineId}`} onClick={() => setHighlightedOrigins([...(sm.invoiceLineId ? [sm.invoiceLineId] : []), ...sm.packingRowIds])} className={`cursor-pointer ${qtyDiff !== null && qtyDiff !== 0 ? "bg-(--pm-error-bg)/60" : ""} ${isHighlighted ? "bg-(--pm-selection)/60" : "hover:bg-(--pm-paper)"}`}>
                            <td className="py-4 px-4"><span className="block font-black">{sm.sku}</span><span className="block text-xs text-(--pm-text-secondary) mt-0.5">{sm.invoiceLineId ? formatOriginLabel(sm.invoiceLineId, locale) : dict.matrix.notInInvoice} ↔ {sm.packingRowIds.length > 0 ? sm.packingRowIds.map((r) => formatOriginLabel(r, locale)).join(", ") : dict.matrix.noBoxes}</span></td>
                            <td className="py-4 px-4">{invLine?.description || "-"}</td>
                            <td className="py-4 px-4 whitespace-nowrap"><strong>{sm.invoiceQty !== null ? fmtNumber.format(sm.invoiceQty) : "-"}</strong> {sm.invoiceUnit}{sm.conversionFactorUsed && <span className="block text-xs text-(--pm-primary)">{formatTemplate(dict.matrix.factorNote, { factor: sm.conversionFactorUsed, qty: fmtNumber.format(effInvQty ?? 0), unit: sm.packingUnit ?? "" })}</span>}</td>
                            <td className="py-4 px-4 whitespace-nowrap"><strong>{fmtNumber.format(sm.packingTotalQty)}</strong> {sm.packingUnit}</td>
                            <td className="py-4 px-4 whitespace-nowrap">{qtyDiff === null ? <span className="text-(--pm-text-secondary)">-</span> : qtyDiff === 0 ? <span className="inline-flex px-3 py-1 rounded-full bg-(--pm-selection) text-(--pm-primary) font-bold text-xs">0</span> : <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-(--pm-error-bg) text-(--pm-error) font-bold text-xs"><span className="h-2 w-2 rounded-full bg-(--pm-error)" aria-hidden="true" />{qtyDiff > 0 ? "+" : ""}{fmtNumber.format(qtyDiff)} {sm.packingUnit}</span>}</td>
                            <td className="py-4 px-4">{sm.status === "MATCHED" ? <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-(--pm-selection) text-(--pm-primary) font-bold text-xs"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {dict.matrix.qtyMatch}</span> : sm.status === "DISCREPANCY" ? <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-(--pm-error-bg) text-(--pm-error) font-bold text-xs"><AlertCircle className="w-4 h-4" aria-hidden="true" /> {dict.matrix.qtyDiff}</span> : <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-(--pm-warning-bg) text-(--pm-warning-text) font-bold text-xs"><HelpCircle className="w-4 h-4" aria-hidden="true" /> {dict.matrix.toConfirm}</span>}{otherFinding && <span className="flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-full bg-(--pm-warning-bg) text-(--pm-warning-text) font-bold text-xs w-fit"><AlertCircle className="w-3.5 h-3.5" aria-hidden="true" /> {formatTemplate(dict.matrix.otherFinding, { label: shortFindingLabel(otherFinding.code, locale).toLowerCase() })}</span>}</td>
                          </tr>
                        );
                      })}
                      {reconciliation.skuSummaries.length === 0 && <tr><td colSpan={6} className="py-8 px-4 text-center text-(--pm-text-secondary)">{dict.matrix.noProducts}</td></tr>}
                      {reconciliation.skuSummaries.length > 0 && reconciliation.skuSummaries.filter((sm) => matrixFilter === "all" ? true : matrixFilter === "match" ? sm.status === "MATCHED" : sm.status !== "MATCHED").length === 0 && <tr><td colSpan={6} className="py-8 px-4 text-center text-(--pm-text-secondary)">{dict.matrix.noFilterMatch}</td></tr>}
                    </tbody>
                  </table>
                </div>
                <p className="mt-4 flex items-start gap-2 text-sm text-(--pm-text-secondary)"><Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> {dict.matrix.note}</p>
              </section>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={() => goToStep(2)} className="btn-press inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-(--pm-border) bg-white text-sm font-bold cursor-pointer"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> {dict.matrix.backToDocs}</button>
                <button type="button" onClick={() => goToStep(4)} className="btn-press inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold cursor-pointer">{dict.matrix.goToMemo} <ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
              </div>
            </>
          )}

          {activeStep === 4 && (
            <>
              {showEditableTables ? (
                <>
                  <div>
                    <p className="text-[11px] font-bold tracking-[0.18em] text-(--pm-primary)">{isWorkspaceEmpty ? dict.capture.eyebrowData : dict.capture.eyebrowSim}</p>
                    <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
                      <h1 className="text-3xl sm:text-4xl font-black tracking-tight">{isWorkspaceEmpty ? dict.capture.titleManual : dict.capture.titleSim}</h1>
                      {!hasData && <span className="px-3 py-1.5 rounded-full border border-(--pm-border) bg-white text-sm font-bold text-(--pm-text-secondary)">{dict.capture.badgeNoData}</span>}
                    </div>
                    <p className="mt-1 text-sm text-(--pm-text-secondary)">{isWorkspaceEmpty ? dict.capture.hintEmpty : dict.capture.hintSim}</p>
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5 items-start">
                    {editableTables}
                    <PackMatchMemo supplierMemo={supplierMemo} canExport={canExport} memoLang={memoLang} onLangChange={setMemoLang} copiedMemo={copiedMemo} onCopy={handleCopyMemo} onDownload={handleDownloadCsv} compact={true} />
                  </div>
                  {hasData && findings.length > 0 && (<div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-(--pm-error-bg) border border-(--pm-error-border) px-5 py-3 text-sm"><span className="inline-flex items-center gap-2 font-bold text-(--pm-error)"><AlertCircle className="w-5 h-5" aria-hidden="true" /> {formatTemplate(dict.capture.findingsAlert, { count: findings.length, plural: pluralS(findings.length) })}</span><span className="text-(--pm-text-secondary)">{findings.map((f) => shortFindingTitle(f, invoice, reconciliation.skuSummaries, locale)).join(" · ")}</span></div>)}
                  <div className="flex justify-start"><button type="button" onClick={() => goToStep(1)} className="btn-press inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-(--pm-primary) bg-white text-(--pm-primary) text-sm font-bold cursor-pointer"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> {dict.capture.backToDiagnosis}</button></div>
                </>
              ) : (
                <>
                  <div>
                    {eyebrow && <p className="text-[11px] font-bold tracking-[0.18em] text-(--pm-primary)">{eyebrow}</p>}
                    <div className="flex flex-wrap items-center gap-3 mt-1">
                      <h1 className="text-3xl sm:text-4xl font-black tracking-tight">{dict.memoStep.title}</h1>
                      <span className="hidden sm:block w-px h-8 bg-(--pm-border)" aria-hidden="true" />
                      {discrepanciesCount > 0 && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-error-border) bg-(--pm-error-bg) text-sm font-bold text-(--pm-error)"><AlertCircle className="w-4 h-4" aria-hidden="true" /> {formatTemplate(dict.memoStep.discrepancies, { count: discrepanciesCount, plural: discPlural })}</span>}
                      {ambiguitiesCount > 0 && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-warning-border) bg-(--pm-warning-bg) text-sm font-bold text-(--pm-warning-text)"><HelpCircle className="w-4 h-4" aria-hidden="true" /> {dict.memoStep.needsReview}</span>}
                      <span className="ml-auto hidden lg:inline-block text-[11px] font-bold tracking-widest px-3 py-1.5 rounded-full bg-(--pm-selection) text-(--pm-primary) border border-(--pm-border)">{dict.memoStep.badge}</span>
                    </div>
                    <p className="mt-1 text-sm text-(--pm-text-secondary)">{dict.memoStep.hint}</p>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5 items-start">
                    <section aria-label={dict.memoStep.memoAria} className="bg-white rounded-2xl border border-(--pm-border) p-5 sm:p-6">
                      <div className="flex items-center justify-between gap-3 pb-4 border-b border-(--pm-border)"><BrandLogo size="sm" theme="light" /><span className="text-[11px] font-bold tracking-widest px-3 py-1.5 rounded-full bg-(--pm-selection) text-(--pm-primary) border border-(--pm-border)">{dict.memoStep.badge}</span></div>
                      {hasData ? <pre lang={memoLang} title={formatTemplate(dict.memoStep.memoLangNote, { lang: memoLang })} className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-(--pm-ink)">{supplierMemo}</pre> : <div className="mt-4 rounded-xl border border-dashed border-(--pm-border) bg-(--pm-paper) px-4 py-12 text-center text-sm text-(--pm-text-secondary)">{dict.memoStep.empty}</div>}
                    </section>
                    <div className="flex flex-col gap-4">
                      <div role="group" aria-label={dict.memoStep.langGroup} className="flex rounded-full border border-(--pm-border) bg-white p-1 w-fit">
                        <button type="button" aria-pressed={memoLang === "es"} onClick={() => setMemoLang("es")} className={`btn-press px-4 py-2 rounded-full text-sm font-bold cursor-pointer ${memoLang === "es" ? "bg-(--pm-ink) text-white" : "text-(--pm-text-secondary)"}`}>{dict.memoStep.spanishNote}</button>
                        <button type="button" aria-pressed={memoLang === "en"} onClick={() => setMemoLang("en")} className={`btn-press px-4 py-2 rounded-full text-sm font-bold cursor-pointer ${memoLang === "en" ? "bg-(--pm-ink) text-white" : "text-(--pm-text-secondary)"}`}>{dict.memoStep.englishNote}</button>
                      </div>
                      <section aria-label={dict.memoStep.referenceAria} className="bg-white rounded-2xl border border-(--pm-border) p-5">
                        <h2 className="text-base font-bold mb-3">{dict.memoStep.reference}</h2>
                        <dl className="flex flex-col gap-2 text-sm">
                          <div className="flex items-center justify-between gap-3 rounded-lg bg-(--pm-paper) px-3 py-2"><dt className="inline-flex items-center gap-2 text-(--pm-text-secondary)"><FileText className="w-4 h-4" aria-hidden="true" /> {dict.memoStep.invoice}</dt><dd className="font-bold">{invoice.invoice_no}</dd></div>
                          <div className="flex items-center justify-between gap-3 rounded-lg bg-(--pm-paper) px-3 py-2"><dt className="inline-flex items-center gap-2 text-(--pm-text-secondary)"><Package className="w-4 h-4" aria-hidden="true" /> {dict.memoStep.packingList}</dt><dd className="font-bold">{packingList.packing_list_no}</dd></div>
                        </dl>
                      </section>
                      <section aria-label={dict.memoStep.findingsAria} className="bg-white rounded-2xl border border-(--pm-border) p-5">
                        <h2 className="text-base font-bold mb-3">{formatTemplate(dict.memoStep.findings, { count: findings.length })}</h2>
                        {findings.length === 0 ? <p className="text-sm text-(--pm-text-secondary)">{hasData ? dict.memoStep.noDiff : dict.memoStep.noData}</p> : (
                          <ul className="flex flex-col gap-2">{findings.map((f, i) => (<li key={`${f.code}-${f.sku}-${i}`} className={`rounded-xl border p-3 flex gap-2.5 ${f.severity === "DISCREPANCY" ? "bg-(--pm-error-bg) border-(--pm-error-border)" : "bg-(--pm-warning-bg) border-(--pm-warning-border)"}`}>{f.severity === "DISCREPANCY" ? <AlertCircle className="w-5 h-5 text-(--pm-error) shrink-0" aria-hidden="true" /> : <HelpCircle className="w-5 h-5 text-(--pm-warning-text) shrink-0" aria-hidden="true" />}<span><strong className="block text-sm">{shortFindingTitle(f, invoice, reconciliation.skuSummaries, locale)}</strong><span className="block text-xs text-(--pm-text-secondary) mt-0.5">{f.origins.join(", ")}</span></span></li>))}</ul>
                        )}
                      </section>
                      <div className="flex flex-wrap gap-3">
                        <button type="button" onClick={handleCopyMemo} disabled={!canExport} className="btn-press flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"><Copy className="w-4 h-4" aria-hidden="true" /> {copiedMemo ? dict.memoStep.copied : dict.memoStep.copy}</button>
                        <button type="button" onClick={handleDownloadCsv} disabled={!canExport} className="btn-press flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-(--pm-border) bg-white text-sm font-bold disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"><Download className="w-4 h-4" aria-hidden="true" /> {dict.memoStep.downloadCsv}</button>
                      </div>
                    </div>
                  </div>

                  <section aria-label={dict.memoStep.simAria} className="bg-white rounded-2xl border border-(--pm-border)">
                    <button type="button" aria-expanded={showEditableTables} onClick={() => setShowEditableTables((v) => !v)} className="btn-press w-full flex flex-wrap items-center gap-3 px-5 py-4 text-left cursor-pointer">
                      <ChevronDown className={`w-5 h-5 transition-transform ${showEditableTables ? "rotate-180" : ""}`} aria-hidden="true" />
                      <span><strong className="block text-sm">{dict.memoStep.simTitle}</strong><span className="text-xs text-(--pm-text-secondary)">{dict.memoStep.simHint}</span></span>
                    </button>
                  </section>
                  <div><button type="button" onClick={() => goToStep(1)} className="btn-press inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-(--pm-border) bg-white text-sm font-bold cursor-pointer"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> {dict.memoStep.backToDiagnosis}</button></div>
                </>
              )}
            </>
          )}
        </main>
      )}

      <footer className={`mt-auto border-t px-4 sm:px-6 py-4 ${shipmentMode === "empty" ? "border-(--pm-dark-border) text-(--pm-dark-secondary)" : "border-(--pm-border) text-(--pm-text-secondary)"}`}>
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>PackMatch</span>
          <span>{dict.footer.evidence}</span>
          {shipmentMode === "empty" && <span className="hidden sm:block">{dict.footer.hubHint}</span>}
        </div>
      </footer>

      {showPasteModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="paste-modal-title" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-(--pm-ink)/80" onClick={() => setShowPasteModal(false)}>
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-(--pm-dark-surface) border border-(--pm-dark-border) rounded-2xl shadow-2xl overflow-hidden text-(--pm-paper)" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 flex items-start justify-between gap-4">
              <div><p className="text-[11px] font-bold tracking-[0.2em] text-(--pm-sage)">{dict.pasteModal.eyebrow}</p><h2 id="paste-modal-title" className="text-2xl sm:text-3xl font-black mt-1">{dict.pasteModal.title}</h2><p className="text-sm text-(--pm-dark-secondary) mt-1">{dict.pasteModal.hint}</p></div>
              <button type="button" onClick={() => setShowPasteModal(false)} aria-label={dict.pasteModal.close} className="btn-press p-2 rounded-full hover:bg-(--pm-dark-border) cursor-pointer shrink-0"><X className="w-5 h-5" aria-hidden="true" /></button>
            </div>
            <div className="px-6 pb-4 overflow-y-auto grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
              <div className="rounded-xl border border-(--pm-dark-border) bg-(--pm-dark-inset) p-4">
                <div className="flex items-center gap-3 mb-3"><span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-(--pm-dark-raised) text-(--pm-sage)"><FileText className="w-5 h-5" aria-hidden="true" /></span><span><span className="text-xs text-(--pm-dark-secondary) mr-2">01</span><strong>{dict.landing.dropInvoiceTitle}</strong><span className="block text-xs text-(--pm-dark-secondary) mt-0.5">{dict.pasteModal.invoiceFormat}</span></span></div>
                <label htmlFor="paste-invoice" className="sr-only">{dict.pasteModal.invoiceLines}</label>
                <textarea id="paste-invoice" autoFocus value={pasteInvoiceText} onChange={(e) => setPasteInvoiceText(e.target.value)} rows={8} placeholder={dict.pasteModal.invoicePlaceholder} className="w-full p-3 rounded-lg bg-(--pm-ink) border border-dashed border-(--pm-dark-dashed) text-sm text-(--pm-paper) placeholder:text-(--pm-dark-secondary)" />
              </div>
              <span className="hidden md:flex items-center text-(--pm-sage) text-2xl" aria-hidden="true">==</span>
              <div className="rounded-xl border border-(--pm-dark-border) bg-(--pm-dark-inset) p-4">
                <div className="flex items-center gap-3 mb-3"><span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-(--pm-dark-raised) text-(--pm-sage)"><Package className="w-5 h-5" aria-hidden="true" /></span><span><span className="text-xs text-(--pm-dark-secondary) mr-2">02</span><strong>{dict.landing.dropPackingTitle}</strong><span className="block text-xs text-(--pm-dark-secondary) mt-0.5">{dict.pasteModal.packingFormat}</span></span></div>
                <label htmlFor="paste-packing" className="sr-only">{dict.pasteModal.packingLines}</label>
                <textarea id="paste-packing" value={pastePackingText} onChange={(e) => setPastePackingText(e.target.value)} rows={8} placeholder={dict.pasteModal.packingPlaceholder} className="w-full p-3 rounded-lg bg-(--pm-ink) border border-dashed border-(--pm-dark-dashed) text-sm text-(--pm-paper) placeholder:text-(--pm-dark-secondary)" />
              </div>
            </div>
            {pasteError && <div role="alert" className="mx-6 mb-3 px-4 py-2.5 rounded-lg bg-(--pm-error-bg) text-sm text-(--pm-error) font-medium">{pasteError}</div>}
            <div className="px-6 py-4 border-t border-(--pm-dark-border) flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-(--pm-dark-secondary)">{dict.pasteModal.separators}</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => setShowPasteModal(false)} className="btn-press px-5 py-2.5 rounded-full border border-(--pm-paper)/50 text-sm font-bold cursor-pointer">{dict.pasteModal.cancel}</button>
                <button type="button" onClick={handleImportPastedCells} className="btn-press px-6 py-2.5 rounded-full bg-(--pm-sage) text-(--pm-ink) text-sm font-black cursor-pointer">{dict.pasteModal.cross}</button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PackMatchWorkbenchPage() {
  return (
    <UiLocaleProvider>
      <PackMatchWorkbench />
    </UiLocaleProvider>
  );
}
