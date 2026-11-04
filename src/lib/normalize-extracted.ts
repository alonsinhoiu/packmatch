import { parseCartonRangeCount } from "./reconcile.ts";
import { refineRowBBoxes } from "./bbox.ts";
import type {
  InvoiceData,
  InvoiceLine,
  NormalizedBBox,
  PackingListData,
  PackingListRow,
  PackingWeightScope,
} from "./reconcile";

/** NFKC: pliega ancho completo (１２３, ，．) a ASCII para comparar y calcular. */
export function nfkc(s: string): string {
  return s.normalize("NFKC");
}

/**
 * Interpreta un número respetando las convenciones del documento:
 * - NFKC previo (dígitos/separadores de ancho completo -> ASCII).
 * - Con ambos separadores, el último es el decimal ("1,250.50" y "1.250,50" -> 1250.5).
 * - Con uno solo: múltiples ocurrencias o grupo final de 3 dígitos -> miles ("1,250" -> 1250,
 *   "1.250" -> 1250); en otro caso el separador es decimal ("4,5" -> 4.5).
 * Devuelve null si no hay ningún dígito (ilegible): el llamador decide el fallback
 * en lugar de inventar silently un valor distinto de cero.
 */
export function parseLocalizedNumber(raw: string): number | null {
  let s = raw.normalize("NFKC").trim();
  if (!s) return null;
  s = s
    .replace(/[$€£¥\s ]/g, "")
    .replace(/^(USD|EUR|CLP|CNY|RMB)/i, "")
    .replace(/(USD|EUR|CLP|CNY|RMB|KGS?|LBS?|KG|元|美元|块)$/i, "");
  s = s.replace(/[^0-9,.\-]/g, "");
  if (!/[0-9]/.test(s)) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let canonical: string;
  if (hasComma && hasDot) {
    canonical =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else if (hasComma) {
    const commas = (s.match(/,/g) || []).length;
    canonical = commas > 1 || /,\d{3}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (hasDot) {
    const dots = (s.match(/\./g) || []).length;
    canonical = dots > 1 || /\.\d{3}$/.test(s) ? s.replace(/\./g, "") : s;
  } else {
    canonical = s;
  }
  const n = Number(canonical);
  return Number.isFinite(n) ? n : null;
}

export function parseSafeNumber(val: unknown, fallback = 0): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const parsed = parseLocalizedNumber(val);
    if (parsed !== null) return parsed;
  }
  return fallback;
}

export function normalizeDiscreteUnit(rawUnit: unknown): string {
  const u = String(rawUnit ?? "PCS")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\./g, "")
    .trim();
  if (
    [
      "PC",
      "PCS",
      "PIECE",
      "PIECES",
      "EA",
      "EACH",
      "UNIT",
      "UNITS",
      "UN",
      "UND",
      "PZA",
      "PZAS",
      // Contables inequívocos en chino: 件/个/只/台/片/支/颗/粒/瓶/袋
      "件",
      "个",
      "只",
      "台",
      "片",
      "支",
      "颗",
      "粒",
      "瓶",
      "袋",
    ].includes(u)
  ) {
    return "PCS";
  }
  // Conjuntos inequívocos en chino: 套/组
  if (["SET", "SETS", "KIT", "KITS", "ASSY", "PACK", "PACKS", "套", "组"].includes(u)) {
    return "SETS";
  }
  // Unidades de embalaje ambiguas (箱, pallet, rollo...) se copian VERBATIM:
  // el motor las dejará como ambigüedad que requiere confirmación.
  return u || "PCS";
}

export function normalizeWeightUnit(rawUnit: unknown): string {
  const u = String(rawUnit ?? "KG")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\./g, "")
    .trim();
  if (["LB", "LBS", "POUND", "POUNDS", "磅", "英磅"].includes(u)) return "LBS";
  if (["KG", "KGS", "KILO", "KILOS", "KILOGRAM", "KILOGRAMS", "千克", "公斤"].includes(u))
    return "KG";
  //克 (gramo) y 吨 (tonelada) NO se convierten: copiar verbatim y dejar que la
  // revisión del operador lo aclare en lugar de multiplicar/dividir a ciegas.
  return u || "KG";
}

