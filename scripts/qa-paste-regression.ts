import assert from 'node:assert/strict';
import { parseInvoicePaste, parsePackingPaste } from '../src/lib/paste-import.ts';
const cases: Array<[string,()=>void]> = [
 ['TSV con punto decimal',()=>{const [r]=parseInvoicePaste('QA-01\tSensor QA\t10\tPCS\t12.50\t125.00');assert.equal(r.qty,10);assert.equal(r.line_amount,125)}],
 ['Decimales con coma',()=>{const [r]=parseInvoicePaste('QA-01;Sensor QA;10;PCS;12,50;125,00');assert.equal(r.unit_price,12.5);assert.equal(r.line_amount,125)}],
 ['Pesos con coma',()=>{const [r]=parsePackingPaste('CTN 1-2;QA-01;2;5;10;4,5;5,5');assert.equal(r.net_weight,4.5);assert.equal(r.gross_weight,5.5)}],
 ['Miles y decimales ES',()=>{const [r]=parseInvoicePaste('QA-01;Sensor;2;PCS;1.250,50;2.501,00');assert.equal(r.unit_price,1250.5);assert.equal(r.line_amount,2501)}],
 ['Miles y decimales US entre comillas',()=>{const [r]=parseInvoicePaste('QA-01,Sensor,2,PCS,"1,250.50","2,501.00"');assert.equal(r.unit_price,1250.5);assert.equal(r.line_amount,2501)}],
 ['Cabeceras no son productos',()=>{const r=parseInvoicePaste('SKU\tDescripción\tCantidad\tUnidad\tPrecio\tSubtotal\nQA-01\tSensor\t10\tPCS\t12.50\t125.00');assert.equal(r.length,1);assert.equal(r[0].line_id,'INV-L1');assert.equal(r[0].sku,'QA-01')}],
 ['Cabeceras de empaque',()=>{const r=parsePackingPaste('Rango\tSKU\tCajas\tUnid/Caja\tTotal\tNeto\tBruto\nCTN 1-2\tQA-01\t2\t5\t10\t4\t5');assert.equal(r.length,1);assert.equal(r[0].row_id,'PL-R1')}],
 ['CSV con coma en descripción',()=>{const [r]=parseInvoicePaste('QA-01,"Sensor, industrial",10,PCS,12.50,125.00');assert.equal(r.description,'Sensor, industrial');assert.equal(r.qty,10);assert.equal(r.unit_price,12.5)}],
 ['Celda entre comillas con salto de línea',()=>{const [r]=parseInvoicePaste('QA-01,"Sensor\nindustrial",10,PCS,12.50,125.00');assert.equal(r.description,'Sensor\nindustrial');assert.equal(r.qty,10)}],
 ['Rechaza texto sin estructura',()=>assert.throws(()=>parseInvoicePaste('hola'))],
 ['Rechaza cantidad ilegible',()=>assert.throws(()=>parseInvoicePaste('QA-01;Sensor;diez;PCS;12.50;125'))],
 ['Rechaza cantidades negativas',()=>assert.throws(()=>parseInvoicePaste('QA-01;Sensor;-10;PCS;12.50;125'))],
 ['Rechaza valores no finitos',()=>assert.throws(()=>parsePackingPaste('CTN 1;QA-01;2;5;Infinity;4;5'))],
 ['Rechaza cajas fraccionarias',()=>assert.throws(()=>parsePackingPaste('CTN 1;QA-01;1.5;5;10;4;5'))],
 ['Cero cajas se conserva y no se inventa una',()=>assert.equal(parsePackingPaste('CTN 1;QA-01;0;0;0;0;0')[0].carton_count,0)],
 ['Fila inválida no se pierde silenciosamente',()=>assert.throws(()=>parseInvoicePaste('QA-01;10\nQA-02;no-numérico'))],
 ['Rechaza duplicados de factura que el motor no agrega',()=>assert.throws(()=>parseInvoicePaste('QA-01;10\nQA-01;5'))],
 ['Subtotal ausente se calcula',()=>assert.equal(parseInvoicePaste('QA-01;Sensor;10;PCS;12,50;')[0].line_amount,125)],
 ['Cabeceras solas y entrada vacía no crean datos',()=>{assert.equal(parseInvoicePaste('SKU;Descripción;Cantidad;Unidad;Precio;Subtotal').length,0);assert.equal(parsePackingPaste('').length,0)}],
 ['Formatos abreviados siguen funcionando',()=>{assert.equal(parseInvoicePaste('QA-01;10')[0].qty,10);assert.equal(parsePackingPaste('QA-01;10')[0].total_qty,10)}],
];
let failures=0;for(const [name,run]of cases){try{run();console.log('PASA '+name)}catch(e){failures++;console.log('FALLA '+name+': '+(e as Error).message.split('\n')[0])}}console.log(`${cases.length-failures}/${cases.length} pruebas superadas`);if(failures)process.exitCode=1;
