import type {
  InvoiceData,
  InvoiceLine,
  NormalizedBBox,
  PackingListData,
  PackingListRow,
} from "./reconcile";

export function parseSafeNumber(val: unknown, fallback = 0): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[^0-9.-]+/g, "");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function normalizeDiscreteUnit(rawUnit: unknown): string {
  const u = String(rawUnit ?? "PCS")
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
    ].includes(u)
  ) {
    return "PCS";
  }
  if (["SET", "SETS", "KIT", "KITS", "ASSY", "PACK", "PACKS"].includes(u)) {
    return "SETS";
  }
  return u || "PCS";
}

export function normalizeWeightUnit(rawUnit: unknown): string {
  const u = String(rawUnit ?? "KG")
    .toUpperCase()
    .replace(/\./g, "")
    .trim();
  if (["LB", "LBS", "POUND", "POUNDS"].includes(u)) return "LBS";
  if (["KG", "KGS", "KILO", "KILOS", "KILOGRAM", "KILOGRAMS"].includes(u))
    return "KG";
  return u || "KG";
}

export function extractExplicitFactorFromText(text: string): number | null {
  if (!text) return null;
  // Detecta patrones explícitos escritos en el documento como:
  // "1 SET = 4 PCS", "1 KIT = 10 PCS", "(4 PCS/SET)", "10 pcs per set"
  const m1 = text.match(
    /1\s*(?:SET|KIT|PACK)\s*(?:=|EQUALS|CONTAINS|:)\s*(\d+)\s*(?:PCS|PC|PIECES|EA)/i
  );
  if (m1) return Number(m1[1]);
  const m2 = text.match(
    /(\d+)\s*(?:PCS|PC|PIECES|EA)\s*(?:\/|PER)\s*(?:SET|KIT|PACK)/i
  );
  if (m2) return Number(m2[1]);
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
    const sku = String(
      line?.sku ??
        line?.part_number ??
        line?.part_no ??
        line?.item_code ??
        line?.pn ??
        `ITEM-${idx + 1}`
    ).trim();

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
    ).trim();
    const rawCartonCountStr = String(row?.carton_count ?? "").toUpperCase();
    const explicitlyShared =
      Boolean(row?.shared_carton) ||
      rawCartonCountStr.includes("SHARED") ||
      cartonRange.toUpperCase().includes("SHARED");

    const rangeKey = cartonRange.toUpperCase().replace(/\s+/g, "");
    const implicitlyShared =
      !explicitlyShared && rangeKey.length > 0 && seenCartonRanges.has(rangeKey);
    if (rangeKey.length > 0) seenCartonRanges.add(rangeKey);

    const isShared = explicitlyShared || implicitlyShared;
    let cartonCount = isShared ? 0 : parseSafeNumber(row?.carton_count, 0);

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
    ).trim();
    const totalQty = parseSafeNumber(row?.total_qty ?? row?.qty, 0);
    const qtyPerCarton = parseSafeNumber(
      row?.qty_per_carton ?? row?.qty_per_box,
      cartonCount > 0 ? totalQty / cartonCount : totalQty
    );

    const isPackaging =
      Boolean(row?.is_packaging_only) ||
      (totalQty === 0 &&
        /FOAM|PALLET|DUNNAGE|PACKAGING|CRATE/i.test(sku));

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

  const computedInvCartons = normalizedRows.reduce(
    (acc, r) => acc + (r.shared_carton ? 0 : r.carton_count),
    0
  );

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

