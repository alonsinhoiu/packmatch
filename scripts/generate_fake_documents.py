#!/usr/bin/env python3
"""
Generador de Factura Comercial y Lista de Empaque falsas pero realistas para PackMatch.
Crea tanto archivos .PNG de alta resolución como archivos .PDF listos para subir o probar.
"""

import os
from PIL import Image, ImageDraw, ImageFont

OUTPUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "documentos_de_prueba"))
os.makedirs(OUTPUT_DIR, exist_ok=True)

def get_font(size: int, bold: bool = False):
    font_paths = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ]
    for p in font_paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

def create_commercial_invoice():
    # Dimensiones estándar A4 a 150 DPI (1240 x 1754 px)
    width, height = 1240, 1754
    img = Image.new("RGB", (width, height), "#FFFFFF")
    draw = ImageDraw.Draw(img)

    f_title = get_font(32, bold=True)
    f_sub = get_font(20, bold=True)
    f_header = get_font(18, bold=True)
    f_body = get_font(16, bold=False)
    f_bold = get_font(16, bold=True)
    f_small = get_font(13, bold=False)

    # 1. Cabecera Corporativa del Proveedor
    draw.rectangle([(50, 45), (1190, 48)], fill="#0B132B")
    draw.text((50, 60), "NINGBO PACIFIC LOGISTICS & MFG CO., LTD.", fill="#0B132B", font=f_sub)
    draw.text((50, 88), "188 Century Avenue, High-Tech Industrial Zone, Ningbo, Zhejiang, China", fill="#475569", font=f_small)
    draw.text((50, 108), "Tel: +86-574-8765-4321 | Tax ID: 91330200MA2819XX89 | Email: export@pacific-logistics.cn", fill="#475569", font=f_small)

    # Título del Documento
    draw.rectangle([(750, 60), (1190, 120)], fill="#F8FAFC", outline="#CBD5E1", width=1)
    draw.text((770, 72), "COMMERCIAL INVOICE", fill="#0F172A", font=f_title)

    # 2. Bloque de Metadatos (Dos Columnas)
    # Columna Izquierda: Consignee / Buyer
    draw.rectangle([(50, 140), (600, 290)], fill="#F8FAFC", outline="#CBD5E1", width=1)
    draw.rectangle([(50, 140), (600, 170)], fill="#E2E8F0")
    draw.text((65, 146), "CONSIGNEE / BUYER:", fill="#0F172A", font=f_header)
    draw.text((65, 180), "LOGISTICA ANDINA S.A.C.", fill="#0F172A", font=f_bold)
    draw.text((65, 205), "Av. Elmer Faucett 2850, Callao, Lima, Perú", fill="#334155", font=f_body)
    draw.text((65, 230), "R.U.C. / Tax ID: 20554891234 | Tel: +51 1 517-8900", fill="#334155", font=f_small)
    draw.text((65, 255), "Attn: Dpto. de Importaciones & Despacho Aduanero", fill="#334155", font=f_small)

    # Columna Derecha: Invoice Details
    draw.rectangle([(630, 140), (1190, 290)], fill="#F8FAFC", outline="#CBD5E1", width=1)
    draw.rectangle([(630, 140), (1190, 170)], fill="#E2E8F0")
    draw.text((645, 146), "INVOICE PARTICULARS:", fill="#0F172A", font=f_header)

    labels_right = [
        ("Invoice No.:", "INV-2026-9042"),
        ("Date:", "2026-10-24"),
        ("Incoterm:", "FOB NINGBO"),
        ("Currency:", "USD ($)"),
        ("Port of Loading:", "Ningbo Port, China"),
        ("Port of Discharge:", "Callao Port, Peru"),
    ]
    y_pos = 180
    for lbl, val in labels_right:
        draw.text((645, y_pos), lbl, fill="#64748B", font=f_bold)
        draw.text((800, y_pos), val, fill="#0F172A", font=f_bold if "INV-" in val else f_body)
        y_pos += 22

    # 3. Tabla Principal de Líneas de Factura
    t_top = 315
    t_bottom = 750
    draw.rectangle([(50, t_top), (1190, t_bottom)], fill="#FFFFFF", outline="#0B132B", width=2)
    # Encabezado de tabla
    draw.rectangle([(50, t_top), (1190, t_top + 40)], fill="#0B132B")

    cols = [
        (50, 120, "Item #", "center"),
        (120, 270, "SKU / Part No.", "left"),
        (270, 720, "Description of Goods", "left"),
        (720, 830, "Quantity", "right"),
        (830, 910, "Unit", "center"),
        (910, 1030, "Unit Price", "right"),
        (1030, 1190, "Amount (USD)", "right"),
    ]

    for x1, x2, title, align in cols:
        draw.line([(x2, t_top), (x2, t_bottom)], fill="#CBD5E1", width=1)
        if align == "center":
            draw.text((x1 + (x2 - x1) // 4, t_top + 10), title, fill="#FFFFFF", font=f_bold)
        elif align == "right":
            draw.text((x2 - 100, t_top + 10), title, fill="#FFFFFF", font=f_bold)
        else:
            draw.text((x1 + 10, t_top + 10), title, fill="#FFFFFF", font=f_bold)

    # Renglones de factura
    rows = [
        ("INV-L1", "SKU-A101", "Smart Bluetooth Sensor Beacon IP67 (Industrial Grade)", "500", "PCS", "$12.00", "$6,000.00"),
        ("INV-L2", "SKU-B202", "Industrial Stainless Valve Kit (1 SET = 2 PCS)", "80", "SETS", "$95.00", "$7,600.00"),
        ("INV-L3", "SKU-C303", "Heavy Duty Fasteners Steel Grade 8.8 (Hex Bolts)", "200", "PCS", "$15.00", "$3,000.00"),
    ]

    curr_y = t_top + 40
    for r_idx, r in enumerate(rows):
        row_bg = "#FFFFFF" if r_idx % 2 == 0 else "#F8FAFC"
        draw.rectangle([(50, curr_y), (1190, curr_y + 60)], fill=row_bg)
        # Redraw vertical grid lines
        for _, x2, _, _ in cols:
            draw.line([(x2, curr_y), (x2, curr_y + 60)], fill="#E2E8F0", width=1)
        draw.line([(50, curr_y + 60), (1190, curr_y + 60)], fill="#CBD5E1", width=1)

        # Text
        draw.text((70, curr_y + 18), r[0], fill="#64748B", font=f_bold)
        draw.text((135, curr_y + 18), r[1], fill="#0F172A", font=f_bold)
        draw.text((285, curr_y + 18), r[2], fill="#334155", font=f_body)
        draw.text((770, curr_y + 18), r[3], fill="#0F172A", font=f_bold)
        draw.text((850, curr_y + 18), r[4], fill="#64748B", font=f_bold)
        draw.text((945, curr_y + 18), r[5], fill="#334155", font=f_body)
        draw.text((1075, curr_y + 18), r[6], fill="#0F172A", font=f_bold)

        curr_y += 60

    # 4. Sección de Totales de Factura
    tot_y = t_bottom + 15
    draw.rectangle([(630, tot_y), (1190, tot_y + 130)], fill="#F8FAFC", outline="#0B132B", width=2)
    draw.text((650, tot_y + 15), "Total Invoiced Items:", fill="#64748B", font=f_body)
    draw.text((900, tot_y + 15), "780 (500 PCS + 80 SETS + 200 PCS)", fill="#0F172A", font=f_bold)

    draw.text((650, tot_y + 45), "Total Packages / Cartons:", fill="#64748B", font=f_body)
    draw.text((900, tot_y + 45), "25 Cartons (CTN 01-25)", fill="#0F172A", font=f_bold)

    draw.line([(630, tot_y + 75), (1190, tot_y + 75)], fill="#CBD5E1", width=1)

    draw.text((650, tot_y + 90), "TOTAL AMOUNT (FOB):", fill="#0B132B", font=f_title)
    draw.text((990, tot_y + 90), "$16,600.00 USD", fill="#10B981", font=f_title)

    # 5. Notas Aduaneras y Sello
    draw.rectangle([(50, tot_y), (600, tot_y + 130)], fill="#FFFFFF", outline="#CBD5E1", width=1)
    draw.text((65, tot_y + 15), "DECLARACIÓN DEL EXPORTADOR:", fill="#0F172A", font=f_bold)
    draw.text((65, 40 + tot_y), "We hereby certify that this invoice is true and correct, and", fill="#475569", font=f_small)
    draw.text((65, 60 + tot_y), "that the products described originated in the People's", fill="#475569", font=f_small)
    draw.text((65, 80 + tot_y), "Republic of China. No other invoice has been issued.", fill="#475569", font=f_small)
    draw.text((65, 105 + tot_y), "Bank Account: Ningbo Commercial Bank · ACC #8839201994", fill="#64748B", font=f_small)

    # Sello / Firma
    stamp_y = tot_y + 160
    draw.rectangle([(800, stamp_y), (1150, stamp_y + 110)], outline="#E11D48", width=2)
    draw.text((820, stamp_y + 15), "NINGBO PACIFIC LOGISTICS & MFG", fill="#E11D48", font=f_small)
    draw.text((840, stamp_y + 40), "★ EXPORT DEPT. APPROVED ★", fill="#E11D48", font=f_bold)
    draw.text((850, stamp_y + 75), "Authorized Signature & Seal", fill="#E11D48", font=f_small)

    # Guardar PNG y PDF
    png_path = os.path.join(OUTPUT_DIR, "Factura_Comercial_INV-2026-9042.png")
    pdf_path = os.path.join(OUTPUT_DIR, "Factura_Comercial_INV-2026-9042.pdf")
    img.save(png_path, "PNG")
    img.save(pdf_path, "PDF", resolution=150.0)
    print(f"Factura guardada en: {png_path} y {pdf_path}")

def create_packing_list():
    # Dimensiones estándar A4 a 150 DPI (1240 x 1754 px)
    width, height = 1240, 1754
    img = Image.new("RGB", (width, height), "#FFFFFF")
    draw = ImageDraw.Draw(img)

    f_title = get_font(32, bold=True)
    f_sub = get_font(20, bold=True)
    f_header = get_font(18, bold=True)
    f_body = get_font(16, bold=False)
    f_bold = get_font(16, bold=True)
    f_small = get_font(13, bold=False)

    # 1. Cabecera Corporativa del Proveedor
    draw.rectangle([(50, 45), (1190, 48)], fill="#0B132B")
    draw.text((50, 60), "NINGBO PACIFIC LOGISTICS & MFG CO., LTD.", fill="#0B132B", font=f_sub)
    draw.text((50, 88), "188 Century Avenue, High-Tech Industrial Zone, Ningbo, Zhejiang, China", fill="#475569", font=f_small)
    draw.text((50, 108), "Warehouse & Shipping Operations · Terminal 4 Logistics Wharf", fill="#475569", font=f_small)

    # Título del Documento
    draw.rectangle([(770, 60), (1190, 120)], fill="#F8FAFC", outline="#CBD5E1", width=1)
    draw.text((800, 72), "PACKING LIST", fill="#0F172A", font=f_title)

    # 2. Bloque de Metadatos (Dos Columnas)
    draw.rectangle([(50, 140), (600, 290)], fill="#F8FAFC", outline="#CBD5E1", width=1)
    draw.rectangle([(50, 140), (600, 170)], fill="#E2E8F0")
    draw.text((65, 146), "CONSIGNEE / SHIP TO:", fill="#0F172A", font=f_header)
    draw.text((65, 180), "LOGISTICA ANDINA S.A.C.", fill="#0F172A", font=f_bold)
    draw.text((65, 205), "Av. Elmer Faucett 2850, Callao, Lima, Perú", fill="#334155", font=f_body)
    draw.text((65, 230), "R.U.C.: 20554891234 | Notify Party: Same as Consignee", fill="#334155", font=f_small)
    draw.text((65, 255), "Customs Broker: Agencia Aduanera del Pacífico S.A.", fill="#334155", font=f_small)

    draw.rectangle([(630, 140), (1190, 290)], fill="#F8FAFC", outline="#CBD5E1", width=1)
    draw.rectangle([(630, 140), (1190, 170)], fill="#E2E8F0")
    draw.text((645, 146), "PACKING LIST PARTICULARS:", fill="#0F172A", font=f_header)

    labels_right = [
        ("Packing List No.:", "PL-2026-9042"),
        ("Ref. Invoice No.:", "INV-2026-9042"),
        ("Date:", "2026-10-24"),
        ("Total Packages:", "25 Cartons"),
        ("Port of Loading:", "Ningbo Port, China"),
        ("Port of Discharge:", "Callao Port, Peru"),
    ]
    y_pos = 180
    for lbl, val in labels_right:
        draw.text((645, y_pos), lbl, fill="#64748B", font=f_bold)
        draw.text((810, y_pos), val, fill="#0F172A", font=f_bold if "PL-" in val else f_body)
        y_pos += 22

    # 3. Tabla Principal de Lista de Empaque
    t_top = 315
    t_bottom = 750
    draw.rectangle([(50, t_top), (1190, t_bottom)], fill="#FFFFFF", outline="#0B132B", width=2)
    draw.rectangle([(50, t_top), (1190, t_top + 40)], fill="#0B132B")

    cols_pl = [
        (50, 150, "Carton Range", "center"),
        (150, 240, "Cartons", "center"),
        (240, 390, "SKU / Part No.", "left"),
        (390, 680, "Item Description", "left"),
        (680, 780, "Qty/Ctn", "right"),
        (780, 890, "Total Qty", "right"),
        (890, 1040, "Net Wt (KG)", "right"),
        (1040, 1190, "Gross Wt (KG)", "right"),
    ]

    for x1, x2, title, align in cols_pl:
        draw.line([(x2, t_top), (x2, t_bottom)], fill="#CBD5E1", width=1)
        if align == "center":
            draw.text((x1 + (x2 - x1) // 6, t_top + 10), title, fill="#FFFFFF", font=f_bold)
        elif align == "right":
            draw.text((x2 - 110, t_top + 10), title, fill="#FFFFFF", font=f_bold)
        else:
            draw.text((x1 + 10, t_top + 10), title, fill="#FFFFFF", font=f_bold)

    # Renglones de empaque con discrepancias realistas
    rows_pl = [
        ("CTN 01-10", "10 CTNS", "SKU-A101", "Smart Bluetooth Sensor Beacon IP67", "50 PCS", "500 PCS", "120.00 KG", "135.00 KG"),
        ("CTN 11-20", "10 CTNS", "SKU-B202", "Industrial Stainless Valve Kit", "7 SETS", "70 SETS", "680.00 KG", "760.00 KG"),
        ("CTN 21-25", "5 CTNS", "SKU-C303", "Heavy Duty Fasteners Steel Grade 8.8", "40 PCS", "200 PCS", "180.00 KG", "160.00 KG"),
    ]

    curr_y = t_top + 40
    for r_idx, r in enumerate(rows_pl):
        row_bg = "#FFFFFF" if r_idx % 2 == 0 else "#F8FAFC"
        draw.rectangle([(50, curr_y), (1190, curr_y + 60)], fill=row_bg)
        for _, x2, _, _ in cols_pl:
            draw.line([(x2, curr_y), (x2, curr_y + 60)], fill="#E2E8F0", width=1)
        draw.line([(50, curr_y + 60), (1190, curr_y + 60)], fill="#CBD5E1", width=1)

        draw.text((65, curr_y + 18), r[0], fill="#0F172A", font=f_bold)
        draw.text((165, curr_y + 18), r[1], fill="#334155", font=f_body)
        draw.text((250, curr_y + 18), r[2], fill="#0F172A", font=f_bold)
        draw.text((400, curr_y + 18), r[3], fill="#334155", font=f_body)
        draw.text((700, curr_y + 18), r[4], fill="#475569", font=f_body)
        draw.text((800, curr_y + 18), r[5], fill="#0F172A", font=f_bold)
        draw.text((920, curr_y + 18), r[6], fill="#0F172A", font=f_bold)
        draw.text((1060, curr_y + 18), r[7], fill="#0F172A", font=f_bold)

        curr_y += 60

    # 4. Sección de Totales de Empaque
    tot_y = t_bottom + 15
    draw.rectangle([(630, tot_y), (1190, tot_y + 130)], fill="#F8FAFC", outline="#0B132B", width=2)
    draw.text((650, tot_y + 15), "Grand Total Cartons:", fill="#64748B", font=f_body)
    draw.text((950, tot_y + 15), "25 CARTONS", fill="#0F172A", font=f_bold)

    draw.text((650, tot_y + 45), "Total Net Weight:", fill="#64748B", font=f_body)
    draw.text((950, tot_y + 45), "980.00 KG", fill="#0F172A", font=f_bold)

    draw.line([(630, tot_y + 75), (1190, tot_y + 75)], fill="#CBD5E1", width=1)

    draw.text((650, tot_y + 90), "TOTAL GROSS WEIGHT:", fill="#0B132B", font=f_title)
    draw.text((970, tot_y + 90), "1,055.00 KG", fill="#10B981", font=f_title)

    # 5. Notas de Empaque y Almacén
    draw.rectangle([(50, tot_y), (600, tot_y + 130)], fill="#FFFFFF", outline="#CBD5E1", width=1)
    draw.text((65, tot_y + 15), "NOTAS DEL DEPÓSITO Y LOGÍSTICA:", fill="#0F172A", font=f_bold)
    draw.text((65, 40 + tot_y), "All cargo is properly palletized and shrink-wrapped.", fill="#475569", font=f_small)
    draw.text((65, 60 + tot_y), "Standard wooden pallets ISPM-15 heat-treated for export.", fill="#475569", font=f_small)
    draw.text((65, 80 + tot_y), "Carton marks: [LOGISTICA ANDINA / CALLAO / CTN 1-25]", fill="#475569", font=f_small)
    draw.text((65, 105 + tot_y), "Dispatched by: Warehouse Chief Wei Zhang (Shift A)", fill="#64748B", font=f_small)

    # Sello / Firma de Almacén
    stamp_y = tot_y + 160
    draw.rectangle([(800, stamp_y), (1150, stamp_y + 110)], outline="#2563EB", width=2)
    draw.text((820, stamp_y + 15), "NINGBO PACIFIC LOGISTICS & MFG", fill="#2563EB", font=f_small)
    draw.text((845, stamp_y + 40), "★ WAREHOUSE DISPATCH OK ★", fill="#2563EB", font=f_bold)
    draw.text((865, stamp_y + 75), "Chief Inspector: W. Zhang", fill="#2563EB", font=f_small)

    # Guardar PNG y PDF
    png_path = os.path.join(OUTPUT_DIR, "Lista_de_Empaque_PL-2026-9042.png")
    pdf_path = os.path.join(OUTPUT_DIR, "Lista_de_Empaque_PL-2026-9042.pdf")
    img.save(png_path, "PNG")
    img.save(pdf_path, "PDF", resolution=150.0)
    print(f"Lista de empaque guardada en: {png_path} y {pdf_path}")

if __name__ == "__main__":
    create_commercial_invoice()
    create_packing_list()
