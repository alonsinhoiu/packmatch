#!/usr/bin/env python3
"""Genera 2 documentos sintéticos (factura EN + packing ZH) para la prueba
real de extracción multilingüe. Sin datos privados. Salida: PNG 1200x1600.
Uso: python3 scripts/generate_live_multilingual_docs.py /tmp/ml-live
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ml-live"
os.makedirs(OUT, exist_ok=True)

LATIN = "/System/Library/Fonts/Helvetica.ttc"
CJK = "/System/Library/Fonts/Hiragino Sans GB.ttc"


def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


F_TITLE = font(CJK, 44)
F_H = font(CJK, 26)
F_B = font(CJK, 24)
F_L = font(LATIN, 24)


def sheet(title, meta_lines, headers, rows, totals, path):
    img = Image.new("RGB", (1200, 1600), "white")
    d = ImageDraw.Draw(img)
    d.text((80, 60), title, font=F_TITLE, fill="black")
    y = 150
    for line in meta_lines:
        d.text((80, y), line, font=F_H, fill="black")
        y += 40
    y += 20
    d.text((80, y), " | ".join(headers), font=F_H, fill="black")
    y += 44
    d.line([(80, y), (1120, y)], fill="black", width=2)
    y += 12
    for r in rows:
        d.text((80, y), " | ".join(r), font=F_B, fill="black")
        y += 44
    y += 16
    d.line([(80, y), (1120, y)], fill="black", width=2)
    y += 12
    for t in totals:
        d.text((80, y), t, font=F_H, fill="black")
        y += 40
    img.save(path)
    print("wrote", path)


# Factura en inglés: ML-901 100 PCS @12.50=1250.00 ; ML-902 2 SETS @40.00=80.00 (1 SET = 5 PCS)
sheet(
    "COMMERCIAL INVOICE",
    ["Invoice No: INV-ML-901", "Incoterm: FOB SHANGHAI", "Currency: USD"],
    ["Item", "Description", "Qty", "Unit", "Unit Price", "Amount"],
    [
        ["ML-901", "Steel Valve DN50", "100", "PCS", "12.50", "1250.00"],
        ["ML-902", "Copper Gland Box (1 SET = 5 PCS)", "2", "SETS", "40.00", "80.00"],
    ],
    ["Total Amount: USD 1330.00", "Total Cartons: 5", "Net Weight: 60 KG", "Gross Weight: 66 KG"],
    os.path.join(OUT, "invoice_en.png"),
)

# 装箱单 en chino: mismos SKUs, descripciones en chino, ML-902 con 10 件 (= 2套 x5)
sheet(
    "装箱单",
    ["装箱单号： PL-ML-901", "贸易术语： FOB SHANGHAI", "货币： USD"],
    ["产品编码", "品名", "箱数", "单箱数量", "总数量", "单位", "净重", "毛重", "箱号"],
    [
        ["ML-901", "钢阀 DN50", "3", "20", "60", "件", "30", "33", "CTN 1-3"],
        ["ML-901", "钢阀 DN50", "1", "40", "40", "件", "12", "13", "CTN 4-4"],
        ["ML-902", "铜接头盒", "1", "10", "10", "件", "18", "20", "CTN 5-5"],
    ],
    ["总箱数： 5", "总净重： 60 KG", "总毛重： 66 KG"],
    os.path.join(OUT, "packing_zh.png"),
)
