import type {
  InvoiceData,
  PackingListData,
  ReconciliationResult,
} from "./reconcile";

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: "CELL_EDIT" | "FACTOR_CONFIRMED" | "CASE_LOADED" | "LIVE_EXTRACTION" | "RESET_TO_EXTRACTED";
  targetId: string;
  field: string;
  previousValue: string;
  newValue: string;
}

/**
 * Prevents OWASP CSV Formula Injection (CWE-1236) when opening exported CSVs in Excel/Sheets.
 * Prefixes a single quote if a non-numeric string starts with =, +, -, @, tab, or CR,
 * even when preceded by spaces/tabs/quotes (Excel/Sheets ignore those before deciding
 * a cell is a formula, so " =CMD" or "  +1+1" would otherwise bypass the check).
 * The decision is made on the string stripped of leading whitespace/quotes, but the
 * original cell value is preserved and only prefixed with `'`.
 */
export function sanitizeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "number") return String(val);
  const str = String(val);
  const probe = str.replace(/^[\s"']+/, "");
  if (/^[=+\-@\t\r]/.test(probe) && !/^-[0-9]+(\.[0-9]+)?$/.test(probe)) {
    return `'${str}`;
  }
  return str;
}

export function generateSupplierMemo(
  invoice: InvoiceData,
  packingList: PackingListData,
  reconciliation: ReconciliationResult,
  lang: "es" | "en" = "es",
  auditTrail: AuditLogEntry[] = []
): string {
  const { findings, skuSummaries, computedTotals } = reconciliation;
  const discrepancies = findings.filter((f) => f.severity === "DISCREPANCY");
  const ambiguities = findings.filter((f) => f.severity === "AMBIGUITY");
  const operatorActions = auditTrail.filter(
    (a) => a.action === "CELL_EDIT" || a.action === "FACTOR_CONFIRMED"
  );

  if (lang === "en") {
    const auditSectionEn =
      operatorActions.length > 0
        ? [
            ``,
            `OPERATOR CONTROL & AUDIT TRAIL (${operatorActions.length} verified action(s)):`,
            ...operatorActions.map(
              (a, idx) =>
                `   [${idx + 1}] ${a.timestamp} | ${a.actor} | ${a.action} on ${a.targetId}.${a.field}: "${a.previousValue}" -> "${a.newValue}"`
            ),
          ]
        : [];

    if (findings.length === 0) {
      return [
        `PRE-FILING CLEARANCE READY — ZERO DISCREPANCIES`,
        `Invoice: ${invoice.invoice_no} | Packing List: ${packingList.packing_list_no} | Incoterm: ${invoice.incoterm}`,
        `Total Declared Amount: ${invoice.currency} ${computedTotals.invoiceLinesSumAmount.toFixed(2)}`,
        `Total Cartons Verified: ${computedTotals.packingCalculatedCartons} CTNs | Gross Weight: ${computedTotals.packingCalculatedGrossKg.toFixed(2)} KG`,
        ``,
        `All ${skuSummaries.length} SKUs reconciled across Commercial Invoice and Packing List.`,
        ...auditSectionEn,
      ].join("\n");
    }

    const lines: string[] = [
      `SUBJECT: URGENT PRE-CUSTOMS RECONCILIATION HOLD — Invoice ${invoice.invoice_no} / Packing List ${packingList.packing_list_no}`,
      ``,
      `Dear Supplier / Export Team,`,
      `During our pre-filing verification between Commercial Invoice (${invoice.invoice_no}) and Packing List (${packingList.packing_list_no}), we detected the following items requiring correction or written clarification prior to customs entry:`,
      ``,
    ];

    if (discrepancies.length > 0) {
      lines.push(`1. FACTUAL DISCREPANCIES TO CORRECT (${discrepancies.length}):`);
      discrepancies.forEach((d, idx) => {
        lines.push(
          `   ${idx + 1}) [${d.code}] SKU ${d.sku} (Origins: ${d.origins.join(", ")}): ${d.detail_en || d.detail}`
        );
      });
      lines.push(``);
    }

    if (ambiguities.length > 0) {
      lines.push(
        `2. AMBIGUITIES REQUIRING WRITTEN CONFIRMATION (${ambiguities.length}):`
      );
      ambiguities.forEach((a, idx) => {
        lines.push(
          `   ${idx + 1}) [${a.code}] SKU ${a.sku} (Origins: ${a.origins.join(", ")}): ${a.detail_en || a.detail}`
        );
      });
      lines.push(``);
    }

    if (auditSectionEn.length > 0) {
      lines.push(...auditSectionEn.slice(1));
      lines.push(``);
    }

    lines.push(
      `Please send revised documents or explicit written confirmation for the referenced lines (${findings.flatMap((f) => f.origins).filter((v, i, arr) => arr.indexOf(v) === i).join(", ")}) so we can proceed with customs filing.`
    );
    return lines.join("\n");
  }

  // Español (por defecto)
  const auditSectionEs =
    operatorActions.length > 0
      ? [
          ``,
          `REGISTRO DE AUDITORÍA Y CONTROLES DEL OPERADOR (${operatorActions.length} acción(es) verificada(s)):`,
          ...operatorActions.map(
            (a, idx) =>
              `   [${idx + 1}] ${a.timestamp} | ${a.actor} | ${a.action} en ${a.targetId}.${a.field}: "${a.previousValue}" -> "${a.newValue}"`
          ),
        ]
      : [];

  if (findings.length === 0) {
    return [
      `ESTADO PRE-DESPACHO: CONCILIADO SIN DISCREPANCIAS (0 ALERTAS)`,
      `Factura Comercial: ${invoice.invoice_no} | Packing List: ${packingList.packing_list_no} | Incoterm: ${invoice.incoterm}`,
      `Valor Total Verificado: ${invoice.currency} ${computedTotals.invoiceLinesSumAmount.toFixed(2)}`,
      `Bultos Totales Verificados: ${computedTotals.packingCalculatedCartons} cajas | Peso Bruto Total: ${computedTotals.packingCalculatedGrossKg.toFixed(2)} KG`,
      ``,
      `Los ${skuSummaries.length} SKUs cuadran exactamente entre Factura Comercial y Packing List.`,
      ...auditSectionEs,
    ].join("\n");
  }

  const lines: string[] = [
    `ASUNTO: OBSERVACIONES PRE-DESPACHO ADUANERO — Factura ${invoice.invoice_no} / Packing List ${packingList.packing_list_no}`,
    ``,
    `Estimado equipo de exportación / proveedor:`,
    `Al conciliar la Factura Comercial (${invoice.invoice_no}) con el Packing List (${packingList.packing_list_no}) antes de la declaración aduanera, detectamos los siguientes puntos con su origen exacto:`,
    ``,
  ];

  if (discrepancies.length > 0) {
    lines.push(
      `1. DISCREPANCIAS DETECTADAS QUE REQUIEREN RECTIFICACIÓN (${discrepancies.length}):`
    );
    discrepancies.forEach((d, idx) => {
      lines.push(
        `   ${idx + 1}) [${d.code}] SKU ${d.sku} (Origen: ${d.origins.join(", ")}): ${d.detail}`
      );
    });
    lines.push(``);
  }

  if (ambiguities.length > 0) {
    lines.push(
      `2. DATOS AMBIGUOS QUE REQUIEREN ACLARACIÓN EXPLÍCITA (${ambiguities.length}):`
    );
    ambiguities.forEach((a, idx) => {
      lines.push(
        `   ${idx + 1}) [${a.code}] SKU ${a.sku} (Origen: ${a.origins.join(", ")}): ${a.detail}`
      );
    });
    lines.push(``);
  }

  if (auditSectionEs.length > 0) {
    lines.push(...auditSectionEs.slice(1));
    lines.push(``);
  }

  const allOrigins = Array.from(
    new Set(findings.flatMap((f) => f.origins))
  ).join(", ");
  lines.push(
    `Por favor rectificar los documentos o confirmar por escrito la equivalencia en las filas citadas (${allOrigins}) antes de numerar el despacho.`
  );
  return lines.join("\n");
}

export function generateReconciliationCsv(
  reconciliation: ReconciliationResult,
  invoice?: InvoiceData
): string {
  // Quantity_Status es solo cantidades (antes "Status", que se leía como
  // conformidad completa). Overall_Status incorpora cualquier hallazgo del
  // SKU (p. ej. error aritmético de importe): un producto con cantidades
  // conformes pero importe erróneo ya no sale como MATCHED en general.
  const headers = [
    "SKU",
    "Paired_PL_SKU",
    "Invoice_Line_ID",
    "Packing_Row_IDs",
    "Invoice_Qty",
    "Invoice_Unit",
    "Packing_Total_Qty",
    "Packing_Unit",
    "Conversion_Factor_Used",
    "Conversion_Source",
    "Quantity_Status",
    "Overall_Status",
    "Finding_Codes",
    "Invoice_Unit_Price",
    "Invoice_Line_Amount_Declared",
    "Invoice_Line_Amount_Expected",
    "Invoice_Amount_Difference",
  ];
  const overallFor = (sku: string, quantityStatus: string) => {
    const own = reconciliation.findings.filter((f) => f.sku === sku);
    if (quantityStatus === "MATCHED" && own.length === 0) return "MATCHED";
    if (quantityStatus === "DISCREPANCY" || own.some((f) => f.severity === "DISCREPANCY")) return "DISCREPANCY";
    return "AMBIGUOUS";
  };
  const rows = reconciliation.skuSummaries.map((s) => {
    const line = invoice?.lines.find(
      (l) => l.line_id === s.invoiceLineId || l.sku === s.sku
    );
    const expected =
      line != null ? Number((line.qty * line.unit_price).toFixed(2)) : null;
    const own = reconciliation.findings.filter((f) => f.sku === s.sku);
    return [
      sanitizeCsvCell(s.sku),
      sanitizeCsvCell(s.pairedPlSku ?? ""),
      sanitizeCsvCell(s.invoiceLineId ?? ""),
      sanitizeCsvCell(s.packingRowIds.join("|")),
      sanitizeCsvCell(s.invoiceQty != null ? String(s.invoiceQty) : ""),
      sanitizeCsvCell(s.invoiceUnit ?? ""),
      sanitizeCsvCell(String(s.packingTotalQty)),
      sanitizeCsvCell(s.packingUnit ?? ""),
      sanitizeCsvCell(s.conversionFactorUsed != null ? String(s.conversionFactorUsed) : ""),
      sanitizeCsvCell(s.conversionSource),
      sanitizeCsvCell(s.status),
      sanitizeCsvCell(overallFor(s.sku, s.status)),
      sanitizeCsvCell(own.map((f) => f.code).join("|")),
      sanitizeCsvCell(line != null ? line.unit_price.toFixed(2) : ""),
      sanitizeCsvCell(line != null ? line.line_amount.toFixed(2) : ""),
      sanitizeCsvCell(expected != null ? expected.toFixed(2) : ""),
      sanitizeCsvCell(
        line != null && expected != null
          ? (line.line_amount - expected).toFixed(2)
          : ""
      ),
    ];
  });
  // Hallazgos globales (sku "ALL": peso/bultos) también viajan en el CSV.
  for (const f of reconciliation.findings.filter((x) => x.sku === "ALL")) {
    rows.push([
      sanitizeCsvCell("ALL"),
      sanitizeCsvCell(""),
      sanitizeCsvCell(""),
      sanitizeCsvCell(f.origins.join("|")),
      sanitizeCsvCell(""),
      sanitizeCsvCell(""),
      sanitizeCsvCell(""),
      sanitizeCsvCell(""),
      sanitizeCsvCell(""),
      sanitizeCsvCell("NONE"),
      sanitizeCsvCell(""),
      sanitizeCsvCell(f.severity === "DISCREPANCY" ? "DISCREPANCY" : "AMBIGUOUS"),
      sanitizeCsvCell(f.code),
      sanitizeCsvCell(""),
      sanitizeCsvCell(""),
      sanitizeCsvCell(""),
      sanitizeCsvCell(""),
    ]);
  }
  return [
    headers.join(","),
    ...rows.map((r) =>
      r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");
}
