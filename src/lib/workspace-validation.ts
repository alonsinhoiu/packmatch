import type { InvoiceData, PackingListData } from './reconcile.ts';
import type { UiLocale } from './i18n/locale.ts';
import { formatTemplate, getDictionary } from './i18n/dictionaries.ts';

export type WorkspaceIssueCode =
  | 'HEADER_INVALID'
  | 'MISSING_SKU'
  | 'DUPLICATE_SKU'
  | 'NON_NEGATIVE'
  | 'PCS_PER_SET'
  | 'PACKING_NON_NEGATIVE';

export interface WorkspaceIssue {
  code: WorkspaceIssueCode;
  /** Identificador de línea/fila o 'INV-HEADER' / 'PL-HEADER'. */
  targetId: string;
  /** Documento: 'invoice' | 'packing' (solo para HEADER_INVALID). */
  doc?: 'invoice' | 'packing';
}

/**
 * Códigos estables de validación. La UI localiza con el diccionario;
 * el motor no compara frases en español.
 */
export function workspaceIssueList(invoice: InvoiceData, packing: PackingListData): WorkspaceIssue[] {
  const issues: WorkspaceIssue[] = [];
  const nonnegative = (values: number[]) => values.every(value => Number.isFinite(value) && value >= 0);
  const header = (name: 'invoice' | 'packing', data: InvoiceData | PackingListData) => {
    if (!nonnegative([data.declared_total_cartons, data.declared_total_net_kg, data.declared_total_gross_kg]) || !Number.isSafeInteger(data.declared_total_cartons)) issues.push({ code: 'HEADER_INVALID', targetId: name === 'invoice' ? 'INV-HEADER' : 'PL-HEADER', doc: name });
  };
  header('invoice', invoice); header('packing', packing);
  const seen = new Set<string>();
  for (const line of invoice.lines) {
    if (!line.sku.trim()) issues.push({ code: 'MISSING_SKU', targetId: line.line_id });
    else if (seen.has(line.sku.trim())) issues.push({ code: 'DUPLICATE_SKU', targetId: line.line_id });
    seen.add(line.sku.trim());
    if (!nonnegative([line.qty, line.unit_price, line.line_amount])) issues.push({ code: 'NON_NEGATIVE', targetId: line.line_id });
    if (line.operator_pcs_per_set != null && (!Number.isSafeInteger(line.operator_pcs_per_set) || line.operator_pcs_per_set <= 0)) issues.push({ code: 'PCS_PER_SET', targetId: line.line_id });
  }
  for (const row of packing.rows) {
    if (!row.sku.trim() && !row.is_packaging_only) issues.push({ code: 'MISSING_SKU', targetId: row.row_id });
    if (!nonnegative([row.carton_count, row.qty_per_carton, row.total_qty, row.net_weight, row.gross_weight]) || !Number.isSafeInteger(row.carton_count)) issues.push({ code: 'PACKING_NON_NEGATIVE', targetId: row.row_id });
  }
  return issues;
}

export function formatWorkspaceIssue(issue: WorkspaceIssue, locale: UiLocale = 'es'): string {
  const v = getDictionary(locale).validation;
  switch (issue.code) {
    case 'HEADER_INVALID':
      return formatTemplate(v.header, { doc: issue.doc === 'packing' ? v.docPacking : v.docInvoice });
    case 'MISSING_SKU':
      return formatTemplate(v.missingSku, { id: issue.targetId });
    case 'DUPLICATE_SKU':
      return formatTemplate(v.duplicateSku, { id: issue.targetId });
    case 'NON_NEGATIVE':
      return formatTemplate(v.nonNegative, { id: issue.targetId });
    case 'PCS_PER_SET':
      return formatTemplate(v.pcsPerSet, { id: issue.targetId });
    case 'PACKING_NON_NEGATIVE':
      return formatTemplate(v.packingNonNegative, { id: issue.targetId });
  }
}

/**
 * Mantiene el contrato anterior (string[]) y localiza según `locale`
 * (es por defecto para no romper consumidores existentes).
 */
export function workspaceIssues(invoice: InvoiceData, packing: PackingListData, locale: UiLocale = 'es'): string[] {
  return workspaceIssueList(invoice, packing).map((i) => formatWorkspaceIssue(i, locale));
}
