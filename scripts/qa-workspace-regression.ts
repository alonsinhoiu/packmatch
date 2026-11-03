import assert from 'node:assert/strict';
import { PRELOADED_CASES } from '../src/lib/preloaded-cases.ts';
import { workspaceIssues } from '../src/lib/workspace-validation.ts';
const clean=PRELOADED_CASES.find(c=>c.case_id.startsWith('C01'))!.extracted;
let passes=0;
function check(name:string, mutate:(data:typeof clean)=>void, invalid:boolean){const data=structuredClone(clean);mutate(data);assert.equal(workspaceIssues(data.invoice,data.packing_list).length>0,invalid);passes++;console.log('PASA '+name)}
check('Datos válidos',()=>{},false);
check('Cantidad negativa',d=>{d.invoice.lines[0].qty=-10},true);
check('SKU vacío',d=>{d.invoice.lines[0].sku=' '},true);
check('SKU duplicado',d=>{d.invoice.lines.push({...d.invoice.lines[0],line_id:'INV-L99'})},true);
check('Cajas fraccionarias',d=>{d.packing_list.rows[0].carton_count=1.5},true);
check('Peso inválido',d=>{d.packing_list.rows[0].net_weight=NaN},true);
check('Factor fraccionario',d=>{d.invoice.lines[0].operator_pcs_per_set=2.5},true);
check('Cabecera negativa',d=>{d.packing_list.declared_total_gross_kg=-1},true);
console.log(`${passes}/8 pruebas superadas`);
