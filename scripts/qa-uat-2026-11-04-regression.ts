import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { reconcileShipment, type InvoiceData, type PackingListData } from '../src/lib/reconcile.ts';
import { normalizeExtractedPayload } from '../src/lib/normalize-extracted.ts';
import { parseInvoicePaste, parsePackingPaste } from '../src/lib/paste-import.ts';
import { describeFinding } from '../src/lib/i18n/findings.ts';
import { generateReconciliationCsv, sanitizeCsvCell } from '../src/lib/supplier-memo.ts';
import { classifyFetchError, readExtractResponse, tryParseJson } from '../src/lib/extract-response.ts';
import { refineRowBBoxes } from '../src/lib/bbox.ts';
import { snapRowBBoxesToGrid, type RasterLike } from '../src/lib/bbox-grid.ts';
import type { NormalizedBBox } from '../src/lib/reconcile.ts';

let passes = 0;
const ok = (name: string) => { passes++; console.log('PASA ' + name); };
// Fixture versionado junto a la prueba (scripts/fixtures/): NO depende de
// work/ ni de ningún archivo ignorado. Contenido idéntico a las respuestas
// esperadas del informe UAT original.
const fixtureUrl = new URL('./fixtures/uat-2026-11-04-case.json', import.meta.url);
const key = JSON.parse(fs.readFileSync(fixtureUrl, 'utf8'));
const repoFile = (rel: string) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// --- Caso nuevo fiel a los documentos (notas impresas -> alcance del peso) ---
function buildCase(weightScope: 'CARTON_TOTAL' | 'PER_ROW' | 'UNSPECIFIED' | undefined): { invoice: InvoiceData; packing: PackingListData } {
  const invoice: InvoiceData = {
    invoice_no: 'INV-UAT-1104', incoterm: 'FOB NINGBO', currency: 'USD',
    declared_total_amount: key.invoice.reduce((a: number, r: any[]) => a + r[5], 0),
    declared_total_net_kg: 34, declared_total_gross_kg: 49, declared_total_cartons: 14,
    lines: key.invoice.map((r: any[], i: number) => ({ line_id: `INV-L${i + 1}`, sku: r[0], description: r[1], qty: r[2], unit: r[3], unit_price: r[4], line_amount: r[5], explicit_pcs_per_set: null })),
  };
  const packing: PackingListData = {
    packing_list_no: 'PL-UAT-1104', incoterm: 'FOB NINGBO',
    declared_total_cartons: 14, declared_total_net_kg: 34, declared_total_gross_kg: 49,
    rows: key.packing.map((r: any[], i: number) => {
      const isZx = r[1] === 'ZX-101' || r[1] === 'ZX-1O1';
      return {
        row_id: `PL-R${i + 1}`, carton_range: r[0], carton_count: r[1] === 'ZX-1O1' ? 0 : 1,
        sku: r[1], qty_per_carton: r[2], total_qty: r[2], unit: r[3],
        net_weight: r[4], gross_weight: r[5], weight_unit: 'KG',
        shared_carton: isZx, weight_scope: isZx ? weightScope : undefined,
        notes: r[6] || undefined, explicit_pcs_per_set: null, is_packaging_only: false,
      };
    }),
  };
  return { invoice, packing };
}

// 1. PDF: worker local (sin CDN) y PDF válido del caso
{
  const src = repoFile('src/lib/pdf-to-image.ts');
  const workerLine = src.split('\n').find((l) => l.includes('workerSrc')) || '';
  assert.ok(!workerLine.includes('http') && !src.includes('cdnjs.cloudflare.com/ajax'), 'worker sin CDN');
  assert.ok(src.includes('pdfjs-dist/build/pdf.worker.min.mjs') && src.includes('import.meta.url'));
  const pdf = fs.readFileSync(new URL('../public/cases/C01_correcto_asimetrico/invoice.pdf', import.meta.url));
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  ok('PDF válido y worker distribuido con la app (sin CDN)');
}

