import * as pdfjsLib from "pdfjs-dist";

// Worker distribuido CON la aplicación: `new URL(..., import.meta.url)` hace
// que el bundler emita el worker de la versión instalada de pdfjs-dist como
// asset propio (mismo origen). Nada se pide a un CDN, así que una versión
// inexistente en cdnjs (p. ej. 6.5.438 -> 404) ya no puede bloquear la carga.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// 150 DPI igual que el raster del servidor (pdftoppm -r 150): el PDF base es
// 72 DPI, así que la escala es 150/72.
const RENDER_SCALE = 150 / 72;

export function isPdfFile(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

/**
 * Rasteriza la primera página del PDF a PNG en el navegador.
 * El servidor (p. ej. Netlify Functions) no dispone de pdftoppm/sips, así que
 * convertir en cliente garantiza que el modelo siempre reciba image/png.
 * Coherente con el servidor, que también rasteriza solo la página 1.
 */
export async function pdfFirstPageToPngDataUrl(
  file: File | Blob
): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D no disponible para rasterizar el PDF.");
    }
    await page.render({ canvas, viewport }).promise;
    return canvas.toDataURL("image/png");
  } finally {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => undefined);
  }
}
