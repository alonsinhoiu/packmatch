export const LBS_PER_KG = 2.20462;

export type NormalizedBBox = [number, number, number, number]; // [ymin, xmin, ymax, xmax] en escala 0..1000

export interface InvoiceLine {
  line_id: string;
  sku: string;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  line_amount: number;
  explicit_pcs_per_set: number | null;
  /** Factor confirmado manualmente por el operador en la interfaz (nunca adivinado por IA) */
  operator_pcs_per_set?: number | null;
  /** Coordenadas normalizadas [ymin, xmin, ymax, xmax] (0..1000) de la fila en la imagen original */
  bbox?: NormalizedBBox;
  /** true solo si el bbox es sintético (fallback defaultRowBBox); false/ausente = grounding real del modelo */
  bbox_estimated?: boolean;
}

export interface InvoiceData {
  invoice_no: string;
  incoterm: string;
  currency: string;
  declared_total_amount: number;
  declared_total_net_kg: number;
  declared_total_gross_kg: number;
  declared_total_cartons: number;
  header_bbox?: NormalizedBBox;
  lines: InvoiceLine[];
}

/**
 * Cómo debe agregarse el peso de una fila:
 * - PER_ROW: el peso pertenece a esa fila/producto; se suma (incluye el caso
 *   de peso distribuido entre productos de una misma caja).
 * - CARTON_TOTAL: cada fila repite el peso total de la caja compartida;
 *   se cuenta una sola vez por caja física.
 * - UNSPECIFIED: el documento declara caja compartida pero no permite saber
 *   si el peso es por producto o el total repetido; requiere resolución.
 * Ausente = PER_ROW (semántica histórica de las filas de packing).
 */
export type PackingWeightScope = "PER_ROW" | "CARTON_TOTAL" | "UNSPECIFIED";

export interface PackingListRow {
  row_id: string;
  carton_range: string;
  carton_count: number;
  sku: string;
  qty_per_carton: number;
  total_qty: number;
  unit: string;
  net_weight: number;
  gross_weight: number;
  weight_unit: string;
  shared_carton: boolean;
  /** Alcance del peso según el documento (ver PackingWeightScope). */
  weight_scope?: PackingWeightScope;
  /** Resolución del operador sobre weight_scope; prevalece sobre el documento. */
  operator_weight_scope?: PackingWeightScope | null;
  /** Nota impresa en la fila (p. ej. "SHARED; SAME 8/10 kg"), si se capturó. */
  notes?: string;
  explicit_pcs_per_set: number | null;
  is_packaging_only: boolean;
  /** Coordenadas normalizadas [ymin, xmin, ymax, xmax] (0..1000) de la fila en la imagen original */
  bbox?: NormalizedBBox;
  /** true solo si el bbox es sintético (fallback defaultRowBBox); false/ausente = grounding real del modelo */
  bbox_estimated?: boolean;
}

export interface PackingListData {
  packing_list_no: string;
  incoterm: string;
  declared_total_cartons: number;
  declared_total_net_kg: number;
  declared_total_gross_kg: number;
  header_bbox?: NormalizedBBox;
  rows: PackingListRow[];
}

export type FindingSeverity = "DISCREPANCY" | "AMBIGUITY";

export interface ReconciliationFinding {
  code:
    | "INVOICE_LINE_MATH_ERROR"
    | "PACKING_ROW_MATH_ERROR"
    | "WEIGHT_LOGIC_VIOLATION"
    | "SKU_IDENTIFIER_AMBIGUITY"
    | "MISSING_ITEM_IN_PACKING_LIST"
    | "UNIT_AMBIGUITY_UNCONVERTIBLE"
    | "QTY_MISMATCH"
    | "UNDECLARED_ITEM_IN_PACKING_LIST"
    | "CARTON_COUNT_MISMATCH"
    | "CARTON_COUNT_AMBIGUITY"
    | "SHARED_CARTON_WEIGHT_AMBIGUITY"
    | "TOTAL_GROSS_WEIGHT_MISMATCH";
  severity: FindingSeverity;
  sku: string;
  origins: string[];
  detail: string;
  detail_en?: string;
}

