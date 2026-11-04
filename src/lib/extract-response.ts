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
 * reintentos automáticos en ningún nivel.
 */
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
    const err: ExtractResponseError = {
      code:
        typeof data.errorCode === "string" && data.errorCode
          ? data.errorCode
          : "NON_JSON_RESPONSE",
      status: resp.status,
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
