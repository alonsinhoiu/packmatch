import type { InvoiceData, PackingListData } from './reconcile.ts';

/** Keep incomplete manual edits visible, but prevent exporting a claim from invalid input. */
export function workspaceIssues(invoice: InvoiceData, packing: PackingListData): string[] {
  const issues: string[] = [];
  const nonnegative = (values: number[]) => values.every(value => Number.isFinite(value) && value >= 0);
  const header = (name: string, data: InvoiceData | PackingListData) => {
    if (!nonnegative([data.declared_total_cartons, data.declared_total_net_kg, data.declared_total_gross_kg]) || !Number.isSafeInteger(data.declared_total_cartons)) issues.push(`${name}: revisa cajas y pesos declarados; deben ser no negativos y las cajas enteras.`);
  };
  header('Factura', invoice); header('Empaque', packing);
  const seen = new Set<string>();
  for (const line of invoice.lines) {
    if (!line.sku.trim()) issues.push(`${line.line_id}: falta el SKU.`);
    else if (seen.has(line.sku.trim())) issues.push(`${line.line_id}: el SKU está repetido en la factura; agrupa sus líneas.`);
    seen.add(line.sku.trim());
    if (!nonnegative([line.qty, line.unit_price, line.line_amount])) issues.push(`${line.line_id}: cantidad, precio y subtotal deben ser números no negativos.`);
    if (line.operator_pcs_per_set != null && (!Number.isSafeInteger(line.operator_pcs_per_set) || line.operator_pcs_per_set <= 0)) issues.push(`${line.line_id}: las piezas por set deben ser un entero positivo.`);
  }
  for (const row of packing.rows) {
    if (!row.sku.trim() && !row.is_packaging_only) issues.push(`${row.row_id}: falta el SKU.`);
    if (!nonnegative([row.carton_count, row.qty_per_carton, row.total_qty, row.net_weight, row.gross_weight]) || !Number.isSafeInteger(row.carton_count)) issues.push(`${row.row_id}: revisa cantidades y pesos; deben ser no negativos y las cajas enteras.`);
  }
  return issues;
}
