import fs from "node:fs";
import path from "node:path";
import {
  PRELOADED_CASES,
  WORST_CASE_BREAK_UI_SHIPMENT,
} from "../src/lib/preloaded-cases.ts";
import { reconcileShipment } from "../src/lib/reconcile.ts";
import {
  normalizeExtractedPayload,
  validateDataUrlAndMagicBytes,
} from "../src/lib/normalize-extracted.ts";
import {
  generateSupplierMemo,
  generateReconciliationCsv,
  sanitizeCsvCell,
  type AuditLogEntry,
} from "../src/lib/supplier-memo.ts";

const rootDir = process.cwd();
const casesDir = path.join(rootDir, "work/prueba-packmatch/cases");

console.log("===============================================================");
console.log("  VALIDACIÓN AUTOMÁTICA END-TO-END DEL MVP PACKMATCH (CA-1..10)");
console.log("===============================================================\n");

// --- CA-1: Paridad 100% con el benchmark validado en C01..C07 (13/13 hallazgos, 0 falsas alertas, orígenes exactos) ---
let ca1TotalExpected = 0;
let ca1TotalHits = 0;
let ca1TotalOriginHits = 0;
let ca1FalseAlerts = 0;

for (const c of PRELOADED_CASES) {
  const gt = JSON.parse(
    fs.readFileSync(path.join(casesDir, c.case_id, "ground_truth.json"), "utf-8")
  );
  const res = reconcileShipment(c.extracted.invoice, c.extracted.packing_list);

  const expMap = new Map<string, Set<string>>();
  for (const f of gt.expected_findings) {
    expMap.set(`${f.code}::${f.sku}`, new Set(f.origins));
  }
  const obtMap = new Map<string, Set<string>>();
  for (const f of res.findings) {
    obtMap.set(`${f.code}::${f.sku}`, new Set(f.origins));
  }

  for (const [k, expOrigins] of expMap.entries()) {
    ca1TotalExpected++;
    const obtOrigins = obtMap.get(k);
    if (obtOrigins) {
      ca1TotalHits++;
      if (
        expOrigins.size === obtOrigins.size &&
        Array.from(expOrigins).every((o) => obtOrigins.has(o))
      ) {
        ca1TotalOriginHits++;
      }
    }
  }
  for (const k of obtMap.keys()) {
    if (!expMap.has(k)) ca1FalseAlerts++;
  }
}

if (
  PRELOADED_CASES.length !== 7 ||
  ca1TotalHits !== 13 ||
  ca1TotalOriginHits !== 13 ||
  ca1FalseAlerts !== 0
) {
  throw new Error(
    `CA-1 FALLÓ: cases=${PRELOADED_CASES.length}, hits=${ca1TotalHits}/13, origins=${ca1TotalOriginHits}/13, false=${ca1FalseAlerts}`
  );
}
console.log(
  "✓ [CA-1] Paridad 100% verificada en los 7 casos precargados (C01-C07): 13/13 aciertos, 13/13 orígenes exactos, 0 falsas alertas."
);

// --- CA-2: Prohibición de adivinar SETS<->PCS + Resolución manual por operador ---
const c04 = structuredClone(
  PRELOADED_CASES.find((c) => c.case_id.startsWith("C04"))!.extracted
);
const resC04Initial = reconcileShipment(c04.invoice, c04.packing_list);
if (
  resC04Initial.findings.length !== 1 ||
  resC04Initial.findings[0].code !== "UNIT_AMBIGUITY_UNCONVERTIBLE"
) {
  throw new Error("CA-2 FALLÓ en estado inicial de C04");
}
// 2a. Factor incorrecto (3 -> 60*3=180 != 240)
c04.invoice.lines.find((l) => l.sku === "SKU-701")!.operator_pcs_per_set = 3;
const resC04Mismatch = reconcileShipment(c04.invoice, c04.packing_list);
if (
  resC04Mismatch.findings.length !== 1 ||
  resC04Mismatch.findings[0].code !== "QTY_MISMATCH"
) {
  throw new Error("CA-2 FALLÓ al detectar descuadre con factor manual 3");
}
// 2b. Factor confirmado correcto (4 -> 60*4=240 == 240)
c04.invoice.lines.find((l) => l.sku === "SKU-701")!.operator_pcs_per_set = 4;
const resC04Confirmed = reconcileShipment(c04.invoice, c04.packing_list);
const sku701Summary = resC04Confirmed.skuSummaries.find(
  (s) => s.sku === "SKU-701"
)!;
if (
  resC04Confirmed.findings.length !== 0 ||
  sku701Summary.conversionSource !== "OPERATOR_CONFIRMED" ||
  sku701Summary.status !== "MATCHED"
) {
  throw new Error("CA-2 FALLÓ tras confirmación de factor por operador");
}
console.log(
  "✓ [CA-2] Regla PCS<->SETS verificada: bloquea sin factor en documento y concilia al instante con trazabilidad 'OPERATOR_CONFIRMED'."
);

