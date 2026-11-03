"use client";

import { parseInvoicePaste, parsePackingPaste } from "@/lib/paste-import";
import { workspaceIssues } from "@/lib/workspace-validation";
import { comparableQuantities } from "@/lib/reconcile-presentation";
import React, { useState, useMemo, useEffect } from "react";
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
import { isPdfFile, pdfFirstPageToPngDataUrl } from "@/lib/pdf-to-image";
import {
  Plus, RotateCcw, FileText, Package, ArrowRight, ArrowLeft, X, Copy, Download,
  AlertCircle, CheckCircle2, HelpCircle, Trash2, ChevronDown, ExternalLink, Info, Weight,
} from "lucide-react";

/* ==========================================================================
   Formato numérico + etiquetas humanas (preservados de la versión anterior)
   ========================================================================== */

function formatEs(value: number, minDec: number, maxDec: number): string {
  const fixed = Math.abs(value).toFixed(maxDec);
  const [intPart, decRaw = ""] = fixed.split(".");
  let dec = decRaw.replace(/0+$/, "");
  while (dec.length < minDec) dec += "0";
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${value < 0 ? "-" : ""}${grouped}${dec ? `,${dec}` : ""}`;
}

const fmtCurrency = { format: (v: number) => formatEs(v, 2, 2) };
const fmtNumber = { format: (v: number) => formatEs(v, 0, 2) };

function formatNowTime(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

const HUMAN_CASE_LABELS: Record<
  string,
  { number: string; name: string; summary: string }
> = {
  C01_correcto_asimetrico: {
    number: "Ejemplo 1",
    name: "Todo coincide",
    summary: "3 productos repartidos en 5 cajas sin errores",
  },
  C02_discrepancia_cantidad_y_subtotal: {
    number: "Ejemplo 2",
    name: "Faltan unidades y mal sumado",
    summary: "En las cajas vienen menos piezas de las que cobran",
  },
  C03_discrepancia_pesos_y_lbs: {
    number: "Ejemplo 3",
    name: "Error en pesos de cajas",
    summary: "Una caja llena figura pesando menos que el producto suelto",
  },
  C04_ambiguo_pcs_sets_sin_factor: {
    number: "Ejemplo 4",
    name: "Kits vs. Piezas sueltas",
    summary: "Cobran por Sets pero el almacén contó piezas sin indicar equivalencia",
  },
  C05_ambiguo_sku_alias_y_muestra_no_declarada: {
    number: "Ejemplo 5",
    name: "Caja extra no declarada",
    summary: "Metieron muestras gratis en una caja que no figuran en la factura",
  },
  C06_denso_celdas_combinadas_y_escaneo: {
    number: "Ejemplo 6",
    name: "Carga en varios palets",
    summary: "6 productos repartidos en 11 filas con faltante y duda de Kits",
  },
  C07_formato_real_sin_ids: {
    number: "Ejemplo 7",
    name: "Factura estándar de fábrica",
    summary: "Formato comercial clásico con faltante en cajas y Kits por confirmar",
  },
};

function humanLabelFor(caseId: string): {
  number: string;
  name: string;
  summary: string;
} {
  const found = PRELOADED_CASES.find((c) => c.case_id === caseId);
  return (
    HUMAN_CASE_LABELS[caseId] || {
      number: caseId.split("_")[0],
      name: found?.title ?? caseId,
      summary: found?.subtitle ?? "",
    }
  );
}

function shortCaseCode(caseId: string): string {
  const m = caseId.match(/^C(\d+)/);
  if (m) return `C${String(Number(m[1])).padStart(2, "0")}`;
  return caseId.split("_")[0];
}

/** Etiqueta corta del tipo de hallazgo para el selector de enfoque (Fase 2). */
function shortFindingLabel(code: Finding["code"]): string {
  switch (code) {
    case "QTY_MISMATCH":
      return "Faltante / sobrante";
    case "UNIT_AMBIGUITY_UNCONVERTIBLE":
      return "Kits sin equivalencia";
    case "INVOICE_LINE_MATH_ERROR":
      return "Error de multiplicación";
    case "WEIGHT_LOGIC_VIOLATION":
      return "Peso imposible";
    case "TOTAL_GROSS_WEIGHT_MISMATCH":
      return "Descuadre de peso total";
    case "SKU_IDENTIFIER_AMBIGUITY":
      return "Código distinto";
    case "UNDECLARED_ITEM_IN_PACKING_LIST":
      return "No declarado en factura";
    case "MISSING_ITEM_IN_PACKING_LIST":
      return "Ausente en cajas";
    case "CARTON_COUNT_MISMATCH":
      return "Descuadre de bultos";
    case "PACKING_ROW_MATH_ERROR":
      return "Error cajas × unidades";
    default:
      return "Observación";
  }
}

function formatOriginLabel(origin: string): string {
  if (origin === "INV-HEADER") return "Totales de Factura";
  if (origin === "PL-HEADER") return "Totales de Lista de Empaque";
  if (origin.startsWith("INV-L")) {
    return `Factura Línea ${origin.replace("INV-L", "")}`;
  }
  if (origin.startsWith("PL-R")) {
    return `Empaque Fila ${origin.replace("PL-R", "")}`;
  }
  return origin;
}


function shortFindingTitle(f: Finding, invoice: InvoiceData, skuSummaries: SkuReconciliationSummary[]): string {
  const sum = skuSummaries.find((x) => x.sku === f.sku);
  const invLine = invoice.lines.find((l) => l.sku === f.sku);
  switch (f.code) {
    case "QTY_MISMATCH": {
      const inv = comparableQuantities(sum)?.invoiceQty ?? sum?.invoiceQty ?? invLine?.qty ?? 0;
      const pl = sum?.packingTotalQty ?? 0;
      const d = Math.abs(pl - inv);
      return pl < inv ? `Faltan ${fmtNumber.format(d)} unidades \u00b7 ${f.sku}` : `Sobran ${fmtNumber.format(d)} unidades \u00b7 ${f.sku}`;
    }
    case "INVOICE_LINE_MATH_ERROR": return `Importe incorrecto \u00b7 ${f.sku}`;
    case "WEIGHT_LOGIC_VIOLATION": return `Peso bruto menor que neto \u00b7 ${f.sku}`;
    case "TOTAL_GROSS_WEIGHT_MISMATCH": return "Diferencia de peso total";
    case "UNIT_AMBIGUITY_UNCONVERTIBLE": return `Equivalencia de sets pendiente \u00b7 ${f.sku}`;
    case "SKU_IDENTIFIER_AMBIGUITY": return `Alias pendiente \u00b7 ${f.sku}`;
    case "UNDECLARED_ITEM_IN_PACKING_LIST": return `Producto no declarado \u00b7 ${f.sku}`;
    case "MISSING_ITEM_IN_PACKING_LIST": return `Ausente en empaque \u00b7 ${f.sku}`;
    case "CARTON_COUNT_MISMATCH": return "Descuadre de bultos";
    case "PACKING_ROW_MATH_ERROR": return `Error cajas \u00d7 unidades \u00b7 ${f.sku}`;
    default: return `Observaci\u00f3n \u00b7 ${f.sku}`;
  }
}

function describeFindingInPlainSpanish(
  f: Finding,
  invoice: InvoiceData,
  packingList: PackingListData,
  skuSummaries: SkuReconciliationSummary[]
): { title: string; explanation: string; locationPills: string[] } {
  const locationPills = f.origins.map(formatOriginLabel);
  const skuSum = skuSummaries.find((s) => s.sku === f.sku);
  const invLine = invoice.lines.find((l) => l.sku === f.sku);
  const plRows = packingList.rows.filter((r) => f.origins.includes(r.row_id));
  const prodDesc = invLine?.description ? ` (${invLine.description})` : "";

  switch (f.code) {
    case "QTY_MISMATCH": {
      const invQty = comparableQuantities(skuSum)?.invoiceQty ?? skuSum?.invoiceQty ?? invLine?.qty ?? 0;
      const plQty = skuSum?.packingTotalQty ?? 0;
      const diff = plQty - invQty;
      const absDiff = Math.abs(diff);
      const breakdown =
        plRows.length > 1
          ? ` (${plRows.map((r) => `${r.total_qty} en ${r.carton_range}`).join(" + ")})`
          : plRows.length === 1
            ? ` (en ${plRows[0].carton_range})`
            : "";
      return {
        title:
          diff < 0
            ? `Faltan ${fmtNumber.format(absDiff)} unidades del producto ${f.sku} en las cajas`
            : `Vienen ${fmtNumber.format(absDiff)} unidades de más del producto ${f.sku} en las cajas`,
        explanation: `En la Factura te cobran ${fmtNumber.format(invQty)} unidades de ${f.sku}${prodDesc}, pero al sumar las cajas de la Lista de Empaque${breakdown} aparecen ${fmtNumber.format(plQty)} unidades.${skuSum?.conversionFactorUsed ? ` Equivalencia aplicada: 1 SET = ${skuSum.conversionFactorUsed} PCS.` : ""}`,
        locationPills,
      };
    }
    case "UNIT_AMBIGUITY_UNCONVERTIBLE": {
      const invQty = invLine?.qty ?? skuSum?.invoiceQty ?? 0;
      const plQty = skuSum?.packingTotalQty ?? 0;
      return {
        title: `No se sabe cuántas piezas trae cada Kit/Set del producto ${f.sku}`,
        explanation: `La Factura cobra ${fmtNumber.format(invQty)} Sets/Kits${prodDesc}, mientras que el almacén contó ${fmtNumber.format(plQty)} piezas sueltas en las cajas. Como ningún documento indica cuántas piezas vienen dentro de cada Set, no es seguro adivinarlo.`,
        locationPills,
      };
    }
    case "INVOICE_LINE_MATH_ERROR": {
      const qty = invLine?.qty ?? 0;
      const price = invLine?.unit_price ?? 0;
      const declared = invLine?.line_amount ?? 0;
      const expected = qty * price;
      return {
        title: `Error de multiplicación en el cobro del producto ${f.sku}`,
        explanation: `En la Factura multiplicaron ${fmtNumber.format(qty)} unidades × $${fmtCurrency.format(price)} y anotaron $${fmtCurrency.format(declared)}, pero el resultado correcto es $${fmtCurrency.format(expected)}.`,
        locationPills,
      };
    }
    case "WEIGHT_LOGIC_VIOLATION": {
      return {
        title: `Peso imposible en ${f.sku}: la caja llena figura pesando menos que el producto sin caja`,
        explanation: `En la Lista de Empaque anotaron un Peso Bruto (con caja) menor que el Peso Neto (solo producto). Esto provoca rechazo automático en el sistema de Aduana.`,
        locationPills,
      };
    }
    case "TOTAL_GROSS_WEIGHT_MISMATCH": {
      return {
        title: `La suma del peso de las cajas no coincide con el peso total declarado`,
        explanation: f.detail,
        locationPills,
      };
    }
    case "SKU_IDENTIFIER_AMBIGUITY": {
      return {
        title: `El código del producto está escrito diferente en la Factura y en las Cajas`,
        explanation: `La Factura lo llama "${f.sku}" y la Lista de Empaque lo llama "${skuSum?.pairedPlSku || ""}". La cantidad coincide, pero ambos documentos deben tener exactamente el mismo código.`,
        locationPills,
      };
    }
    case "UNDECLARED_ITEM_IN_PACKING_LIST": {
      return {
        title: `Hay un producto dentro de las cajas (${f.sku}) que no aparece en la Factura`,
        explanation: `En la Lista de Empaque figuran unidades de "${f.sku}" que no están declaradas en la Factura Comercial. Incluso si son muestras sin costo, por ley deben figurar en la factura.`,
        locationPills,
      };
    }
    case "MISSING_ITEM_IN_PACKING_LIST": {
      return {
        title: `El producto ${f.sku} figura cobrado en la Factura pero no aparece en ninguna caja`,
        explanation: `La Factura cobra unidades de "${f.sku}"${prodDesc}, pero ese producto no aparece en la Lista de Empaque.`,
        locationPills,
      };
    }
    case "CARTON_COUNT_MISMATCH": {
      return {
        title: `El número total de cajas declaradas no coincide con la suma de las filas`,
        explanation: f.detail,
        locationPills,
      };
    }
    case "PACKING_ROW_MATH_ERROR": {
      return {
        title: `Error al multiplicar cajas por unidades en el producto ${f.sku}`,
        explanation: f.detail,
        locationPills,
      };
    }
    default:
      return {
        title: `Observación en ${f.sku}`,
        explanation: f.detail,
        locationPills,
      };
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
        <span className="text-[10px] tracking-widest text-(--pm-dark-secondary)">PDF / PNG / JPG</span>
      </span>
      <span className="block mt-8 text-base font-bold text-(--pm-paper)">{title}</span>
      <span className="block mt-1 text-sm text-(--pm-dark-secondary)">{hint} o <span className="underline underline-offset-2 text-(--pm-paper)">elige uno</span></span>
      {loadedLabel && <span className="inline-block mt-3 text-xs font-semibold px-3 py-1 rounded-full bg-(--pm-primary) text-white">Cargado: {loadedLabel}</span>}
      <input id={inputId} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </label>
  );
}

/* ==========================================================================
   Componente principal
   ========================================================================== */

export default function PackMatchWorkbench() {
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
      invLines = parseInvoicePaste(pasteInvoiceText);
      plRows = parsePackingPaste(pastePackingText);
    } catch (error) {
      setPasteError(error instanceof Error ? error.message : "No se pudo leer la tabla.");
      return;
    }
    if (invLines.length === 0 && plRows.length === 0) {
      setPasteError(
        "No se detectaron renglones válidos. Pega al menos una línea con SKU y cantidad en alguno de los dos cuadros."
      );
      return;
    }
    const grossSum = plRows.reduce((a, r) => a + r.gross_weight / (r.weight_unit === "LBS" ? LBS_PER_KG : 1), 0);
    const netSum = plRows.reduce((a, r) => a + r.net_weight / (r.weight_unit === "LBS" ? LBS_PER_KG : 1), 0);
    const ctnSum = plRows.reduce(
      (a, r) => a + (r.shared_carton ? 0 : r.carton_count),
      0
    );
    const amountSum = invLines.reduce((a, l) => a + l.line_amount, 0);
    setInvoice({
      invoice_no: "PEGADO-EXCEL",
      incoterm: "",
      currency: "USD",
      declared_total_amount: Number(amountSum.toFixed(2)),
      declared_total_net_kg: Number(netSum.toFixed(2)),
      declared_total_gross_kg: Number(grossSum.toFixed(2)),
      declared_total_cartons: ctnSum,
      lines: invLines,
    });
    setPackingList({
      packing_list_no: "PEGADO-EXCEL",
      incoterm: "",
      declared_total_cartons: ctnSum,
      declared_total_net_kg: Number(netSum.toFixed(2)),
      declared_total_gross_kg: Number(grossSum.toFixed(2)),
      rows: plRows,
    });
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
    const firstFinding = reconcileShipment(
      {
        ...createEmptyInvoice(),
        lines: invLines,
      },
      {
        ...createEmptyPackingList(),
        rows: plRows,
      }
    ).findings[0];
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
    const prevVal = currentRow ? currentRow[field] : "";
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
      row[field] = parsedVal;
      if (field === "shared_carton" && parsedVal) {
        row.carton_count = 0;
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
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleHubFile(file: File, target: "invoice" | "packing") {
    const dataUrl = await fileToDataUrl(file);
    if (target === "invoice") {
      setCustomInvDataUrl(dataUrl);
      setCustomInvName(file.name);
    } else {
      setCustomPlDataUrl(dataUrl);
      setCustomPlName(file.name);
    }
    setExtractError(null);
  }

  async function handleRunLiveExtraction(invUrl: string, plUrl: string) {
    setIsExtractingLive(true);
    setExtractError(null);
    try {
      const toDataUrlIfRelative = async (u: string) => {
        if (u.startsWith("data:")) return u;
        const resp = await fetch(u);
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

      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceDataUrl: invDataUrl,
          packingListDataUrl: plDataUrl,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      setInvoice(data.extracted.invoice);
      setPackingList(data.extracted.packing_list);
      setInvoiceImgUrl(data.normalizedInvoiceDataUrl || invDataUrl);
      setPackingImgUrl(data.normalizedPackingListDataUrl || plDataUrl);
      setAuditTrail([]);
      setUndoHistory([]);
      setFactorDrafts({});
      setShipmentMode("workspace");
      setEditTab("invoice");
      setActiveStep(1);
      setMatrixFilter("all");
      setFocusFindingIdx("all");
      const firstFinding = reconcileShipment(
        data.extracted.invoice,
        data.extracted.packing_list
      ).findings[0];
      setHighlightedOrigins(firstFinding ? firstFinding.origins : []);
    } catch (err: unknown) {
      setExtractError(String((err as Error)?.message || err));
    } finally {
      setIsExtractingLive(false);
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
    const csv = generateReconciliationCsv(reconciliation);
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
    shipmentMode === "demo" ? humanLabelFor(activeCaseMeta.case_id) : null;

  const inputIssues = workspaceIssues(invoice, packingList);
  const hasData = !isWorkspaceEmpty;
  const canExport = hasData && inputIssues.length === 0;
  const findings = reconciliation.findings;
  const selIdx = findings.length > 0 ? Math.min(selectedFindingIdx, findings.length - 1) : 0;
  const selFinding = findings.length > 0 ? findings[selIdx] : null;
  const selHuman = selFinding ? describeFindingInPlainSpanish(selFinding, invoice, packingList, reconciliation.skuSummaries) : null;
  const selSum = selFinding ? reconciliation.skuSummaries.find((x) => x.sku === selFinding.sku) : undefined;
  const selComparable = comparableQuantities(selSum);
  const selInvLine = selFinding ? invoice.lines.find((l) => l.sku === selFinding.sku) : undefined;
  const focusFinding = typeof focusFindingIdx === "number" && findings[focusFindingIdx] ? findings[focusFindingIdx] : null;
  const eyebrow = shipmentMode === "demo" ? `EJEMPLO ${shortCaseCode(activeCaseMeta.case_id)}` : shipmentMode === "workspace" ? "ESPACIO DE TRABAJO" : "";
  const steps = [
    { n: 1 as const, label: "Diagnóstico y alertas" },
    { n: 2 as const, label: "Cotejo en documentos" },
    { n: 3 as const, label: "Matriz por producto" },
    { n: 4 as const, label: "Mensaje al proveedor" },
  ];

  const editableTables = (
    <div className="bg-white rounded-2xl border border-(--pm-border) overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4" role="tablist" aria-label="Tablas de captura">
        <button type="button" role="tab" aria-selected={editTab === "invoice"} onClick={() => setEditTab("invoice")} className={`btn-press inline-flex items-center gap-2 px-3 py-2 text-sm font-bold border-b-[3px] cursor-pointer ${editTab === "invoice" ? "border-(--pm-primary) text-(--pm-ink)" : "border-transparent text-(--pm-text-secondary)"}`}>
          <FileText className="w-4 h-4" aria-hidden="true" /> Factura comercial
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-(--pm-border) text-(--pm-text-secondary)">{invoice.invoice_no === "BORRADOR" ? "BORRADOR" : `${invoice.lines.length} filas`}</span>
        </button>
        <span className="hidden sm:block w-px h-6 bg-(--pm-border)" aria-hidden="true" />
        <button type="button" role="tab" aria-selected={editTab === "packing"} onClick={() => setEditTab("packing")} className={`btn-press inline-flex items-center gap-2 px-3 py-2 text-sm font-bold border-b-[3px] cursor-pointer ${editTab === "packing" ? "border-(--pm-primary) text-(--pm-ink)" : "border-transparent text-(--pm-text-secondary)"}`}>
          <Package className="w-4 h-4" aria-hidden="true" /> Lista de empaque
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-(--pm-border) text-(--pm-text-secondary)">{packingList.rows.length} filas</span>
        </button>
      </div>
      {editTab === "invoice" ? (
        <div className="p-5">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div><label htmlFor="cap-cartons" className="block text-[11px] font-bold tracking-wide text-(--pm-ink)">CAJAS DECLARADAS</label>
              <input id="cap-cartons" type="number" value={invoice.declared_total_cartons} onChange={(e) => { const v = Number(e.target.value) || 0; appendAudit("CELL_EDIT", "INV-HEADER", "declared_total_cartons", invoice.declared_total_cartons, v); setInvoice((p) => ({ ...p, declared_total_cartons: v })); }} className="mt-1 w-36 px-3 py-2 bg-white border border-(--pm-border) rounded-lg text-sm font-semibold" /></div>
            <div><label htmlFor="cap-net" className="block text-[11px] font-bold tracking-wide text-(--pm-ink)">PESO NETO (KG)</label>
              <input id="cap-net" type="number" step="0.1" value={invoice.declared_total_net_kg} onChange={(e) => { const v = Number(e.target.value) || 0; appendAudit("CELL_EDIT", "INV-HEADER", "declared_total_net_kg", invoice.declared_total_net_kg, v); setInvoice((p) => ({ ...p, declared_total_net_kg: v })); }} className="mt-1 w-36 px-3 py-2 bg-white border border-(--pm-border) rounded-lg text-sm font-semibold" /></div>
            <div><label htmlFor="cap-gross" className="block text-[11px] font-bold tracking-wide text-(--pm-ink)">PESO BRUTO (KG)</label>
              <input id="cap-gross" type="number" step="0.1" value={invoice.declared_total_gross_kg} onChange={(e) => { const v = Number(e.target.value) || 0; appendAudit("CELL_EDIT", "INV-HEADER", "declared_total_gross_kg", invoice.declared_total_gross_kg, v); setInvoice((p) => ({ ...p, declared_total_gross_kg: v })); }} className="mt-1 w-36 px-3 py-2 bg-white border border-(--pm-border) rounded-lg text-sm font-semibold" /></div>
            <button type="button" onClick={addInvoiceLine} className="btn-press ml-auto inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold cursor-pointer"><Plus className="w-4 h-4" aria-hidden="true" /> Agregar línea</button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-(--pm-border)">
            <table className="w-full text-left text-sm min-w-[640px]">
              <thead><tr className="bg-(--pm-selection) text-(--pm-ink) text-xs"><th scope="col" className="py-2.5 px-3">Línea</th><th scope="col" className="py-2.5 px-3">Producto</th><th scope="col" className="py-2.5 px-3">Cant.</th><th scope="col" className="py-2.5 px-3">Unidad</th><th scope="col" className="py-2.5 px-3">Precio</th><th scope="col" className="py-2.5 px-3">Subtotal</th><th scope="col" className="py-2.5 px-3">Piezas / set</th><th scope="col" className="py-2.5 px-3"><span className="sr-only">Eliminar</span></th></tr></thead>
              <tbody className="divide-y divide-(--pm-border)">
                {invoice.lines.map((line, idx) => (
                  <tr key={line.line_id}>
                    <td className="py-2 px-3 text-(--pm-text-secondary) whitespace-nowrap">Línea {idx + 1}</td>
                    <td className="py-2 px-2"><input type="text" aria-label={`SKU línea ${idx + 1}`} value={line.sku} onChange={(e) => updateInvoiceLine(idx, "sku", e.target.value)} className="w-28 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><input type="number" aria-label={`Cantidad línea ${idx + 1}`} value={line.qty} onChange={(e) => updateInvoiceLine(idx, "qty", e.target.value)} className="w-20 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><select aria-label={`Unidad línea ${idx + 1}`} value={line.unit} onChange={(e) => updateInvoiceLine(idx, "unit", e.target.value)} className="px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm"><option value="PCS">PCS</option><option value="SETS">SETS</option></select></td>
                    <td className="py-2 px-2"><input type="number" step="0.5" aria-label={`Precio línea ${idx + 1}`} value={line.unit_price} onChange={(e) => updateInvoiceLine(idx, "unit_price", e.target.value)} className="w-20 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><input type="number" step="1" aria-label={`Subtotal línea ${idx + 1}`} value={line.line_amount} onChange={(e) => updateInvoiceLine(idx, "line_amount", e.target.value)} className="w-24 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2 whitespace-nowrap">{line.explicit_pcs_per_set ? <span className="text-xs px-2 py-1 rounded-full bg-(--pm-selection) text-(--pm-primary) font-bold">1 SET = {line.explicit_pcs_per_set} PCS</span> : line.unit === "SETS" ? <input type="number" min={1} placeholder="Sin confirmar" aria-label={`Piezas por set línea ${idx + 1}`} value={line.operator_pcs_per_set ?? ""} onChange={(e) => updateInvoiceLine(idx, "operator_pcs_per_set", e.target.value)} className="w-28 px-2 py-1.5 bg-(--pm-warning-bg) border border-(--pm-warning-border) rounded-md text-xs" /> : <span className="text-(--pm-text-secondary)">-</span>}</td>
                    <td className="py-2 px-2"><button type="button" onClick={() => removeInvoiceLine(idx)} aria-label={`Eliminar línea ${idx + 1}`} className="btn-press p-2 rounded-lg text-(--pm-error) hover:bg-(--pm-error-bg) cursor-pointer"><Trash2 className="w-4 h-4" aria-hidden="true" /></button></td>
                  </tr>
                ))}
                {invoice.lines.length === 0 && (<tr><td colSpan={8} className="py-10 px-3 text-center text-(--pm-text-secondary) border border-dashed border-(--pm-border) rounded-lg">Aún no hay productos. Agrega la primera línea.</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="p-5">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            {([
              ["declared_total_cartons", "Cajas declaradas en empaque"],
              ["declared_total_net_kg", "Peso neto declarado en empaque (kg)"],
              ["declared_total_gross_kg", "Peso bruto declarado en empaque (kg)"],
            ] as const).map(([field, label]) => (
              <div key={field}><label htmlFor={`packing-${field}`} className="block text-[11px] font-bold tracking-wide text-(--pm-ink)">{label}</label>
                <input id={`packing-${field}`} type="number" min={0} step={field === "declared_total_cartons" ? 1 : "any"} value={packingList[field]} onChange={(e) => { const value = Number(e.target.value); if (!Number.isFinite(value) || value < 0 || (field === "declared_total_cartons" && !Number.isInteger(value))) return; appendAudit("CELL_EDIT", "PL-HEADER", field, packingList[field], value); setPackingList((previous) => ({ ...previous, [field]: value })); }} className="mt-1 w-36 px-3 py-2 bg-white border border-(--pm-border) rounded-lg text-sm font-semibold" />
              </div>
            ))}
            <button type="button" onClick={addPackingRow} className="btn-press inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold cursor-pointer"><Plus className="w-4 h-4" aria-hidden="true" /> Agregar fila</button></div>
          <div className="overflow-x-auto rounded-xl border border-(--pm-border)">
            <table className="w-full text-left text-sm min-w-[720px]">
              <thead><tr className="bg-(--pm-selection) text-(--pm-ink) text-xs"><th scope="col" className="py-2.5 px-3">Fila</th><th scope="col" className="py-2.5 px-3">Cajas / Palet</th><th scope="col" className="py-2.5 px-3">N° Cajas</th><th scope="col" className="py-2.5 px-3">Producto</th><th scope="col" className="py-2.5 px-3">Unid/Caja</th><th scope="col" className="py-2.5 px-3">Total Unid.</th><th scope="col" className="py-2.5 px-3">Peso Neto</th><th scope="col" className="py-2.5 px-3">Peso Bruto</th><th scope="col" className="py-2.5 px-3"><span className="sr-only">Eliminar</span></th></tr></thead>
              <tbody className="divide-y divide-(--pm-border)">
                {packingList.rows.map((row, idx) => (
                  <tr key={row.row_id}>
                    <td className="py-2 px-3 text-(--pm-text-secondary) whitespace-nowrap">Fila {idx + 1}</td>
                    <td className="py-2 px-2"><input type="text" aria-label={`Rango de cajas fila ${idx + 1}`} value={row.carton_range} onChange={(e) => updatePackingRow(idx, "carton_range", e.target.value)} className="w-24 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2">{row.shared_carton ? <span className="text-xs px-2 py-1 rounded-full bg-(--pm-selection) font-bold">Caja compartida</span> : <input type="number" aria-label={`Número de cajas fila ${idx + 1}`} value={row.carton_count} onChange={(e) => updatePackingRow(idx, "carton_count", e.target.value)} className="w-16 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" />}</td>
                    <td className="py-2 px-2"><input type="text" aria-label={`SKU fila ${idx + 1}`} value={row.sku} onChange={(e) => updatePackingRow(idx, "sku", e.target.value)} className="w-28 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><input type="number" aria-label={`Unidades por caja fila ${idx + 1}`} value={row.qty_per_carton} onChange={(e) => updatePackingRow(idx, "qty_per_carton", e.target.value)} className="w-20 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><input type="number" aria-label={`Total unidades fila ${idx + 1}`} value={row.total_qty} onChange={(e) => updatePackingRow(idx, "total_qty", e.target.value)} className="w-20 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm font-bold" /></td>
                    <td className="py-2 px-2"><input type="number" step="0.5" aria-label={`Peso neto fila ${idx + 1}`} value={row.net_weight} onChange={(e) => updatePackingRow(idx, "net_weight", e.target.value)} className="w-20 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><input type="number" step="0.5" aria-label={`Peso bruto fila ${idx + 1}`} value={row.gross_weight} onChange={(e) => updatePackingRow(idx, "gross_weight", e.target.value)} className="w-20 px-2 py-1.5 bg-white border border-(--pm-border) rounded-md text-sm" /></td>
                    <td className="py-2 px-2"><button type="button" onClick={() => removePackingRow(idx)} aria-label={`Eliminar fila ${idx + 1}`} className="btn-press p-2 rounded-lg text-(--pm-error) hover:bg-(--pm-error-bg) cursor-pointer"><Trash2 className="w-4 h-4" aria-hidden="true" /></button></td>
                  </tr>
                ))}
                {packingList.rows.length === 0 && (<tr><td colSpan={9} className="py-10 px-3 text-center text-(--pm-text-secondary)">Aún no hay filas de empaque. Agrega la primera fila.</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 px-5 py-3 border-t border-(--pm-border) text-sm text-(--pm-text-secondary)">
        <span className="inline-flex items-center gap-2"><FileText className="w-4 h-4" aria-hidden="true" /> {invoice.lines.length} productos</span>
        <span className="w-px h-5 bg-(--pm-border)" aria-hidden="true" />
        <span className="inline-flex items-center gap-2"><Package className="w-4 h-4" aria-hidden="true" /> {packingList.rows.length} filas de empaque</span>
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen flex flex-col ${shipmentMode === "empty" ? "bg-(--pm-ink) text-(--pm-paper)" : "bg-(--pm-paper) text-(--pm-ink)"}`}>
      <header className="bg-(--pm-ink) text-white border-b border-(--pm-dark-border)">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <BrandLogo size="sm" theme="dark" />
            <span className="hidden md:inline-block border-l border-white/20 pl-4 text-sm text-(--pm-dark-secondary)">Conciliación pre-despacho</span>
          </div>
          <div className="flex items-center gap-2">
            {shipmentMode === "empty" && <span className="hidden lg:block text-sm text-(--pm-dark-secondary)">Factura comercial ↔ Lista de empaque</span>}
            {shipmentMode === "demo" && demoHuman && (
              <span className="hidden md:inline-flex items-center gap-2 text-xs text-(--pm-dark-secondary)">
                Demo: <strong className="text-white">{shortCaseCode(activeCaseMeta.case_id)}</strong>
                <button type="button" onClick={() => loadCaseObject(activeCaseMeta, dataMode)} className="underline underline-offset-2 hover:text-white cursor-pointer">Reiniciar</button>
              </span>
            )}
            {operatorEditsCount > 0 && shipmentMode !== "empty" && (
              <button type="button" onClick={handleUndo} className="btn-press inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-(--pm-warning-border) text-(--pm-warning-border) text-xs font-bold cursor-pointer"><RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Deshacer ({operatorEditsCount})</button>
            )}
            {shipmentMode !== "empty" && (
              <button type="button" onClick={handleNewShipment} className="btn-press inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-(--pm-paper)/60 text-white text-sm font-bold hover:bg-(--pm-dark-surface) cursor-pointer"><Plus className="w-4 h-4" aria-hidden="true" /> Nuevo embarque</button>
            )}
          </div>
        </div>
      </header>

      {inputIssues.length > 0 && shipmentMode !== "empty" && <div role="alert" className="bg-(--pm-warning-bg) border-b border-(--pm-warning-border) px-6 py-3 text-sm text-(--pm-warning-text)"><strong>Completa o corrige los datos antes de exportar.</strong><ul>{inputIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
      {extractError && <div role="alert" className="bg-(--pm-error-bg) border-b border-(--pm-error-border) px-6 py-2.5 text-sm text-(--pm-error) font-medium">No se pudo procesar el archivo: {extractError}</div>}

      {shipmentMode !== "empty" && (
        <PackMatchStepper steps={steps} activeStep={activeStep} onStep={goToStep} />
      )}

      {shipmentMode === "empty" && (
        <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 py-10 sm:py-14">
          <p className="text-[11px] font-bold tracking-[0.22em] text-(--pm-sage)">EL PUNTO DE ENCUENTRO</p>
          <h1 className="mt-3 text-4xl sm:text-5xl font-black tracking-tight">Nuevo embarque</h1>
          <p className="mt-3 text-base text-(--pm-dark-secondary)">La factura y el empaque, conectados desde el inicio.</p>

          <div className="mt-10 grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-6 items-stretch">
            <section aria-label="Factura comercial" className="rounded-2xl border border-(--pm-dark-border) bg-(--pm-dark-surface) p-4">
              <div className="flex items-center justify-between px-1 pb-3 text-[11px] tracking-widest text-(--pm-dark-secondary)"><span>01 / FACTURA</span><span>{customInvName ? "1 archivo" : "Sin archivo"}</span></div>
              <DropZone inputId="hub-invoice-file" title="Factura comercial" hint="Arrastra tu archivo aquí" loadedLabel={customInvName} onFile={(f) => void handleHubFile(f, "invoice")} icon={<FileText className="w-5 h-5" aria-hidden="true" />} />
            </section>
            <div className="flex lg:flex-col items-center justify-center gap-4 px-2 text-center">
              <span className="hidden lg:block text-(--pm-sage) text-3xl font-light" aria-hidden="true">==</span>
              <div>
                <p className="text-xl font-bold leading-tight">Un mismo<br />embarque.</p>
                <p className="mt-2 text-sm text-(--pm-dark-secondary) max-w-[180px]">Agrega ambos documentos para iniciar la comparación.</p>
                <button type="button" disabled={!customInvDataUrl || !customPlDataUrl || isExtractingLive} onClick={() => customInvDataUrl && customPlDataUrl && void handleRunLiveExtraction(customInvDataUrl, customPlDataUrl)} className="btn-press mt-4 inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-(--pm-sage) text-(--pm-ink) font-bold text-sm disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
                  {isExtractingLive ? "Analizando documentos…" : <>Conciliar <ArrowRight className="w-4 h-4" aria-hidden="true" /></>}
                </button>
                <p className="mt-2 text-xs text-(--pm-dark-secondary)">{(customInvDataUrl ? 1 : 0) + (customPlDataUrl ? 1 : 0)} de 2 archivos</p>
              </div>
            </div>
            <section aria-label="Lista de empaque" className="rounded-2xl border border-(--pm-dark-border) bg-(--pm-dark-surface) p-4">
              <div className="flex items-center justify-between px-1 pb-3 text-[11px] tracking-widest text-(--pm-dark-secondary)"><span>02 / EMPAQUE</span><span>{customPlName ? "1 archivo" : "Sin archivo"}</span></div>
              <DropZone inputId="hub-packing-file" title="Lista de empaque" hint="Arrastra tu archivo aquí" loadedLabel={customPlName} onFile={(f) => void handleHubFile(f, "packing")} icon={<Package className="w-5 h-5" aria-hidden="true" />} />
            </section>
          </div>

          <div className="mt-10 pt-6 border-t border-(--pm-dark-border) flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
            <span className="text-(--pm-dark-secondary)">Otras formas de comenzar</span>
            <button type="button" onClick={() => { setPasteError(null); setShowPasteModal(true); }} className="btn-press font-semibold text-(--pm-paper) hover:text-(--pm-sage) cursor-pointer">Excel / CSV <span aria-hidden="true">↗</span></button>
            <button type="button" onClick={handleStartWithEmptyTables} className="btn-press font-semibold text-(--pm-paper) hover:text-(--pm-sage) cursor-pointer">Tablas en blanco <span aria-hidden="true">↗</span></button>
            <label className="ml-auto inline-flex items-center gap-2">
              <span className="sr-only">Probar un ejemplo</span>
              <select aria-label="Probar un ejemplo" value="" onChange={(e) => { if (e.target.value) handleSelectCase(e.target.value); }} className="h-9 px-3 rounded-lg bg-(--pm-dark-surface) border border-(--pm-dark-border) text-(--pm-paper) text-sm font-semibold cursor-pointer">
                <option value="" disabled>Probar un ejemplo →</option>
                {PRELOADED_CASES.map((c) => { const h = humanLabelFor(c.case_id); return <option key={c.case_id} value={c.case_id}>{h.number} · {h.name}</option>; })}
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
                  <h1 className="text-3xl sm:text-4xl font-black tracking-tight">Diagnóstico y alertas</h1>
                  <span className="hidden sm:block w-px h-8 bg-(--pm-border)" aria-hidden="true" />
                  {!hasData ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-border) bg-white text-sm font-bold text-(--pm-text-secondary)">Sin datos</span>
                  ) : inputIssues.length > 0 ? (<span className="text-sm font-bold text-(--pm-warning-text)">Datos por corregir</span>) : findings.length === 0 ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-primary) bg-(--pm-selection) text-sm font-bold text-(--pm-primary)"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Sin diferencias detectadas</span>
                  ) : ambiguitiesCount > 0 && discrepanciesCount === 0 ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-warning-border) bg-(--pm-warning-bg) text-sm font-bold text-(--pm-warning-text)"><HelpCircle className="w-4 h-4" aria-hidden="true" /> Equivalencia pendiente</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-error-border) bg-(--pm-error-bg) text-sm font-bold text-(--pm-error)"><AlertCircle className="w-4 h-4" aria-hidden="true" /> Requiere revisión</span>
                  )}
                  <span className="text-sm text-(--pm-text-secondary)">{findings.length} hallazgo{findings.length === 1 ? "" : "s"}{ambiguitiesCount > 0 ? ` · ${ambiguitiesCount} duda${ambiguitiesCount === 1 ? "" : "s"} por confirmar` : ""}</span>
                </div>
                <p className="mt-1 text-sm text-(--pm-text-secondary)">{!hasData ? "Agrega datos en el Paso 4 para comenzar el diagnóstico." : findings.length === 0 ? "Revisa el resultado de la conciliación entre la factura y la lista de empaque." : `De los ${totalSkus} productos de este envío, ${matchedSkus} cuadran en cantidades${discrepantSkus + ambiguousSkus > 0 ? ` y ${discrepantSkus + ambiguousSkus} requieren revisión antes de enviar los papeles a la Aduana.` : "."}`}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { icon: <FileText className="w-5 h-5" aria-hidden="true" />, label: "Total facturado", value: `USD ${fmtCurrency.format(reconciliation.computedTotals.invoiceLinesSumAmount)}` },
                  { icon: <Package className="w-5 h-5" aria-hidden="true" />, label: "Cajas físicas (bultos)", value: `${fmtNumber.format(reconciliation.computedTotals.packingCalculatedCartons)} cajas` },
                  { icon: <Weight className="w-5 h-5" aria-hidden="true" />, label: "Peso total (neto / bruto)", value: `${fmtNumber.format(reconciliation.computedTotals.packingCalculatedNetKg)} / ${fmtNumber.format(reconciliation.computedTotals.packingCalculatedGrossKg)} kg` },
                ].map((m) => (
                  <div key={m.label} className="bg-white rounded-2xl border border-(--pm-border) px-5 py-4 flex items-center gap-4">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-(--pm-selection) text-(--pm-primary) shrink-0">{m.icon}</span>
                    <span><span className="block text-sm text-(--pm-text-secondary)">{m.label}</span><span className="block text-xl font-black">{m.value}</span></span>
                  </div>
                ))}
              </div>

              {!hasData ? (
                <div className="bg-white rounded-2xl border border-(--pm-border) p-8 text-center">
                  <p className="font-bold">Sin datos</p>
                  <p className="text-sm text-(--pm-text-secondary) mt-1">Todavía no hay datos que diagnosticar. Agrega renglones en la captura manual y vuelve aquí para ver el veredicto al instante.</p>
                  <button type="button" onClick={() => { setShowEditableTables(true); goToStep(4); }} className="btn-press mt-4 px-5 py-2.5 rounded-lg bg-(--pm-primary) text-white text-sm font-bold cursor-pointer">Ir a captura manual</button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5 items-start">
                  <section aria-label="Hallazgos" className="bg-white rounded-2xl border border-(--pm-border) p-5">
                    <h2 className="text-lg font-bold">Hallazgos · {findings.length}</h2>
                    {findings.length === 0 ? (
                      <div className="mt-4">
                        <div className="rounded-xl border border-(--pm-primary) bg-(--pm-selection) p-4 flex gap-3"><CheckCircle2 className="w-6 h-6 text-(--pm-primary) shrink-0" aria-hidden="true" /><span><strong className="block">No se detectaron hallazgos.</strong><span className="text-sm text-(--pm-text-secondary)">Las cantidades de ambos documentos coinciden.</span></span></div>
                        <ul className="mt-4 divide-y divide-(--pm-border) text-sm">
                          {[["Diferencias de cantidad", discrepantSkus], ["Productos sin correspondencia", findings.length], ["Cajas / empaque", 0], ["Peso", 0]].map(([l, v]) => (
                            <li key={String(l)} className="flex items-center justify-between py-2.5"><span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-(--pm-primary)" aria-hidden="true" /> {l}</span><span className="font-bold">{v}</span></li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <ul className="mt-4 flex flex-col gap-3">
                        {findings.map((f, idx) => {
                          const human = describeFindingInPlainSpanish(f, invoice, packingList, reconciliation.skuSummaries);
                          const isSel = idx === selIdx;
                          const isDisc = f.severity === "DISCREPANCY";
                          return (
                            <li key={`${f.code}-${f.sku}-${idx}`}>
                              <button type="button" aria-pressed={isSel} onClick={() => { setSelectedFindingIdx(idx); setHighlightedOrigins(f.origins); }} className={`btn-press w-full text-left p-4 rounded-xl border cursor-pointer ${isSel ? "border-(--pm-primary) bg-(--pm-selection)" : "border-(--pm-border) bg-white hover:bg-(--pm-paper)"}`}>
                                <span className="flex items-start gap-2.5">
                                  {isDisc ? <AlertCircle className="w-5 h-5 text-(--pm-error) shrink-0 mt-0.5" aria-hidden="true" /> : <HelpCircle className="w-5 h-5 text-(--pm-warning-text) shrink-0 mt-0.5" aria-hidden="true" />}
                                  <span className="min-w-0"><span className="block text-sm font-bold leading-snug"><span className="text-(--pm-text-secondary) mr-1.5">{String(idx + 1).padStart(2, "0")}</span>{shortFindingTitle(f, invoice, reconciliation.skuSummaries)}</span>
                                  <span className="block text-xs text-(--pm-text-secondary) mt-1 leading-relaxed">{human.explanation}</span></span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>

                  <section aria-label="Detalle del hallazgo" className="bg-white rounded-2xl border border-(--pm-border) p-5 sm:p-6">
                    {findings.length === 0 ? (
                      <>
                        <div className="flex items-start gap-3"><CheckCircle2 className="w-8 h-8 text-(--pm-primary) shrink-0" aria-hidden="true" /><h2 className="text-2xl font-black leading-tight">Las cantidades de ambos documentos coinciden.</h2></div>
                        <div className="flex flex-wrap gap-2 mt-4">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-(--pm-paper) border border-(--pm-border)"><FileText className="w-3.5 h-3.5" aria-hidden="true" /> Factura: <strong>{invoice.invoice_no}</strong></span>
                          <span className="text-(--pm-text-secondary)">/</span>
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-(--pm-paper) border border-(--pm-border)"><Package className="w-3.5 h-3.5" aria-hidden="true" /> Lista de empaque: <strong>{packingList.packing_list_no}</strong></span>
                        </div>
                        {reconciliation.skuSummaries.length > 0 && (
                          <div className="mt-6">
                            <h3 className="text-base font-bold mb-3">Comparación por producto</h3>
                            <div className="overflow-x-auto rounded-xl border border-(--pm-border)"><table className="w-full text-sm min-w-[520px]"><thead><tr className="bg-(--pm-selection) text-left text-xs"><th scope="col" className="py-2.5 px-3">Producto</th><th scope="col" className="py-2.5 px-3">Cantidad en factura</th><th scope="col" className="py-2.5 px-3">Cantidad en empaque</th><th scope="col" className="py-2.5 px-3">Resultado</th></tr></thead>
                            <tbody className="divide-y divide-(--pm-border)">{reconciliation.skuSummaries.map((sm) => (<tr key={sm.sku}><td className="py-2.5 px-3 font-bold">{sm.sku}</td><td className="py-2.5 px-3">{sm.invoiceQty !== null ? `${fmtNumber.format(sm.invoiceQty)} ${sm.invoiceUnit}` : "-"}{sm.conversionFactorUsed ? <span className="block text-xs text-(--pm-text-secondary)">(1 SET = {sm.conversionFactorUsed} PCS)</span> : null}</td><td className="py-2.5 px-3">{fmtNumber.format(sm.packingTotalQty)} {sm.packingUnit}</td><td className="py-2.5 px-3"><span className="inline-flex items-center gap-1 text-(--pm-primary) font-bold text-xs"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Coincide</span></td></tr>))}</tbody></table></div>
                          </div>
                        )}
                      </>
                    ) : selFinding && selHuman ? (
                      <>
                        <div className="flex items-start gap-3">
                          {selFinding.severity === "DISCREPANCY" ? <AlertCircle className="w-8 h-8 text-(--pm-error) shrink-0" aria-hidden="true" /> : <HelpCircle className="w-8 h-8 text-(--pm-warning-text) shrink-0" aria-hidden="true" />}
                          <div><h2 className="text-2xl font-black leading-tight">{shortFindingTitle(selFinding, invoice, reconciliation.skuSummaries)}</h2>
                          {selInvLine?.description && <p className="text-sm text-(--pm-text-secondary) mt-0.5">{selInvLine.description}</p>}</div>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-4">{selHuman.locationPills.map((pill, i) => (<span key={`${pill}-${i}`} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-(--pm-paper) border border-(--pm-border)">{pill.includes("Empaque") || pill.includes("Lista") ? <Package className="w-3.5 h-3.5" aria-hidden="true" /> : <FileText className="w-3.5 h-3.5" aria-hidden="true" />} {pill}</span>))}</div>
                        <p className="mt-4 text-sm leading-relaxed">{selHuman.explanation}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
                          {selFinding.code === "INVOICE_LINE_MATH_ERROR" && selInvLine ? (<>
                            <div className="rounded-xl border border-(--pm-border) p-4"><span className="block text-sm text-(--pm-text-secondary)">Declarado</span><strong className="text-xl">USD {fmtCurrency.format(selInvLine.line_amount)}</strong></div>
                            <div className="rounded-xl border border-(--pm-border) p-4"><span className="block text-sm text-(--pm-text-secondary)">Correcto</span><strong className="text-xl">USD {fmtCurrency.format(selInvLine.qty * selInvLine.unit_price)}</strong></div>
                            <div className="rounded-xl border border-(--pm-border) p-4 flex items-center text-sm font-semibold">{fmtNumber.format(selInvLine.qty)} × USD {fmtCurrency.format(selInvLine.unit_price)} = USD {fmtCurrency.format(selInvLine.qty * selInvLine.unit_price)}</div>
                          </>) : selSum ? (<>
                            <div className="rounded-xl border border-(--pm-border) p-4"><span className="block text-sm text-(--pm-text-secondary)">Factura{selSum.conversionFactorUsed ? ` (1 SET = ${selSum.conversionFactorUsed} PCS)` : ""}</span><strong className="text-xl">{selSum.invoiceQty !== null ? `${fmtNumber.format(selComparable?.invoiceQty ?? selSum.invoiceQty)} ${selComparable?.unit ?? selSum.invoiceUnit}` : "No figura"}</strong></div>
                            <div className="rounded-xl border border-(--pm-border) p-4"><span className="block text-sm text-(--pm-text-secondary)">Empaque (suma de filas)</span><strong className="text-xl">{fmtNumber.format(selSum.packingTotalQty)} {selSum.packingUnit}</strong></div>
                            {selComparable ? (<div className="rounded-xl border border-(--pm-error-border) bg-(--pm-error-bg) p-4"><span className="block text-sm text-(--pm-error)">Diferencia</span><strong className="text-xl text-(--pm-error)">{fmtNumber.format(selComparable.difference)} {selSum.packingUnit}</strong></div>) : (<div className="rounded-xl border border-(--pm-border) p-4 text-sm text-(--pm-text-secondary) flex items-center">Las unidades no son directamente comparables sin equivalencia confirmada.</div>)}
                          </>) : null}
                        </div>
                        {selFinding.code === "UNIT_AMBIGUITY_UNCONVERTIBLE" && selSum && (() => {
                          const draft = factorDrafts[selFinding.sku] ?? "";
                          const factor = Number(draft);
                          const valid = draft.trim() !== "" && Number.isSafeInteger(factor) && factor > 0;
                          return (
                            <div className="mt-5 rounded-xl bg-(--pm-warning-bg) border border-(--pm-warning-border) px-4 py-3 flex flex-wrap items-center gap-3">
                              <span className="text-sm font-bold">Confirma la equivalencia de unidades:</span>
                              <span className="text-sm font-semibold">1 SET =</span>
                              <input type="number" min={1} step={1} value={draft} aria-label={`Piezas por Set para ${selFinding.sku}`} placeholder="Ej. 4" className="w-20 px-2 py-1.5 bg-white border border-(--pm-warning-border) rounded-lg text-sm font-bold" onChange={(e) => setFactorDrafts((prev) => ({ ...prev, [selFinding.sku]: e.target.value }))} />
                              <span className="text-sm font-semibold">PCS</span>
                              <button type="button" disabled={!valid} onClick={() => { if (valid) setOperatorFactorBySku(selFinding.sku, factor); }} className="btn-press px-4 py-2 rounded-lg bg-(--pm-primary) text-white text-sm font-bold cursor-pointer">Confirmar equivalencia</button>
                            </div>
                          );
                        })()}
                        <div className="flex flex-wrap items-center justify-between gap-3 mt-6">
                          <span className="text-sm text-(--pm-text-secondary)">Origen de la evidencia: {selFinding.origins.map(formatOriginLabel).join("  /  ")}</span>
                          <button type="button" onClick={() => { setHighlightedOrigins(selFinding.origins); setFocusFindingIdx(selIdx); goToStep(2); }} className="btn-press inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold cursor-pointer">Ver evidencia <ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
                        </div>
                      </>
                    ) : null}
                  </section>
                </div>
              )}
              {hasData && (<div className="flex justify-end"><button type="button" onClick={() => goToStep(2)} className="btn-press inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold cursor-pointer">Inspeccionar documentos <ArrowRight className="w-4 h-4" aria-hidden="true" /></button></div>)}
            </>
          )}

          {activeStep === 2 && (
            <>
              <div>
                {eyebrow && <p className="text-[11px] font-bold tracking-[0.18em] text-(--pm-primary)">{eyebrow}</p>}
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  <h1 className="text-3xl sm:text-4xl font-black tracking-tight">Cotejo en documentos</h1>
                  <span className="hidden sm:block w-px h-8 bg-(--pm-border)" aria-hidden="true" />
                  {focusFinding ? (<span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-error-border) bg-(--pm-error-bg) text-sm font-bold text-(--pm-error)"><AlertCircle className="w-4 h-4" aria-hidden="true" /> {shortFindingTitle(focusFinding, invoice, reconciliation.skuSummaries)}</span>) : findings.length > 0 ? (<span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-error-border) bg-(--pm-error-bg) text-sm font-bold text-(--pm-error)"><AlertCircle className="w-4 h-4" aria-hidden="true" /> Requiere revisión</span>) : (<span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-primary) bg-(--pm-selection) text-sm font-bold text-(--pm-primary)"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Sin diferencias</span>)}
                  <span className="text-sm text-(--pm-text-secondary)">{findings.length} hallazgos en total</span>
                </div>
                <p className="mt-1 text-sm text-(--pm-text-secondary)">Compara la Factura y la Lista de Empaque para validar cantidades, montos y datos clave.</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="focus-finding" className="text-sm font-bold">Inspeccionando:</label>
                <select id="focus-finding" value={typeof focusFindingIdx === "number" && focusFindingIdx < findings.length ? String(focusFindingIdx) : "all"} onChange={(e) => { const v = e.target.value; if (v === "all") { setFocusFindingIdx("all"); setHighlightedOrigins(findings.flatMap((x) => x.origins)); } else { const i = Number(v); setFocusFindingIdx(i); setSelectedFindingIdx(i); const f = findings[i]; if (f) setHighlightedOrigins(f.origins); } }} className="h-10 px-3 rounded-lg bg-white border border-(--pm-border) text-sm font-medium cursor-pointer max-w-full">
                  <option value="all">Todas las marcas</option>
                  {findings.map((f, i) => (<option key={`${f.code}-${f.sku}-${i}`} value={String(i)}>Problema {i + 1}: {f.sku} ({shortFindingLabel(f.code)})</option>))}
                </select>
                <button type="button" onClick={() => { setFocusFindingIdx("all"); setHighlightedOrigins(findings.flatMap((x) => x.origins)); }} className="btn-press h-10 px-4 rounded-lg border border-(--pm-border) bg-white text-sm font-bold cursor-pointer">Mostrar todas las marcas</button>
                {highlightedOrigins.length > 0 && (<>
                  <span className="text-sm text-(--pm-text-secondary)">Origen del hallazgo:</span>
                  {highlightedOrigins.map((o) => (<span key={o} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-(--pm-selection) border border-(--pm-border)">{o.startsWith("PL") ? <Package className="w-3.5 h-3.5" aria-hidden="true" /> : <FileText className="w-3.5 h-3.5" aria-hidden="true" />} {formatOriginLabel(o)}</span>))}
                  <button type="button" onClick={() => setHighlightedOrigins([])} className="btn-press inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border border-(--pm-border) bg-white text-sm font-bold cursor-pointer"><X className="w-4 h-4" aria-hidden="true" /> Limpiar selección</button>
                </>)}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <section aria-label="Factura comercial" className="bg-white rounded-2xl border border-(--pm-border) p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div><p className="text-[11px] font-bold tracking-widest text-(--pm-primary)"><span className="inline-block h-2 w-2 rounded-full bg-(--pm-sage) mr-1.5" aria-hidden="true" />DOCUMENTO 1 · FACTURA</p><h2 className="text-base font-bold">Factura Comercial ({invoice.invoice_no})</h2></div>
                    {invoiceImgUrl.startsWith("/cases/") && <a href={invoiceImgUrl.replace(".png", ".pdf")} target="_blank" rel="noreferrer" className="btn-press inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full bg-(--pm-selection) text-(--pm-primary) border border-(--pm-border)">Abrir PDF <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /></a>}
                  </div>
                  {invoiceImgUrl ? (
                    <div className="relative w-full overflow-hidden rounded-lg border border-(--pm-border) bg-white">
                      <img src={invoiceImgUrl} alt={`Factura Comercial ${invoice.invoice_no}`} className="w-full block select-none" />
                      {invoice.header_bbox && (<div role="button" tabIndex={0} aria-label="Resaltar cabecera de totales en la Factura" onClick={() => setHighlightedOrigins(["INV-HEADER"])} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setHighlightedOrigins(["INV-HEADER"]); } }} style={{ top: `${invoice.header_bbox[0] / 10}%`, left: `${invoice.header_bbox[1] / 10}%`, height: `${(invoice.header_bbox[2] - invoice.header_bbox[0]) / 10}%`, width: `${(invoice.header_bbox[3] - invoice.header_bbox[1]) / 10}%` }} title="Totales declarados en la Factura" className={`absolute cursor-pointer rounded-sm ${highlightedOrigins.includes("INV-HEADER") ? "border-2 border-(--pm-error) bg-(--pm-highlight)/25 z-10" : "hover:bg-(--pm-primary)/10"}`}>{highlightedOrigins.includes("INV-HEADER") && <span className="absolute -top-5 left-0 bg-(--pm-error) text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">Totales de Factura</span>}</div>)}
                      {invoice.lines.map((line, idx) => { if (!line.bbox) return null; const [ymin, xmin, ymax, xmax] = line.bbox; const active = highlightedOrigins.includes(line.line_id); const summary = reconciliation.skuSummaries.find((sm) => sm.invoiceLineId === line.line_id); return (<div role="button" tabIndex={0} aria-label={`Factura Línea ${idx + 1}: ${line.sku}`} key={`bbox-${line.line_id}`} onClick={() => setHighlightedOrigins([line.line_id, ...(summary?.packingRowIds || [])])} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setHighlightedOrigins([line.line_id, ...(summary?.packingRowIds || [])]); } }} style={{ top: `${ymin / 10}%`, left: `${xmin / 10}%`, height: `${(ymax - ymin) / 10}%`, width: `${(xmax - xmin) / 10}%` }} title={line.bbox_estimated ? `Factura Línea ${idx + 1} · ${line.sku} (${line.qty} ${line.unit}) — posición estimada` : `Factura Línea ${idx + 1} · ${line.sku} (${line.qty} ${line.unit})`} className={`absolute cursor-pointer rounded-sm ${active ? "border-2 border-(--pm-error) bg-(--pm-highlight)/25 z-10" : "hover:bg-(--pm-primary)/10"}${line.bbox_estimated ? " border border-dashed border-(--pm-primary)/60 opacity-70" : ""}`}>{active && <span className="absolute -top-5 right-0 bg-(--pm-error) text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap max-w-[220px] truncate">Línea {idx + 1}: {line.sku} ({line.qty} {line.unit})</span>}</div>); })}
                    </div>
                  ) : (<div className="rounded-lg border border-dashed border-(--pm-border) bg-(--pm-paper) px-4 py-10 text-center"><p className="text-sm font-semibold">Sin imagen de factura en este embarque</p><p className="text-xs text-(--pm-text-secondary) mt-1">Los datos capturados a mano o pegados desde Excel se concilian igual, sin necesidad de imagen.</p></div>)}
                </section>

                <section aria-label="Lista de empaque" className="bg-white rounded-2xl border border-(--pm-border) p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div><p className="text-[11px] font-bold tracking-widest text-(--pm-primary)"><span className="inline-block h-2 w-2 rounded-full bg-(--pm-primary) mr-1.5" aria-hidden="true" />DOCUMENTO 2 · LISTA DE EMPAQUE</p><h2 className="text-base font-bold">Lista de Empaque ({packingList.packing_list_no})</h2></div>
                    {packingImgUrl.startsWith("/cases/") && <a href={packingImgUrl.replace(".png", ".pdf")} target="_blank" rel="noreferrer" className="btn-press inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full bg-(--pm-selection) text-(--pm-primary) border border-(--pm-border)">Abrir PDF <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /></a>}
                  </div>
                  {packingImgUrl ? (
                    <div className="relative w-full overflow-hidden rounded-lg border border-(--pm-border) bg-white">
                      <img src={packingImgUrl} alt={`Lista de Empaque ${packingList.packing_list_no}`} className="w-full block select-none" />
                      {packingList.header_bbox && (<div role="button" tabIndex={0} aria-label="Resaltar cabecera de totales en la Lista de Empaque" onClick={() => setHighlightedOrigins(["PL-HEADER"])} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setHighlightedOrigins(["PL-HEADER"]); } }} style={{ top: `${packingList.header_bbox[0] / 10}%`, left: `${packingList.header_bbox[1] / 10}%`, height: `${(packingList.header_bbox[2] - packingList.header_bbox[0]) / 10}%`, width: `${(packingList.header_bbox[3] - packingList.header_bbox[1]) / 10}%` }} title="Totales declarados en la Lista de Empaque" className={`absolute cursor-pointer rounded-sm ${highlightedOrigins.includes("PL-HEADER") ? "border-2 border-(--pm-error) bg-(--pm-highlight)/25 z-10" : "hover:bg-(--pm-primary)/10"}`}>{highlightedOrigins.includes("PL-HEADER") && <span className="absolute -top-5 left-0 bg-(--pm-error) text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">Totales de Lista de Empaque</span>}</div>)}
                      {packingList.rows.map((row, idx) => { if (!row.bbox) return null; const [ymin, xmin, ymax, xmax] = row.bbox; const active = highlightedOrigins.includes(row.row_id); const summary = reconciliation.skuSummaries.find((sm) => sm.packingRowIds.includes(row.row_id)); return (<div role="button" tabIndex={0} aria-label={`Empaque Fila ${idx + 1}: ${row.sku}`} key={`bbox-${row.row_id}`} onClick={() => setHighlightedOrigins([...(summary?.invoiceLineId ? [summary.invoiceLineId] : []), ...(summary?.packingRowIds || [row.row_id])])} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setHighlightedOrigins([...(summary?.invoiceLineId ? [summary.invoiceLineId] : []), ...(summary?.packingRowIds || [row.row_id])]); } }} style={{ top: `${ymin / 10}%`, left: `${xmin / 10}%`, height: `${(ymax - ymin) / 10}%`, width: `${(xmax - xmin) / 10}%` }} title={row.bbox_estimated ? `Fila ${idx + 1} (${row.carton_range}) · ${row.sku}: ${row.total_qty} ${row.unit} — posición estimada` : `Fila ${idx + 1} (${row.carton_range}) · ${row.sku}: ${row.total_qty} ${row.unit}`} className={`absolute cursor-pointer rounded-sm ${active ? "border-2 border-(--pm-error) bg-(--pm-highlight)/25 z-10" : "hover:bg-(--pm-primary)/10"}${row.bbox_estimated ? " border border-dashed border-(--pm-primary)/60 opacity-70" : ""}`}>{active && <span className="absolute -top-5 left-0 bg-(--pm-error) text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap max-w-[220px] truncate">Fila {idx + 1} ({row.carton_range}): {row.total_qty} {row.unit}</span>}</div>); })}
                    </div>
                  ) : (<div className="rounded-lg border border-dashed border-(--pm-border) bg-(--pm-paper) px-4 py-10 text-center"><p className="text-sm font-semibold">Sin imagen de lista de empaque en este embarque</p><p className="text-xs text-(--pm-text-secondary) mt-1">Los datos capturados a mano o pegados desde Excel se concilian igual, sin necesidad de imagen.</p></div>)}
                </section>
              </div>

              {focusFinding && focusFinding.code === "QTY_MISMATCH" ? (() => {
                const sm = reconciliation.skuSummaries.find((x) => x.sku === focusFinding.sku);
                const rows = packingList.rows.filter((r) => focusFinding.origins.includes(r.row_id));
                if (!sm) return null;
                return (
                  <section aria-label="Comparación de unidades" className="bg-white rounded-2xl border border-(--pm-border) p-5 grid grid-cols-1 sm:grid-cols-4 gap-4 items-center">
                    <div className="flex items-center gap-3"><span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-(--pm-selection) text-(--pm-primary)"><Package className="w-5 h-5" aria-hidden="true" /></span><span><strong className="block">Comparación de unidades</strong><span className="text-sm text-(--pm-text-secondary)">{sm.sku}{selInvLine?.description ? ` · ${selInvLine.description}` : ""}</span></span></div>
                    <div><span className="block text-sm text-(--pm-text-secondary)">Factura</span><strong className="text-2xl">{sm.invoiceQty !== null ? `${fmtNumber.format(sm.invoiceQty)} ${sm.invoiceUnit}` : "-"}</strong></div>
                    <div><span className="block text-sm text-(--pm-text-secondary)">Empaque</span><strong className="text-2xl">{fmtNumber.format(sm.packingTotalQty)} {sm.packingUnit}</strong>{rows.length > 1 && <span className="block text-xs text-(--pm-text-secondary)">{rows.map((r) => fmtNumber.format(r.total_qty)).join(" + ")} = {fmtNumber.format(sm.packingTotalQty)}</span>}</div>
                    <div className="rounded-xl bg-(--pm-error-bg) p-4"><span className="flex items-center gap-2 text-sm font-bold text-(--pm-error)"><AlertCircle className="w-4 h-4" aria-hidden="true" /> Diferencia</span><strong className="text-2xl text-(--pm-error)">{sm.invoiceQty !== null ? `${fmtNumber.format(sm.packingTotalQty - sm.invoiceQty)} ${sm.packingUnit}` : "-"}</strong></div>
                  </section>
                );
              })() : (
                <section aria-label="Comparación del documento seleccionado" className="bg-white rounded-2xl border border-(--pm-border) p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h2 className="text-lg font-bold">Comparación del documento seleccionado</h2>
                    <div className="flex flex-wrap gap-4 text-sm"><span><span className="text-(--pm-text-secondary) block text-xs">Total facturado</span><strong>USD {fmtCurrency.format(reconciliation.computedTotals.invoiceLinesSumAmount)}</strong></span><span><span className="text-(--pm-text-secondary) block text-xs">Bultos</span><strong>{fmtNumber.format(reconciliation.computedTotals.packingCalculatedCartons)} cajas</strong></span><span><span className="text-(--pm-text-secondary) block text-xs">Peso neto / bruto</span><strong>{fmtNumber.format(reconciliation.computedTotals.packingCalculatedNetKg)} / {fmtNumber.format(reconciliation.computedTotals.packingCalculatedGrossKg)} kg</strong></span></div>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-(--pm-border)"><table className="w-full text-sm min-w-[760px]"><thead><tr className="bg-(--pm-selection) text-left text-xs"><th scope="col" className="py-2.5 px-3">Línea</th><th scope="col" className="py-2.5 px-3">SKU</th><th scope="col" className="py-2.5 px-3">Descripción</th><th scope="col" className="py-2.5 px-3">Cantidad</th><th scope="col" className="py-2.5 px-3">Precio unitario</th><th scope="col" className="py-2.5 px-3">Declarado (Factura)</th><th scope="col" className="py-2.5 px-3">Correcto</th><th scope="col" className="py-2.5 px-3">Estado</th></tr></thead>
                  <tbody className="divide-y divide-(--pm-border)">{invoice.lines.map((line, idx) => { const correct = line.qty * line.unit_price; const ok = Math.abs(correct - line.line_amount) < 0.005; const active = highlightedOrigins.includes(line.line_id); return (<tr key={line.line_id} className={active && !ok ? "bg-(--pm-error-bg)" : ""}><td className="py-2.5 px-3">{idx + 1}</td><td className="py-2.5 px-3 font-bold">{line.sku}</td><td className="py-2.5 px-3">{line.description || "-"}</td><td className="py-2.5 px-3">{fmtNumber.format(line.qty)} {line.unit}</td><td className="py-2.5 px-3">USD {fmtCurrency.format(line.unit_price)}</td><td className="py-2.5 px-3">USD {fmtCurrency.format(line.line_amount)}</td><td className="py-2.5 px-3">USD {fmtCurrency.format(correct)}</td><td className="py-2.5 px-3">{ok ? <span className="inline-flex items-center gap-1 text-xs font-bold text-(--pm-primary)"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Importe correcto</span> : <span className="inline-flex items-center gap-1 text-xs font-bold text-(--pm-error)"><AlertCircle className="w-4 h-4" aria-hidden="true" /> Importe incorrecto (cálculo)</span>}</td></tr>); })}{invoice.lines.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-(--pm-text-secondary)">Sin líneas de factura.</td></tr>}</tbody></table></div>
                </section>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={() => goToStep(1)} className="btn-press inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-(--pm-border) bg-white text-sm font-bold cursor-pointer"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Volver al diagnóstico</button>
                <button type="button" onClick={() => goToStep(3)} className="btn-press inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold cursor-pointer">Continuar a la matriz <ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
              </div>
            </>
          )}

          {activeStep === 3 && (
            <>
              <div>
                {eyebrow && <p className="text-[11px] font-bold tracking-[0.18em] text-(--pm-primary)">{eyebrow}</p>}
                <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
                  <div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl sm:text-4xl font-black tracking-tight">Matriz por producto</h1>
                  {findings.length > 0 && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-error-border) bg-(--pm-error-bg) text-sm font-bold text-(--pm-error)"><AlertCircle className="w-4 h-4" aria-hidden="true" /> Requiere revisión</span>}</div>
                  <div role="group" aria-label="Filtrar productos por estado" className="flex rounded-full border border-(--pm-border) bg-white overflow-hidden">
                    {([["all", `Todos (${totalSkus})`], ["disc", `Solo discrepancias (${discrepantSkus + ambiguousSkus})`], ["match", `Solo conformes (${matchedSkus})`]] as const).map(([key, label]) => (
                      <button key={key} type="button" aria-pressed={matrixFilter === key} onClick={() => setMatrixFilter(key)} className={`btn-press px-4 py-2 text-sm font-bold cursor-pointer ${matrixFilter === key ? "bg-(--pm-ink) text-white" : "text-(--pm-text-secondary) hover:bg-(--pm-selection)"}`}>{label}</button>
                    ))}
                  </div>
                </div>
                <p className="mt-1 text-sm text-(--pm-text-secondary)">Comparación de cantidades por producto entre la Factura y el Empaque.</p>
              </div>

              <div className="bg-white rounded-2xl border border-(--pm-border) px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-2"><Package className="w-5 h-5 text-(--pm-primary)" aria-hidden="true" /> Productos: <strong>{totalSkus}</strong></span>
                <span className="hidden sm:block w-px h-6 bg-(--pm-border)" aria-hidden="true" />
                <span className="inline-flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-(--pm-primary)" aria-hidden="true" /> Cantidad coincide: <strong>{matchedSkus}</strong></span>
                <span className="hidden sm:block w-px h-6 bg-(--pm-border)" aria-hidden="true" />
                <span className="inline-flex items-center gap-2"><AlertCircle className="w-5 h-5 text-(--pm-error)" aria-hidden="true" /> Con diferencia: <strong>{discrepantSkus + ambiguousSkus}</strong></span>
              </div>

              <section aria-label="Matriz comparativa por producto" className="bg-white rounded-2xl border border-(--pm-border) p-5">
                <h2 className="text-lg font-bold mb-4">Comparativo por producto</h2>
                <div className="overflow-x-auto rounded-xl border border-(--pm-border)">
                  <table className="w-full text-left text-sm min-w-[820px]">
                    <caption className="sr-only">Resumen comparativo producto por producto entre Factura y Lista de Empaque</caption>
                    <thead><tr className="bg-(--pm-selection) text-xs text-(--pm-ink)"><th scope="col" className="py-3 px-4">Producto / Origen</th><th scope="col" className="py-3 px-4">Descripción</th><th scope="col" className="py-3 px-4">Facturado (Factura)</th><th scope="col" className="py-3 px-4">Empacado (Empaque)</th><th scope="col" className="py-3 px-4">Diferencia</th><th scope="col" className="py-3 px-4">Estado de cantidad</th></tr></thead>
                    <tbody className="divide-y divide-(--pm-border)">
                      {reconciliation.skuSummaries.filter((sm) => matrixFilter === "all" ? true : matrixFilter === "match" ? sm.status === "MATCHED" : sm.status !== "MATCHED").map((sm) => {
                        const invLine = invoice.lines.find((l) => l.line_id === sm.invoiceLineId);
                        const effInvQty = comparableQuantities(sm)?.invoiceQty ?? null;
                        const qtyDiff = effInvQty === null ? null : sm.packingTotalQty - effInvQty;
                        const isHighlighted = (sm.invoiceLineId && highlightedOrigins.includes(sm.invoiceLineId)) || sm.packingRowIds.some((r) => highlightedOrigins.includes(r));
                        const otherFinding = sm.status === "MATCHED" ? findings.find((f) => f.sku === sm.sku) : undefined;
                        return (
                          <tr key={`${sm.sku}-${sm.invoiceLineId}`} onClick={() => setHighlightedOrigins([...(sm.invoiceLineId ? [sm.invoiceLineId] : []), ...sm.packingRowIds])} className={`cursor-pointer ${qtyDiff !== null && qtyDiff !== 0 ? "bg-(--pm-error-bg)/60" : ""} ${isHighlighted ? "bg-(--pm-selection)/60" : "hover:bg-(--pm-paper)"}`}>
                            <td className="py-4 px-4"><span className="block font-black">{sm.sku}</span><span className="block text-xs text-(--pm-text-secondary) mt-0.5">{sm.invoiceLineId ? formatOriginLabel(sm.invoiceLineId) : "No está en la Factura"} ↔ {sm.packingRowIds.length > 0 ? sm.packingRowIds.map((r) => `Empaque ${r.replace("PL-R", "Fila ")}`).join(", ") : "Sin cajas"}</span></td>
                            <td className="py-4 px-4">{invLine?.description || "-"}</td>
                            <td className="py-4 px-4 whitespace-nowrap"><strong>{sm.invoiceQty !== null ? fmtNumber.format(sm.invoiceQty) : "-"}</strong> {sm.invoiceUnit}{sm.conversionFactorUsed && <span className="block text-xs text-(--pm-primary)">(1 SET = {sm.conversionFactorUsed} PCS → {fmtNumber.format(effInvQty ?? 0)} {sm.packingUnit})</span>}</td>
                            <td className="py-4 px-4 whitespace-nowrap"><strong>{fmtNumber.format(sm.packingTotalQty)}</strong> {sm.packingUnit}</td>
                            <td className="py-4 px-4 whitespace-nowrap">{qtyDiff === null ? <span className="text-(--pm-text-secondary)">-</span> : qtyDiff === 0 ? <span className="inline-flex px-3 py-1 rounded-full bg-(--pm-selection) text-(--pm-primary) font-bold text-xs">0</span> : <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-(--pm-error-bg) text-(--pm-error) font-bold text-xs"><span className="h-2 w-2 rounded-full bg-(--pm-error)" aria-hidden="true" />{qtyDiff > 0 ? "+" : ""}{fmtNumber.format(qtyDiff)} {sm.packingUnit}</span>}</td>
                            <td className="py-4 px-4">{sm.status === "MATCHED" ? <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-(--pm-selection) text-(--pm-primary) font-bold text-xs"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Cantidad coincide</span> : sm.status === "DISCREPANCY" ? <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-(--pm-error-bg) text-(--pm-error) font-bold text-xs"><AlertCircle className="w-4 h-4" aria-hidden="true" /> Diferencia</span> : <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-(--pm-warning-bg) text-(--pm-warning-text) font-bold text-xs"><HelpCircle className="w-4 h-4" aria-hidden="true" /> Por confirmar</span>}{otherFinding && <span className="flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-full bg-(--pm-warning-bg) text-(--pm-warning-text) font-bold text-xs w-fit"><AlertCircle className="w-3.5 h-3.5" aria-hidden="true" /> Otro hallazgo: {shortFindingLabel(otherFinding.code).toLowerCase()}.</span>}</td>
                          </tr>
                        );
                      })}
                      {reconciliation.skuSummaries.length === 0 && <tr><td colSpan={6} className="py-8 px-4 text-center text-(--pm-text-secondary)">Sin productos todavía. Agrega renglones en la captura manual (Paso 4).</td></tr>}
                      {reconciliation.skuSummaries.length > 0 && reconciliation.skuSummaries.filter((sm) => matrixFilter === "all" ? true : matrixFilter === "match" ? sm.status === "MATCHED" : sm.status !== "MATCHED").length === 0 && <tr><td colSpan={6} className="py-8 px-4 text-center text-(--pm-text-secondary)">Ningún producto coincide con este filtro.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <p className="mt-4 flex items-start gap-2 text-sm text-(--pm-text-secondary)"><Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> La coincidencia de cantidades no resuelve otros hallazgos (p. ej., importe de factura).</p>
              </section>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={() => goToStep(2)} className="btn-press inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-(--pm-border) bg-white text-sm font-bold cursor-pointer"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Volver a documentos</button>
                <button type="button" onClick={() => goToStep(4)} className="btn-press inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold cursor-pointer">Preparar mensaje al proveedor <ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
              </div>
            </>
          )}

          {activeStep === 4 && (
            <>
              {showEditableTables ? (
                <>
                  <div>
                    <p className="text-[11px] font-bold tracking-[0.18em] text-(--pm-primary)">{isWorkspaceEmpty ? "CAPTURA DE DATOS" : "SIMULACIÓN"}</p>
                    <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
                      <h1 className="text-3xl sm:text-4xl font-black tracking-tight">{isWorkspaceEmpty ? "Captura manual" : "Simulación manual"}</h1>
                      {!hasData && <span className="px-3 py-1.5 rounded-full border border-(--pm-border) bg-white text-sm font-bold text-(--pm-text-secondary)">Sin datos</span>}
                    </div>
                    <p className="mt-1 text-sm text-(--pm-text-secondary)">{isWorkspaceEmpty ? "Agrega los productos de la factura y las cajas del envío." : "Cambia una cantidad o peso y comprueba al instante si el embarque queda listo."}</p>
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5 items-start">
                    {editableTables}
                    <PackMatchMemo supplierMemo={supplierMemo} canExport={canExport} memoLang={memoLang} onLangChange={setMemoLang} copiedMemo={copiedMemo} onCopy={handleCopyMemo} onDownload={handleDownloadCsv} compact={true} />
                  </div>
                  {hasData && findings.length > 0 && (<div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-(--pm-error-bg) border border-(--pm-error-border) px-5 py-3 text-sm"><span className="inline-flex items-center gap-2 font-bold text-(--pm-error)"><AlertCircle className="w-5 h-5" aria-hidden="true" /> {findings.length} hallazgo{findings.length === 1 ? "" : "s"} por revisar</span><span className="text-(--pm-text-secondary)">{findings.map((f) => shortFindingTitle(f, invoice, reconciliation.skuSummaries)).join(" · ")}</span></div>)}
                  <div className="flex justify-start"><button type="button" onClick={() => goToStep(1)} className="btn-press inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-(--pm-primary) bg-white text-(--pm-primary) text-sm font-bold cursor-pointer"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Volver al diagnóstico</button></div>
                </>
              ) : (
                <>
                  <div>
                    {eyebrow && <p className="text-[11px] font-bold tracking-[0.18em] text-(--pm-primary)">{eyebrow}</p>}
                    <div className="flex flex-wrap items-center gap-3 mt-1">
                      <h1 className="text-3xl sm:text-4xl font-black tracking-tight">Mensaje al proveedor</h1>
                      <span className="hidden sm:block w-px h-8 bg-(--pm-border)" aria-hidden="true" />
                      {discrepanciesCount > 0 && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-error-border) bg-(--pm-error-bg) text-sm font-bold text-(--pm-error)"><AlertCircle className="w-4 h-4" aria-hidden="true" /> {discrepanciesCount} Discrepancia{discrepanciesCount === 1 ? "" : "s"}</span>}
                      {ambiguitiesCount > 0 && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--pm-warning-border) bg-(--pm-warning-bg) text-sm font-bold text-(--pm-warning-text)"><HelpCircle className="w-4 h-4" aria-hidden="true" /> Requiere revisión</span>}
                      <span className="ml-auto hidden lg:inline-block text-[11px] font-bold tracking-widest px-3 py-1.5 rounded-full bg-(--pm-selection) text-(--pm-primary) border border-(--pm-border)">MINUTA PRE-DESPACHO</span>
                    </div>
                    <p className="mt-1 text-sm text-(--pm-text-secondary)">Copie y envíe la minuta a la fábrica para que corrijan las diferencias.</p>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5 items-start">
                    <section aria-label="Minuta" className="bg-white rounded-2xl border border-(--pm-border) p-5 sm:p-6">
                      <div className="flex items-center justify-between gap-3 pb-4 border-b border-(--pm-border)"><BrandLogo size="sm" theme="light" /><span className="text-[11px] font-bold tracking-widest px-3 py-1.5 rounded-full bg-(--pm-selection) text-(--pm-primary) border border-(--pm-border)">MINUTA PRE-DESPACHO</span></div>
                      {hasData ? <pre className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-(--pm-ink)">{supplierMemo}</pre> : <div className="mt-4 rounded-xl border border-dashed border-(--pm-border) bg-(--pm-paper) px-4 py-12 text-center text-sm text-(--pm-text-secondary)">El mensaje estará disponible cuando agregues datos completos y válidos.</div>}
                    </section>
                    <div className="flex flex-col gap-4">
                      <div role="group" aria-label="Idioma del mensaje" className="flex rounded-full border border-(--pm-border) bg-white p-1 w-fit">
                        <button type="button" aria-pressed={memoLang === "es"} onClick={() => setMemoLang("es")} className={`btn-press px-4 py-2 rounded-full text-sm font-bold cursor-pointer ${memoLang === "es" ? "bg-(--pm-ink) text-white" : "text-(--pm-text-secondary)"}`}>Español (Minuta)</button>
                        <button type="button" aria-pressed={memoLang === "en"} onClick={() => setMemoLang("en")} className={`btn-press px-4 py-2 rounded-full text-sm font-bold cursor-pointer ${memoLang === "en" ? "bg-(--pm-ink) text-white" : "text-(--pm-text-secondary)"}`}>English (Claim Note)</button>
                      </div>
                      <section aria-label="Referencia del embarque" className="bg-white rounded-2xl border border-(--pm-border) p-5">
                        <h2 className="text-base font-bold mb-3">Referencia del embarque</h2>
                        <dl className="flex flex-col gap-2 text-sm">
                          <div className="flex items-center justify-between gap-3 rounded-lg bg-(--pm-paper) px-3 py-2"><dt className="inline-flex items-center gap-2 text-(--pm-text-secondary)"><FileText className="w-4 h-4" aria-hidden="true" /> Factura</dt><dd className="font-bold">{invoice.invoice_no}</dd></div>
                          <div className="flex items-center justify-between gap-3 rounded-lg bg-(--pm-paper) px-3 py-2"><dt className="inline-flex items-center gap-2 text-(--pm-text-secondary)"><Package className="w-4 h-4" aria-hidden="true" /> Packing List</dt><dd className="font-bold">{packingList.packing_list_no}</dd></div>
                        </dl>
                      </section>
                      <section aria-label="Hallazgos" className="bg-white rounded-2xl border border-(--pm-border) p-5">
                        <h2 className="text-base font-bold mb-3">Hallazgos · {findings.length}</h2>
                        {findings.length === 0 ? <p className="text-sm text-(--pm-text-secondary)">{hasData ? "Sin diferencias detectadas." : "Sin datos."}</p> : (
                          <ul className="flex flex-col gap-2">{findings.map((f, i) => (<li key={`${f.code}-${f.sku}-${i}`} className={`rounded-xl border p-3 flex gap-2.5 ${f.severity === "DISCREPANCY" ? "bg-(--pm-error-bg) border-(--pm-error-border)" : "bg-(--pm-warning-bg) border-(--pm-warning-border)"}`}>{f.severity === "DISCREPANCY" ? <AlertCircle className="w-5 h-5 text-(--pm-error) shrink-0" aria-hidden="true" /> : <HelpCircle className="w-5 h-5 text-(--pm-warning-text) shrink-0" aria-hidden="true" />}<span><strong className="block text-sm">{shortFindingTitle(f, invoice, reconciliation.skuSummaries)}</strong><span className="block text-xs text-(--pm-text-secondary) mt-0.5">{f.origins.join(", ")}</span></span></li>))}</ul>
                        )}
                      </section>
                      <div className="flex flex-wrap gap-3">
                        <button type="button" onClick={handleCopyMemo} disabled={!canExport} className="btn-press flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-(--pm-primary) hover:bg-(--pm-primary-hover) text-white text-sm font-bold disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"><Copy className="w-4 h-4" aria-hidden="true" /> {copiedMemo ? "Copiado" : "Copiar mensaje"}</button>
                        <button type="button" onClick={handleDownloadCsv} disabled={!canExport} className="btn-press flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-(--pm-border) bg-white text-sm font-bold disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"><Download className="w-4 h-4" aria-hidden="true" /> Descargar CSV</button>
                      </div>
                    </div>
                  </div>

                  <section aria-label="Simulación manual" className="bg-white rounded-2xl border border-(--pm-border)">
                    <button type="button" aria-expanded={showEditableTables} onClick={() => setShowEditableTables((v) => !v)} className="btn-press w-full flex flex-wrap items-center gap-3 px-5 py-4 text-left cursor-pointer">
                      <ChevronDown className={`w-5 h-5 transition-transform ${showEditableTables ? "rotate-180" : ""}`} aria-hidden="true" />
                      <span><strong className="block text-sm">Simulación manual (opcional)</strong><span className="text-xs text-(--pm-text-secondary)">Cambia una cantidad o peso y comprueba al instante si el embarque queda listo.</span></span>
                    </button>
                  </section>
                  <div><button type="button" onClick={() => goToStep(1)} className="btn-press inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-(--pm-border) bg-white text-sm font-bold cursor-pointer"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Volver al diagnóstico</button></div>
                </>
              )}
            </>
          )}
        </main>
      )}

      <footer className={`mt-auto border-t px-4 sm:px-6 py-4 ${shipmentMode === "empty" ? "border-(--pm-dark-border) text-(--pm-dark-secondary)" : "border-(--pm-border) text-(--pm-text-secondary)"}`}>
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>PackMatch</span>
          <span>La evidencia primero. Cada dato en su lugar.</span>
          {shipmentMode === "empty" && <span className="hidden sm:block">Factura ↔ Empaque</span>}
        </div>
      </footer>

      {showPasteModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="paste-modal-title" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-(--pm-ink)/80" onClick={() => setShowPasteModal(false)}>
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-(--pm-dark-surface) border border-(--pm-dark-border) rounded-2xl shadow-2xl overflow-hidden text-(--pm-paper)" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 flex items-start justify-between gap-4">
              <div><p className="text-[11px] font-bold tracking-[0.2em] text-(--pm-sage)">IMPORTAR DATOS</p><h2 id="paste-modal-title" className="text-2xl sm:text-3xl font-black mt-1">Pegar celdas desde Excel / CSV</h2><p className="text-sm text-(--pm-dark-secondary) mt-1">Copia las filas de cada documento y pégalas en su espacio.</p></div>
              <button type="button" onClick={() => setShowPasteModal(false)} aria-label="Cerrar importación" className="btn-press p-2 rounded-full hover:bg-(--pm-dark-border) cursor-pointer shrink-0"><X className="w-5 h-5" aria-hidden="true" /></button>
            </div>
            <div className="px-6 pb-4 overflow-y-auto grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
              <div className="rounded-xl border border-(--pm-dark-border) bg-(--pm-dark-inset) p-4">
                <div className="flex items-center gap-3 mb-3"><span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-(--pm-dark-raised) text-(--pm-sage)"><FileText className="w-5 h-5" aria-hidden="true" /></span><span><span className="text-xs text-(--pm-dark-secondary) mr-2">01</span><strong>Factura comercial</strong><span className="block text-xs text-(--pm-dark-secondary) mt-0.5">SKU · Descripción · Cantidad · Unidad · Precio · Subtotal</span></span></div>
                <label htmlFor="paste-invoice" className="sr-only">Filas de la factura</label>
                <textarea id="paste-invoice" autoFocus value={pasteInvoiceText} onChange={(e) => setPasteInvoiceText(e.target.value)} rows={8} placeholder="Pega aquí las filas de la factura" className="w-full p-3 rounded-lg bg-(--pm-ink) border border-dashed border-(--pm-dark-dashed) text-sm text-(--pm-paper) placeholder:text-(--pm-dark-secondary)" />
              </div>
              <span className="hidden md:flex items-center text-(--pm-sage) text-2xl" aria-hidden="true">==</span>
              <div className="rounded-xl border border-(--pm-dark-border) bg-(--pm-dark-inset) p-4">
                <div className="flex items-center gap-3 mb-3"><span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-(--pm-dark-raised) text-(--pm-sage)"><Package className="w-5 h-5" aria-hidden="true" /></span><span><span className="text-xs text-(--pm-dark-secondary) mr-2">02</span><strong>Lista de empaque</strong><span className="block text-xs text-(--pm-dark-secondary) mt-0.5">Rango · SKU · Cajas · Unid./caja · Total · Neto · Bruto</span></span></div>
                <label htmlFor="paste-packing" className="sr-only">Filas de la lista de empaque</label>
                <textarea id="paste-packing" value={pastePackingText} onChange={(e) => setPastePackingText(e.target.value)} rows={8} placeholder="Pega aquí las filas de la lista de empaque" className="w-full p-3 rounded-lg bg-(--pm-ink) border border-dashed border-(--pm-dark-dashed) text-sm text-(--pm-paper) placeholder:text-(--pm-dark-secondary)" />
              </div>
            </div>
            {pasteError && <div role="alert" className="mx-6 mb-3 px-4 py-2.5 rounded-lg bg-(--pm-error-bg) text-sm text-(--pm-error) font-medium">{pasteError}</div>}
            <div className="px-6 py-4 border-t border-(--pm-dark-border) flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-(--pm-dark-secondary)">Separadores admitidos: tabulación, coma o punto y coma.</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => setShowPasteModal(false)} className="btn-press px-5 py-2.5 rounded-full border border-(--pm-paper)/50 text-sm font-bold cursor-pointer">Cancelar</button>
                <button type="button" onClick={handleImportPastedCells} className="btn-press px-6 py-2.5 rounded-full bg-(--pm-sage) text-(--pm-ink) text-sm font-black cursor-pointer">Cruzar datos</button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
