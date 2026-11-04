import type { InvoiceLine, PackingListRow } from "./reconcile.ts";
import type { UiLocale } from "./i18n/locale.ts";
import { formatTemplate, getDictionary } from "./i18n/dictionaries.ts";

export type PasteErrorCode =
  | "UNCLOSED_QUOTE"
  | "MISSING_FIELD"
  | "INVALID_NUMBER"
  | "BAD_WEIGHT_UNIT"
  | "BAD_SHARED_FLAG"
  | "BAD_WEIGHT_SCOPE"
  | "CONFLICTING_COLUMNS"
  | "INVOICE_FORMAT"
  | "DUPLICATE_SKU"
  | "MISSING_SKU"
  | "CARTONS_INT"
  | "PACKING_FORMAT"
  | "INVOICE_ROW"
  | "PACKING_ROW";

/** Error con código estable: la UI localiza por `code`, nunca comparando frases. */
export class PasteError extends Error {
  code: PasteErrorCode;
  constructor(code: PasteErrorCode, message: string) {
    super(message);
    this.name = "PasteError";
    this.code = code;
  }
}

type PasteFieldLabel =
  | "labelQty" | "labelPrice" | "labelSubtotal" | "labelCartons"
  | "labelPerCarton" | "labelTotal" | "labelNet" | "labelGross";

function msg(locale: UiLocale, pick: (d: ReturnType<typeof getDictionary>["pasteErrors"]) => string, vars?: Record<string, string | number>): string {
  return formatTemplate(pick(getDictionary(locale).pasteErrors), vars);
}

function labelText(locale: UiLocale, label: PasteFieldLabel): string {
  const p = getDictionary(locale).pasteErrors;
  return p[label];
}

/** One delimiter per sheet; quoted delimiters, escaped quotes and multiline cells are preserved. */
function records(text: string, locale: UiLocale): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const counts = new Map([["\t", 0], [";", 0], [",", 0]]);
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') { if (quoted && input[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted) {
      if (c === "\n" || c === "\r") break;
      if (counts.has(c)) counts.set(c, counts.get(c)! + 1);
    }
  }
  const delimiter = counts.get("\t")! > 0 ? "\t" : counts.get(";")! > 0 ? ";" : ",";
  const result: string[][] = [];
  let row: string[] = [], cell = "";
  quoted = false;
  const pushRow = () => { row.push(cell.trim()); if (row.some(Boolean)) result.push(row); row = []; cell = ""; };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell.trim() === "") quoted = !quoted;
      else cell += c;
    } else if (!quoted && c === delimiter) { row.push(cell.trim()); cell = ""; }
    else if (!quoted && (c === "\n" || c === "\r")) { pushRow(); if (c === "\r" && input[i + 1] === "\n") i++; }
    else cell += c;
  }
  if (quoted) throw new PasteError("UNCLOSED_QUOTE", msg(locale, (p) => p.unclosedQuote));
  pushRow();
  return result;
}