// 2. Respuestas HTML/no JSON, timeout y error del proveedor sin cuerpo expuesto
{
  assert.equal(tryParseJson('<HTML><HEAD></HEAD></HTML>').ok, false);
  assert.equal(tryParseJson('{"a":1}').ok, true);
  await assert.rejects(
    () => readExtractResponse(new Response('<HTML>proxy</HTML>', { status: 502, headers: { 'Content-Type': 'text/html' } })),
    (e: any) => e.code === 'NON_JSON_RESPONSE' && !JSON.stringify(e).includes('proxy')
  );
  await assert.rejects(
    () => readExtractResponse(new Response(JSON.stringify({ errorCode: 'META_HTTP_ERROR', error: 'x' }), { status: 503 })),
    (e: any) => e.code === 'META_HTTP_ERROR' && e.status === 503
  );
  const timeoutErr = new Error('timed out'); timeoutErr.name = 'TimeoutError';
  assert.equal(classifyFetchError(timeoutErr).code, 'PROVIDER_TIMEOUT');
  assert.equal(classifyFetchError(new TypeError('fetch failed')).code, 'PROVIDER_UNREACHABLE');
  ok('extracción: HTML/no JSON, timeout y error de proveedor con código estable sin exponer cuerpo');
}

// 3a. Peso compartido repetido (explícito en las notas): cuenta una vez
{
  const { invoice, packing } = buildCase('CARTON_TOTAL');
  const res = reconcileShipment(invoice, packing);
  assert.deepEqual(res.computedTotals, { invoiceLinesSumAmount: 5264, packingCalculatedCartons: 14, packingCalculatedNetKg: 34, packingCalculatedGrossKg: 49 });
  assert.deepEqual(res.findings.map((f) => `${f.code}:${f.sku}`).sort(), key.expected.map((x: any) => `${x.issue}:${x.sku}`).sort());
  ok('peso compartido repetido: 14 cajas / 34 kg / 49 kg y 4 hallazgos sin falsa discrepancia');
}

// 3b. Peso distribuido por producto: se suma aunque los valores coincidan
{
  const { invoice, packing } = buildCase('PER_ROW');
  // distribuido: cada producto aporta 4/5 de la caja (la caja pesa 8/10 en total)
  packing.rows.filter((r) => r.sku.startsWith('ZX-')).forEach((r) => { r.net_weight = 4; r.gross_weight = 5; });
  const res = reconcileShipment(invoice, packing);
  assert.equal(res.computedTotals.packingCalculatedNetKg, 34);
  assert.equal(res.computedTotals.packingCalculatedGrossKg, 49);
  assert.ok(!res.findings.some((f) => f.code === 'SHARED_CARTON_WEIGHT_AMBIGUITY' || f.code === 'TOTAL_GROSS_WEIGHT_MISMATCH'));
  ok('peso distribuido por producto (explícito) se suma, sin ambigüedad');
}

// 3c. Ambigüedad: pesos idénticos sin alcance, y alcance UNSPECIFIED
for (const scope of [undefined, 'UNSPECIFIED'] as const) {
  const { invoice, packing } = buildCase(scope);
  const res = reconcileShipment(invoice, packing);
  assert.ok(res.findings.some((f) => f.code === 'SHARED_CARTON_WEIGHT_AMBIGUITY'), `scope=${scope}`);
  assert.ok(!res.findings.some((f) => f.code === 'TOTAL_GROSS_WEIGHT_MISMATCH'), 'sin falsa discrepancia de peso total');
  // resoluble por el operador
  packing.rows.filter((r) => r.sku.startsWith('ZX-')).forEach((r) => { r.operator_weight_scope = 'CARTON_TOTAL'; });
  const resolved = reconcileShipment(invoice, packing);
  assert.ok(!resolved.findings.some((f) => f.code === 'SHARED_CARTON_WEIGHT_AMBIGUITY'));
  assert.equal(resolved.computedTotals.packingCalculatedGrossKg, 49);
}
ok('peso compartido ambiguo: ambigüedad conservada, sin falso total, resoluble por operador');

