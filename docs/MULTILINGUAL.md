# Extracción multilingüe: alcance, pruebas y límites

PackMatch separa tres idiomas independientes: **interfaz** (`uiLocale`: es/en/zh),
**documentos** (lo que esté impreso en factura y empaque) e **minuta** (`memoLang`: es/en).
El idioma de interfaz nunca condiciona la extracción.

## Niveles de prueba (no mezclar)

| Nivel | Qué demuestra | Dónde |
| --- | --- | --- |
| 1. Unitarias con respuestas simuladas | Normalización + motor tratan bien JSON multilingües | `npm run test:qa` → `scripts/qa-extraction-multilingual.ts` + `scripts/fixtures/multilingual-cases.ts` (8 fixtures, 11 checks) |
| 2. Reproducción guardada | Determinismo sobre una extracción real grabada | `docs/fixtures/live-multilingual-2026-11-03.json` (sin clave, sin PII) |
| 3. Real contra Meta | Capacidad multilingüe del modelo | Muestra acotada abajo (2 llamadas, ~$0.046 en total) |

Las pruebas simuladas **no** demuestran capacidad del modelo. Solo el nivel 3 lo hace,
y solo para la muestra probada: no se afirma compatibilidad con “cualquier idioma”.

## Prueba real (2026-11-03, `muse-spark-1.3`)

- Documentos sintéticos sin PII generados con
  `python3 scripts/generate_live_multilingual_docs.py /tmp/ml-live`
  (factura en inglés +装箱单 en chino, PIL + Hiragino Sans GB).
- Llamada: `POST /api/extract` con ambas imágenes (servidor local, clave en `.env`,
  nunca publicada). Latencia ~22 s, ~$0.023 por llamada.
- Resultado grabado (redactado, sin data URLs): `docs/fixtures/live-multilingual-2026-11-03.json`.

Muestra mixta EN+ZH extraída exacta: `INV-ML-901` (100 PCS ML-901 @12.50=1250.00;
2 SETS ML-902 @40.00=80.00 con factor explícito 5) y `PL-ML-901`
(60+40 PCS ML-901; 10 件→PCS ML-902; cajas 3+1+1; 60/66 KG). Totales coherentes
(1330 / 5 / 60 / 66), `bbox` reales (no estimadas) en las 5 filas y cabeceras.

Conciliación de la extracción real: **0 hallazgos**
(`ML-901 MATCHED`; `ML-902 MATCHED` vía factor `DOCUMENT_EXPLICIT`).
ML-902 vinculó “Copper Gland Box” con “铜接头盒” **por SKU idéntico**, no por
traducción: el motor nunca empareja por descripción traducida.

## Límites observados

- Probado en vivo: factura EN + packing ZH mixtos. ES/EN/ZH/árabe-cabeceras y
  separadores `1.250,50`/`1,250.50` solo en nivel 1 (simulado).
- Dígitos arábigos orientales (١٢٣) no se interpretan: NFKC no los pliega a ASCII.
- `克` (gramo) y `吨` (tonelada) se copian verbatim, no se convierten: quedan para
  revisión del operador en lugar de multiplicar/dividir a ciegas.
- Unidad de venta ambigua (`箱`, pallet, rollo) se copia verbatim y produce
  `UNIT_AMBIGUITY_UNCONVERTIBLE` (requiere confirmación, fixture `ambiguous-unit`).
- Cifra ilegible o ausente en el JSON del modelo → `parseSafeNumber` usa fallback 0
  (contrato histórico del esquema); no se inventa otro valor, pero el 0 puede
  enmascarar el dato faltante: el operador debe inspeccionar la fila.
- Emparejamiento solo por SKU exacto o prefijo/sufijo con `-`; sin evidencia
  suficiente (SKUs distintos por idioma) el caso queda como discrepancia/ambigüedad
  para revisión, nunca se fusiona por traducción aparente.

## Reproducir

```bash
python3 scripts/generate_live_multilingual_docs.py /tmp/ml-live
npm run dev  # en otra terminal
# POST /api/extract con invoice_en.png + packing_zh.png como data URLs
# Conciliar docs/fixtures/live-multilingual-2026-11-03.json con reconcileShipment
```
