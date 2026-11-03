import type {
  InvoiceData,
  PackingListData,
  ReconciliationFinding as Finding,
  SkuReconciliationSummary,
} from "../reconcile.ts";
import { comparableQuantities } from "../reconcile-presentation.ts";
import type { UiLocale } from "./locale.ts";
import { formatTemplate, getDictionary } from "./dictionaries.ts";
import { getLocaleFormatters } from "./format.ts";

/** Etiqueta corta del tipo de hallazgo (selector de enfoque). */
export function shortFindingLabel(code: Finding["code"], locale: UiLocale): string {
  const d = getDictionary(locale).findingShort;
  return d[code] ?? d.DEFAULT;
}

export function formatOriginLabel(origin: string, locale: UiLocale): string {
  const o = getDictionary(locale).origins;
  if (origin === "INV-HEADER") return o.invoiceTotals;
  if (origin === "PL-HEADER") return o.packingTotals;
  if (origin.startsWith("INV-L")) {
    return formatTemplate(o.invoiceLine, { n: origin.replace("INV-L", "") });
  }
  if (origin.startsWith("PL-R")) {
    return formatTemplate(o.packingRow, { n: origin.replace("PL-R", "") });
  }
  return origin;
}

export function shortFindingTitle(
  f: Finding,
  invoice: InvoiceData,
  skuSummaries: SkuReconciliationSummary[],
  locale: UiLocale
): string {
  const { fmtNumber } = getLocaleFormatters(locale);
  const sum = skuSummaries.find((x) => x.sku === f.sku);
  const invLine = invoice.lines.find((l) => l.sku === f.sku);
  if (locale === "en") {
    switch (f.code) {
      case "QTY_MISMATCH": {
        const inv = comparableQuantities(sum)?.invoiceQty ?? sum?.invoiceQty ?? invLine?.qty ?? 0;
        const pl = sum?.packingTotalQty ?? 0;
        const dQty = Math.abs(pl - inv);
        return pl < inv
          ? `Short ${fmtNumber.format(dQty)} units · ${f.sku}`
          : `Over by ${fmtNumber.format(dQty)} units · ${f.sku}`;
      }
      case "INVOICE_LINE_MATH_ERROR":
        return `Wrong amount · ${f.sku}`;
      case "WEIGHT_LOGIC_VIOLATION":
        return `Gross weight below net · ${f.sku}`;
      case "TOTAL_GROSS_WEIGHT_MISMATCH":
        return "Total weight difference";
      case "UNIT_AMBIGUITY_UNCONVERTIBLE":
        return `Set equivalent pending · ${f.sku}`;
      case "SKU_IDENTIFIER_AMBIGUITY":
        return `Alias pending · ${f.sku}`;
      case "UNDECLARED_ITEM_IN_PACKING_LIST":
        return `Undeclared product · ${f.sku}`;
      case "MISSING_ITEM_IN_PACKING_LIST":
        return `Missing from packing · ${f.sku}`;
      case "CARTON_COUNT_MISMATCH":
        return "Box count mismatch";
      case "PACKING_ROW_MATH_ERROR":
        return `Boxes × units error · ${f.sku}`;
      default:
        return `Note · ${f.sku}`;
    }
  }
  if (locale === "zh") {
    switch (f.code) {
      case "QTY_MISMATCH": {
        const inv = comparableQuantities(sum)?.invoiceQty ?? sum?.invoiceQty ?? invLine?.qty ?? 0;
        const pl = sum?.packingTotalQty ?? 0;
        const dQty = Math.abs(pl - inv);
        return pl < inv
          ? `短缺 ${fmtNumber.format(dQty)} 件 · ${f.sku}`
          : `多出 ${fmtNumber.format(dQty)} 件 · ${f.sku}`;
      }
      case "INVOICE_LINE_MATH_ERROR":
        return `金额错误 · ${f.sku}`;
      case "WEIGHT_LOGIC_VIOLATION":
        return `毛重小于净重 · ${f.sku}`;
      case "TOTAL_GROSS_WEIGHT_MISMATCH":
        return "总重不符";
      case "UNIT_AMBIGUITY_UNCONVERTIBLE":
        return `套件换算待确认 · ${f.sku}`;
      case "SKU_IDENTIFIER_AMBIGUITY":
        return `别名待确认 · ${f.sku}`;
      case "UNDECLARED_ITEM_IN_PACKING_LIST":
        return `未申报产品 · ${f.sku}`;
      case "MISSING_ITEM_IN_PACKING_LIST":
        return `装箱缺失 · ${f.sku}`;
      case "CARTON_COUNT_MISMATCH":
        return "箱数不符";
      case "PACKING_ROW_MATH_ERROR":
        return `箱数×数量错误 · ${f.sku}`;
      default:
        return `备注 · ${f.sku}`;
    }
  }
  switch (f.code) {
    case "QTY_MISMATCH": {
      const inv = comparableQuantities(sum)?.invoiceQty ?? sum?.invoiceQty ?? invLine?.qty ?? 0;
      const pl = sum?.packingTotalQty ?? 0;
      const dQty = Math.abs(pl - inv);
      return pl < inv
        ? `Faltan ${fmtNumber.format(dQty)} unidades · ${f.sku}`
        : `Sobran ${fmtNumber.format(dQty)} unidades · ${f.sku}`;
    }
    case "INVOICE_LINE_MATH_ERROR":
      return `Importe incorrecto · ${f.sku}`;
    case "WEIGHT_LOGIC_VIOLATION":
      return `Peso bruto menor que neto · ${f.sku}`;
    case "TOTAL_GROSS_WEIGHT_MISMATCH":
      return "Diferencia de peso total";
    case "UNIT_AMBIGUITY_UNCONVERTIBLE":
      return `Equivalencia de sets pendiente · ${f.sku}`;
    case "SKU_IDENTIFIER_AMBIGUITY":
      return `Alias pendiente · ${f.sku}`;
    case "UNDECLARED_ITEM_IN_PACKING_LIST":
      return `Producto no declarado · ${f.sku}`;
    case "MISSING_ITEM_IN_PACKING_LIST":
      return `Ausente en empaque · ${f.sku}`;
    case "CARTON_COUNT_MISMATCH":
      return "Descuadre de bultos";
    case "PACKING_ROW_MATH_ERROR":
      return `Error cajas × unidades · ${f.sku}`;
    default:
      return `Observación · ${f.sku}`;
  }
}