// 4. PCS <-> SETS en ambas direcciones, explicación desde las unidades reales
{
  const { invoice, packing } = buildCase('CARTON_TOTAL');
  const res = reconcileShipment(invoice, packing);
  const finding = res.findings.find((f) => f.code === 'UNIT_AMBIGUITY_UNCONVERTIBLE')!;
  for (const locale of ['es', 'en', 'zh'] as const) {
    const expl = describeFinding(finding, invoice, packing, res.skuSummaries, locale).explanation;
    assert.ok(expl.includes('48') && expl.includes('PCS') && expl.includes('4') && expl.includes('SETS'), `${locale}: ${expl}`);
    assert.ok(expl.indexOf('PCS') < expl.indexOf('SETS'), `${locale} no invierte: ${expl}`);
  }
  const inv2 = structuredClone(invoice); const pack2 = structuredClone(packing);
  const dk = inv2.lines.find((l) => l.sku === 'DK-048')!; dk.qty = 4; dk.unit = 'SETS'; dk.unit_price = 36; dk.line_amount = 144;
  const dkRow = pack2.rows.find((r) => r.sku === 'DK-048')!; dkRow.total_qty = 48; dkRow.qty_per_carton = 48; dkRow.unit = 'PCS';
  const res2 = reconcileShipment(inv2, pack2);
  const f2 = res2.findings.find((f) => f.code === 'UNIT_AMBIGUITY_UNCONVERTIBLE')!;
  const expl2 = describeFinding(f2, inv2, pack2, res2.skuSummaries, 'es').explanation;
  assert.ok(expl2.indexOf('SETS') < expl2.indexOf('PCS'), `dirección inversa no invierte: ${expl2}`);
  // tras confirmar 12 PCS/SET: MATCHED + confirmación registrada en el resumen
  invoice.lines.find((l) => l.sku === 'DK-048')!.operator_pcs_per_set = 12;
  const confirmed = reconcileShipment(invoice, packing);
  const dkSummary = confirmed.skuSummaries.find((s) => s.sku === 'DK-048')!;
  assert.equal(dkSummary.status, 'MATCHED');
  assert.equal(dkSummary.conversionFactorUsed, 12);
  assert.equal(dkSummary.conversionSource, 'OPERATOR_CONFIRMED');
  assert.equal(confirmed.findings.length, 3);
  ok('PCS↔SETS ambas direcciones, sin factor ambiguo y con factor 12 MATCHED (3 hallazgos)');
}

// 5. Importación antigua y nueva
{
  // Formato antiguo reconstruido desde el fixture versionado (= packing-importacion.tsv original)
  const legacyText = key.packing.map((r: any[]) => [r[0], r[1], r[1] === 'ZX-1O1' ? 0 : 1, r[2], r[2], r[4], r[5], 'KG'].join('\t')).join('\n');
  const legacy = parsePackingPaste(legacyText);
  assert.equal(legacy.length, 15);
  assert.equal(legacy[5].unit, 'PCS'); // formato antiguo conserva PCS (documentado)
  const nueva = parsePackingPaste([
    '6\tDK-048\t1\t4\t4\t2\t3\tKG\tSETS',
    '7\tZX-101\t1\t20\t20\t8\t10\tKG\tPCS\tSI\tTOTAL_CAJA',
    '7\tZX-1O1\t0\t30\t30\t8\t10\tKG\tPCS\tSI\tTOTAL_CAJA',
    '8\tGX-040\t1\t40\t40\t2\t3\tKG\tPCS\tSI',
    '9\tHX-050\t1\t50\t50\t4\t5\tKG\tPCS\tSI\tPOR_FILA',
  ].join('\n'));
  assert.equal(nueva[0].unit, 'SETS');
  assert.equal(nueva[1].shared_carton, true); assert.equal(nueva[1].weight_scope, 'CARTON_TOTAL');
  assert.equal(nueva[3].weight_scope, 'UNSPECIFIED'); // compartida sin alcance: no se adivina
  assert.equal(nueva[4].weight_scope, 'PER_ROW');
  assert.throws(() => parsePackingPaste('7\tZX-101\t1\t20\t20\t8\t10\tKG\tPCS\tQUIZAS'));
  const inv = parseInvoicePaste(key.invoice.map((r: any[]) => r.join('\t')).join('\n'));
  assert.equal(inv.length, 12); assert.equal(inv[1].line_amount, 950);
  ok('importación: formato antiguo compatible y formato nuevo con unidad/compartida/alcance');
}