export interface SkuReconciliationSummary {
  sku: string;
  pairedPlSku: string | null;
  invoiceLineId: string | null;
  packingRowIds: string[];
  invoiceQty: number | null;
  invoiceUnit: string | null;
  packingTotalQty: number;
  packingUnit: string | null;
  conversionFactorUsed: number | null;
  conversionSource: "DOCUMENT_EXPLICIT" | "OPERATOR_CONFIRMED" | "NONE";
  status: "MATCHED" | "DISCREPANCY" | "AMBIGUOUS";
}

export interface ReconciliationResult {
  findings: ReconciliationFinding[];
  skuSummaries: SkuReconciliationSummary[];
  computedTotals: {
    invoiceLinesSumAmount: number;
    packingCalculatedCartons: number;
    packingCalculatedNetKg: number;
    packingCalculatedGrossKg: number;
  };
}

/**
 * Cardinalidad física que declara un rango de cajas, si es determinable:
 * "7" -> 1, "7-9" / "CTN 1-6" -> span, "1,3,5" -> 3. Sin dígitos o con un
 * span invertido devuelve null (no se inventa el número de bultos).
 */
export function parseCartonRangeCount(range: string): number | null {
  const s = String(range || "").normalize("NFKC").toUpperCase();
  const numbers = (s.match(/\d+/g) || []).map(Number);
  if (numbers.length === 0) return null;
  if (numbers.length === 1) return 1;
  const span = s.match(/(\d+)\s*[-–—~]\s*(\d+)/) || s.match(/(\d+)\s+TO\s+(\d+)/);
  if (span) {
    const a = Number(span[1]);
    const b = Number(span[2]);
    return b >= a ? b - a + 1 : null;
  }
  if (/[,;]/.test(s)) return numbers.length;
  return null;
}

/**
 * Motor determinista de conciliación pre-despacho (paridad 1:1 con reconcile_and_eval.py).
 * Regla crítica: NUNCA convierte PCS <-> SETS sin un factor explícito en el documento
 * (`explicit_pcs_per_set`) o confirmado manualmente por el operador (`operator_pcs_per_set`).
 */
