import assert from 'node:assert/strict';
import { normalizeExtractedPayload, parseLocalizedNumber, normalizeDiscreteUnit, normalizeWeightUnit, extractExplicitFactorFromText } from '../src/lib/normalize-extracted.ts';
import { reconcileShipment } from '../src/lib/reconcile.ts';
import { MULTILINGUAL_FIXTURES } from './fixtures/multilingual-cases.ts';

/**
 * NIVEL 1 — Pruebas unitarias con respuestas SIMULADAS del modelo.
 * No demuestran capacidad multilingüe del modelo: verifican que
 * normalización + motor determinista tratan esos JSON correctamente.
 * La prueba real contra Meta vive en docs/MULTILINGUAL.md (muestra acotada).
 */
let passes = 0;
const ok = (name: string) => { passes++; console.log('PASA ' + name); };

// A. Unidades: solo equivalencias inequívocas; lo ambiguo se copia verbatim
assert.equal(normalizeDiscreteUnit('件'), 'PCS');
assert.equal(normalizeDiscreteUnit('个'), 'PCS');
assert.equal(normalizeDiscreteUnit('套'), 'SETS');
assert.equal(normalizeDiscreteUnit('组'), 'SETS');
assert.equal(normalizeDiscreteUnit('箱'), '箱');
assert.equal(normalizeDiscreteUnit('托盘'), '托盘');
assert.equal(normalizeDiscreteUnit('EA'), 'PCS');
assert.equal(normalizeWeightUnit('千克'), 'KG');
assert.equal(normalizeWeightUnit('公斤'), 'KG');
assert.equal(normalizeWeightUnit('磅'), 'LBS');
assert.equal(normalizeWeightUnit('克'), '克');
assert.equal(normalizeWeightUnit('吨'), '吨');
ok('unidades CJK: inequívocas se mapean, ambiguas se preservan');

// B. Factores explícitos incl. chino; nada inventado
assert.equal(extractExplicitFactorFromText('Valve Kit (1 SET = 4 PCS)'), 4);
assert.equal(extractExplicitFactorFromText('阀门套件（1套=4件）'), 4);
assert.equal(extractExplicitFactorFromText('每套4件'), 4);
assert.equal(extractExplicitFactorFromText('4件/套'), 4);
assert.equal(extractExplicitFactorFromText('1套：10件'), 10);
assert.equal(extractExplicitFactorFromText('Valve Kit'), null);
assert.equal(extractExplicitFactorFromText('阀门套件'), null);
ok('factores explícitos ES/EN/ZH; sin factor no se inventa');

// C. Números con convenciones del documento + ancho completo
assert.equal(parseLocalizedNumber('1.250,50'), 1250.5);
assert.equal(parseLocalizedNumber('1,250.50'), 1250.5);
assert.equal(parseLocalizedNumber('4,5'), 4.5);
assert.equal(parseLocalizedNumber('１２５０．５０'), 1250.5);
assert.equal(parseLocalizedNumber('１，２５０'), 1250);
assert.equal(parseLocalizedNumber('$4,200.00'), 4200);
assert.equal(parseLocalizedNumber('¥1,250'), 1250);
assert.equal(parseLocalizedNumber('ilegible'), null);
assert.equal(parseLocalizedNumber('???'), null);
ok('números ES/EN/ancho completo; ilegible -> null (sin inventar)');

// D. Fixtures: normalización exacta + hallazgos exactos (datos y orígenes)
for (const fx of MULTILINGUAL_FIXTURES) {
  const norm = normalizeExtractedPayload(fx.raw);
  assert.equal(norm.invoice.lines.length, fx.expectedLines.length, `${fx.id}: nº líneas`);
  fx.expectedLines.forEach((exp, i) => {
    const got = norm.invoice.lines[i];
    assert.equal(got.sku, exp.sku, `${fx.id} línea ${i} sku`);
    assert.equal(got.description, exp.description, `${fx.id} línea ${i} descripción original preservada`);
    assert.equal(got.qty, exp.qty, `${fx.id} línea ${i} qty`);
    assert.equal(got.unit, exp.unit, `${fx.id} línea ${i} unit`);
    assert.equal(got.unit_price, exp.unit_price, `${fx.id} línea ${i} precio`);
    assert.equal(got.line_amount, exp.line_amount, `${fx.id} línea ${i} importe`);
    assert.equal(got.explicit_pcs_per_set, exp.explicit_pcs_per_set, `${fx.id} línea ${i} factor`);
  });
  assert.equal(norm.packing_list.rows.length, fx.expectedRows.length, `${fx.id}: nº filas`);
  fx.expectedRows.forEach((exp, i) => {
    const got = norm.packing_list.rows[i];
    assert.equal(got.sku, exp.sku, `${fx.id} fila ${i} sku`);
    assert.equal(got.total_qty, exp.total_qty, `${fx.id} fila ${i} total`);
    assert.equal(got.unit, exp.unit, `${fx.id} fila ${i} unidad preservada`);
    assert.equal(got.net_weight, exp.net_weight, `${fx.id} fila ${i} neto`);
    assert.equal(got.gross_weight, exp.gross_weight, `${fx.id} fila ${i} bruto`);
    assert.equal(got.weight_unit, exp.weight_unit, `${fx.id} fila ${i} unidad peso`);
    assert.equal(got.carton_count, exp.carton_count, `${fx.id} fila ${i} cajas`);
  });
  // bbox sobre el documento rasterizado: válidas 0..1000
  for (const l of norm.invoice.lines) assert.ok(Array.isArray(l.bbox) && l.bbox.length === 4 && l.bbox.every((n) => Number.isFinite(n) && n >= 0 && n <= 1000), `${fx.id}: bbox línea ${l.line_id}`);
  for (const r of norm.packing_list.rows) assert.ok(Array.isArray(r.bbox) && r.bbox.length === 4 && r.bbox.every((n) => Number.isFinite(n) && n >= 0 && n <= 1000), `${fx.id}: bbox fila ${r.row_id}`);
  const res = reconcileShipment(norm.invoice, norm.packing_list);
  assert.equal(res.findings.length, fx.expectedFindings.length, `${fx.id}: nº hallazgos (${res.findings.map((f) => f.code).join(',')})`);
  fx.expectedFindings.forEach((exp, i) => {
    const got = res.findings[i];
    assert.equal(got.code, exp.code, `${fx.id} hallazgo ${i} código`);
    assert.equal(got.sku, exp.sku, `${fx.id} hallazgo ${i} sku`);
    assert.deepEqual([...got.origins].sort(), [...exp.origins].sort(), `${fx.id} hallazgo ${i} orígenes`);
  });
  ok(`fixture ${fx.id}: extracción simulada + conciliación (${fx.expectedFindings.length} hallazgos)`);
}

console.log(`${passes}/${passes} pruebas superadas (NIVEL 1: respuestas simuladas; ver docs/MULTILINGUAL.md para prueba real)`);
