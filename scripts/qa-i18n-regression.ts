import assert from 'node:assert/strict';
import { es } from '../src/lib/i18n/dictionaries-es.ts';
import { en } from '../src/lib/i18n/dictionaries-en.ts';
import { formatTemplate } from '../src/lib/i18n/dictionaries.ts';
import { formatCurrencyValue, formatNumberValue } from '../src/lib/i18n/format.ts';
import { getStoredUiLocale, isUiLocale, persistUiLocale, resolveInitialUiLocale, UI_LOCALE_STORAGE_KEY } from '../src/lib/i18n/locale.ts';
import { shortFindingLabel } from '../src/lib/i18n/findings.ts';
import { workspaceIssues } from '../src/lib/workspace-validation.ts';
import { parseInvoicePaste, PasteError } from '../src/lib/paste-import.ts';
import { PRELOADED_CASES } from '../src/lib/preloaded-cases.ts';

let passes = 0;
const ok = (name: string) => { passes++; console.log('PASA ' + name); };

// 1. Paridad profunda de claves ES/EN (objetos, arreglos y hojas string)
function leafPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj === 'string') return [prefix];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => leafPaths(v, `${prefix}[${i}]`));
  if (obj && typeof obj === 'object') return Object.entries(obj).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
  return [prefix];
}
const esPaths = leafPaths(es).sort();
const enPaths = leafPaths(en).sort();
assert.deepEqual(enPaths, esPaths);
ok('paridad de claves ES/EN en diccionarios');

// 2. Interpolaciones: mismo conjunto de {vars} en cada plantilla ES/EN
const varsOf = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
function walk(a: unknown, b: unknown, path: string) {
  if (typeof a === 'string' && typeof b === 'string') {
    assert.equal(varsOf(b), varsOf(a), `vars difieren en ${path}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    assert.equal(b.length, a.length, `largo difiere en ${path}`);
    a.forEach((v, i) => walk(v, (b as unknown[])[i], `${path}[${i}]`));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of Object.keys(a)) walk((a as any)[k], (b as any)[k], path ? `${path}.${k}` : k);
    return;
  }
  assert.fail(`tipos difieren en ${path}`);
}
walk(es, en, '');
ok('interpolaciones {var} consistentes ES/EN');

// 2b. formatTemplate sustituye todas las vars
assert.equal(formatTemplate('Hola {name}, {count} cajas', { name: 'Ana', count: 2 }), 'Hola Ana, 2 cajas');
ok('formatTemplate interpola vars');

// 3. Formatos Intl es-CL vs en-US difieren y conservan el valor
const esFmt = formatNumberValue('es', 1234.5);
const enFmt = formatNumberValue('en', 1234.5);
assert.notEqual(esFmt, enFmt);
assert.ok(esFmt.includes('.') && esFmt.includes(','), `es-CL esperado, recibido ${esFmt}`);
assert.ok(enFmt.includes(',') && enFmt.includes('.'), `en-US esperado, recibido ${enFmt}`);
assert.equal(formatCurrencyValue('es', 1250.5), formatCurrencyValue('es', 1250.5));
assert.ok(formatCurrencyValue('en', 1250.5).includes('1,250.50'));
assert.ok(formatCurrencyValue('es', 1250.5).includes('1.250,50'));
ok('formatos Intl es-CL/en-US correctos y sin conversión de moneda');

// 4. Persistencia segura: defecto es, clave propia, sin lanzar si está bloqueado
delete (globalThis as any).window;
assert.equal(resolveInitialUiLocale(), 'es');
assert.equal(isUiLocale('en'), true);
assert.equal(isUiLocale('fr'), false);
(globalThis as any).window = { localStorage: { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } } };
assert.equal(getStoredUiLocale(), null);
assert.equal(resolveInitialUiLocale(), 'es');
persistUiLocale('en'); // no debe lanzar
ok('localStorage bloqueado no rompe (defecto es)');
const store = new Map<string, string>();
(globalThis as any).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } };
persistUiLocale('en');
assert.equal(store.get(UI_LOCALE_STORAGE_KEY), 'en');
assert.equal(resolveInitialUiLocale(), 'en');
persistUiLocale('es');
assert.equal(resolveInitialUiLocale(), 'es');
ok('persistencia en packmatch.uiLocale + lectura');
delete (globalThis as any).window;

// 5. Validaciones localizadas con códigos estables
const clean = PRELOADED_CASES.find((c) => c.case_id.startsWith('C01'))!.extracted;
const bad = structuredClone(clean);
bad.invoice.lines[0].sku = ' ';
const esIssues = workspaceIssues(bad.invoice, bad.packing_list, 'es');
const enIssues = workspaceIssues(bad.invoice, bad.packing_list, 'en');
assert.ok(esIssues.length > 0 && enIssues.length > 0);
assert.notEqual(esIssues[0], enIssues[0]);
assert.ok(/SKU/i.test(enIssues[0]), `mensaje EN esperado, recibido: ${enIssues[0]}`);
assert.ok(/SKU/i.test(esIssues[0]));
assert.equal(workspaceIssues(clean.invoice, clean.packing_list).length, 0);
ok('workspaceIssues localiza ES/EN sin comparar frases');

// 6. Errores de pegado con código estable y mensaje localizado
try { parseInvoicePaste('hola', 'es'); assert.fail('debió lanzar'); }
catch (e) { assert.ok(e instanceof PasteError); assert.equal((e as PasteError).code, 'INVOICE_ROW'); assert.ok(/Factura/i.test((e as Error).message)); }
try { parseInvoicePaste('hola', 'en'); assert.fail('debió lanzar'); }
catch (e) { assert.ok(e instanceof PasteError); assert.ok(/Invoice/i.test((e as Error).message)); }
try { parseInvoicePaste('QA-01;10\nQA-01;5', 'en'); assert.fail('debió lanzar por duplicado'); }
catch (e) { assert.equal((e as PasteError).code, 'INVOICE_ROW'); }
ok('paste-import lanza PasteError con code + mensaje ES/EN');

// 7. Etiquetas de hallazgo traducidas, códigos internos intactos
assert.notEqual(shortFindingLabel('QTY_MISMATCH', 'es'), shortFindingLabel('QTY_MISMATCH', 'en'));
assert.equal(shortFindingLabel('UNKNOWN_CODE' as any, 'en'), 'Note');
assert.equal(shortFindingLabel('UNKNOWN_CODE' as any, 'es'), 'Observación');
ok('finding labels ES/EN con códigos estables');

console.log(`${passes}/${passes} pruebas superadas`);