export function reconcileShipment(
  invoice: InvoiceData,
  packingList: PackingListData
): ReconciliationResult {
  const findings: ReconciliationFinding[] = [];
  const skuSummaries: SkuReconciliationSummary[] = [];

  // 1. Verificación aritmética interna de líneas de Factura
  const invBySku = new Map<string, InvoiceLine>();
  let invoiceLinesSumAmount = 0;

  for (const line of invoice.lines || []) {
    const lid = line.line_id;
    const sku = String(line.sku).trim();
    const qty = Number(line.qty);
    const uprice = Number(line.unit_price);
    const lamount = Number(line.line_amount);
    invoiceLinesSumAmount += lamount;

    if (Math.abs(qty * uprice - lamount) > 0.02) {
      findings.push({
        code: "INVOICE_LINE_MATH_ERROR",
        severity: "DISCREPANCY",
        sku,
        origins: [lid],
        detail: `Error aritmético en línea ${lid}: ${qty} × $${uprice.toFixed(2)} = $${(qty * uprice).toFixed(2)}, pero declara $${lamount.toFixed(2)}.`,
        detail_en: `Line ${lid} math mismatch: ${qty} * ${uprice.toFixed(2)} = ${(qty * uprice).toFixed(2)} != ${lamount.toFixed(2)}`,
      });
    }
    invBySku.set(sku, line);
  }

  // 1b. Grupos de caja física compartida: decidir, por caja, si el peso se
  // suma por fila, se cuenta una vez (total repetido) o es ambiguo.
  // Nunca se deduce "total repetido" solo de pesos iguales sin marca: los
  // pesos iguales sin alcance explícito generan ambigüedad resoluble.
  const weightKgOf = (row: PackingListRow) => {
    const u = String(row.weight_unit || "KG").toUpperCase().trim();
    const f = u === "LBS" || u === "LB" ? 1 / LBS_PER_KG : 1;
    return { net: Number(row.net_weight) * f, gross: Number(row.gross_weight) * f };
  };
  const declaredScope = (row: PackingListRow): PackingWeightScope | undefined =>
    row.operator_weight_scope ?? row.weight_scope ?? undefined;
  const skipWeightRowIds = new Set<string>();
  const ambiguousWeightGroups: PackingListRow[][] = [];
  const ambiguousCartonGroups: PackingListRow[][] = [];
  // Cajas físicas por grupo compartido: la caja se cuenta una vez (el mayor
  // carton_count del grupo, típicamente 1 en la primera fila y 0 en el resto),
  // aunque todas las filas vengan marcadas como compartidas.
  const cartonContribution = new Map<string, number>();
  {
    const byCarton = new Map<string, PackingListRow[]>();
    for (const row of packingList.rows || []) {
      const key = String(row.carton_range || "").toUpperCase().replace(/\s+/g, "");
      const groupKey = key || row.row_id;
      byCarton.set(groupKey, [...(byCarton.get(groupKey) || []), row]);
    }
    for (const group of byCarton.values()) {
      if (group.length < 2) continue;
      const scopes = group.map(declaredScope);
      const isSharedGroup =
        group.some((r) => Boolean(r.shared_carton)) || scopes.some((s) => s !== undefined && s !== "PER_ROW");
      if (!isSharedGroup) continue;
      const weights = group.map(weightKgOf);
      const allWeightsEqual =
        weights.every((w) => Math.abs(w.net - weights[0].net) < 0.01 && Math.abs(w.gross - weights[0].gross) < 0.01);
      const hasCartonTotal = scopes.includes("CARTON_TOTAL");
      const hasPerRow = scopes.includes("PER_ROW");
      const hasUnspecified = scopes.includes("UNSPECIFIED");
      let mode: "SUM" | "COUNT_ONCE" | "AMBIGUOUS";
      if (hasCartonTotal && hasPerRow) mode = "AMBIGUOUS"; // marcas contradictorias
      else if (hasCartonTotal) mode = allWeightsEqual ? "COUNT_ONCE" : "AMBIGUOUS";
      else if (hasUnspecified) mode = "AMBIGUOUS";
      else if (scopes.every((s) => s === "PER_ROW")) mode = "SUM"; // distribuido explícito, aunque los pesos coincidan
      else mode = allWeightsEqual ? "AMBIGUOUS" : "SUM"; // legado sin marca: solo lo repetido idéntico es dudoso
      // Conteo físico del grupo (una sola vez, en la primera fila):
      // - Un único conteo positivo distinto se conserva tal cual (el rango
      //   puede ser una etiqueta/palet con varias cajas: no se sustituye por
      //   la cardinalidad del rango).
      // - Si todas las filas traen 0 (p. ej. ambas marcadas compartidas por
      //   el modelo), la caja no desaparece: se deriva de la cardinalidad
      //   del rango ("7" -> 1, "7-9" -> 3).
      // - Conteos positivos contradictorios, o todo cero sin rango
      //   determinable, es ambiguo: no se inventa el número de bultos.
      const positiveDistinct = [
        ...new Set(group.map((r) => Number(r.carton_count || 0)).filter((n) => n > 0)),
      ];
      let physicalCartons: number | null;
      if (positiveDistinct.length === 1) physicalCartons = positiveDistinct[0];
      else if (positiveDistinct.length === 0)
        physicalCartons = parseCartonRangeCount(group[0].carton_range);
      else physicalCartons = null;
      if (physicalCartons === null) {
        ambiguousCartonGroups.push(group);
        group.forEach((r) => cartonContribution.set(r.row_id, 0));
      } else {
        group.forEach((r, i) =>
          cartonContribution.set(r.row_id, i === 0 ? physicalCartons! : 0)
        );
      }
      if (mode === "COUNT_ONCE") {
        group.slice(1).forEach((r) => skipWeightRowIds.add(r.row_id));
      } else if (mode === "AMBIGUOUS") {
        group.forEach((r) => skipWeightRowIds.add(r.row_id));
        ambiguousWeightGroups.push(group);
      }
    }
  }

  // 2. Verificación interna de filas de Packing List y agregación por SKU
  const plBySku = new Map<string, PackingListRow[]>();
  let totalPlNetKg = 0;
  let totalPlGrossKg = 0;
  let totalPlCartons = 0;

  for (const row of packingList.rows || []) {
    const rid = row.row_id;
    const sku = String(row.sku).trim();
    const cCount = Number(row.carton_count || 0);
    const shared = Boolean(row.shared_carton);

    // Fila compartida sin grupo (su caja la aporta otra fila): su conteo
    // positivo impreso se conserva; el 0 sigue siendo 0.
    totalPlCartons += cartonContribution.get(row.row_id) ?? cCount;
    if (!shared) {
      const qPerCtn = Number(row.qty_per_carton || 0);
      const tQty = Number(row.total_qty || 0);
      if (cCount > 0 && Math.abs(cCount * qPerCtn - tQty) > 0.01) {
        findings.push({
          code: "PACKING_ROW_MATH_ERROR",
          severity: "DISCREPANCY",
          sku,
          origins: [rid],
          detail: `Descuadre interno en fila ${rid}: ${cCount} cajas × ${qPerCtn} unid/caja ≠ ${tQty} total.`,
          detail_en: `Row ${rid} carton math mismatch: ${cCount} cartons * ${qPerCtn} != ${tQty}`,
        });
      }
    }

    const netW = Number(row.net_weight);
    const grossW = Number(row.gross_weight);
    const wUnit = String(row.weight_unit || "KG")
      .toUpperCase()
      .trim();

    const netKg = wUnit === "LBS" || wUnit === "LB" ? netW / LBS_PER_KG : netW;
    const grossKg =
      wUnit === "LBS" || wUnit === "LB" ? grossW / LBS_PER_KG : grossW;
    // Caja compartida con total repetido: solo aporta la primera fila.
    // Grupo ambiguo: no aporta hasta que el operador resuelva el alcance,
    // para no fabricar un total (ni una falsa discrepancia) con un supuesto.
    if (!skipWeightRowIds.has(row.row_id)) {
      totalPlNetKg += netKg;
      totalPlGrossKg += grossKg;
    }

    // Regla física: Peso Bruto > Peso Neto
    if (grossKg < netKg - 0.01) {
      findings.push({
        code: "WEIGHT_LOGIC_VIOLATION",
        severity: "DISCREPANCY",
        sku,
        origins: [rid],
        detail: `Inversión física en fila ${rid}: Peso Bruto (${grossW} ${wUnit}) es menor que Peso Neto (${netW} ${wUnit}).`,
        detail_en: `Row ${rid} has Gross Weight (${grossW} ${wUnit}) < Net Weight (${netW} ${wUnit}).`,
      });
    }

    if (
      row.is_packaging_only ||
      (Number(row.total_qty || 0) === 0 && sku.includes("FOAM"))
    ) {
      continue;
    }

    const existing = plBySku.get(sku) || [];
    existing.push(row);
    plBySku.set(sku, existing);
  }

  // 3. Emparejamiento de SKUs (exacto vs prefijo/sufijo ambiguo)
  const matchedPlSkus = new Set<string>();

  for (const [invSku, invLine] of invBySku.entries()) {
    const lid = invLine.line_id;
    let plRows = plBySku.get(invSku);
    let pairedPlSku: string | null = invSku;
    let hasAmbiguousSku = false;

    if (plRows !== undefined) {
      matchedPlSkus.add(invSku);
    } else {
      const candidates = Array.from(plBySku.keys()).filter(
        (k) =>
          !matchedPlSkus.has(k) &&
          (k.startsWith(invSku + "-") || invSku.startsWith(k + "-"))
      );
      if (candidates.length === 1) {
        const candSku = candidates[0];
        matchedPlSkus.add(candSku);
        plRows = plBySku.get(candSku)!;
        pairedPlSku = candSku;
        hasAmbiguousSku = true;
        findings.push({
          code: "SKU_IDENTIFIER_AMBIGUITY",
          severity: "AMBIGUITY",
          sku: invSku,
          origins: [lid, ...plRows.map((r) => r.row_id)],
          detail: `Variación ambigua de código: la Factura declara '${invSku}' (${lid}) mientras el Packing List indica '${candSku}' (${plRows.map((r) => r.row_id).join(", ")}) sin tabla de equivalencia.`,
          detail_en: `Invoice SKU '${invSku}' tentatively paired with Packing List SKU '${candSku}' without explicit alias table.`,
        });
      } else {
        findings.push({
          code: "MISSING_ITEM_IN_PACKING_LIST",
          severity: "DISCREPANCY",
          sku: invSku,
          origins: [lid],
          detail: `El SKU '${invSku}' facturado en ${lid} no aparece en ninguna fila del Packing List.`,
          detail_en: `SKU '${invSku}' on Invoice (${lid}) not found in Packing List.`,
        });
        skuSummaries.push({
          sku: invSku,
          pairedPlSku: null,
          invoiceLineId: lid,
          packingRowIds: [],
          invoiceQty: Number(invLine.qty),
          invoiceUnit: String(invLine.unit).toUpperCase().trim(),
          packingTotalQty: 0,
          packingUnit: null,
          conversionFactorUsed: null,
          conversionSource: "NONE",
          status: "DISCREPANCY",
        });
        continue;
      }
    }

    const invUnit = String(invLine.unit).toUpperCase().trim();
    const invQty = Number(invLine.qty);
    const plUnits = new Set(
      plRows.map((r) => String(r.unit).toUpperCase().trim())
    );
    const plSumQty = plRows.reduce((acc, r) => acc + Number(r.total_qty), 0);
    const origins = [lid, ...plRows.map((r) => r.row_id)];

    if (plUnits.size > 1) {
      findings.push({
        code: "UNIT_AMBIGUITY_UNCONVERTIBLE",
        severity: "AMBIGUITY",
        sku: invSku,
        origins,
        detail: `Unidades mezcladas entre distintas filas del Packing List para ${invSku}: ${Array.from(plUnits).sort().join(", ")}.`,
        detail_en: `Mixed units across Packing List rows for ${invSku}: ${Array.from(plUnits).sort().join(", ")}`,
      });
      skuSummaries.push({
        sku: invSku,
        pairedPlSku,
        invoiceLineId: lid,
        packingRowIds: plRows.map((r) => r.row_id),
        invoiceQty: invQty,
        invoiceUnit: invUnit,
        packingTotalQty: plSumQty,
        packingUnit: "MIXED",
        conversionFactorUsed: null,
        conversionSource: "NONE",
        status: "AMBIGUOUS",
      });
      continue;
    }

    const plUnit = Array.from(plUnits)[0];
    let status: "MATCHED" | "DISCREPANCY" | "AMBIGUOUS" = hasAmbiguousSku
      ? "AMBIGUOUS"
      : "MATCHED";
    let conversionFactorUsed: number | null = null;
    let conversionSource: "DOCUMENT_EXPLICIT" | "OPERATOR_CONFIRMED" | "NONE" =
      "NONE";

    if (invUnit === plUnit) {
      if (Math.abs(invQty - plSumQty) > 0.01) {
        status = "DISCREPANCY";
        findings.push({
          code: "QTY_MISMATCH",
          severity: "DISCREPANCY",
          sku: invSku,
          origins,
          detail: `La Factura (${lid}) declara ${invQty} ${invUnit}, pero las filas del Packing List (${plRows.map((r) => r.row_id).join(", ")}) suman ${plSumQty} ${plUnit} (diferencia: ${plSumQty - invQty > 0 ? "+" : ""}${plSumQty - invQty} ${plUnit}).`,
          detail_en: `Invoice (${lid}) declares ${invQty} ${invUnit}, but Packing List rows (${plRows.map((r) => r.row_id).join(", ")}) sum to ${plSumQty} ${plUnit}.`,
        });
      }
    } else {
      const docFactors = [
        invLine.explicit_pcs_per_set,
        ...plRows.map((r) => r.explicit_pcs_per_set),
      ].filter((f): f is number => f !== null && f !== undefined && f > 0);

      const operatorFactor =
        invLine.operator_pcs_per_set && invLine.operator_pcs_per_set > 0
          ? Number(invLine.operator_pcs_per_set)
          : null;

      if (docFactors.length === 0 && operatorFactor === null) {
        status = "AMBIGUOUS";
        findings.push({
          code: "UNIT_AMBIGUITY_UNCONVERTIBLE",
          severity: "AMBIGUITY",
          sku: invSku,
          origins,
          detail: `No se puede convertir ${invQty} ${invUnit} (${lid}) a ${plSumQty} ${plUnit} (${plRows.map((r) => r.row_id).join(", ")}) sin un factor de conversión explícito en los documentos.`,
          detail_en: `Cannot convert ${invQty} ${invUnit} (${lid}) to ${plSumQty} ${plUnit} without an explicit conversion factor in the documents.`,
        });
      } else {
        const factor =
          docFactors.length > 0 ? Number(docFactors[0]) : operatorFactor!;
        conversionFactorUsed = factor;
        conversionSource =
          docFactors.length > 0 ? "DOCUMENT_EXPLICIT" : "OPERATOR_CONFIRMED";

        const invInPcs =
          invUnit === "SETS" && plUnit === "PCS"
            ? invQty * factor
            : invQty / factor;
        if (Math.abs(invInPcs - plSumQty) > 0.01) {
          status = "DISCREPANCY";
          findings.push({
            code: "QTY_MISMATCH",
            severity: "DISCREPANCY",
            sku: invSku,
            origins,
            detail: `Con factor ${conversionSource === "OPERATOR_CONFIRMED" ? "confirmado por operador" : "explícito"} (1 SET = ${factor} PCS), la Factura (${lid}) equivale a ${invInPcs} ${plUnit}, pero el Packing List suma ${plSumQty} ${plUnit}.`,
            detail_en: `With ${conversionSource === "OPERATOR_CONFIRMED" ? "operator-confirmed" : "explicit"} factor ${factor}, Invoice (${lid}) equals ${invInPcs} ${plUnit}, but Packing List sums to ${plSumQty} ${plUnit}.`,
          });
        }
      }
    }

    skuSummaries.push({
      sku: invSku,
      pairedPlSku,
      invoiceLineId: lid,
      packingRowIds: plRows.map((r) => r.row_id),
      invoiceQty: invQty,
      invoiceUnit: invUnit,
      packingTotalQty: plSumQty,
      packingUnit: plUnit,
      conversionFactorUsed,
      conversionSource,
      status,
    });
  }

  // 4. Ítems en Packing List no declarados en Factura Comercial
  for (const [plSku, plRows] of plBySku.entries()) {
    if (!matchedPlSkus.has(plSku)) {
      findings.push({
        code: "UNDECLARED_ITEM_IN_PACKING_LIST",
        severity: "DISCREPANCY",
        sku: plSku,
        origins: plRows.map((r) => r.row_id),
        detail: `Mercancía no declarada en factura: el SKU '${plSku}' figura físicamente en el Packing List (${plRows.map((r) => r.row_id).join(", ")}) pero no existe en la Factura Comercial.`,
        detail_en: `SKU '${plSku}' appears in Packing List (${plRows.map((r) => r.row_id).join(", ")}) but is missing from Commercial Invoice.`,
      });
      skuSummaries.push({
        sku: plSku,
        pairedPlSku: plSku,
        invoiceLineId: null,
        packingRowIds: plRows.map((r) => r.row_id),
        invoiceQty: null,
        invoiceUnit: null,
        packingTotalQty: plRows.reduce(
          (acc, r) => acc + Number(r.total_qty),
          0
        ),
        packingUnit: String(plRows[0]?.unit || "PCS")
          .toUpperCase()
          .trim(),
        conversionFactorUsed: null,
        conversionSource: "NONE",
        status: "DISCREPANCY",
      });
    }
  }

  // 4b. Ambigüedad de peso en caja compartida (resoluble por el operador
  // editando el alcance del peso: por fila o total de caja repetido).
  for (const group of ambiguousWeightGroups) {
    const ids = group.map((r) => r.row_id);
    const range = group[0].carton_range;
    findings.push({
      code: "SHARED_CARTON_WEIGHT_AMBIGUITY",
      severity: "AMBIGUITY",
      sku: "ALL",
      origins: ids,
      detail: `Peso de caja compartida sin alcance determinable en la caja ${range} (${ids.join(", ")}): no se sabe si cada fila trae el peso por producto o si repiten el peso total de la caja. Confirma el alcance del peso para agregar los kilos una sola vez o sumarlos por producto.`,
      detail_en: `Shared-carton weight scope cannot be determined for carton ${range} (${ids.join(", ")}): it is unclear whether each row carries its per-product weight or repeats the whole carton weight. Confirm the weight scope to count the kilos once or sum them per product.`,
    });
  }

  // 4c. Ambigüedad de bultos de un grupo compartido: no se puede determinar
  // cuántas cajas físicas son (conteos contradictorios o rango sin
  // cardinalidad). Resoluble editando rango/nº de cajas del grupo.
  for (const group of ambiguousCartonGroups) {
    const ids = group.map((r) => r.row_id);
    findings.push({
      code: "CARTON_COUNT_AMBIGUITY",
      severity: "AMBIGUITY",
      sku: "ALL",
      origins: ids,
      detail: `Número de bultos sin determinar en la caja/rango compartido «${group[0].carton_range}» (${ids.join(", ")}): los conteos por fila no coinciden o el rango no permite derivar cuántas cajas físicas son. Confirma el rango o el nº de cajas del grupo.`,
      detail_en: `Physical carton count cannot be determined for shared carton/range "${group[0].carton_range}" (${ids.join(", ")}): row counts conflict or the range has no determinable cardinality. Confirm the group's range or carton count.`,
    });
  }

  // 5. Verificación de totales globales de bultos y peso bruto
  const invCartons = Number(invoice.declared_total_cartons || 0);
  const plDeclCartons = Number(packingList.declared_total_cartons || 0);
  // Con un grupo de bultos ambiguo la suma está incompleta: no se emite un
  // descuadre de bultos que podría ser falso.
  if (ambiguousCartonGroups.length === 0 && (invCartons !== plDeclCartons || plDeclCartons !== totalPlCartons)) {
    const extraOrigins = ["INV-HEADER", "PL-HEADER"];
    for (const [plSku, plRows] of plBySku.entries()) {
      if (!matchedPlSkus.has(plSku)) {
        extraOrigins.push(...plRows.map((r) => r.row_id));
      }
    }
    findings.push({
      code: "CARTON_COUNT_MISMATCH",
      severity: "DISCREPANCY",
      sku: "ALL",
      origins: extraOrigins,
      detail: `Descuadre de bultos totales: cabecera Factura declara ${invCartons} cajas, cabecera PL declara ${plDeclCartons} cajas y la suma de filas es ${totalPlCartons} cajas.`,
      detail_en: `Carton count mismatch: Invoice header=${invCartons}, PL header=${plDeclCartons}, PL row sum=${totalPlCartons}.`,
    });
  }

  const invGross = Number(invoice.declared_total_gross_kg || 0.0);
  // Con un grupo de peso ambiguo el total calculado está incompleto: no se
  // emite una discrepancia de peso total que podría ser falsa.
  if (ambiguousWeightGroups.length === 0 && Math.abs(totalPlGrossKg - invGross) > 0.25) {
    findings.push({
      code: "TOTAL_GROSS_WEIGHT_MISMATCH",
      severity: "DISCREPANCY",
      sku: "ALL",
      origins: [
        "INV-HEADER",
        ...(packingList.rows || []).map((r) => r.row_id),
      ],
      detail: `Descuadre de Peso Bruto Total: las filas del Packing List suman ${totalPlGrossKg.toFixed(2)} KG (convertidos), pero la Factura Comercial declara ${invGross.toFixed(2)} KG.`,
      detail_en: `Sum of PL row gross weights (${totalPlGrossKg.toFixed(2)} KG) != Invoice declared gross weight (${invGross.toFixed(2)} KG).`,
    });
  }

  return {
    findings,
    skuSummaries,
    computedTotals: {
      invoiceLinesSumAmount: Number(invoiceLinesSumAmount.toFixed(2)),
      packingCalculatedCartons: totalPlCartons,
      packingCalculatedNetKg: Number(totalPlNetKg.toFixed(2)),
      packingCalculatedGrossKg: Number(totalPlGrossKg.toFixed(2)),
    },
  };
}