/** Comma or dot decimals; mixed separators use the last separator as the decimal mark. */
function numeric(raw: string | undefined, label: PasteFieldLabel, locale: UiLocale, fallback?: number): number {
  if (raw === undefined || raw.trim() === "") {
    if (fallback !== undefined) return fallback;
    throw new PasteError("MISSING_FIELD", msg(locale, (p) => p.missing, { label: labelText(locale, label) }));
  }
  let value = raw.normalize("NFKC").trim().replace(/^(?:USD|EUR|CLP|CNY|RMB)\s*/i, "").replace(/[$€£¥\s 元块]/g, "");
  const comma = value.lastIndexOf(","), dot = value.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    value = comma > dot ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  } else if (comma >= 0) {
    if ((value.match(/,/g) || []).length > 1 && /^\d{1,3}(,\d{3})+$/.test(value)) value = value.replace(/,/g, "");
    else value = value.replace(",", ".");
  } else if ((value.match(/\./g) || []).length > 1 && /^\d{1,3}(\.\d{3})+$/.test(value)) value = value.replace(/\./g, "");
  const n = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) throw new PasteError("INVALID_NUMBER", msg(locale, (p) => p.invalidNumber, { label: labelText(locale, label), value: raw }));
  return n;
}
const isNumeric = (raw: string | undefined, locale: UiLocale) => { try { numeric(raw, "labelQty", locale); return true; } catch { return false; } };
const key = (s: string = "") => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
// Cabeceras en chino (los caracteres CJK no sobreviven a key(): se comparan en bruto).
const ZH_SKU_HEADERS = ["产品", "编码", "型号", "品名", "料号", "货号", "物料"];
const ZH_QTY_HEADERS = ["数量", "件数", "总数", "总量"];
const ZH_PACKING_HEADERS = ["箱号", "箱数", "净重", "毛重", "重量", "托盘"];
const hasZh = (s: string, words: string[]) => words.some((w) => s.includes(w));
const skuHeader = (s: string) => ["sku", "producto", "codigo", "part", "item"].includes(key(s)) || hasZh(s, ZH_SKU_HEADERS);
const quantityHeader = (s: string) => ["cantidad", "qty", "quantity", "total", "totalunid", "totalqty"].includes(key(s)) || hasZh(s, ZH_QTY_HEADERS);
function qtyUnit(raw: string | undefined): string {
  const s = (raw || "PCS").normalize("NFKC").trim().toUpperCase();
  if (["PCS", "PC", "EA", "PZA", "PIEZA", "PIEZAS", "UND", "UN"].includes(s)) return "PCS";
  if (["SETS", "SET", "KIT", "KITS", "JUEGO", "JUEGOS"].includes(s)) return "SETS";
  // Unidades contables inequívocas en chino; las ambiguas (箱) se copian verbatim.
  if (["件", "个", "只", "台", "片", "支", "颗", "粒", "瓶", "袋"].includes(s)) return "PCS";
  if (["套", "组"].includes(s)) return "SETS";
  return s.normalize("NFKC").trim();
}
function weightUnit(raw: string | undefined, locale: UiLocale): string {
  const s = (raw || "KG").normalize("NFKC").trim().toUpperCase();
  if (["LB", "LBS", "LIBRA", "LIBRAS"].includes(s)) return "LBS";
  if (["KG", "KGS", "KILOGRAMO", "KILOGRAMOS"].includes(s)) return "KG";
  if (["千克", "公斤"].includes(s)) return "KG";
  if (["磅", "英磅"].includes(s)) return "LBS";
  throw new PasteError("BAD_WEIGHT_UNIT", msg(locale, (p) => p.badWeightUnit, { value: raw ?? "" }));
}

export function parseInvoicePaste(text: string, locale: UiLocale = "es"): InvoiceLine[] {
  const out: InvoiceLine[] = [];
  const seen = new Set<string>();
  records(text, locale).forEach((c, idx) => {
    if (skuHeader(c[0]) && c.slice(1).some(quantityHeader)) return;
    try {
      if (c.length < 2 || c.length > 6 || !c[0]) throw new PasteError("INVOICE_FORMAT", msg(locale, (p) => p.invoiceFormat));
      const sku = c[0];
      if (seen.has(sku)) throw new PasteError("DUPLICATE_SKU", msg(locale, (p) => p.duplicateSku, { sku }));
      let description = "", qty: number, unit = "PCS", price = 0, amount: number | undefined;
      if (c.length === 6) {
        description = c[1]; qty = numeric(c[2], "labelQty", locale); unit = qtyUnit(c[3]); price = numeric(c[4], "labelPrice", locale, 0); amount = numeric(c[5], "labelSubtotal", locale, qty * price);
      } else if (c.length === 5) {
        if (isNumeric(c[1], locale)) { qty = numeric(c[1], "labelQty", locale); unit = qtyUnit(c[2]); price = numeric(c[3], "labelPrice", locale, 0); amount = numeric(c[4], "labelSubtotal", locale, qty * price); }
        else { description = c[1]; qty = numeric(c[2], "labelQty", locale); unit = qtyUnit(c[3]); price = numeric(c[4], "labelPrice", locale, 0); }
      } else if (c.length === 4) {
        if (isNumeric(c[1], locale)) { qty = numeric(c[1], "labelQty", locale); unit = qtyUnit(c[2]); price = numeric(c[3], "labelPrice", locale, 0); }
        else { description = c[1]; qty = numeric(c[2], "labelQty", locale); price = numeric(c[3], "labelPrice", locale, 0); }
      } else { qty = numeric(c[1], "labelQty", locale); if (c.length === 3) price = numeric(c[2], "labelPrice", locale, 0); }
      seen.add(sku);
      out.push({ line_id: `INV-L${out.length + 1}`, sku, description, qty, unit, unit_price: price, line_amount: amount ?? qty * price, explicit_pcs_per_set: null, operator_pcs_per_set: null });
    } catch (e) {
      if (e instanceof PasteError && e.code !== "INVOICE_ROW") {
        throw new PasteError("INVOICE_ROW", msg(locale, (p) => p.invoiceRow, { row: idx + 1, reason: e.message }));
      }
      throw e;
    }
  });
  return out;
}

