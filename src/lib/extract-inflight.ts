import { createHash } from "node:crypto";

/**
 * Deduplicación SOLO de vuelo (in-flight), ventana 60 s, sin persistencia
 * cross-instance. SOLO SERVIDOR (usa node:crypto): en serverless cada
 * instancia lleva su propio Set; frena el doble-clic contra la misma
 * instancia, no es garantía distribuida.
 */
export const INFLIGHT_TTL_MS = 60_000;
const inflightByHash = new Map<string, number>();

export function sha256Short(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

export function claimInflight(hash: string): boolean {
  const now = Date.now();
  for (const [k, ts] of inflightByHash) {
    if (now - ts > INFLIGHT_TTL_MS) inflightByHash.delete(k);
  }
  if (inflightByHash.has(hash)) return false;
  inflightByHash.set(hash, now);
  return true;
}

export function releaseInflight(hash: string): void {
  inflightByHash.delete(hash);
}