// --- CA-3: Separación Extracción vs Cálculo en vivo (< 50 ms sin red) ---
const c06 = structuredClone(
  PRELOADED_CASES.find((c) => c.case_id.startsWith("C06"))!.extracted
);
const t0 = performance.now();
const plR9 = c06.packing_list.rows.find((r) => r.row_id === "PL-R9")!;
plR9.qty_per_carton = 40;
plR9.total_qty = 80;
const resC06Edited = reconcileShipment(c06.invoice, c06.packing_list);
const elapsedMs = performance.now() - t0;

const stillHas804Mismatch = resC06Edited.findings.some(
  (f) => f.sku === "SKU-804"
);
if (stillHas804Mismatch || elapsedMs > 50) {
  throw new Error(
    `CA-3 FALLÓ: stillHas804Mismatch=${stillHas804Mismatch}, elapsedMs=${elapsedMs}`
  );
}
console.log(
  `✓ [CA-3] Edición de celda en vivo verificada: recálculo determinista completado en ${elapsedMs.toFixed(3)} ms (< 50 ms) y USD $0.00.`
);

// --- CA-4: Trazabilidad bidireccional y minuta de reclamo con orígenes exactos ---
const c06Initial = PRELOADED_CASES.find((c) => c.case_id.startsWith("C06"))!;
const resC06Init = reconcileShipment(
  c06Initial.extracted.invoice,
  c06Initial.extracted.packing_list
);
const memoEs = generateSupplierMemo(
  c06Initial.extracted.invoice,
  c06Initial.extracted.packing_list,
  resC06Init,
  "es"
);
const memoEn = generateSupplierMemo(
  c06Initial.extracted.invoice,
  c06Initial.extracted.packing_list,
  resC06Init,
  "en"
);
const csvOut = generateReconciliationCsv(resC06Init);

for (const originId of [
  "INV-L4",
  "PL-R3",
  "PL-R6",
  "PL-R9",
  "INV-L6",
  "PL-R11",
]) {
  if (!memoEs.includes(originId) || !memoEn.includes(originId)) {
    throw new Error(`CA-4 FALLÓ: origen ${originId} ausente en minuta`);
  }
}
if (!csvOut.includes("SKU-804") || !csvOut.includes("PL-R3|PL-R6|PL-R9")) {
  throw new Error("CA-4 FALLÓ: CSV no incluye agrupación muchos-a-uno");
}
for (const c of PRELOADED_CASES) {
  const pngInv = path.join(rootDir, "public", c.invoiceImageUrl);
  const pngPl = path.join(rootDir, "public", c.packingListImageUrl);
  if (!fs.existsSync(pngInv) || !fs.existsSync(pngPl)) {
    throw new Error(`CA-4 FALLÓ: imagen ausente en public/ para ${c.case_id}`);
  }
}
console.log(
  "✓ [CA-4] Trazabilidad bidireccional, activos visuales en public/cases/ y minutas ES/EN + CSV verificados."
);

// --- CA-5: Seguridad de credenciales (.env no expuesto en cliente ni en .next/static) ---
const dotenvPath = path.join(rootDir, ".env");
let secretVal = "";
if (fs.existsSync(dotenvPath)) {
  for (const line of fs.readFileSync(dotenvPath, "utf-8").split(/\r?\n/)) {
    if (line.startsWith("MODEL_API_KEY=")) {
      secretVal = line.slice("MODEL_API_KEY=".length).trim();
    }
  }
}

function scanDirForSecret(dir: string, secret: string): string[] {
  const hits: string[] = [];
  if (!secret || !fs.existsSync(dir)) return hits;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      hits.push(...scanDirForSecret(full, secret));
    } else if (
      entry.isFile() &&
      /\.(js|json|html|css|md|ts|tsx|py|txt)$/.test(entry.name)
    ) {
      const content = fs.readFileSync(full, "utf-8");
      if (content.includes(secret)) hits.push(full);
    }
  }
  return hits;
}

const leakedFiles = [
  ...scanDirForSecret(path.join(rootDir, ".next"), secretVal),
  ...scanDirForSecret(path.join(rootDir, "src"), secretVal),
  ...scanDirForSecret(path.join(rootDir, "public"), secretVal),
  ...scanDirForSecret(path.join(rootDir, "outputs"), secretVal),
  ...scanDirForSecret(path.join(rootDir, "work"), secretVal),
];