const SHARED_TRUE = ["SI", "SÍ", "YES", "Y", "TRUE", "1", "SHARED", "COMPARTIDA", "COMPARTIDO", "MIX", "混装", "共享", "是"];
const SHARED_FALSE = ["NO", "FALSE", "0", "N", ""];
function sharedToken(raw: string | undefined, locale: UiLocale): boolean | undefined {
  if (raw === undefined) return undefined;
  const s = raw.normalize("NFKC").trim().toUpperCase();
  if (SHARED_FALSE.includes(s)) return s === "" ? undefined : false;
  if (SHARED_TRUE.includes(s)) return true;
  throw new PasteError("BAD_SHARED_FLAG", msg(locale, (p) => p.badShared, { value: raw }));
}
function weightScopeToken(raw: string | undefined, locale: UiLocale): PackingListRow["weight_scope"] {
  if (raw === undefined || raw.trim() === "") return undefined;
  const s = raw.normalize("NFKC").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (["CARTON_TOTAL", "TOTAL_CAJA", "TOTAL", "REPETIDO", "REPEATED", "REPEATED_TOTAL", "MISMO_PESO"].includes(s)) return "CARTON_TOTAL";
  if (["PER_ROW", "POR_FILA", "POR_PRODUCTO", "PER_PRODUCT", "DISTRIBUIDO", "DISTRIBUTED", "FILA"].includes(s)) return "PER_ROW";
  if (["UNSPECIFIED", "SIN_DETERMINAR", "AMBIGUO", "DESCONOCIDO", "UNKNOWN"].includes(s)) return "UNSPECIFIED";
  throw new PasteError("BAD_WEIGHT_SCOPE", msg(locale, (p) => p.badWeightScope, { value: raw }));
}
const isWeightScopeToken = (raw: string) => ["CARTON_TOTAL", "TOTAL_CAJA", "TOTAL", "REPETIDO", "REPEATED", "REPEATED_TOTAL", "MISMO_PESO", "PER_ROW", "POR_FILA", "POR_PRODUCTO", "PER_PRODUCT", "DISTRIBUIDO", "DISTRIBUTED", "FILA", "UNSPECIFIED", "SIN_DETERMINAR", "AMBIGUO", "DESCONOCIDO", "UNKNOWN"].includes(raw.normalize("NFKC").trim().toUpperCase().replace(/[\s-]+/g, "_"));
const isWeightUnitToken = (raw: string) => ["KG", "KGS", "KILOGRAMO", "KILOGRAMOS", "LB", "LBS", "LIBRA", "LIBRAS", "千克", "公斤", "磅", "英磅"].includes(raw.normalize("NFKC").trim().toUpperCase());
const isSalesUnitToken = (raw: string) => ["PCS", "PC", "EA", "PZA", "PIEZA", "PIEZAS", "UND", "UN", "SETS", "SET", "KIT", "KITS", "JUEGO", "JUEGOS", "件", "个", "套", "组"].includes(raw.normalize("NFKC").trim().toUpperCase());