export function extractExplicitFactorFromText(text: string): number | null {
  if (!text) return null;
  const t = text.normalize("NFKC");
  // Detecta patrones explícitos escritos en el documento como:
  // "1 SET = 4 PCS", "1 KIT = 10 PCS", "(4 PCS/SET)", "10 pcs per set",
  // "1套=4件", "1套:4件", "每套4件", "4件/套"
  const m1 = t.match(
    /1\s*(?:SET|KIT|PACK|套|组)\s*(?:=|EQUALS|CONTAINS|:|：)\s*(\d+)\s*(?:PCS|PC|PIECES|EA|件|个|只)/i
  );
  if (m1) return Number(m1[1]);
  const m2 = t.match(
    /每\s*(?:SET|KIT|套|组)\s*(\d+)\s*(?:PCS|PC|PIECES|EA|件|个|只)/i
  );
  if (m2) return Number(m2[1]);
  const m3 = t.match(
    /(\d+)\s*(?:PCS|PC|PIECES|EA|件|个|只)\s*(?:\/|／|PER)\s*(?:SET|KIT|PACK|套|组)/i
  );
  if (m3) return Number(m3[1]);
  return null;
}

function isValidBBox(bbox: unknown): bbox is NormalizedBBox {
  if (!Array.isArray(bbox) || bbox.length !== 4) return false;
  const [ymin, xmin, ymax, xmax] = bbox.map((n) => Number(n));
  return (
    Number.isFinite(ymin) &&
    Number.isFinite(xmin) &&
    Number.isFinite(ymax) &&
    Number.isFinite(xmax) &&
    ymin >= 0 &&
    xmin >= 0 &&
    ymax <= 1000 &&
    xmax <= 1000 &&
    ymax > ymin &&
    xmax > xmin
  );
}

/**
 * Calcula coordenadas normalizadas [ymin, xmin, ymax, xmax] (0..1000) por defecto
 * cuando un documento precargado o un modelo no devuelve bbox por fila.
 * ATENCIÓN: el resultado es sintético/estimado, NO grounding real del modelo.
 * Los llamadores deben marcar `bbox_estimated: true` en ese caso.
 */
export function defaultRowBBox(
  rowIndex: number,
  totalRows: number
): NormalizedBBox {
  // Basado en la geometría estándar de tabla: cabecera en y=95..140, filas desde y=218
  const rowStep = totalRows > 8 ? 38 : 42;
  const ymin = Math.min(920, 216 + rowIndex * rowStep);
  const ymax = Math.min(960, ymin + rowStep - 2);
  return [ymin, 32, ymax, 968];
}

/**
 * Alcance del peso de una caja compartida a partir del campo del modelo o de
 * la nota impresa. Solo marcas textuales explícitas producen CARTON_TOTAL o
 * PER_ROW; una nota de caja compartida sin dato de peso produce UNSPECIFIED.
 */
export function normalizeWeightScope(
  rawScope: unknown,
  notes: string,
  isShared: boolean
): PackingWeightScope | undefined {
  const s = String(rawScope ?? "").normalize("NFKC").toUpperCase().trim();
  if (["CARTON_TOTAL", "SHARED_TOTAL", "REPEATED", "REPEATED_TOTAL", "TOTAL_CAJA", "CARTON"].includes(s)) return "CARTON_TOTAL";
  if (["PER_ROW", "PER_PRODUCT", "DISTRIBUTED", "POR_PRODUCTO", "ROW"].includes(s)) return "PER_ROW";
  if (["UNSPECIFIED", "UNKNOWN", "AMBIGUOUS", "SIN_DETERMINAR"].includes(s)) return "UNSPECIFIED";
  const t = String(notes || "").normalize("NFKC");
  if (
    /\bsame\s+[\d.,/]+\s*(kg|lb)/i.test(t) ||
    /\bsame\b[^.;]{0,50}\b(weight|kg|peso)\b/i.test(t) ||
    /\bshared\b[^.;]{0,50}\b(weight|total)\b/i.test(t) ||
    /peso\s+(total\s+)?(de\s+la\s+)?caja/i.test(t) ||
    /mismo\s+peso|peso\s+repetido|repite\s+el\s+peso/i.test(t) ||
    /(相同|同一|整箱)[^。;]{0,20}(重量|总重|毛重|净重)/.test(t)
  ) return "CARTON_TOTAL";
  if (/distributed|per[-\s]?product|por\s+producto|distribuid|分摊|按产品/.test(t.toLowerCase())) return "PER_ROW";
  if (isShared && /shared|compartid|混装|共享/i.test(t)) return "UNSPECIFIED";
  return undefined;
}