if (leakedFiles.length > 0) {
  throw new Error(
    `CA-5 FALLÓ: secreto encontrado en ${leakedFiles.length} archivo(s)`
  );
}
console.log(
  "✓ [CA-5] Auditoría de seguridad en bundles (.next/, src/, public/, outputs/, work/): 0 fugas de MODEL_API_KEY."
);

// --- CA-6 (Punto 1): Plantillas reales sin columnas INV-L*/PL-R*, sinónimos UOM (EA/KIT/KGS) y cajas compartidas ---
const rawRealWorldPayload = {
  invoice: {
    invoice_no: "RW-9001",
    incoterm: "FOB NINGBO",
    currency: "USD",
    declared_total_amount: "$4,200.00",
    declared_total_net_kg: "110 KGS",
    declared_total_gross_kg: "125 KGS",
    lines: [
      {
        part_no: "VLV-10",
        item_description: "Check Valve Assembly (1 KIT = 6 EA)",
        quantity: "20",
        uom: "KIT",
        price: "$150.00",
        amount: "$3,000.00",
      },
      {
        part_no: "GSK-20",
        item_description: "Flange Gasket Ring",
        quantity: "400",
        uom: "EA",
        price: "$3.00",
        amount: "$1,200.00",
      },
    ],
  },
  packing_list: {
    packing_list_no: "PL-RW-9001",
    rows: [
      {
        box_no: "Box 1-4",
        pn: "VLV-10",
        total_qty: "120 EA",
        uom: "EA",
        nw: "80",
        gw: "90",
        weight_unit: "KGS",
      },
      {
        box_no: "Box 5",
        pn: "GSK-20",
        total_qty: "250",
        uom: "PIECES",
        nw: "18",
        gw: "21",
        weight_unit: "KGS",
      },
      {
        // Comparte Box 5 implícitamente sin decir '(Shared)'
        box_no: "Box 5",
        pn: "GSK-20",
        total_qty: "150",
        uom: "EA",
        nw: "12",
        gw: "14",
        weight_unit: "KGS",
      },
    ],
  },
};

const normRW = normalizeExtractedPayload(rawRealWorldPayload);
const resRW = reconcileShipment(normRW.invoice, normRW.packing_list);
if (
  normRW.invoice.lines[0].line_id !== "INV-L1" ||
  normRW.invoice.lines[0].unit !== "SETS" ||
  normRW.invoice.lines[0].explicit_pcs_per_set !== 6 ||
  normRW.packing_list.rows[2].row_id !== "PL-R3" ||
  normRW.packing_list.rows[2].shared_carton !== true ||
  resRW.computedTotals.packingCalculatedCartons !== 5 ||
  resRW.findings.length !== 0
) {
  throw new Error(
    `CA-6 FALLÓ en normalización de plantilla real: ${JSON.stringify({
      normRW,
      resRW,
    })}`
  );
}
console.log(
  "✓ [CA-6] Soporte de plantillas reales sin IDs (autogeneración INV-L*/PL-R*, EA->PCS, KIT->SETS, KGS->KG, caja compartida implícita) verificado."
);

// --- CA-7 (Punto 2): Coordenadas BBox válidas en todas las cabeceras y filas de C01-C07 ---
let totalBBoxesVerified = 0;
for (const c of PRELOADED_CASES) {
  const invHdr = c.extracted.invoice.header_bbox;
  const plHdr = c.extracted.packing_list.header_bbox;
  if (!invHdr || !plHdr || invHdr.length !== 4 || plHdr.length !== 4) {
    throw new Error(`CA-7 FALLÓ: header_bbox ausente en ${c.case_id}`);
  }
  for (const l of c.extracted.invoice.lines) {
    if (
      !l.bbox ||
      l.bbox.length !== 4 ||
      l.bbox[2] <= l.bbox[0] ||
      l.bbox[3] <= l.bbox[1]
    ) {
      throw new Error(
        `CA-7 FALLÓ: bbox inválido en ${c.case_id} ${l.line_id}`
      );
    }
    totalBBoxesVerified++;
  }
  for (const r of c.extracted.packing_list.rows) {
    if (
      !r.bbox ||
      r.bbox.length !== 4 ||
      r.bbox[2] <= r.bbox[0] ||
      r.bbox[3] <= r.bbox[1]
    ) {
      throw new Error(`CA-7 FALLÓ: bbox inválido en ${c.case_id} ${r.row_id}`);
    }
    totalBBoxesVerified++;
  }
}
console.log(
  `✓ [CA-7] Coordenadas visuales BBox verificadas en las ${totalBBoxesVerified} filas y 14 cabeceras de C01-C07.`
);

