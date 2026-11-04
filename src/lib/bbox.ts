import type { NormalizedBBox } from "./reconcile.ts";

/**
 * Validación y refinamiento del grounding visual (bbox por fila, 0..1000).
 *
 * Las filas de una tabla forman una retícula: tops casi equidistantes y
 * alturas parecidas. El modelo a veces devuelve una fila desplazada, o cajas
 * ajustadas al texto en vez de a la fila completa. Esto se detecta contra la
 * retícula del propio documento (sin offsets fijos ni reglas por documento):
 *
 * - Fila atípica frente a una retícula fuerte: se sustituye por la banda
 *   predicha por la retícula y se marca ESTIMADA.
 * - Cajas sistemáticamente bajas (texto, no fila): se expanden a bandas de
 *   un paso de retícula centradas según la retícula y se marcan ESTIMADAS.
 * - Sin retícula fiable (pocas filas, tops no monótonos, solapes): se
 *   conservan las coordenadas del modelo pero se marcan estimadas si hay
 *   irregularidades; nunca se presentan como exactas.
 */
export interface BBoxRefinement {
  bbox: NormalizedBBox;
  estimated: boolean;
  corrected: boolean;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function refineRowBBoxes(
  input: NormalizedBBox[]
): BBoxRefinement[] {
  const keep = (estimated: boolean): BBoxRefinement[] =>
    input.map((bbox) => ({ bbox, estimated, corrected: false }));
  const n = input.length;
  if (n < 3) return keep(false);

  const tops = input.map((b) => b[0]);
  const heights = input.map((b) => b[2] - b[0]);
  const diffs = tops.slice(1).map((t, i) => t - tops[i]);
  const monotonic = diffs.every((d) => d > 0);
  const overlaps = input.some(
    (b, i) => i > 0 && b[0] < input[i - 1][2] - 0.15 * heights[i - 1]
  );
  const medH = median(heights);
  const heightSpread =
    medH > 0 ? Math.max(...heights) / Math.max(1, Math.min(...heights)) : Infinity;

  if (!monotonic) return keep(true);

  const pitch = median(diffs);
  if (pitch <= 0) return keep(true);
  const intercept = median(tops.map((t, i) => t - i * pitch));
  const residuals = tops.map((t, i) => Math.abs(t - (intercept + i * pitch)));
  const inlierTol = Math.max(3, 0.15 * pitch);
  const inliers = residuals.map((r) => r <= inlierTol);
  const inlierCount = inliers.filter(Boolean).length;

  if (inlierCount < Math.max(2, Math.ceil(0.7 * n))) {
    // Sin retícula fuerte: conservar, marcando estimado si hay irregularidad.
    return keep(overlaps || heightSpread > 1.6);
  }

  // Reajuste por mínimos cuadrados solo con inliers (retícula robusta).
  const idx = inliers.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const meanI = idx.reduce((a, b) => a + b, 0) / idx.length;
  const meanT = idx.reduce((a, i) => a + tops[i], 0) / idx.length;
  const cov = idx.reduce((a, i) => a + (i - meanI) * (tops[i] - meanT), 0);
  const varI = idx.reduce((a, i) => a + (i - meanI) ** 2, 0);
  const fitPitch = varI > 0 ? cov / varI : pitch;
  const fitIntercept = meanT - fitPitch * meanI;
  const inlierHeights = heights.filter((_, i) => inliers[i]);
  const bandHeight = median(inlierHeights);
  const medXmin = median(input.filter((_, i) => inliers[i]).map((b) => b[1]));
  const medXmax = median(input.filter((_, i) => inliers[i]).map((b) => b[3]));
  const outlierTol = Math.max(5, 0.25 * fitPitch);
  // Cajas de texto (altura muy inferior al paso): no cubren la fila entera.
  const textTight = bandHeight < 0.82 * fitPitch;

  return input.map((bbox, i) => {
    const predTop = fitIntercept + i * fitPitch;
    if (textTight) {
      const ymin = clamp(Math.round(predTop), 0, 999);
      return {
        bbox: [ymin, bbox[1], clamp(Math.round(predTop + fitPitch), ymin + 1, 1000), bbox[3]] as NormalizedBBox,
        estimated: true,
        corrected: true,
      };
    }
    if (residuals[i] > outlierTol) {
      const ymin = clamp(Math.round(predTop), 0, 999);
      return {
        bbox: [ymin, Math.round(medXmin), clamp(Math.round(predTop + bandHeight), ymin + 1, 1000), Math.round(medXmax)] as NormalizedBBox,
        estimated: true,
        corrected: true,
      };
    }
    return { bbox, estimated: false, corrected: false };
  });
}