// 5b. Normalización de extracción: nota "SAME 8/10 kg" -> CARTON_TOTAL, SETS conservado
{
  const norm = normalizeExtractedPayload({
    invoice: { invoice_no: 'INV-UAT-1104', declared_total_gross_kg: 49, declared_total_cartons: 14, lines: [{ sku: 'DK-048', qty: 48, unit: 'PCS', unit_price: 3, line_amount: 144 }] },
    packing_list: { packing_list_no: 'PL-UAT-1104', declared_total_gross_kg: 49, declared_total_cartons: 14, rows: [
      { carton_range: '6', carton_count: 1, sku: 'DK-048', total_qty: 4, unit: 'SETS', net_weight: 2, gross_weight: 3, weight_unit: 'KG' },
      { carton_range: '7', carton_count: 1, sku: 'ZX-101', total_qty: 20, unit: 'PCS', net_weight: 8, gross_weight: 10, weight_unit: 'KG', notes: 'Shared carton with ZX-1O1' },
      { carton_range: '7', carton_count: 0, sku: 'ZX-1O1', total_qty: 30, unit: 'PCS', net_weight: 8, gross_weight: 10, weight_unit: 'KG', shared_carton: true, notes: 'SHARED with ZX-101; SAME 8/10 kg' },
    ] },
  });
  assert.equal(norm.packing_list.rows[0].unit, 'SETS');
  assert.equal(norm.packing_list.rows[2].weight_scope, 'CARTON_TOTAL');
  ok('normalización: SETS conservado y nota SAME -> peso total de caja repetido');
}

// 6. CSV distingue cantidad de importe y cambia al corregir el subtotal
{
  const { invoice, packing } = buildCase('CARTON_TOTAL');
  const csv1 = generateReconciliationCsv(reconcileShipment(invoice, packing), invoice);
  const header = csv1.split('\n')[0].split(',');
  assert.ok(header.includes('Quantity_Status') && header.includes('Overall_Status') && header.includes('Finding_Codes'));
  assert.ok(!header.includes('Status'));
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const cells = (sku: string) => csv1.split('\n').find((l) => l.startsWith(`"${sku}"`))!.split('","').map((c) => c.replace(/^"|"$/g, ''));
  const bv = cells('BV-080');
  assert.equal(bv[idx.Quantity_Status], 'MATCHED');
  assert.equal(bv[idx.Overall_Status], 'DISCREPANCY');
  assert.ok(bv[idx.Finding_Codes].includes('INVOICE_LINE_MATH_ERROR'));
  assert.equal(bv[idx.Invoice_Unit_Price], '12.50');
  assert.equal(bv[idx.Invoice_Line_Amount_Declared], '950.00');
  assert.equal(bv[idx.Invoice_Line_Amount_Expected], '1000.00');
  invoice.lines.find((l) => l.sku === 'BV-080')!.line_amount = 1000;
  const csv2 = generateReconciliationCsv(reconcileShipment(invoice, packing), invoice);
  assert.notEqual(csv1, csv2);
  const bv2 = csv2.split('\n').find((l) => l.startsWith('"BV-080"'))!.split('","').map((c) => c.replace(/^"|"$/g, ''));
  assert.equal(bv2[idx.Overall_Status], 'MATCHED');
  assert.equal(sanitizeCsvCell('=CMD'), "'=CMD");
  ok('CSV: Quantity_Status=MATCHED con Overall_Status=DISCREPANCY por importe; difiere tras corregir');
}

