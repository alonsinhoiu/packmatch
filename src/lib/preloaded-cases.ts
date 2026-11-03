// Auto-generado con las extracciones reales de Muse Spark 1.3 (C01 a C07) + coordenadas bbox
import type { InvoiceData, PackingListData } from "./reconcile";

export interface PreloadedCase {
  case_id: string;
  title: string;
  subtitle: string;
  tag: string;
  invoiceImageUrl: string;
  packingListImageUrl: string;
  latency_seconds: number;
  estimated_call_cost_usd: number;
  extracted: {
    invoice: InvoiceData;
    packing_list: PackingListData;
  };
}

export const PRELOADED_CASES: PreloadedCase[] = [
  {
    "case_id": "C01_correcto_asimetrico",
    "title": "C01 · Embarque Correcto Asimétrico (Control)",
    "subtitle": "3 líneas en Factura vs 5 filas en Packing List (incluye factor explícito 1 SET = 2 PCS y embalaje SPARE-FOAM)",
    "tag": "Control (0 alertas)",
    "invoiceImageUrl": "/cases/C01_correcto_asimetrico/invoice.png",
    "packingListImageUrl": "/cases/C01_correcto_asimetrico/packing_list.png",
    "latency_seconds": 8.81,
    "estimated_call_cost_usd": 0.014326,
    "extracted": {
      "invoice": {
        "invoice_no": "INV-2026-101",
        "incoterm": "FOB SHENZHEN",
        "currency": "USD",
        "declared_total_amount": 6460.0,
        "declared_total_net_kg": 310.0,
        "declared_total_gross_kg": 345.0,
        "declared_total_cartons": 15,
        "lines": [
          {
            "line_id": "INV-L1",
            "sku": "SKU-101",
            "description": "Industrial Sensor Module A",
            "qty": 230,
            "unit": "PCS",
            "unit_price": 12.0,
            "line_amount": 2760.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              362,
              41,
              440,
              959
            ]
          },
          {
            "line_id": "INV-L2",
            "sku": "SKU-202",
            "description": "Shielded Control Cable 5m",
            "qty": 120,
            "unit": "PCS",
            "unit_price": 15.0,
            "line_amount": 1800.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              440,
              41,
              518,
              959
            ]
          },
          {
            "line_id": "INV-L3",
            "sku": "SKU-303",
            "description": "Mounting Bracket Kit (1 SET = 2 PCS)",
            "qty": 50,
            "unit": "SETS",
            "unit_price": 38.0,
            "line_amount": 1900.0,
            "explicit_pcs_per_set": 2,
            "bbox": [
              518,
              41,
              596,
              959
            ]
          }
        ],
        "header_bbox": [
          151,
          41,
          252,
          959
        ]
      },
      "packing_list": {
        "packing_list_no": "PL-2026-101",
        "incoterm": "FOB SHENZHEN",
        "declared_total_cartons": 15,
        "declared_total_net_kg": 310.0,
        "declared_total_gross_kg": 345.0,
        "rows": [
          {
            "row_id": "PL-R1",
            "carton_range": "CTN 1-5",
            "carton_count": 5,
            "sku": "SKU-101",
            "qty_per_carton": 40,
            "total_qty": 200,
            "unit": "PCS",
            "net_weight": 100.0,
            "gross_weight": 110.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              313,
              43,
              381,
              957
            ]
          },
          {
            "row_id": "PL-R2",
            "carton_range": "CTN 6-8",
            "carton_count": 3,
            "sku": "SKU-202",
            "qty_per_carton": 40,
            "total_qty": 120,
            "unit": "PCS",
            "net_weight": 90.0,
            "gross_weight": 100.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              381,
              43,
              448,
              957
            ]
          },
          {
            "row_id": "PL-R3",
            "carton_range": "CTN 9-10",
            "carton_count": 2,
            "sku": "SKU-303",
            "qty_per_carton": 50,
            "total_qty": 100,
            "unit": "PCS",
            "net_weight": 45.0,
            "gross_weight": 52.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              448,
              43,
              516,
              957
            ]
          },
          {
            "row_id": "PL-R4",
            "carton_range": "CTN 11-11",
            "carton_count": 1,
            "sku": "SKU-101",
            "qty_per_carton": 30,
            "total_qty": 30,
            "unit": "PCS",
            "net_weight": 15.0,
            "gross_weight": 17.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              516,
              43,
              583,
              957
            ]
          },
          {
            "row_id": "PL-R5",
            "carton_range": "CTN 12-15",
            "carton_count": 4,
            "sku": "SPARE-FOAM",
            "qty_per_carton": 0,
            "total_qty": 0,
            "unit": "PCS",
            "net_weight": 60.0,
            "gross_weight": 66.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": true,
            "bbox": [
              583,
              43,
              651,
              957
            ]
          }
        ],
        "header_bbox": [
          131,
          43,
          218,
          957
        ]
      }
    }
  },
  {
    "case_id": "C02_discrepancia_cantidad_y_subtotal",
    "title": "C02 · Faltante de Unidades + Error Aritmético",
    "subtitle": "SKU-401 suma 480 PCS en 3 tramos de cajas frente a 500 PCS facturados; error de subtotal en INV-L2",
    "tag": "2 Discrepancias",
    "invoiceImageUrl": "/cases/C02_discrepancia_cantidad_y_subtotal/invoice.png",
    "packingListImageUrl": "/cases/C02_discrepancia_cantidad_y_subtotal/packing_list.png",
    "latency_seconds": 8.81,
    "estimated_call_cost_usd": 0.013279,
    "extracted": {
      "invoice": {
        "invoice_no": "INV-2026-202",
        "incoterm": "CIF VALPARAISO",
        "currency": "USD",
        "declared_total_amount": 6350.0,
        "declared_total_net_kg": 290.0,
        "declared_total_gross_kg": 320.0,
        "declared_total_cartons": 12,
        "lines": [
          {
            "line_id": "INV-L1",
            "sku": "SKU-401",
            "description": "Hydraulic Valve 1/2 inch",
            "qty": 500,
            "unit": "PCS",
            "unit_price": 10.0,
            "line_amount": 5000.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              393,
              41,
              478,
              959
            ]
          },
          {
            "line_id": "INV-L2",
            "sku": "SKU-402",
            "description": "Pressure Gauge 0-10 Bar",
            "qty": 100,
            "unit": "PCS",
            "unit_price": 12.5,
            "line_amount": 1350.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              478,
              41,
              562,
              959
            ]
          }
        ],
        "header_bbox": [
          164,
          41,
          274,
          959
        ]
      },
      "packing_list": {
        "packing_list_no": "PL-2026-202",
        "incoterm": "CIF VALPARAISO",
        "declared_total_cartons": 12,
        "declared_total_net_kg": 290.0,
        "declared_total_gross_kg": 320.0,
        "rows": [
          {
            "row_id": "PL-R1",
            "carton_range": "CTN 1-4",
            "carton_count": 4,
            "sku": "SKU-401",
            "qty_per_carton": 50,
            "total_qty": 200,
            "unit": "PCS",
            "net_weight": 100.0,
            "gross_weight": 110.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              336,
              43,
              409,
              957
            ]
          },
          {
            "row_id": "PL-R2",
            "carton_range": "CTN 5-8",
            "carton_count": 4,
            "sku": "SKU-401",
            "qty_per_carton": 50,
            "total_qty": 200,
            "unit": "PCS",
            "net_weight": 100.0,
            "gross_weight": 110.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              409,
              43,
              481,
              957
            ]
          },
          {
            "row_id": "PL-R3",
            "carton_range": "CTN 9-10",
            "carton_count": 2,
            "sku": "SKU-401",
            "qty_per_carton": 40,
            "total_qty": 80,
            "unit": "PCS",
            "net_weight": 40.0,
            "gross_weight": 45.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              481,
              43,
              553,
              957
            ]
          },
          {
            "row_id": "PL-R4",
            "carton_range": "CTN 11-12",
            "carton_count": 2,
            "sku": "SKU-402",
            "qty_per_carton": 50,
            "total_qty": 100,
            "unit": "PCS",
            "net_weight": 50.0,
            "gross_weight": 55.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              553,
              43,
              626,
              957
            ]
          }
        ],
        "header_bbox": [
          140,
          43,
          234,
          957
        ]
      }
    }
  },
  {
    "case_id": "C03_discrepancia_pesos_y_lbs",
    "title": "C03 · Inversión Física Bruto < Neto + Conversión LBS/KG",
    "subtitle": "Packing List en libras (LBS) con peso bruto menor al neto en PL-R2 y descuadre de peso total en KG",
    "tag": "2 Discrepancias",
    "invoiceImageUrl": "/cases/C03_discrepancia_pesos_y_lbs/invoice.png",
    "packingListImageUrl": "/cases/C03_discrepancia_pesos_y_lbs/packing_list.png",
    "latency_seconds": 8.72,
    "estimated_call_cost_usd": 0.012573,
    "extracted": {
      "invoice": {
        "invoice_no": "INV-2026-303",
        "incoterm": "FOB NINGBO",
        "currency": "USD",
        "declared_total_amount": 4200.0,
        "declared_total_net_kg": 310.0,
        "declared_total_gross_kg": 355.0,
        "declared_total_cartons": 10,
        "lines": [
          {
            "line_id": "INV-L1",
            "sku": "SKU-501",
            "description": "Steel Flange DN50",
            "qty": 100,
            "unit": "PCS",
            "unit_price": 14.0,
            "line_amount": 1400.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              362,
              41,
              440,
              959
            ]
          },
          {
            "line_id": "INV-L2",
            "sku": "SKU-502",
            "description": "Steel Flange DN80",
            "qty": 80,
            "unit": "PCS",
            "unit_price": 20.0,
            "line_amount": 1600.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              440,
              41,
              518,
              959
            ]
          },
          {
            "line_id": "INV-L3",
            "sku": "SKU-503",
            "description": "Gasket Ring Pack",
            "qty": 200,
            "unit": "PCS",
            "unit_price": 6.0,
            "line_amount": 1200.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              518,
              41,
              596,
              959
            ]
          }
        ],
        "header_bbox": [
          151,
          41,
          252,
          959
        ]
      },
      "packing_list": {
        "packing_list_no": "PL-2026-303",
        "incoterm": "FOB NINGBO",
        "declared_total_cartons": 10,
        "declared_total_net_kg": 310.0,
        "declared_total_gross_kg": 355.0,
        "rows": [
          {
            "row_id": "PL-R1",
            "carton_range": "CTN 1-4",
            "carton_count": 4,
            "sku": "SKU-501",
            "qty_per_carton": 25,
            "total_qty": 100,
            "unit": "PCS",
            "net_weight": 90.0,
            "gross_weight": 120.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              362,
              43,
              440,
              957
            ]
          },
          {
            "row_id": "PL-R2",
            "carton_range": "CTN 5-8",
            "carton_count": 4,
            "sku": "SKU-502",
            "qty_per_carton": 20,
            "total_qty": 80,
            "unit": "PCS",
            "net_weight": 120.0,
            "gross_weight": 108.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              440,
              43,
              518,
              957
            ]
          },
          {
            "row_id": "PL-R3",
            "carton_range": "CTN 9-10",
            "carton_count": 2,
            "sku": "SKU-503",
            "qty_per_carton": 100,
            "total_qty": 200,
            "unit": "PCS",
            "net_weight": 220.46,
            "gross_weight": 242.51,
            "weight_unit": "LBS",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              518,
              43,
              596,
              957
            ]
          }
        ],
        "header_bbox": [
          151,
          43,
          252,
          957
        ]
      }
    }
  },
  {
    "case_id": "C04_ambiguo_pcs_sets_sin_factor",
    "title": "C04 · Ambigüedad SETS vs PCS Sin Factor Explícito",
    "subtitle": "60 SETS en Factura vs 240 PCS en Packing List sin factor documentado (prohibido adivinar 1 SET = 4 PCS)",
    "tag": "1 Ambigüedad",
    "invoiceImageUrl": "/cases/C04_ambiguo_pcs_sets_sin_factor/invoice.png",
    "packingListImageUrl": "/cases/C04_ambiguo_pcs_sets_sin_factor/packing_list.png",
    "latency_seconds": 9.99,
    "estimated_call_cost_usd": 0.012424,
    "extracted": {
      "invoice": {
        "invoice_no": "INV-2026-404",
        "incoterm": "EXW SHANGHAI",
        "currency": "USD",
        "declared_total_amount": 3900.0,
        "declared_total_net_kg": 140.0,
        "declared_total_gross_kg": 158.0,
        "declared_total_cartons": 7,
        "lines": [
          {
            "line_id": "INV-L1",
            "sku": "SKU-701",
            "description": "Valve Assembly Kit",
            "qty": 60,
            "unit": "SETS",
            "unit_price": 45.0,
            "line_amount": 2700.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              362,
              41,
              440,
              959
            ]
          },
          {
            "line_id": "INV-L2",
            "sku": "SKU-702",
            "description": "Brass Adapter",
            "qty": 100,
            "unit": "PCS",
            "unit_price": 8.0,
            "line_amount": 800.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              440,
              41,
              518,
              959
            ]
          },
          {
            "line_id": "INV-L3",
            "sku": "SKU-703",
            "description": "Teflon Seal Tape Roll",
            "qty": 200,
            "unit": "PCS",
            "unit_price": 2.0,
            "line_amount": 400.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              518,
              41,
              596,
              959
            ]
          }
        ],
        "header_bbox": [
          151,
          41,
          252,
          959
        ]
      },
      "packing_list": {
        "packing_list_no": "PL-2026-404",
        "incoterm": "EXW SHANGHAI",
        "declared_total_cartons": 7,
        "declared_total_net_kg": 140.0,
        "declared_total_gross_kg": 158.0,
        "rows": [
          {
            "row_id": "PL-R1",
            "carton_range": "CTN 1-6",
            "carton_count": 6,
            "sku": "SKU-701",
            "qty_per_carton": 40,
            "total_qty": 240,
            "unit": "PCS",
            "net_weight": 120.0,
            "gross_weight": 135.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              362,
              43,
              440,
              957
            ]
          },
          {
            "row_id": "PL-R2",
            "carton_range": "CTN 7-7",
            "carton_count": 1,
            "sku": "SKU-702",
            "qty_per_carton": 100,
            "total_qty": 100,
            "unit": "PCS",
            "net_weight": 12.0,
            "gross_weight": 14.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              440,
              43,
              518,
              957
            ]
          },
          {
            "row_id": "PL-R3",
            "carton_range": "CTN 7-7",
            "carton_count": 0,
            "sku": "SKU-703",
            "qty_per_carton": 200,
            "total_qty": 200,
            "unit": "PCS",
            "net_weight": 8.0,
            "gross_weight": 9.0,
            "weight_unit": "KG",
            "shared_carton": true,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              518,
              43,
              596,
              957
            ]
          }
        ],
        "header_bbox": [
          151,
          43,
          252,
          957
        ]
      }
    }
  },
  {
    "case_id": "C05_ambiguo_sku_alias_y_muestra_no_declarada",
    "title": "C05 · Variación de Código SKU + Mercancía No Declarada",
    "subtitle": "SKU-901 vs SKU-901-REV2 + caja promocional SKU-999-PROMO en Packing List ausente en Factura Comercial",
    "tag": "4 Hallazgos",
    "invoiceImageUrl": "/cases/C05_ambiguo_sku_alias_y_muestra_no_declarada/invoice.png",
    "packingListImageUrl": "/cases/C05_ambiguo_sku_alias_y_muestra_no_declarada/packing_list.png",
    "latency_seconds": 6.36,
    "estimated_call_cost_usd": 0.011095,
    "extracted": {
      "invoice": {
        "invoice_no": "INV-2026-505",
        "incoterm": "FOB QINGDAO",
        "currency": "USD",
        "declared_total_amount": 5250.0,
        "declared_total_net_kg": 210.0,
        "declared_total_gross_kg": 234.0,
        "declared_total_cartons": 9,
        "lines": [
          {
            "line_id": "INV-L1",
            "sku": "SKU-901",
            "description": "Optical Terminal Box",
            "qty": 300,
            "unit": "PCS",
            "unit_price": 12.5,
            "line_amount": 3750.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              393,
              41,
              478,
              959
            ]
          },
          {
            "line_id": "INV-L2",
            "sku": "SKU-902",
            "description": "Fiber Splice Tray",
            "qty": 150,
            "unit": "PCS",
            "unit_price": 10.0,
            "line_amount": 1500.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              478,
              41,
              562,
              959
            ]
          }
        ],
        "header_bbox": [
          164,
          41,
          274,
          959
        ]
      },
      "packing_list": {
        "packing_list_no": "PL-2026-505",
        "incoterm": "FOB QINGDAO",
        "declared_total_cartons": 10,
        "declared_total_net_kg": 215.0,
        "declared_total_gross_kg": 240.0,
        "rows": [
          {
            "row_id": "PL-R1",
            "carton_range": "CTN 1-6",
            "carton_count": 6,
            "sku": "SKU-901-REV2",
            "qty_per_carton": 50,
            "total_qty": 300,
            "unit": "PCS",
            "net_weight": 150.0,
            "gross_weight": 168.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              362,
              43,
              440,
              957
            ]
          },
          {
            "row_id": "PL-R2",
            "carton_range": "CTN 7-9",
            "carton_count": 3,
            "sku": "SKU-902",
            "qty_per_carton": 50,
            "total_qty": 150,
            "unit": "PCS",
            "net_weight": 60.0,
            "gross_weight": 66.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              440,
              43,
              518,
              957
            ]
          },
          {
            "row_id": "PL-R3",
            "carton_range": "CTN 10-10",
            "carton_count": 1,
            "sku": "SKU-999-PROMO",
            "qty_per_carton": 20,
            "total_qty": 20,
            "unit": "PCS",
            "net_weight": 5.0,
            "gross_weight": 6.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              518,
              43,
              596,
              957
            ]
          }
        ],
        "header_bbox": [
          151,
          43,
          252,
          957
        ]
      }
    }
  },
  {
    "case_id": "C06_denso_celdas_combinadas_y_escaneo",
    "title": "C06 · Escaneo Rotado Multi-Palet (6 SKUs / 11 Filas)",
    "subtitle": "Faltante sutil (-6 PCS en SKU-804 disperso en 3 filas) + ambigüedad SETS/PCS en SKU-806 vs factor explícito en SKU-805",
    "tag": "Escaneo Denso (2 Hallazgos)",
    "invoiceImageUrl": "/cases/C06_denso_celdas_combinadas_y_escaneo/invoice.png",
    "packingListImageUrl": "/cases/C06_denso_celdas_combinadas_y_escaneo/packing_list.png",
    "latency_seconds": 9.23,
    "estimated_call_cost_usd": 0.016431,
    "extracted": {
      "invoice": {
        "invoice_no": "INV-2026-606",
        "incoterm": "FOB SHANGHAI",
        "currency": "USD",
        "declared_total_amount": 18420.0,
        "declared_total_net_kg": 642.0,
        "declared_total_gross_kg": 706.0,
        "declared_total_cartons": 28,
        "lines": [
          {
            "line_id": "INV-L1",
            "sku": "SKU-801",
            "description": "DIN Rail Power Supply 24V",
            "qty": 180,
            "unit": "PCS",
            "unit_price": 25.0,
            "line_amount": 4500.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              294,
              41,
              357,
              959
            ]
          },
          {
            "line_id": "INV-L2",
            "sku": "SKU-802",
            "description": "Relay Socket Base 8-Pin",
            "qty": 400,
            "unit": "PCS",
            "unit_price": 4.5,
            "line_amount": 1800.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              357,
              41,
              420,
              959
            ]
          },
          {
            "line_id": "INV-L3",
            "sku": "SKU-803",
            "description": "Contactor 3P 32A",
            "qty": 150,
            "unit": "PCS",
            "unit_price": 28.0,
            "line_amount": 4200.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              420,
              41,
              483,
              959
            ]
          },
          {
            "line_id": "INV-L4",
            "sku": "SKU-804",
            "description": "Circuit Breaker MCB 2P 16A",
            "qty": 320,
            "unit": "PCS",
            "unit_price": 9.0,
            "line_amount": 2880.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              483,
              41,
              546,
              959
            ]
          },
          {
            "line_id": "INV-L5",
            "sku": "SKU-805",
            "description": "Terminal Block Kit (1 SET = 10 PCS)",
            "qty": 120,
            "unit": "SETS",
            "unit_price": 18.0,
            "line_amount": 2160.0,
            "explicit_pcs_per_set": 10,
            "bbox": [
              546,
              41,
              610,
              959
            ]
          },
          {
            "line_id": "INV-L6",
            "sku": "SKU-806",
            "description": "Cable Gland Assortment Box",
            "qty": 90,
            "unit": "SETS",
            "unit_price": 32.0,
            "line_amount": 2880.0,
            "explicit_pcs_per_set": null,
            "bbox": [
              610,
              41,
              673,
              959
            ]
          }
        ],
        "header_bbox": [
          123,
          41,
          204,
          959
        ]
      },
      "packing_list": {
        "packing_list_no": "PL-2026-606",
        "incoterm": "FOB SHANGHAI",
        "declared_total_cartons": 28,
        "declared_total_net_kg": 642.0,
        "declared_total_gross_kg": 706.0,
        "rows": [
          {
            "row_id": "PL-R1",
            "carton_range": "CTN 1-4",
            "carton_count": 4,
            "sku": "SKU-801",
            "qty_per_carton": 30,
            "total_qty": 120,
            "unit": "PCS",
            "net_weight": 72.0,
            "gross_weight": 80.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              223,
              43,
              271,
              957
            ]
          },
          {
            "row_id": "PL-R2",
            "carton_range": "CTN 5-8",
            "carton_count": 4,
            "sku": "SKU-802",
            "qty_per_carton": 50,
            "total_qty": 200,
            "unit": "PCS",
            "net_weight": 40.0,
            "gross_weight": 44.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              271,
              43,
              319,
              957
            ]
          },
          {
            "row_id": "PL-R3",
            "carton_range": "CTN 9-11",
            "carton_count": 3,
            "sku": "SKU-804",
            "qty_per_carton": 40,
            "total_qty": 120,
            "unit": "PCS",
            "net_weight": 48.0,
            "gross_weight": 53.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              319,
              43,
              367,
              957
            ]
          },
          {
            "row_id": "PL-R4",
            "carton_range": "CTN 12-14",
            "carton_count": 3,
            "sku": "SKU-803",
            "qty_per_carton": 30,
            "total_qty": 90,
            "unit": "PCS",
            "net_weight": 81.0,
            "gross_weight": 89.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              367,
              43,
              415,
              957
            ]
          },
          {
            "row_id": "PL-R5",
            "carton_range": "CTN 15-16",
            "carton_count": 2,
            "sku": "SKU-801",
            "qty_per_carton": 30,
            "total_qty": 60,
            "unit": "PCS",
            "net_weight": 36.0,
            "gross_weight": 40.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              415,
              43,
              463,
              957
            ]
          },
          {
            "row_id": "PL-R6",
            "carton_range": "CTN 17-19",
            "carton_count": 3,
            "sku": "SKU-804",
            "qty_per_carton": 40,
            "total_qty": 120,
            "unit": "PCS",
            "net_weight": 48.0,
            "gross_weight": 53.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              463,
              43,
              511,
              957
            ]
          },
          {
            "row_id": "PL-R7",
            "carton_range": "CTN 20-23",
            "carton_count": 4,
            "sku": "SKU-805",
            "qty_per_carton": 300,
            "total_qty": 1200,
            "unit": "PCS",
            "net_weight": 110.0,
            "gross_weight": 122.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              511,
              43,
              559,
              957
            ]
          },
          {
            "row_id": "PL-R8",
            "carton_range": "CTN 24-25",
            "carton_count": 2,
            "sku": "SKU-803",
            "qty_per_carton": 30,
            "total_qty": 60,
            "unit": "PCS",
            "net_weight": 54.0,
            "gross_weight": 59.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              559,
              43,
              607,
              957
            ]
          },
          {
            "row_id": "PL-R9",
            "carton_range": "CTN 26-27",
            "carton_count": 2,
            "sku": "SKU-804",
            "qty_per_carton": 37,
            "total_qty": 74,
            "unit": "PCS",
            "net_weight": 30.0,
            "gross_weight": 33.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              607,
              43,
              655,
              957
            ]
          },
          {
            "row_id": "PL-R10",
            "carton_range": "CTN 27-27",
            "carton_count": 0,
            "sku": "SKU-802",
            "qty_per_carton": 200,
            "total_qty": 200,
            "unit": "PCS",
            "net_weight": 38.0,
            "gross_weight": 42.0,
            "weight_unit": "KG",
            "shared_carton": true,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              655,
              43,
              703,
              957
            ]
          },
          {
            "row_id": "PL-R11",
            "carton_range": "CTN 28-28",
            "carton_count": 1,
            "sku": "SKU-806",
            "qty_per_carton": 450,
            "total_qty": 450,
            "unit": "PCS",
            "net_weight": 85.0,
            "gross_weight": 91.0,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              703,
              43,
              751,
              957
            ]
          }
        ],
        "header_bbox": [
          93,
          43,
          155,
          957
        ]
      }
    }
  },
  {
    "case_id": "C07_formato_real_sin_ids",
    "title": "C07 · Plantilla Real Sin IDs (P/N, Q'ty, U/M, EA/KIT/KGS)",
    "subtitle": "Sin columnas INV-L*/PL-R*: Muse Spark 1.3 + normalizador autogeneran IDs, convierten EA->PCS / KIT->SETS y detectan 2 hallazgos",
    "tag": "Formato Real (2 Hallazgos)",
    "invoiceImageUrl": "/cases/C07_formato_real_sin_ids/invoice.png",
    "packingListImageUrl": "/cases/C07_formato_real_sin_ids/packing_list.png",
    "latency_seconds": 19.2,
    "estimated_call_cost_usd": 0.01641,
    "extracted": {
      "invoice": {
        "invoice_no": "EXP-2026-707",
        "incoterm": "CIF SAN ANTONIO",
        "currency": "USD",
        "declared_total_amount": 8650,
        "declared_total_net_kg": 265,
        "declared_total_gross_kg": 292,
        "declared_total_cartons": 12,
        "header_bbox": [
          151,
          41,
          252,
          959
        ],
        "lines": [
          {
            "line_id": "INV-L1",
            "sku": "PN-4401",
            "description": "Stainless Ball Valve 1-Inch",
            "qty": 150,
            "unit": "PCS",
            "unit_price": 22,
            "line_amount": 3300,
            "explicit_pcs_per_set": null,
            "operator_pcs_per_set": null,
            "bbox": [
              362,
              41,
              440,
              959
            ]
          },
          {
            "line_id": "INV-L2",
            "sku": "PN-4402",
            "description": "Pneumatic Actuator Double Acting",
            "qty": 200,
            "unit": "PCS",
            "unit_price": 18.5,
            "line_amount": 3700,
            "explicit_pcs_per_set": null,
            "operator_pcs_per_set": null,
            "bbox": [
              440,
              41,
              518,
              959
            ]
          },
          {
            "line_id": "INV-L3",
            "sku": "PN-4403",
            "description": "High-Temp O-Ring Maintenance Kit",
            "qty": 40,
            "unit": "SETS",
            "unit_price": 41.25,
            "line_amount": 1650,
            "explicit_pcs_per_set": null,
            "operator_pcs_per_set": null,
            "bbox": [
              518,
              41,
              596,
              959
            ]
          }
        ]
      },
      "packing_list": {
        "packing_list_no": "PKL-2026-707",
        "incoterm": "CIF SAN ANTONIO",
        "declared_total_cartons": 12,
        "declared_total_net_kg": 265,
        "declared_total_gross_kg": 292,
        "header_bbox": [
          131,
          46,
          218,
          954
        ],
        "rows": [
          {
            "row_id": "PL-R1",
            "carton_range": "Box 1-3",
            "carton_count": 3,
            "sku": "PN-4401",
            "qty_per_carton": 30,
            "total_qty": 90,
            "unit": "PCS",
            "net_weight": 54,
            "gross_weight": 60,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              313,
              46,
              381,
              954
            ]
          },
          {
            "row_id": "PL-R2",
            "carton_range": "Box 4-6",
            "carton_count": 3,
            "sku": "PN-4402",
            "qty_per_carton": 40,
            "total_qty": 120,
            "unit": "PCS",
            "net_weight": 78,
            "gross_weight": 85,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              381,
              46,
              448,
              954
            ]
          },
          {
            "row_id": "PL-R3",
            "carton_range": "Box 7-8",
            "carton_count": 2,
            "sku": "PN-4401",
            "qty_per_carton": 30,
            "total_qty": 60,
            "unit": "PCS",
            "net_weight": 36,
            "gross_weight": 40,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              448,
              46,
              516,
              954
            ]
          },
          {
            "row_id": "PL-R4",
            "carton_range": "Box 9-10",
            "carton_count": 2,
            "sku": "PN-4402",
            "qty_per_carton": 35,
            "total_qty": 70,
            "unit": "PCS",
            "net_weight": 45,
            "gross_weight": 50,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              516,
              46,
              583,
              954
            ]
          },
          {
            "row_id": "PL-R5",
            "carton_range": "Box 11-12",
            "carton_count": 2,
            "sku": "PN-4403",
            "qty_per_carton": 100,
            "total_qty": 200,
            "unit": "PCS",
            "net_weight": 52,
            "gross_weight": 57,
            "weight_unit": "KG",
            "shared_carton": false,
            "explicit_pcs_per_set": null,
            "is_packaging_only": false,
            "bbox": [
              583,
              46,
              651,
              954
            ]
          }
        ]
      }
    }
  }
];

