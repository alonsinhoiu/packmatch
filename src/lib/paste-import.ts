import type { InvoiceLine, PackingListRow } from "./reconcile.ts";

/** One delimiter per sheet; quoted delimiters, escaped quotes and multiline cells are preserved. */
function records(text: string): string[][] {
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
  if (quoted) throw new Error("Hay una celda con comillas sin cerrar. Revisa el CSV antes de importar.");
  pushRow();
  return result;
}

/** Comma or dot decimals; mixed separators use the last separator as the decimal mark. */
function numeric(raw: string | undefined, label: string, fallback?: number): number {
  if (raw === undefined || raw.trim() === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Falta ${label}.`);
  }
  let value = raw.trim().replace(/^(?:USD|EUR|CLP)\s*/i, "").replace(/[$€£\s\u00a0]/g, "");
  const comma = value.lastIndexOf(","), dot = value.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    value = comma > dot ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  } else if (comma >= 0) {
    if ((value.match(/,/g) || []).length > 1 && /^\d{1,3}(,\d{3})+$/.test(value)) value = value.replace(/,/g, "");
    else value = value.replace(",", ".");
  } else if ((value.match(/\./g) || []).length > 1 && /^\d{1,3}(\.\d{3})+$/.test(value)) value = value.replace(/\./g, "");
  const n = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} debe ser un número válido mayor o igual que cero (recibido: «${raw}»).`);
  return n;
}
const isNumeric = (raw: string | undefined) => { try { numeric(raw, "el valor"); return true; } catch { return false; } };
const key = (s: string = "") => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const skuHeader = (s: string) => ["sku", "producto", "codigo", "part", "item"].includes(key(s));
const quantityHeader = (s: string) => ["cantidad", "qty", "quantity", "total", "totalunid", "totalqty"].includes(key(s));
function qtyUnit(raw: string | undefined): string {
  const s = (raw || "PCS").trim().toUpperCase();
  if (["PCS", "PC", "EA", "PZA", "PIEZA", "PIEZAS", "UND", "UN"].includes(s)) return "PCS";
  if (["SETS", "SET", "KIT", "KITS", "JUEGO", "JUEGOS"].includes(s)) return "SETS";
  return s;
}
function weightUnit(raw: string | undefined): string {
  const s = (raw || "KG").trim().toUpperCase();
  if (["LB", "LBS", "LIBRA", "LIBRAS"].includes(s)) return "LBS";
  if (["KG", "KGS", "KILOGRAMO", "KILOGRAMOS"].includes(s)) return "KG";
  throw new Error(`Unidad de peso no admitida: «${raw}». Usa KG o LBS.`);
}

export function parseInvoicePaste(text: string): InvoiceLine[] {
  const out: InvoiceLine[] = [];
  const seen = new Set<string>();
  records(text).forEach((c, idx) => {
    if (skuHeader(c[0]) && c.slice(1).some(quantityHeader)) return;
    try {
      if (c.length < 2 || c.length > 6 || !c[0]) throw new Error("Usa SKU y cantidad; el formato completo es SKU, descripción, cantidad, unidad, precio y subtotal.");
      const sku = c[0];
      if (seen.has(sku)) throw new Error(`El SKU «${sku}» está repetido. Agrupa sus líneas en una sola antes de importar.`);
      let description = "", qty: number, unit = "PCS", price = 0, amount: number | undefined;
      if (c.length === 6) {
        description = c[1]; qty = numeric(c[2], "la cantidad"); unit = qtyUnit(c[3]); price = numeric(c[4], "el precio", 0); amount = numeric(c[5], "el subtotal", qty * price);
      } else if (c.length === 5) {
        if (isNumeric(c[1])) { qty = numeric(c[1], "la cantidad"); unit = qtyUnit(c[2]); price = numeric(c[3], "el precio", 0); amount = numeric(c[4], "el subtotal", qty * price); }
        else { description = c[1]; qty = numeric(c[2], "la cantidad"); unit = qtyUnit(c[3]); price = numeric(c[4], "el precio", 0); }
      } else if (c.length === 4) {
        if (isNumeric(c[1])) { qty = numeric(c[1], "la cantidad"); unit = qtyUnit(c[2]); price = numeric(c[3], "el precio", 0); }
        else { description = c[1]; qty = numeric(c[2], "la cantidad"); price = numeric(c[3], "el precio", 0); }
      } else { qty = numeric(c[1], "la cantidad"); if (c.length === 3) price = numeric(c[2], "el precio", 0); }
      seen.add(sku);
      out.push({ line_id: `INV-L${out.length + 1}`, sku, description, qty, unit, unit_price: price, line_amount: amount ?? qty * price, explicit_pcs_per_set: null, operator_pcs_per_set: null });
    } catch (e) { throw new Error(`Factura, fila ${idx + 1}: ${(e as Error).message}`); }
  });
  return out;
}

