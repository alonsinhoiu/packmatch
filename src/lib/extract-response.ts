/**
 * Ayudas puras (sin red ni DOM) para consumir respuestas de extracción.
 * Regla: nunca se interpreta como JSON un cuerpo que no lo es, y nunca se
 * expone el cuerpo interno del proveedor/servidor al operador.
 */

/**
 * Presupuesto de tiempos medido en sondas reales (2026-11-04, sin streaming:
 * TTFB = tiempo total de generación):
 * - texto mínimo: 2,6 s; imagen mínima: 2,9 s (auth/endpoint/modelo sanos).
 * - ambos documentos + salida mínima: 18,9 s; + esquema completo: 38,5 s.
 * - racha previa: 6 timeouts >45 s con los mismos documentos (degradación
 *   transitoria del proveedor, no formato ni tamaño).
 * Por eso proveedor 50 s (cubre 38,5 s medidos + margen) < cliente 57 s <
 * plataforma 60 s (Netlify Functions síncronas, ver netlify.toml). Sin
 * reintentos automáticos en ningún nivel. ADEMÁS el borde corta conexiones
 * ~30 s sin bytes: la ruta emite SSE con heartbeat cada 10 s, así que una
 * pata de 40-50 s ya no muere por inactividad (límite que queda: 60 s de
 * ejecución).
 */
/**
 * Heartbeat SSE cada 10 s: el borde público corta conexiones ~30 s sin
 * bytes, así que cada pata larga debe emitir tráfico mucho antes.
 */
export const SSE_HEARTBEAT_MS = 10_000;

export const EXTRACTION_TIMEOUTS = {
  providerMs: 50_000,
  clientMs: 57_000,
  platformBudgetMs: 60_000,
} as const;

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false };

export function tryParseJson(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown };
  return (
    e.name === "TimeoutError" ||
    e.name === "AbortError" ||
    e.code === "ETIMEDOUT" ||
    e.code === 23 // DOMException TIMEOUT_ERR legado
  );
}

export interface ExtractResponseError {
  code: string;
  status?: number;
  retryAfterSeconds?: number;
  retryable?: boolean;
  requestId?: string;
}

/**
 * Interpreta la respuesta HTTP de /api/extract en el navegador.
 * Devuelve el JSON ya parseado o lanza ExtractResponseError con código
 * estable (sin cuerpo crudo). El llamador localiza por código.
 */
export async function readExtractResponse(
  resp: Response
): Promise<Record<string, unknown>> {
  const text = await resp.text();
  const parsed = tryParseJson(text);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
    const err: ExtractResponseError = {
      code: "NON_JSON_RESPONSE",
      status: resp.status,
    };
    throw err;
  }
  const data = parsed.value as Record<string, unknown>;
  if (!resp.ok || data.error) {
    return mapExtractData(data, resp.status);
  }
  return data;
}

/**
 * Consume una respuesta SSE de extracción (`text/event-stream`):
 * ignora heartbeats (`: ping` / `{"type":"heartbeat"}`), exige UN ÚNICO
 * frame `data:` final con JSON íntegro y `extracted`. Sin `data:` completo
 * (corte, truncado, cancelación) lanza STREAM_TRUNCATED: un 200 parcial
 * nunca es éxito y nada parcial se aplica.
 */
export async function consumeStreamedExtract(
  resp: Response,
  opts: { idleMs?: number } = {}
): Promise<Record<string, unknown>> {
  const idleMs = opts.idleMs ?? 0;
  if (!resp.body) {
    const text = await resp.text();
    const parsed = tryParseJson(text);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
      throw { code: "STREAM_TRUNCATED", status: resp.status } as ExtractResponseError;
    }
    return mapExtractData(parsed.value as Record<string, unknown>, resp.status);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const dataFrames: string[] = [];
  const pumpIdle = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (idleMs <= 0) return reader.read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const readP = reader.read();
      const timeoutP = new Promise<never>((_, rej) => {
        timer = setTimeout(() => {
          const e = new Error(`sin bytes durante ${idleMs}ms`) as Error & { code?: string };
          e.code = "STREAM_TRUNCATED";
          rej(e);
        }, idleMs);
      });
      return await Promise.race([readP, timeoutP]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  try {
    for (;;) {
      let res: ReadableStreamReadResult<Uint8Array>;
      try {
        res = await pumpIdle();
      } catch (err) {
        try {
          await reader.cancel();
        } catch {
          /* noop */
        }
        if ((err as { code?: unknown })?.code === "STREAM_TRUNCATED") throw err;
        throw { code: "STREAM_TRUNCATED", status: resp.status } as ExtractResponseError;
      }
      if (res.done) break;
      buffer += decoder.decode(res.value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split("\n")) {
          const t = line.trim();
          if (!t) continue;
          if (t.startsWith(":")) continue; // heartbeat SSE
          if (t.startsWith("data:")) {
            const payload = t.slice(5).trim();
            if (payload.startsWith("{")) {
              try {
                const v = JSON.parse(payload) as { type?: unknown };
                if (v && v.type === "heartbeat") continue;
              } catch {
                /* JSON parcial: conservar para fallar íntegro abajo */
              }
            }
            dataFrames.push(payload);
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
  if (dataFrames.length === 0) {
    throw { code: "STREAM_TRUNCATED", status: resp.status } as ExtractResponseError;
  }
  const parsed = tryParseJson(dataFrames[dataFrames.length - 1]);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
    throw { code: "STREAM_TRUNCATED", status: resp.status } as ExtractResponseError;
  }
  return mapExtractData(parsed.value as Record<string, unknown>, resp.status);
}

function mapExtractData(
  data: Record<string, unknown>,
  status: number
): Record<string, unknown> {
  if (data.error) {
    const err: ExtractResponseError = {
      code:
        typeof data.errorCode === "string" && data.errorCode
          ? data.errorCode
          : "NON_JSON_RESPONSE",
      status,
      retryAfterSeconds:
        typeof data.retryAfterSeconds === "number"
          ? data.retryAfterSeconds
          : typeof data.suggestedRetryAfterSeconds === "number"
            ? data.suggestedRetryAfterSeconds
            : undefined,
      retryable: typeof data.retryable === "boolean" ? data.retryable : undefined,
      requestId: typeof data.requestId === "string" ? data.requestId : undefined,
    };
    throw err;
  }
  return data;
}

/**
 * Punto de entrada del cliente: rama SSE (`text/event-stream`) o lectura
 * bufferizada clásica. Conserva códigos estables en ambos casos.
 */
export async function consumeExtractResponse(
  resp: Response,
  opts: { idleMs?: number } = {}
): Promise<Record<string, unknown>> {
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    return consumeStreamedExtract(resp, opts);
  }
  return readExtractResponse(resp);
}

/** Clasifica un fallo de fetch (timeout / red) sin exponer el mensaje crudo. */
export function classifyFetchError(err: unknown): ExtractResponseError {
  if (isTimeoutError(err)) return { code: "PROVIDER_TIMEOUT" };
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string" &&
    (err as { code: string }).code
  ) {
    return { code: (err as { code: string }).code };
  }
  return { code: "PROVIDER_UNREACHABLE" };
}