// 7. Cadena completa normalizador -> motor: la caja compartida no desaparece
{
  const rawFromKey = (mutate: (rows: any[]) => void) => {
    const rows = key.packing.map((r: any[], i: number) => ({
      row_id: `PL-R${i + 1}`, carton_range: r[0], carton_count: 1, sku: r[1],
      qty_per_carton: r[2], total_qty: r[2], unit: r[3], net_weight: r[4], gross_weight: r[5],
      weight_unit: 'KG', shared_carton: false, weight_scope: 'PER_ROW', notes: r[6] || '', explicit_pcs_per_set: null, is_packaging_only: false,
    }));
    mutate(rows);
    return {
      invoice: { invoice_no: 'INV-UAT-1104', incoterm: 'FOB NINGBO', currency: 'USD', declared_total_amount: 5264, declared_total_net_kg: 34, declared_total_gross_kg: 49, declared_total_cartons: 14, lines: key.invoice.map((r: any[], i: number) => ({ line_id: `INV-L${i + 1}`, sku: r[0], description: r[1], qty: r[2], unit: r[3], unit_price: r[4], line_amount: r[5], explicit_pcs_per_set: null })) },
      packing_list: { packing_list_no: 'PL-UAT-1104', incoterm: 'FOB NINGBO', declared_total_cartons: 14, declared_total_net_kg: 34, declared_total_gross_kg: 49, rows },
    };
  };
  const runRaw = (raw: any) => { const n = normalizeExtractedPayload(raw); return { n, res: reconcileShipment(n.invoice, n.packing_list) }; };

  // 7a. Solo la segunda fila marcada compartida (conteo 0 en ella)
  {
    const { n, res } = runRaw(rawFromKey((rows) => { rows[6].weight_scope = 'CARTON_TOTAL'; rows[7].shared_carton = true; rows[7].carton_count = 0; rows[7].weight_scope = 'CARTON_TOTAL'; }));
    assert.equal(res.computedTotals.packingCalculatedCartons, 14);
    assert.equal(res.computedTotals.packingCalculatedGrossKg, 49);
    assert.ok(!res.findings.some((f) => f.code === 'CARTON_COUNT_MISMATCH'));
    void n;
  }
  // 7b. Ambas filas compartidas con carton_count=0: la caja se deriva del rango "7"
  {
    const { n, res } = runRaw(rawFromKey((rows) => { rows[6].shared_carton = true; rows[6].carton_count = 0; rows[6].weight_scope = 'CARTON_TOTAL'; rows[7].shared_carton = true; rows[7].carton_count = 0; rows[7].weight_scope = 'CARTON_TOTAL'; }));
    assert.deepEqual(n.packing_list.rows.slice(6, 8).map((r) => r.carton_count), [0, 0]); // el normalizador no inventa unos
    assert.equal(res.computedTotals.packingCalculatedCartons, 14);
    assert.equal(res.computedTotals.packingCalculatedNetKg, 34);
    assert.ok(!res.findings.some((f) => f.code === 'CARTON_COUNT_MISMATCH' || f.code === 'CARTON_COUNT_AMBIGUITY'));
    assert.equal(res.findings.length, 4);
  }
  // 7c. Conteos positivos impresos no se pierden al normalizar
  {
    const { n, res } = runRaw(rawFromKey((rows) => { rows[6].shared_carton = true; rows[6].carton_count = 1; rows[6].weight_scope = 'CARTON_TOTAL'; rows[7].shared_carton = true; rows[7].carton_count = 1; rows[7].weight_scope = 'CARTON_TOTAL'; }));
    assert.deepEqual(n.packing_list.rows.slice(6, 8).map((r) => r.carton_count), [1, 1]);
    assert.equal(res.computedTotals.packingCalculatedCartons, 14);
  }
  // 7d. Peso distribuido a través del normalizador (4/5 por producto)
  {
    const { res } = runRaw(rawFromKey((rows) => { rows[6].shared_carton = true; rows[6].net_weight = 4; rows[6].gross_weight = 5; rows[7].shared_carton = true; rows[7].carton_count = 0; rows[7].net_weight = 4; rows[7].gross_weight = 5; }));
    assert.equal(res.computedTotals.packingCalculatedNetKg, 34);
    assert.equal(res.computedTotals.packingCalculatedGrossKg, 49);
    assert.equal(res.computedTotals.packingCalculatedCartons, 14);
  }
  // 7e. Cardinalidad incierta: rango sin dígitos con todo cero, y conteos contradictorios
  for (const mutate of [
    (rows: any[]) => { rows[6].shared_carton = true; rows[6].carton_count = 0; rows[6].carton_range = 'PALLET-A'; rows[7].shared_carton = true; rows[7].carton_count = 0; rows[7].carton_range = 'PALLET-A'; },
    (rows: any[]) => { rows[6].shared_carton = true; rows[6].carton_count = 1; rows[7].shared_carton = true; rows[7].carton_count = 2; },
  ]) {
    const { res } = runRaw(rawFromKey(mutate));
    assert.ok(res.findings.some((f) => f.code === 'CARTON_COUNT_AMBIGUITY'));
    assert.ok(!res.findings.some((f) => f.code === 'CARTON_COUNT_MISMATCH'), 'sin falsa discrepancia de bultos');
  }
  ok('normalizador->motor: solo 2ª compartida, ambas compartidas en 0, conteos positivos, distribuido y rango incierto');
}