export function normalizeExtractedPayload(raw: any): {
  invoice: InvoiceData;
  packing_list: PackingListData;
} {
  const rawInv = raw?.invoice || {};
  const rawPl = raw?.packing_list || {};

  const rawLines: any[] = Array.isArray(rawInv.lines) ? rawInv.lines : [];
  const normalizedLines: InvoiceLine[] = rawLines.map((line, idx) => {
    const rawId = String(line?.line_id ?? "").trim();
    const canonicalLineId = /^INV-L\d+$/i.test(rawId)
      ? rawId.toUpperCase()
      : `INV-L${idx + 1}`;

    const description = String(
      line?.description ?? line?.item_description ?? line?.name ?? ""
    ).trim();
    // NFKC en SKU: pliega ancho completo (ＡＢＣ-１２３ -> ABC-123) de forma
    // consistente en factura y empaque; nunca traduce ni fusiona distintos.
    const sku = String(
      line?.sku ??
        line?.part_number ??
        line?.part_no ??
        line?.item_code ??
        line?.pn ??
        `ITEM-${idx + 1}`
    )
      .normalize("NFKC")
      .trim();

    const explicitFromField =
      line?.explicit_pcs_per_set !== null &&
      line?.explicit_pcs_per_set !== undefined &&
      Number(line?.explicit_pcs_per_set) > 0
        ? Number(line.explicit_pcs_per_set)
        : null;
    const explicitFactor =
      explicitFromField ?? extractExplicitFactorFromText(description);

    return {
      line_id: canonicalLineId,
      sku,
      description,
      qty: parseSafeNumber(line?.qty ?? line?.quantity, 0),
      unit: normalizeDiscreteUnit(line?.unit ?? line?.uom),
      unit_price: parseSafeNumber(line?.unit_price ?? line?.price, 0),
      line_amount: parseSafeNumber(line?.line_amount ?? line?.amount, 0),
      explicit_pcs_per_set: explicitFactor,
      operator_pcs_per_set:
        line?.operator_pcs_per_set && Number(line.operator_pcs_per_set) > 0
          ? Number(line.operator_pcs_per_set)
          : null,
      bbox: isValidBBox(line?.bbox)
        ? [
            Number(line.bbox[0]),
            Number(line.bbox[1]),
            Number(line.bbox[2]),
            Number(line.bbox[3]),
          ]
        : defaultRowBBox(idx, rawLines.length),
      bbox_estimated: isValidBBox(line?.bbox) ? false : true,
    };
  });

  const rawRows: any[] = Array.isArray(rawPl.rows) ? rawPl.rows : [];
  const seenCartonRanges = new Set<string>();

  const normalizedRows: PackingListRow[] = rawRows.map((row, idx) => {
    const rawId = String(row?.row_id ?? "").trim();
    const canonicalRowId = /^PL-R\d+$/i.test(rawId)
      ? rawId.toUpperCase()
      : `PL-R${idx + 1}`;

    const cartonRange = String(
      row?.carton_range ?? row?.carton_no ?? row?.box_no ?? `CTN ${idx + 1}`
    )
      .normalize("NFKC")
      .trim();
    const rawCartonCountStr = String(row?.carton_count ?? "").toUpperCase();
    const explicitlyShared =
      Boolean(row?.shared_carton) ||
      rawCartonCountStr.includes("SHARED") ||
      cartonRange.toUpperCase().includes("SHARED") ||
      cartonRange.includes("共享");

    const rangeKey = cartonRange.toUpperCase().replace(/\s+/g, "");
    const implicitlyShared =
      !explicitlyShared && rangeKey.length > 0 && seenCartonRanges.has(rangeKey);
    if (rangeKey.length > 0) seenCartonRanges.add(rangeKey);

    const isShared = explicitlyShared || implicitlyShared;
    // Un conteo positivo impreso se conserva aunque la fila sea compartida:
    // forzarlo a 0 hacía desaparecer la caja física cuando el modelo marcaba
    // compartidas todas las filas del grupo. El 0 se mantiene como 0; el
    // motor deriva la contribución del grupo desde el rango si procede.
    let cartonCount = parseSafeNumber(row?.carton_count, 0);

    // Si una plantilla real no trae columna separada "Cartons" pero trae "CTN 1-4"
    if (!isShared && cartonCount === 0) {
      const mRange = cartonRange.match(/(\d+)\s*[-–~to]+\s*(\d+)/i);
      if (mRange) {
        const a = Number(mRange[1]);
        const b = Number(mRange[2]);
        if (b >= a) cartonCount = b - a + 1;
      } else if (/\d+/.test(cartonRange)) {
        cartonCount = 1;
      }
    }

    const sku = String(
      row?.sku ??
        row?.part_number ??
        row?.part_no ??
        row?.item_code ??
        row?.pn ??
        `ITEM-${idx + 1}`
    )
      .normalize("NFKC")
      .trim();
    const totalQty = parseSafeNumber(row?.total_qty ?? row?.qty, 0);
    const qtyPerCarton = parseSafeNumber(
      row?.qty_per_carton ?? row?.qty_per_box,
      cartonCount > 0 ? totalQty / cartonCount : totalQty
    );

    const isPackaging =
      Boolean(row?.is_packaging_only) ||
      (totalQty === 0 &&
        /FOAM|PALLET|DUNNAGE|PACKAGING|CRATE|托盘|泡沫|木箱/i.test(sku));

    const rowNotes = String(row?.notes ?? row?.note ?? row?.remarks ?? "").normalize("NFKC").trim();
    return {
      row_id: canonicalRowId,
      carton_range: cartonRange,
      carton_count: cartonCount,
      sku,
      qty_per_carton: qtyPerCarton,
      total_qty: totalQty,
      unit: normalizeDiscreteUnit(row?.unit ?? row?.uom),
      net_weight: parseSafeNumber(row?.net_weight ?? row?.nw, 0),
      gross_weight: parseSafeNumber(row?.gross_weight ?? row?.gw, 0),
      weight_unit: normalizeWeightUnit(row?.weight_unit),
      shared_carton: isShared,
      weight_scope: normalizeWeightScope(row?.weight_scope, rowNotes, isShared),
      notes: rowNotes || undefined,
      explicit_pcs_per_set:
        row?.explicit_pcs_per_set !== null &&
        row?.explicit_pcs_per_set !== undefined &&
        Number(row?.explicit_pcs_per_set) > 0
          ? Number(row.explicit_pcs_per_set)
          : null,
      is_packaging_only: isPackaging,
      bbox: isValidBBox(row?.bbox)
        ? [
            Number(row.bbox[0]),
            Number(row.bbox[1]),
            Number(row.bbox[2]),
            Number(row.bbox[3]),
          ]
        : defaultRowBBox(idx, rawRows.length),
      bbox_estimated: isValidBBox(row?.bbox) ? false : true,
    };
  });

  // Refinamiento del grounding: solo si TODAS las filas de un documento
  // traen bbox del modelo (sin estimados sintéticos mezclados). Corrige
  // filas atípicas frente a la retícula y marca estimado lo corregido.
  for (const rows of [normalizedLines, normalizedRows] as Array<Array<{ bbox?: NormalizedBBox; bbox_estimated?: boolean }>>) {
    if (rows.length >= 3 && rows.every((r) => r.bbox && !r.bbox_estimated)) {
      const refined = refineRowBBoxes(rows.map((r) => r.bbox!));
      rows.forEach((r, i) => {
        r.bbox = refined[i].bbox;
        r.bbox_estimated = refined[i].estimated;
      });
    }
  }

  // Total físico de fallback coherente con el motor: por grupo compartido
  // cuenta una vez (conteo positivo único; si todo es 0, cardinalidad del
  // rango); el resto suma su conteo por fila.
  const computedInvCartons = (() => {
    const groups = new Map<string, PackingListRow[]>();
    for (const r of normalizedRows) {
      const k = r.carton_range.toUpperCase().replace(/\s+/g, "") || r.row_id;
      groups.set(k, [...(groups.get(k) || []), r]);
    }
    let total = 0;
    for (const group of groups.values()) {
      const isSharedGroup = group.length > 1 && group.some((r) => r.shared_carton);
      if (!isSharedGroup) {
        total += group.reduce((a, r) => a + r.carton_count, 0);
        continue;
      }
      const positives = [...new Set(group.map((r) => r.carton_count).filter((n) => n > 0))];
      total +=
        positives.length === 1
          ? positives[0]
          : positives.length === 0
            ? (parseCartonRangeCount(group[0].carton_range) ?? 0)
            : 0;
    }
    return total;
  })();

  return {
    invoice: {
      invoice_no: String(rawInv.invoice_no ?? "INV-UNKNOWN").trim(),
      incoterm: String(rawInv.incoterm ?? "FOB").trim(),
      currency: String(rawInv.currency ?? "USD").trim(),
      declared_total_amount: parseSafeNumber(rawInv.declared_total_amount, 0),
      declared_total_net_kg: parseSafeNumber(rawInv.declared_total_net_kg, 0),
      declared_total_gross_kg: parseSafeNumber(
        rawInv.declared_total_gross_kg,
        0
      ),
      declared_total_cartons: parseSafeNumber(
        rawInv.declared_total_cartons,
        computedInvCartons
      ),
      header_bbox: isValidBBox(rawInv.header_bbox)
        ? rawInv.header_bbox
        : [92, 32, 145, 760],
      lines: normalizedLines,
    },
    packing_list: {
      packing_list_no: String(rawPl.packing_list_no ?? "PL-UNKNOWN").trim(),
      incoterm: String(rawPl.incoterm ?? "FOB").trim(),
      declared_total_cartons: parseSafeNumber(
        rawPl.declared_total_cartons,
        computedInvCartons
      ),
      declared_total_net_kg: parseSafeNumber(rawPl.declared_total_net_kg, 0),
      declared_total_gross_kg: parseSafeNumber(
        rawPl.declared_total_gross_kg,
        0
      ),
      header_bbox: isValidBBox(rawPl.header_bbox)
        ? rawPl.header_bbox
        : [92, 32, 145, 760],
      rows: normalizedRows,
    },
  };
}

