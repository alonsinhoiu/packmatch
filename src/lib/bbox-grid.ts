import type { NormalizedBBox } from "./reconcile.ts";

/**
 * Anclaje de bandas de fila a las líneas horizontales reales de la imagen.
 *
 * Una retícula de bbox puede ser internamente consistente y aun así venir
 * desplazada en bloque del modelo. La única referencia absoluta es la
 * propia imagen: entre el centro de una fila y el de la siguiente debe
 * existir el borde inferior/superior de la tabla. Se busca, en esa ventana,
 * la fila de píxeles con mayor proporción de borde fuerte y continuo
 * (una línea de tabla cruza casi todo el ancho; el texto, no).
 *
 * Si no hay líneas detectables con suficiente confianza (foto sin
 * rejilla, escaneo sin bordes), no se toca nada: el llamador conserva el
 * grounding del modelo y su marca de estimado. Sin offsets fijos.
 */
export interface RasterLike {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

const LINE_MIN_FRACTION = 0.6;
// Umbral bajo a propósito: al rasterizar un PDF, las líneas de 1px quedan
// suavizadas y su salto de luminancia puede bajar a ~10-20 (medido sobre la
// factura real: con 25 solo se detectaba la mitad de los bordes). Lo que
// distingue a una línea de tabla no es la intensidad sino la continuidad:
// debe cruzar al menos el 60% del ancho a la misma y.
const EDGE_DELTA = 8;

export function horizontalLineScores(raster: RasterLike): Float64Array {
  const { data, width, height } = raster;
  const lum = new Float64Array(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  }
  const scores = new Float64Array(height);
  for (let y = 1; y < height; y++) {
    let strong = 0;
    const rowOff = y * width;
    const prevOff = (y - 1) * width;
    for (let x = 0; x < width; x++) {
      if (Math.abs(lum[rowOff + x] - lum[prevOff + x]) > EDGE_DELTA) strong++;
    }
    scores[y] = strong / width;
  }
  return scores;
}

export interface SnapResult {
  bbox: NormalizedBBox;
  snapped: boolean;
}

export function snapRowBBoxesToGrid(
  raster: RasterLike,
  boxes: NormalizedBBox[]
): SnapResult[] {
  const unsnapped = boxes.map((bbox) => ({ bbox, snapped: false }));
  const n = boxes.length;
  if (n < 2 || raster.height < 10 || raster.width < 10) return unsnapped;
  const h = raster.height;
  const scale = 1000 / h;
  const centersPx = boxes.map((b) => ((b[0] + b[2]) / 2 / 1000) * h);
  const diffs = centersPx.slice(1).map((c, i) => c - centersPx[i]);
  if (diffs.some((d) => d <= 2)) return unsnapped;
  const pitchPx = [...diffs].sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
  const scores = horizontalLineScores(raster);

  const bestLine = (from: number, to: number): number | null => {
    let bestY = -1;
    let bestScore = 0;
    const lo = Math.max(1, Math.floor(from));
    const hi = Math.min(h - 1, Math.ceil(to));
    for (let y = lo; y <= hi; y++) {
      if (scores[y] > bestScore) {
        bestScore = scores[y];
        bestY = y;
      }
    }
    return bestScore >= LINE_MIN_FRACTION ? bestY : null;
  };

  const boundaries: number[] = [];
  const top = bestLine(centersPx[0] - pitchPx, centersPx[0]);
  if (top === null) return unsnapped;
  boundaries.push(top);
  for (let i = 0; i < n - 1; i++) {
    const b = bestLine(centersPx[i], centersPx[i + 1]);
    if (b === null) return unsnapped;
    boundaries.push(b);
  }
  const bottom = bestLine(centersPx[n - 1], centersPx[n - 1] + pitchPx);
  if (bottom === null) return unsnapped;
  boundaries.push(bottom);
  for (let i = 1; i < boundaries.length; i++) {
    if (boundaries[i] <= boundaries[i - 1]) return unsnapped;
  }

  // Validación de coherencia de bandas (sin offsets fijos ni reglas por
  // documento): la ventana superior puede contener dos líneas fuertes
  // (borde de cabecera + borde de primera fila). Si la primera banda queda
  // incoherente con sus vecinas, se re-elige entre TODAS las candidatas de
  // la ventana la que deje una altura coherente con la mediana del resto.
  // Sin evidencia suficiente se devuelve unsnapped (se conserva estimado).
  {
    const pxHeights = boundaries.slice(1).map((b, i) => b - boundaries[i]);
    const rest = [...pxHeights.slice(1)].sort((a, b) => a - b);
    const medRest = rest[Math.floor(rest.length / 2)];
    if (medRest > 0) {
      const tol = 0.4 * medRest;
      if (Math.abs(pxHeights[0] - medRest) > tol) {
        const lo = Math.max(1, Math.floor(centersPx[0] - pitchPx));
        const hi = Math.min(h - 1, Math.ceil(centersPx[0]));
        let best: number | null = null;
        let bestErr = tol;
        for (let y = lo; y <= hi; y++) {
          if (scores[y] < LINE_MIN_FRACTION) continue;
          if (y >= boundaries[1]) continue;
          const err = Math.abs(boundaries[1] - y - medRest);
          if (err < bestErr) {
            bestErr = err;
            best = y;
          }
        }
        if (best === null) return unsnapped;
        boundaries[0] = best;
      }
      // Guardia general: ninguna banda puede desviarse >±40% de la mediana
      // global; si ocurre, no hay anclaje fiable.
      const allHeights = boundaries.slice(1).map((b, i) => b - boundaries[i]);
      const sorted = [...allHeights].sort((a, b) => a - b);
      const medAll = sorted[Math.floor(sorted.length / 2)];
      if (medAll > 0 && allHeights.some((x) => Math.abs(x - medAll) > 0.4 * medAll)) {
        return unsnapped;
      }
    }
  }

  return boxes.map((bbox, i) => {
    const ymin = Math.round(boundaries[i] * scale);
    const ymax = Math.round(boundaries[i + 1] * scale);
    if (ymax <= ymin) return { bbox, snapped: false };
    return {
      bbox: [ymin, bbox[1], ymax, bbox[3]] as NormalizedBBox,
      snapped: true,
    };
  });
}

/** Carga una imagen (data URL u Object URL) como raster en el navegador. */
export async function loadRaster(imageUrl: string): Promise<RasterLike | null> {
  if (typeof document === "undefined") return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve({ data: imageData.data, width: canvas.width, height: canvas.height });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

export async function snapDocumentRows<
  T extends { bbox?: NormalizedBBox; bbox_estimated?: boolean }
>(rows: T[], imageUrl: string): Promise<T[]> {
  if (rows.length < 2 || rows.some((r) => !r.bbox)) return rows;
  const raster = await loadRaster(imageUrl);
  if (!raster) return rows;
  const snapped = snapRowBBoxesToGrid(
    raster,
    rows.map((r) => r.bbox!)
  );
  if (snapped.some((s) => !s.snapped)) return rows;
  // Anclado a líneas reales de la imagen: grounding basado en evidencia.
  return rows.map((r, i) => ({ ...r, bbox: snapped[i].bbox, bbox_estimated: false }));
}