// 8. Importación: invariancia ante el orden de columnas opcionales
{
  const lines: Array<{ base: unknown[]; optional: string[] }> = key.packing.map((r: any[]) => {
    const zx = r[1] === 'ZX-101' || r[1] === 'ZX-1O1';
    const base = [r[0], r[1], r[1] === 'ZX-1O1' ? 0 : 1, r[2], r[2], r[4], r[5]];
    const optional = zx ? ['KG', r[3], 'SI', 'TOTAL_CAJA'] : ['KG', r[3], 'NO', 'POR_FILA'];
    return { base, optional };
  });
  const render = (order: number[]) => lines.map(({ base, optional }) => [...base, ...order.map((i) => optional[i])].join('\t')).join('\n');
  const invLines = parseInvoicePaste(key.invoice.map((r: any[]) => r.join('\t')).join('\n'));
  const totalsFor = (rows: ReturnType<typeof parsePackingPaste>) => reconcileShipment(
    { invoice_no: 'INV-UAT-1104', incoterm: 'FOB NINGBO', currency: 'USD', declared_total_amount: 5264, declared_total_net_kg: 34, declared_total_gross_kg: 49, declared_total_cartons: 14, lines: invLines },
    { packing_list_no: 'PL-UAT-1104', incoterm: 'FOB NINGBO', declared_total_cartons: 14, declared_total_net_kg: 34, declared_total_gross_kg: 49, rows }
  );
  const orders = [[0, 1, 2, 3], [0, 1, 3, 2], [3, 2, 1, 0], [2, 3, 0, 1], [1, 3, 0, 2]];
  for (const order of orders) {
    const rows = parsePackingPaste(render(order));
    assert.equal(rows[0].shared_carton, false, `orden ${order}: NO manda`);
    assert.equal(rows[0].weight_scope, 'PER_ROW');
    assert.equal(rows[5].unit, 'SETS');
    assert.equal(rows[6].shared_carton, true); assert.equal(rows[6].weight_scope, 'CARTON_TOTAL');
    const res = totalsFor(rows);
    assert.deepEqual([res.computedTotals.packingCalculatedCartons, res.computedTotals.packingCalculatedNetKg, res.computedTotals.packingCalculatedGrossKg], [14, 34, 49], `orden ${order}`);
    assert.equal(res.findings.length, 4, `orden ${order}: ${res.findings.map((f) => f.code)}`);
  }
  // Contradicciones explícitas: error, nunca sobrescritura silenciosa
  assert.throws(() => parsePackingPaste('7\tZX-101\t1\t20\t20\t8\t10\tKG\tPCS\tSI\tNO'), /contradictori/i);
  assert.throws(() => parsePackingPaste('7\tZX-101\t1\t20\t20\t8\t10\tKG\tPCS\tPOR_FILA\tTOTAL_CAJA'), /contradictori/i);
  assert.throws(() => parsePackingPaste('7\tZX-101\t1\t20\t20\t8\t10\tKG\tLBS\tPCS\tNO\tPOR_FILA'), /contradictori/i);
  // Repetir el mismo valor es inocuo
  assert.equal(parsePackingPaste('7\tZX-101\t1\t20\t20\t8\t10\tKG\tPCS\tSI\tSI\tTOTAL_CAJA')[0].shared_carton, true);
  ok('importación: NO+POR_FILA en cualquier orden (14/34/49, 4 hallazgos); contradicciones lanzan error');
}