// --- CA-8 (headcount-internal-controls-and-audit): Evidencia de control y registro de auditoría en minuta ES/EN ---
const sampleAudit: AuditLogEntry[] = [
  {
    id: "AUD-1",
    timestamp: "21:55:00",
    actor: "Operador Pre-Despacho",
    action: "FACTOR_CONFIRMED",
    targetId: "INV-L6",
    field: "operator_pcs_per_set",
    previousValue: "sin_factor",
    newValue: "1 SET = 5 PCS",
  },
  {
    id: "AUD-2",
    timestamp: "21:55:10",
    actor: "Operador Pre-Despacho",
    action: "CELL_EDIT",
    targetId: "PL-R9",
    field: "total_qty",
    previousValue: "74",
    newValue: "80",
  },
];
const memoWithAuditEs = generateSupplierMemo(
  c06Initial.extracted.invoice,
  c06Initial.extracted.packing_list,
  resC06Init,
  "es",
  sampleAudit
);
const memoWithAuditEn = generateSupplierMemo(
  c06Initial.extracted.invoice,
  c06Initial.extracted.packing_list,
  resC06Init,
  "en",
  sampleAudit
);
if (
  !memoWithAuditEs.includes("REGISTRO DE AUDITORÍA Y CONTROLES DEL OPERADOR") ||
  !memoWithAuditEs.includes("1 SET = 5 PCS") ||
  !memoWithAuditEn.includes("OPERATOR CONTROL & AUDIT TRAIL") ||
  !memoWithAuditEn.includes("PL-R9.total_qty")
) {
  throw new Error("CA-8 FALLÓ: el registro de auditoría no aparece en la minuta");
}
console.log(
  "✓ [CA-8] Registro de auditoría y evidencia de controles (headcount-internal-controls-and-audit) verificado en ES/EN."
);

// --- CA-9 (addy-security-and-hardening): Validación de magic bytes (PDF/PNG) + neutralización de CSV Formula Injection ---
const validPngHeader = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]).toString("base64");
const spoofedPngHeader = Buffer.from("<!DOCTYPE html><script>alert(1)</script>").toString(
  "base64"
);
const validPdfHeader = Buffer.from("%PDF-1.7\n1 0 obj\n").toString("base64");

if (
  !validateDataUrlAndMagicBytes(`data:image/png;base64,${validPngHeader}`, "PNG").valid ||
  validateDataUrlAndMagicBytes(`data:image/png;base64,${spoofedPngHeader}`, "Spoof").valid ||
  !validateDataUrlAndMagicBytes(`data:application/pdf;base64,${validPdfHeader}`, "PDF").valid
) {
  throw new Error("CA-9 FALLÓ en validación de magic bytes");
}
if (
  sanitizeCsvCell("=CMD|'/C calc'!A0") !== "'=CMD|'/C calc'!A0" ||
  sanitizeCsvCell("+SUM(A1:A2)") !== "'+SUM(A1:A2)" ||
  sanitizeCsvCell("-10") !== "-10"
) {
  throw new Error("CA-9 FALLÓ en neutralización de CSV Formula Injection");
}
console.log(
  "✓ [CA-9] Endurecimiento OWASP (addy-security-and-hardening): validación binaria magic bytes y anti-CSV injection verificados."
);

// --- CA-10 (emil-break-ui): Stress test con datos extremos (SKUs de 42 chars, importes de 7 dígitos, diacríticos) ---
const resBreakUi = reconcileShipment(
  WORST_CASE_BREAK_UI_SHIPMENT.extracted.invoice,
  WORST_CASE_BREAK_UI_SHIPMENT.extracted.packing_list
);
if (
  resBreakUi.findings.length !== 4 ||
  resBreakUi.computedTotals.invoiceLinesSumAmount !== 1294500.75 ||
  resBreakUi.computedTotals.packingCalculatedCartons !== 1420
) {
  throw new Error(
    `CA-10 FALLÓ en WORST_CASE_BREAK_UI_SHIPMENT: ${JSON.stringify(resBreakUi)}`
  );
}
console.log(
  "✓ [CA-10] Stress test de datos extremos (emil-break-ui: SKUs de 42 chars, USD $1,294,500.75, diacríticos) verificado."
);

console.log("\n===============================================================");
console.log("  TODOS LOS CRITERIOS DE ACEPTACIÓN (CA-1 A CA-10) SUPERADOS   ");
console.log("===============================================================");