export function parsePackingPaste(text: string): PackingListRow[] {
  const out: PackingListRow[] = [];
  records(text).forEach((c, idx) => {
    if ((skuHeader(c[0]) || skuHeader(c[1])) && c.slice(1).some(x => quantityHeader(x) || ["cajas", "cartons", "neto", "bruto"].includes(key(x)))) return;
    try {
      if (c.length < 2 || c.length > 8 || !c[0]) throw new Error("Usa SKU y total; el formato completo es rango, SKU, cajas, unidades/caja, total, neto y bruto.");
      let sku = "", range = `CTN ${out.length + 1}`, cartons = 1, per = 0, total = 0, net = 0, gross = 0, unit = "KG";
      if (c.length >= 7) { range = c[0]; sku = c[1]; cartons = numeric(c[2], "el número de cajas"); per = numeric(c[3], "las unidades por caja"); total = numeric(c[4], "el total de unidades"); net = numeric(c[5], "el peso neto", 0); gross = numeric(c[6], "el peso bruto", 0); unit = weightUnit(c[7]); }
      else if (c.length === 6) {
        if (isNumeric(c[1])) { sku = c[0]; cartons = numeric(c[1], "el número de cajas"); per = numeric(c[2], "las unidades por caja"); total = numeric(c[3], "el total de unidades"); net = numeric(c[4], "el peso neto", 0); gross = numeric(c[5], "el peso bruto", 0); }
        else { range = c[0]; sku = c[1]; per = numeric(c[2], "las unidades por caja"); total = numeric(c[3], "el total de unidades"); net = numeric(c[4], "el peso neto", 0); gross = numeric(c[5], "el peso bruto", 0); }
      } else if (c.length === 5) { sku = c[0]; per = numeric(c[1], "las unidades por caja"); total = numeric(c[2], "el total de unidades"); net = numeric(c[3], "el peso neto", 0); gross = numeric(c[4], "el peso bruto", 0); }
      else { sku = c[0]; total = numeric(c[1], "el total de unidades"); per = total; if (c.length === 4) { net = numeric(c[2], "el peso neto", 0); gross = numeric(c[3], "el peso bruto", 0); } else if (c.length === 3) { gross = numeric(c[2], "el peso bruto", 0); net = gross; } }
      if (!sku) throw new Error("Falta el SKU.");
      if (!Number.isSafeInteger(cartons)) throw new Error("El número de cajas debe ser un entero mayor o igual que cero.");
      out.push({ row_id: `PL-R${out.length + 1}`, carton_range: range, carton_count: cartons, sku, qty_per_carton: per, total_qty: total, unit: "PCS", net_weight: net, gross_weight: gross, weight_unit: unit, shared_carton: false, explicit_pcs_per_set: null, is_packaging_only: false });
    } catch (e) { throw new Error(`Empaque, fila ${idx + 1}: ${(e as Error).message}`); }
  });
  return out;
}
