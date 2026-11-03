import type { SkuReconciliationSummary } from "./reconcile.ts";

/** Express both quantities in the packing list unit, as used by the reconciliation engine. */
export function comparableQuantities(summary?: SkuReconciliationSummary) {
  if (!summary || summary.invoiceQty === null) return null;
  let invoiceQty = summary.invoiceQty;
  if (summary.invoiceUnit !== summary.packingUnit) {
    const factor = summary.conversionFactorUsed;
    if (!factor || factor <= 0) return null;
    if (summary.invoiceUnit === "SETS" && summary.packingUnit === "PCS") invoiceQty *= factor;
    else if (summary.invoiceUnit === "PCS" && summary.packingUnit === "SETS") invoiceQty /= factor;
    else return null;
  }
  return { invoiceQty, packingQty: summary.packingTotalQty, unit: summary.packingUnit, difference: summary.packingTotalQty - invoiceQty };
}