/**
 * emil-break-ui: Realistic worst-case customs dataset for UI stress testing.
 * Includes:
 * - Row 1: 42-char unbreakable industrial Siemens part code + diacritic-heavy multilingual description
 * - Row 2: 7-digit quantities and USD amounts (1,248,500.75) + split across 3 long pallet ranges
 * - Row 3: 2-char minimal SKU ("X1") + SETS/PCS ambiguity without factor
 */
export const WORST_CASE_BREAK_UI_SHIPMENT: PreloadedCase = {
  case_id: "BREAK_UI_WORST_CASE",
  title: "Break-UI · Stress Test de Datos Extremos",
  subtitle: "Prueba adversarial (emil-break-ui): SKUs sin espacios de 42 caracteres, descripciones multilingües con diacríticos, importes millonarios y códigos mínimos.",
  tag: "Stress Test UI",
  invoiceImageUrl: "/cases/C07_formato_real_sin_ids/invoice.png",
  packingListImageUrl: "/cases/C07_formato_real_sin_ids/packing_list.png",
  latency_seconds: 0.0,
  estimated_call_cost_usd: 0.0,
  extracted: {
    invoice: {
      invoice_no: "INV-2026-88901-NORTHWIND-HOLDINGS-INTL-EXPORT-REV4",
      incoterm: "CIP AEROPUERTO ARTURO MERINO BENÍTEZ (SCL)",
      currency: "USD",
      declared_total_amount: 1294500.75,
      declared_total_net_kg: 18450.5,
      declared_total_gross_kg: 19820.25,
      declared_total_cartons: 1420,
      header_bbox: [108, 36, 179, 964],
      lines: [
        {
          line_id: "INV-L1",
          sku: "SIEMENS-6ES7515-2AM02-0AB0-REV2026-EXP",
          description:
            "Válvula Criogénica Wiśniewska-Kowalczyk DIN-EN-1092-1 PN40 Acero Inoxidable Austenítico 316L — Prüfzeugnis 3.1",
          qty: 12500,
          unit: "PCS",
          unit_price: 99.88,
          line_amount: 1248500.0,
          explicit_pcs_per_set: null,
          bbox: [248, 36, 315, 964],
        },
        {
          line_id: "INV-L2",
          sku: "ABB-ACS880-01-246A-3+E202+J400-HEAVY",
          description:
            "Variador de Frecuencia Industrial Trifásico IP55 con Filtro Armónico Integrado",
          qty: 400,
          unit: "PCS",
          unit_price: 85.0,
          line_amount: 34000.0,
          explicit_pcs_per_set: null,
          bbox: [315, 36, 383, 964],
        },
        {
          line_id: "INV-L3",
          sku: "X1",
          description: "Junta",
          qty: 1200,
          unit: "SETS",
          unit_price: 10.000625,
          line_amount: 12000.75,
          explicit_pcs_per_set: null,
          bbox: [383, 36, 450, 964],
        },
      ],
    },
    packing_list: {
      packing_list_no: "PKL-2026-88901-CONSOLIDATED-WAREHOUSE-GDANSK-09",
      incoterm: "CIP AEROPUERTO ARTURO MERINO BENÍTEZ (SCL)",
      declared_total_cartons: 1420,
      declared_total_net_kg: 18450.5,
      declared_total_gross_kg: 19820.25,
      header_bbox: [108, 46, 179, 954],
      rows: [
        {
          row_id: "PL-R1",
          carton_range: "PALLET-0001..0800 (CONT-MSKU-998120-4)",
          carton_count: 800,
          sku: "SIEMENS-6ES7515-2AM02-0AB0-REV2026-EXP",
          qty_per_carton: 10,
          total_qty: 8000,
          unit: "PCS",
          net_weight: 10500.25,
          gross_weight: 11200.0,
          weight_unit: "KG",
          shared_carton: false,
          explicit_pcs_per_set: null,
          is_packaging_only: false,
          bbox: [315, 46, 383, 954],
        },
        {
          row_id: "PL-R2",
          carton_range: "PALLET-0801..1250 (CONT-MSKU-998120-4)",
          carton_count: 450,
          sku: "SIEMENS-6ES7515-2AM02-0AB0-REV2026-EXP",
          qty_per_carton: 10,
          total_qty: 4500,
          unit: "PCS",
          net_weight: 5950.25,
          gross_weight: 6420.25,
          weight_unit: "KG",
          shared_carton: false,
          explicit_pcs_per_set: null,
          is_packaging_only: false,
          bbox: [383, 46, 449, 954],
        },
        {
          row_id: "PL-R3",
          carton_range: "PALLET-1251..1350",
          carton_count: 100,
          sku: "ABB-ACS880-01-246A-3+E202+J400-HEAVY",
          qty_per_carton: 3,
          total_qty: 385,
          unit: "PCS",
          net_weight: 1500.0,
          gross_weight: 1650.0,
          weight_unit: "KG",
          shared_carton: false,
          explicit_pcs_per_set: null,
          is_packaging_only: false,
          bbox: [449, 46, 516, 954],
        },
        {
          row_id: "PL-R4",
          carton_range: "PALLET-1351..1420",
          carton_count: 70,
          sku: "X1",
          qty_per_carton: 100,
          total_qty: 7200,
          unit: "PCS",
          net_weight: 500.0,
          gross_weight: 550.0,
          weight_unit: "KG",
          shared_carton: false,
          explicit_pcs_per_set: null,
          is_packaging_only: false,
          bbox: [583, 46, 651, 954],
        },
      ],
    },
  },
};