// 9. Grounding visual: retícula de filas, atípicos y cajas de texto
{
  const pitch = 31.7, top0 = 212;
  const lattice = (n: number, h = 32): NormalizedBBox[] => Array.from({ length: n }, (_, i) => [Math.round(top0 + i * pitch), 32, Math.round(top0 + i * pitch) + h, 968] as NormalizedBBox);
  // 9a. Retícula perfecta: intacta y sin marcar estimada
  const perfect = lattice(12);
  const r1 = refineRowBBoxes(perfect);
  assert.deepEqual(r1.map((r) => r.bbox), perfect);
  assert.ok(r1.every((r) => !r.estimated && !r.corrected));
  // 9b. Una fila desplazada hacia arriba (patrón del fallo BV-080) se corrige y se marca estimada
  const shifted = lattice(12); shifted[1] = [231, 32, 259, 968];
  const r2 = refineRowBBoxes(shifted);
  assert.ok(Math.abs(r2[1].bbox[0] - 244) <= 2, `top corregido ${r2[1].bbox[0]}`);
  assert.equal(r2[1].estimated, true); assert.equal(r2[1].corrected, true);
  assert.ok(r2.every((r, i) => i === 1 || (!r.estimated && !r.corrected)));
  assert.ok(r2[1].bbox[0] >= r2[0].bbox[2] - 1 && r2[1].bbox[2] <= r2[2].bbox[0] + 1, 'sin invadir filas vecinas');
  // También en primera y última fila
  for (const idx of [0, 11]) {
    const s = lattice(12); const orig = s[idx][0]; s[idx] = [orig - 13, 32, orig - 13 + 28, 968];
    const r = refineRowBBoxes(s);
    assert.ok(Math.abs(r[idx].bbox[0] - orig) <= 2, `fila ${idx} corregida ${r[idx].bbox[0]} vs ${orig}`);
    assert.equal(r[idx].estimated, true);
  }
  // 9c. Cajas ajustadas al texto (altura mitad del paso): bandas completas estimadas, sin solapes
  const tight = lattice(12, 16).map((b) => [b[0] + 8, b[1], b[0] + 24, b[3]] as NormalizedBBox);
  const r3 = refineRowBBoxes(tight);
  assert.ok(r3.every((r) => r.estimated && r.corrected));
  r3.forEach((r, i) => {
    const h = r.bbox[2] - r.bbox[0];
    assert.ok(h >= pitch * 0.9 && h <= pitch * 1.1, `altura de banda ${h}`);
    if (i > 0) assert.ok(r.bbox[0] >= r3[i - 1].bbox[2] - 1, 'bandas sin solape');
  });
  // 9d. Sin retícula (tops no monótonos): se conserva pero marcado estimado; pocas filas: intacto
  const messy = lattice(5); [messy[1], messy[3]] = [messy[3], messy[1]];
  const r4 = refineRowBBoxes(messy);
  assert.ok(r4.every((r) => r.estimated && !r.corrected));
  assert.deepEqual(r4.map((r) => r.bbox), messy);
  assert.ok(refineRowBBoxes(lattice(2)).every((r) => !r.estimated));
  // 9e. Integración: normalizador corrige el atípico y no toca la retícula perfecta
  const rawWith = (boxes: NormalizedBBox[]) => ({
    invoice: { invoice_no: 'INV-UAT-1104', declared_total_gross_kg: 49, declared_total_cartons: 14, lines: key.invoice.map((r: any[], i: number) => ({ sku: r[0], qty: r[2], unit: r[3], unit_price: r[4], line_amount: r[5], bbox: boxes[i] })) },
    packing_list: { packing_list_no: 'PL-UAT-1104', declared_total_gross_kg: 49, declared_total_cartons: 14, rows: key.packing.slice(0, 3).map((r: any[], i: number) => ({ carton_range: r[0], carton_count: 1, sku: r[1], total_qty: r[2], unit: r[3], net_weight: r[4], gross_weight: r[5], weight_unit: 'KG' })) },
  });
  const badBoxes = lattice(12); badBoxes[1] = [231, 32, 259, 968];
  const normBad = normalizeExtractedPayload(rawWith(badBoxes));
  assert.equal(normBad.invoice.lines[1].bbox_estimated, true);
  assert.ok(Math.abs((normBad.invoice.lines[1].bbox?.[0] ?? 0) - 244) <= 2);
  const normGood = normalizeExtractedPayload(rawWith(lattice(12)));
  assert.equal(normGood.invoice.lines[1].bbox_estimated, false);
  assert.deepEqual(normGood.invoice.lines[1].bbox, lattice(12)[1]);
  ok('grounding: retícula perfecta intacta, atípico corregido+estimado (1ª/media/última), texto expandido, sin retícula marcado');
}