// 4 MB: Netlify Functions acepta 6 MB con ~30% de sobrecarga base64 (~4.5 MB
// efectivos). El servidor nunca debe prometer más que la plataforma.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB

export function validateDataUrlAndMagicBytes(
  dataUrl: string,
  label: string
): { valid: boolean; error?: string; mime?: string; buffer?: Buffer } {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    return { valid: false, error: `${label}: Formato Data URL inválido.` };
  }
  const match = dataUrl.match(
    /^data:(application\/pdf|image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/=\s]+)$/
  );
  if (!match) {
    return {
      valid: false,
      error: `${label}: Tipo MIME no permitido (solo PDF, PNG, JPEG, WEBP).`,
    };
  }
  const mime = match[1];
  const buf = Buffer.from(match[2], "base64");
  if (buf.byteLength === 0) {
    return { valid: false, error: `${label}: Archivo vacío.` };
  }
  if (buf.byteLength > MAX_UPLOAD_BYTES) {
    return {
      valid: false,
      error: `${label}: El archivo supera el límite de 4 MB.`,
    };
  }

  const isPdf =
    buf.byteLength >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-";
  const isPng =
    buf.byteLength >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47;
  const isJpeg =
    buf.byteLength >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff;
  const isWebp =
    buf.byteLength >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP";

  if (
    (mime === "application/pdf" && !isPdf) ||
    (mime === "image/png" && !isPng) ||
    (mime === "image/jpeg" && !isJpeg) ||
    (mime === "image/webp" && !isWebp)
  ) {
    return {
      valid: false,
      error: `${label}: Firma binaria (magic bytes) no coincide con el tipo declarado (${mime}).`,
    };
  }

  return { valid: true, mime, buffer: buf };
}