export function describeFinding(
  f: Finding,
  invoice: InvoiceData,
  packingList: PackingListData,
  skuSummaries: SkuReconciliationSummary[],
  locale: UiLocale
): { title: string; explanation: string; locationPills: string[] } {
  const { fmtCurrency, fmtNumber } = getLocaleFormatters(locale);
  const locationPills = f.origins.map((o) => formatOriginLabel(o, locale));
  const skuSum = skuSummaries.find((s) => s.sku === f.sku);
  const invLine = invoice.lines.find((l) => l.sku === f.sku);
  const plRows = packingList.rows.filter((r) => f.origins.includes(r.row_id));
  const prodDesc = invLine?.description ? ` (${invLine.description})` : "";

  if (locale === "en") {
    switch (f.code) {
      case "QTY_MISMATCH": {
        const invQty = comparableQuantities(skuSum)?.invoiceQty ?? skuSum?.invoiceQty ?? invLine?.qty ?? 0;
        const plQty = skuSum?.packingTotalQty ?? 0;
        const diff = plQty - invQty;
        const absDiff = Math.abs(diff);
        const breakdown =
          plRows.length > 1
            ? ` (${plRows.map((r) => `${r.total_qty} in ${r.carton_range}`).join(" + ")})`
            : plRows.length === 1
              ? ` (in ${plRows[0].carton_range})`
              : "";
        return {
          title:
            diff < 0
              ? `Short ${fmtNumber.format(absDiff)} units of product ${f.sku} in the boxes`
              : `${fmtNumber.format(absDiff)} extra units of product ${f.sku} in the boxes`,
          explanation: `The Invoice bills ${fmtNumber.format(invQty)} units of ${f.sku}${prodDesc}, but adding up the Packing List boxes${breakdown} gives ${fmtNumber.format(plQty)} units.${skuSum?.conversionFactorUsed ? ` Applied equivalent: 1 SET = ${skuSum.conversionFactorUsed} PCS.` : ""}`,
          locationPills,
        };
      }
      case "UNIT_AMBIGUITY_UNCONVERTIBLE": {
        const invQty = invLine?.qty ?? skuSum?.invoiceQty ?? 0;
        const plQty = skuSum?.packingTotalQty ?? 0;
        return {
          title: `Unknown pieces per kit/set for product ${f.sku}`,
          explanation: `The Invoice bills ${fmtNumber.format(invQty)} sets/kits${prodDesc}, while the warehouse counted ${fmtNumber.format(plQty)} loose pieces in the boxes. Since no document states how many pieces come in each set, it is not safe to guess.`,
          locationPills,
        };
      }
      case "INVOICE_LINE_MATH_ERROR": {
        const qty = invLine?.qty ?? 0;
        const price = invLine?.unit_price ?? 0;
        const declared = invLine?.line_amount ?? 0;
        const expected = qty * price;
        return {
          title: `Multiplication error in the charge for product ${f.sku}`,
          explanation: `The Invoice multiplies ${fmtNumber.format(qty)} units × $${fmtCurrency.format(price)} and records $${fmtCurrency.format(declared)}, but the correct result is $${fmtCurrency.format(expected)}.`,
          locationPills,
        };
      }
      case "WEIGHT_LOGIC_VIOLATION": {
        return {
          title: `Impossible weight on ${f.sku}: the packed box weighs less than the product alone`,
          explanation: `The Packing List records a Gross Weight (with box) lower than the Net Weight (product only). This triggers automatic rejection in the Customs system.`,
          locationPills,
        };
      }
      case "TOTAL_GROSS_WEIGHT_MISMATCH": {
        return {
          title: `The sum of box weights does not match the declared total weight`,
          explanation: f.detail_en || f.detail,
          locationPills,
        };
      }
      case "SKU_IDENTIFIER_AMBIGUITY": {
        return {
          title: `The product code is written differently on the Invoice and the Boxes`,
          explanation: `The Invoice calls it "${f.sku}" and the Packing List calls it "${skuSum?.pairedPlSku || ""}". The quantity matches, but both documents must show exactly the same code.`,
          locationPills,
        };
      }
      case "UNDECLARED_ITEM_IN_PACKING_LIST": {
        return {
          title: `There is a product inside the boxes (${f.sku}) missing from the Invoice`,
          explanation: `The Packing List shows units of "${f.sku}" not declared on the Commercial Invoice. Even free samples must appear on the invoice by law.`,
          locationPills,
        };
      }
      case "MISSING_ITEM_IN_PACKING_LIST": {
        return {
          title: `Product ${f.sku} is billed on the Invoice but appears in no box`,
          explanation: `The Invoice bills units of "${f.sku}"${prodDesc}, but that product does not appear on the Packing List.`,
          locationPills,
        };
      }
      case "CARTON_COUNT_MISMATCH": {
        return {
          title: `The declared total box count does not match the row sum`,
          explanation: f.detail_en || f.detail,
          locationPills,
        };
      }
      case "PACKING_ROW_MATH_ERROR": {
        return {
          title: `Error multiplying boxes by units for product ${f.sku}`,
          explanation: f.detail_en || f.detail,
          locationPills,
        };
      }
      default:
        return { title: `Note on ${f.sku}`, explanation: f.detail_en || f.detail, locationPills };
    }
  }

  if (locale === "zh") {
    switch (f.code) {
      case "QTY_MISMATCH": {
        const invQty = comparableQuantities(skuSum)?.invoiceQty ?? skuSum?.invoiceQty ?? invLine?.qty ?? 0;
        const plQty = skuSum?.packingTotalQty ?? 0;
        const diff = plQty - invQty;
        const absDiff = Math.abs(diff);
        const breakdown =
          plRows.length > 1
            ? `（${plRows.map((r) => `${r.total_qty} 件（${r.carton_range}）`).join(" + ")}）`
            : plRows.length === 1
              ? `（${plRows[0].carton_range}）`
              : "";
        return {
          title:
            diff < 0
              ? `产品 ${f.sku} 装箱数量短缺 ${fmtNumber.format(absDiff)} 件`
              : `产品 ${f.sku} 装箱数量多出 ${fmtNumber.format(absDiff)} 件`,
          explanation: `发票开具 ${f.sku} ${fmtNumber.format(invQty)} 件${prodDesc}，但装箱单各箱合计${breakdown}为 ${fmtNumber.format(plQty)} 件。${skuSum?.conversionFactorUsed ? `已应用换算：1 套 = ${skuSum.conversionFactorUsed} 件。` : ""}`,
          locationPills,
        };
      }
      case "UNIT_AMBIGUITY_UNCONVERTIBLE": {
        const invQty = invLine?.qty ?? skuSum?.invoiceQty ?? 0;
        const plQty = skuSum?.packingTotalQty ?? 0;
        return {
          title: `产品 ${f.sku} 每套所含件数未知`,
          explanation: `发票按 ${fmtNumber.format(invQty)} 套/组开具${prodDesc}，而仓库在各箱中点得散件 ${fmtNumber.format(plQty)} 件。由于没有任何单证注明每套内含件数，不能臆测换算。`,
          locationPills,
        };
      }
      case "INVOICE_LINE_MATH_ERROR": {
        const qty = invLine?.qty ?? 0;
        const price = invLine?.unit_price ?? 0;
        const declared = invLine?.line_amount ?? 0;
        const expected = qty * price;
        return {
          title: `产品 ${f.sku} 收费乘法错误`,
          explanation: `发票按 ${fmtNumber.format(qty)} 件 × $${fmtCurrency.format(price)} 计算为 $${fmtCurrency.format(declared)}，正确结果应为 $${fmtCurrency.format(expected)}。`,
          locationPills,
        };
      }
      case "WEIGHT_LOGIC_VIOLATION": {
        return {
          title: `${f.sku} 重量异常：整箱毛重小于产品净重`,
          explanation: `装箱单记录的毛重（含箱）小于净重（仅产品），海关系统将自动退单。`,
          locationPills,
        };
      }
      case "TOTAL_GROSS_WEIGHT_MISMATCH": {
        return {
          title: `各箱重量之和与申报总重不符`,
          explanation: f.detail_en || f.detail,
          locationPills,
        };
      }
      case "SKU_IDENTIFIER_AMBIGUITY": {
        return {
          title: `产品编码在发票与装箱单上写法不一致`,
          explanation: `发票上为“${f.sku}”，装箱单上为“${skuSum?.pairedPlSku || ""}”。数量相符，但两份单证必须使用完全相同的编码。`,
          locationPills,
        };
      }
      case "UNDECLARED_ITEM_IN_PACKING_LIST": {
        return {
          title: `箱内产品（${f.sku}）未在发票上申报`,
          explanation: `装箱单列有“${f.sku}”，但商业发票上没有申报。即使是免费样品，依法也必须列入发票。`,
          locationPills,
        };
      }
      case "MISSING_ITEM_IN_PACKING_LIST": {
        return {
          title: `产品 ${f.sku} 已在发票上收费，但未出现在任何箱中`,
          explanation: `发票开具“${f.sku}”${prodDesc}，但装箱单上没有该产品。`,
          locationPills,
        };
      }
      case "CARTON_COUNT_MISMATCH": {
        return {
          title: `申报总箱数与各行合计不符`,
          explanation: f.detail_en || f.detail,
          locationPills,
        };
      }
      case "PACKING_ROW_MATH_ERROR": {
        return {
          title: `产品 ${f.sku} 箱数乘以单箱数量有误`,
          explanation: f.detail_en || f.detail,
          locationPills,
        };
      }
      default:
        return { title: `${f.sku} 的备注`, explanation: f.detail_en || f.detail, locationPills };
    }
  }

  switch (f.code) {
    case "QTY_MISMATCH": {
      const invQty = comparableQuantities(skuSum)?.invoiceQty ?? skuSum?.invoiceQty ?? invLine?.qty ?? 0;
      const plQty = skuSum?.packingTotalQty ?? 0;
      const diff = plQty - invQty;
      const absDiff = Math.abs(diff);
      const breakdown =
        plRows.length > 1
          ? ` (${plRows.map((r) => `${r.total_qty} en ${r.carton_range}`).join(" + ")})`
          : plRows.length === 1
            ? ` (en ${plRows[0].carton_range})`
            : "";
      return {
        title:
          diff < 0
            ? `Faltan ${fmtNumber.format(absDiff)} unidades del producto ${f.sku} en las cajas`
            : `Vienen ${fmtNumber.format(absDiff)} unidades de más del producto ${f.sku} en las cajas`,
        explanation: `En la Factura te cobran ${fmtNumber.format(invQty)} unidades de ${f.sku}${prodDesc}, pero al sumar las cajas de la Lista de Empaque${breakdown} aparecen ${fmtNumber.format(plQty)} unidades.${skuSum?.conversionFactorUsed ? ` Equivalencia aplicada: 1 SET = ${skuSum.conversionFactorUsed} PCS.` : ""}`,
        locationPills,
      };
    }
    case "UNIT_AMBIGUITY_UNCONVERTIBLE": {
      const invQty = invLine?.qty ?? skuSum?.invoiceQty ?? 0;
      const plQty = skuSum?.packingTotalQty ?? 0;
      return {
        title: `No se sabe cuántas piezas trae cada Kit/Set del producto ${f.sku}`,
        explanation: `La Factura cobra ${fmtNumber.format(invQty)} Sets/Kits${prodDesc}, mientras que el almacén contó ${fmtNumber.format(plQty)} piezas sueltas en las cajas. Como ningún documento indica cuántas piezas vienen dentro de cada Set, no es seguro adivinarlo.`,
        locationPills,
      };
    }
    case "INVOICE_LINE_MATH_ERROR": {
      const qty = invLine?.qty ?? 0;
      const price = invLine?.unit_price ?? 0;
      const declared = invLine?.line_amount ?? 0;
      const expected = qty * price;
      return {
        title: `Error de multiplicación en el cobro del producto ${f.sku}`,
        explanation: `En la Factura multiplicaron ${fmtNumber.format(qty)} unidades × $${fmtCurrency.format(price)} y anotaron $${fmtCurrency.format(declared)}, pero el resultado correcto es $${fmtCurrency.format(expected)}.`,
        locationPills,
      };
    }
    case "WEIGHT_LOGIC_VIOLATION": {
      return {
        title: `Peso imposible en ${f.sku}: la caja llena figura pesando menos que el producto sin caja`,
        explanation: `En la Lista de Empaque anotaron un Peso Bruto (con caja) menor que el Peso Neto (solo producto). Esto provoca rechazo automático en el sistema de Aduana.`,
        locationPills,
      };
    }
    case "TOTAL_GROSS_WEIGHT_MISMATCH": {
      return {
        title: `La suma del peso de las cajas no coincide con el peso total declarado`,
        explanation: f.detail,
        locationPills,
      };
    }
    case "SKU_IDENTIFIER_AMBIGUITY": {
      return {
        title: `El código del producto está escrito diferente en la Factura y en las Cajas`,
        explanation: `La Factura lo llama "${f.sku}" y la Lista de Empaque lo llama "${skuSum?.pairedPlSku || ""}". La cantidad coincide, pero ambos documentos deben tener exactamente el mismo código.`,
        locationPills,
      };
    }
    case "UNDECLARED_ITEM_IN_PACKING_LIST": {
      return {
        title: `Hay un producto dentro de las cajas (${f.sku}) que no aparece en la Factura`,
        explanation: `En la Lista de Empaque figuran unidades de "${f.sku}" que no están declaradas en la Factura Comercial. Incluso si son muestras sin costo, por ley deben figurar en la factura.`,
        locationPills,
      };
    }
    case "MISSING_ITEM_IN_PACKING_LIST": {
      return {
        title: `El producto ${f.sku} figura cobrado en la Factura pero no aparece en ninguna caja`,
        explanation: `La Factura cobra unidades de "${f.sku}"${prodDesc}, pero ese producto no aparece en la Lista de Empaque.`,
        locationPills,
      };
    }
    case "CARTON_COUNT_MISMATCH": {
      return {
        title: `El número total de cajas declaradas no coincide con la suma de las filas`,
        explanation: f.detail,
        locationPills,
      };
    }
    case "PACKING_ROW_MATH_ERROR": {
      return {
        title: `Error al multiplicar cajas por unidades en el producto ${f.sku}`,
        explanation: f.detail,
        locationPills,
      };
    }
    default:
      return { title: `Observación en ${f.sku}`, explanation: f.detail, locationPills };
  }
}