// 10. Anclaje a la rejilla real de la imagen (desplazamiento absoluto del modelo)
{
  const W = 400, H = 360, top = 60, pitchPx = 20, n = 8;
  const makeRaster = (withGrid: boolean): RasterLike => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      const rowIdx = Math.floor((y - top) / pitchPx);
      const inTable = y >= top && y < top + n * pitchPx;
      const shade = inTable && rowIdx % 2 === 0 ? 243 : 255;
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        let v = shade;
        if (withGrid && y >= top && y <= top + n * pitchPx && (y - top) % pitchPx === 0) v = 205; // línea de borde (incl. inferior)
        if (inTable && y % pitchPx === Math.floor(pitchPx / 2) + (top % pitchPx) && x > 30 && x < 190 && (y - top) % pitchPx >= 8 && (y - top) % pitchPx < 12) v = 0; // texto
        data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255;
      }
    }
    return { data, width: W, height: H };
  };
  const toBox = (y0px: number, y1px: number): NormalizedBBox => [Math.round((y0px / H) * 1000), 32, Math.round((y1px / H) * 1000), 968];
  // Modelo desplazado -3px en bloque (como la factura de la extracción PDF)
  const shiftedBoxes = Array.from({ length: n }, (_, i) => toBox(top + i * pitchPx - 3, top + (i + 1) * pitchPx - 3));
  const snapped = snapRowBBoxesToGrid(makeRaster(true), shiftedBoxes);
  assert.ok(snapped.every((s) => s.snapped));
  snapped.forEach((s, i) => {
    const trueTop = Math.round(((top + i * pitchPx) / H) * 1000);
    const trueBottom = Math.round(((top + (i + 1) * pitchPx) / H) * 1000);
    assert.ok(Math.abs(s.bbox[0] - trueTop) <= 3, `fila ${i} top ${s.bbox[0]} vs ${trueTop}`);
    assert.ok(Math.abs(s.bbox[2] - trueBottom) <= 3, `fila ${i} bottom ${s.bbox[2]} vs ${trueBottom}`);
    assert.equal(s.bbox[1], 32); assert.equal(s.bbox[3], 968);
    if (i > 0) assert.equal(s.bbox[0], snapped[i - 1].bbox[2]); // bandas contiguas, sin invadir
  });
  // Sin rejilla detectable: no se toca nada
  const untouched = snapRowBBoxesToGrid(makeRaster(false), shiftedBoxes);
  assert.ok(untouched.every((s) => !s.snapped));
  assert.deepEqual(untouched.map((s) => s.bbox), shiftedBoxes);
  ok('anclaje a rejilla: corrige desplazamiento en bloque contra líneas reales; sin rejilla no inventa');
}

// 10b. Trampa de la cabecera: la ventana superior contiene la línea de la
// cabecera Y la de la primera fila; debe elegirse la de la fila, no la
// primera por fuerza de borde. Sin evidencia suficiente: sin anclaje.
{
  const W2 = 400, H2 = 360, top2 = 90, pitch2 = 20, n2 = 6, headerLine = 78;
  const makeRaster2 = (rowTopStrong: boolean): RasterLike => {
    const data = new Uint8ClampedArray(W2 * H2 * 4);
    for (let y = 0; y < H2; y++) {
      for (let x = 0; x < W2; x++) {
        const p = (y * W2 + x) * 4;
        let v = 255;
        const isHeader = y === headerLine;
        const isRowLine = y >= top2 && y <= top2 + n2 * pitch2 && (y - top2) % pitch2 === 0 && (rowTopStrong || y !== top2);
        const isText = y >= top2 && y < top2 + n2 * pitch2 && (y - top2) % pitch2 >= 8 && (y - top2) % pitch2 < 12 && x > 30 && x < 190;
        if (isHeader || isRowLine) v = 205;
        else if (isText) v = 0;
        data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255;
      }
    }
    return { data, width: W2, height: H2 };
  };
  const toBox2 = (y0px: number, y1px: number): NormalizedBBox => [Math.round((y0px / H2) * 1000), 32, Math.round((y1px / H2) * 1000), 968];
  // Desplazamiento hacia arriba: la ventana superior abarca cabecera y fila 1
  const shifted2 = Array.from({ length: n2 }, (_, i) => toBox2(top2 + i * pitch2 - 5, top2 + (i + 1) * pitch2 - 5));
  const snapped2 = snapRowBBoxesToGrid(makeRaster2(true), shifted2);
  assert.ok(snapped2.every((s) => s.snapped), 'con ambas líneas debe anclar');
  const trueFirstTop = Math.round((top2 / H2) * 1000);
  assert.ok(Math.abs(snapped2[0].bbox[0] - trueFirstTop) <= 3, `primera banda ${snapped2[0].bbox[0]} vs fila real ${trueFirstTop} (no cabecera)`);
  assert.ok(Math.abs(snapped2[0].bbox[2] - snapped2[0].bbox[0] - (snapped2[1].bbox[2] - snapped2[1].bbox[0])) <= 4, 'altura coherente con vecinas');
  // Solo hay línea de cabecera (borde superior de fila ausente): no anclar como exacto
  const doubtful = snapRowBBoxesToGrid(makeRaster2(false), shifted2);
  assert.ok(doubtful.every((s) => !s.snapped), 'sin borde de fila no hay anclaje exacto');
  ok('anclaje: primera banda elige la línea de la fila (no la cabecera); sin evidencia no marca exacto');
}

console.log(`${passes}/${passes} pruebas superadas (regresión UAT 2026-11-04)`);