export function parsePackingPaste(text: string, locale: UiLocale = "es"): PackingListRow[] {
  const out: PackingListRow[] = [];
  records(text, locale).forEach((c, idx) => {
    if ((skuHeader(c[0]) || skuHeader(c[1])) && c.slice(1).some(x => quantityHeader(x) || hasZh(x, ZH_PACKING_HEADERS) || ["cajas", "cartons", "neto", "bruto"].includes(key(x)))) return;
    try {
      if (c.length < 2 || c.length > 14 || !c[0]) throw new PasteError("PACKING_FORMAT", msg(locale, (p) => p.packingFormat));
      let sku = "", range = `CTN ${out.length + 1}`, cartons = 1, per = 0, total = 0, net = 0, gross = 0, unit = "KG";
      // Formato extendido (compatible): tras las 7 columnas clásicas pueden
      // venir, en cualquier orden, unidad de peso, unidad de venta
      // (PCS/SETS/...), caja compartida (SI/NO) y alcance del peso
      // (TOTAL_CAJA = total repetido por caja, POR_FILA = peso por producto,
      // SIN_DETERMINAR). Sin esas columnas se conserva el formato antiguo.
      let salesUnit: string | undefined, shared: boolean | undefined, weightScope: PackingListRow["weight_scope"];
      let seenWeightUnit = false;
      if (c.length >= 7) { range = c[0]; sku = c[1]; cartons = numeric(c[2], "labelCartons", locale); per = numeric(c[3], "labelPerCarton", locale); total = numeric(c[4], "labelTotal", locale); net = numeric(c[5], "labelNet", locale, 0); gross = numeric(c[6], "labelGross", locale, 0);
        // Columnas opcionales en cualquier orden: cada tipo se lee por
        // separado. El alcance del peso (POR_FILA, TOTAL_CAJA...) NO marca
        // la caja como compartida: eso solo lo decide SI/NO. Repetir una
        // columna con el mismo valor es inocuo; valores incompatibles
        // lanzan CONFLICTING_COLUMNS en vez de sobrescribir en silencio.
        const conflict = (value: string) => new PasteError("CONFLICTING_COLUMNS", msg(locale, (p) => p.conflictingColumns, { value }));
        for (const extra of c.slice(7)) {
          if (extra.trim() === "") continue;
          if (isWeightUnitToken(extra)) {
            const u = weightUnit(extra, locale);
            if (seenWeightUnit && u !== unit) throw conflict(extra);
            unit = u; seenWeightUnit = true;
          } else if (isSalesUnitToken(extra)) {
            const u = qtyUnit(extra);
            if (salesUnit !== undefined && u !== salesUnit) throw conflict(extra);
            salesUnit = u;
          } else if (isWeightScopeToken(extra)) {
            const s = weightScopeToken(extra, locale);
            if (weightScope !== undefined && s !== weightScope) throw conflict(extra);
            weightScope = s;
          } else {
            const s = sharedToken(extra, locale);
            if (s !== undefined) {
              if (shared !== undefined && s !== shared) throw conflict(extra);
              shared = s;
            }
          }
        }
      }
      else if (c.length === 6) {
        if (isNumeric(c[1], locale)) { sku = c[0]; cartons = numeric(c[1], "labelCartons", locale); per = numeric(c[2], "labelPerCarton", locale); total = numeric(c[3], "labelTotal", locale); net = numeric(c[4], "labelNet", locale, 0); gross = numeric(c[5], "labelGross", locale, 0); }
        else { range = c[0]; sku = c[1]; per = numeric(c[2], "labelPerCarton", locale); total = numeric(c[3], "labelTotal", locale); net = numeric(c[4], "labelNet", locale, 0); gross = numeric(c[5], "labelGross", locale, 0); }
      } else if (c.length === 5) { sku = c[0]; per = numeric(c[1], "labelPerCarton", locale); total = numeric(c[2], "labelTotal", locale); net = numeric(c[3], "labelNet", locale, 0); gross = numeric(c[4], "labelGross", locale, 0); }
      else { sku = c[0]; total = numeric(c[1], "labelTotal", locale); per = total; if (c.length === 4) { net = numeric(c[2], "labelNet", locale, 0); gross = numeric(c[3], "labelGross", locale, 0); } else if (c.length === 3) { gross = numeric(c[2], "labelGross", locale, 0); net = gross; } }
      if (!sku) throw new PasteError("MISSING_SKU", msg(locale, (p) => p.missingSku));
      if (!Number.isSafeInteger(cartons)) throw new PasteError("CARTONS_INT", msg(locale, (p) => p.cartonsInt));
      // Sin columna de unidad de venta (formato antiguo) se conserva PCS por
      // compatibilidad; el formato extendido la trae explícita y nunca se
      // adivina. Caja compartida sin alcance de peso -> UNSPECIFIED (ambiguo
      // resoluble), nunca "caja independiente" ni "total repetido" por defecto.
      const isShared = shared ?? false;
      out.push({ row_id: `PL-R${out.length + 1}`, carton_range: range, carton_count: cartons, sku, qty_per_carton: per, total_qty: total, unit: salesUnit ?? "PCS", net_weight: net, gross_weight: gross, weight_unit: unit, shared_carton: isShared, weight_scope: weightScope ?? (isShared ? "UNSPECIFIED" : undefined), explicit_pcs_per_set: null, is_packaging_only: false });
    } catch (e) {
      if (e instanceof PasteError && e.code !== "PACKING_ROW") {
        throw new PasteError("PACKING_ROW", msg(locale, (p) => p.packingRow, { row: idx + 1, reason: e.message }));
      }
      throw e;
    }
  });
  return out;
}
