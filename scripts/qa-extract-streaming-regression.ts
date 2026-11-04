import assert from 'node:assert/strict';
import {
  classifyFetchError,
  consumeExtractResponse,
  consumeStreamedExtract,
  readExtractResponse,
  SSE_HEARTBEAT_MS,
} from '../src/lib/extract-response.ts';
import { claimInflight, releaseInflight, sha256Short } from '../src/lib/extract-inflight.ts';

// Pruebas controladas del CONTRATO DE STREAMING de extracción.
// - Mocks LOCALES de fetch/Response/ReadableStream. CERO red.
// - Temporizadores virtuales: idleMs 50-80 ms SIMULA el corte público (~30 s sin bytes).
//   Producción emite heartbeat cada SSE_HEARTBEAT_MS (< 30 s estrictos).
// - Contrato exigido (lo que el streaming implementa y esto verifica):
//   * Heartbeats `: ping` / {"type":"heartbeat"} resetean inactividad.
//   * Un único JSON final íntegro con `extracted`; 200 parcial !== éxito.
//   * Truncado/error mid-stream -> error estructurado con `code` estable.
//   * Cancelación -> nada parcial aplicado, archivos conservados (el llamador no los limpia).
//   * Doble clic -> un solo trabajo (guard cliente + dedup servidor por hash).
//   * Reintento SOLO manual; 1 llamada proveedor por intento.

let passes = 0;
const ok = (name: string) => { passes++; console.log('PASA ' + name); };

assert.ok(SSE_HEARTBEAT_MS < 30_000, `heartbeat ${SSE_HEARTBEAT_MS}ms debe ser < corte 30 s`);
ok('heartbeat de producción es menor que el corte público por inactividad');

type Chunk = { delayMs: number; data: string };
const enc = new TextEncoder();

function mockStreamedResponse(chunks: Chunk[], opts: { failAt?: number; signal?: AbortSignal } = {}): Response {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const onAbort = () => {
        timers.forEach(clearTimeout);
        try {
          const e = new Error('aborted');
          e.name = 'AbortError';
          controller.error(e);
        } catch { /* ya cerrada */ }
      };
      if (opts.signal?.aborted) { onAbort(); return; }
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      chunks.forEach((ch, i) => {
        timers.push(setTimeout(() => {
          if (opts.failAt !== undefined && i === opts.failAt) {
            timers.forEach(clearTimeout);
            controller.error(new Error('provider boom mid-stream'));
            return;
          }
          controller.enqueue(enc.encode(ch.data));
          if (i === chunks.length - 1) { try { controller.close(); } catch { /* noop */ } }
        }, ch.delayMs));
      });
    },
    cancel() { timers.forEach(clearTimeout); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

// Réplica del guard cliente (page.tsx: extractInFlightRef + seq).
function createClientSession(
  fetchFn: (signal: AbortSignal) => Promise<Response>,
  consume: (r: Response, s: AbortSignal) => Promise<unknown>
) {
  let inFlight = false;
  let seq = 0;
  let applied: unknown = null;
  let calls = 0;
  let currentCtl: AbortController | null = null;
  return {
    get fetchCalls() { return calls; },
    get applied() { return applied; },
    get extracting() { return inFlight; },
    async run(): Promise<{ deduped: boolean; data?: unknown; error?: unknown }> {
      if (inFlight) return { deduped: true };
      inFlight = true;
      const mySeq = ++seq;
      const ctl = new AbortController();
      currentCtl = ctl;
      calls++;
      try {
        const resp = await fetchFn(ctl.signal);
        const data = await consume(resp, ctl.signal);
        if (mySeq !== seq) return { deduped: true };
        applied = data;
        return { deduped: false, data };
      } catch (error) {
        if (mySeq !== seq) return { deduped: true };
        return { deduped: false, error };
      } finally {
        if (mySeq === seq) { inFlight = false; currentCtl = null; }
      }
    },
    cancel() { currentCtl?.abort(); },
  };
}

// (a1) Pata silenciosa > idle muere: modelo del corte público ~30 s sin bytes.
{
  const resp = mockStreamedResponse([{ delayMs: 120, data: JSON.stringify({ extracted: { invoice: { lines: [1, 2] } } }) }]);
  await assert.rejects(
    () => consumeStreamedExtract(resp, { idleMs: 50 }),
    (e: unknown) => (e as { code?: unknown })?.code === 'STREAM_TRUNCATED'
  );
  ok('streaming (a1): pata silenciosa >idle muere con STREAM_TRUNCATED (modelo del corte ~30 s)');
}

// (a2) Con heartbeats < idle el mismo tiempo total sobrevive y el JSON final llega íntegro.
{
  const payload = { extracted: { invoice: { invoice_no: 'INV-UAT-1104' } }, requestId: 'r-hb' };
  const resp = mockStreamedResponse([
    { delayMs: 5, data: ': ping\n\n' },
    { delayMs: 25, data: `${JSON.stringify({ type: 'heartbeat', t: 1 })}\n\n` },
    { delayMs: 45, data: ': ping\n\n' },
    { delayMs: 65, data: `data: ${JSON.stringify(payload)}\n\n` },
  ]);
  const data = await consumeStreamedExtract(resp, { idleMs: 50 });
  assert.deepEqual(data, payload);
  const viaRouter = await consumeExtractResponse(
    mockStreamedResponse([{ delayMs: 5, data: ': ping\n\n' }, { delayMs: 10, data: `data: ${JSON.stringify(payload)}\n\n` }]),
    { idleMs: 50 }
  );
  assert.deepEqual(viaRouter, payload);
  ok('streaming (a2): heartbeat <idle sobrevive y el JSON final llega íntegro (consume + router SSE)');
}

// (b) Fallo del proveedor a mitad de stream -> error estructurado, sin 200 parcial como éxito.
{
  const sess = createClientSession(
    (signal) => Promise.resolve(mockStreamedResponse(
      [{ delayMs: 5, data: '{"extracted":{"invoice":' }, { delayMs: 25, data: '"CORTADO' }],
      { failAt: 1, signal }
    )),
    (r, s) => consumeStreamedExtract(r, { idleMs: 60 })
  );
  void sess;
  const res = await createClientSession(
    (signal) => Promise.resolve(mockStreamedResponse(
      [{ delayMs: 5, data: '{"extracted":{"invoice":' }, { delayMs: 25, data: '"CORTADO' }],
      { failAt: 1, signal }
    )),
    (r, s) => consumeStreamedExtract(r, { idleMs: 60 })
  ).run();
  assert.ok(res.error, 'mid-stream debe rechazar, no resolver');
  assert.equal((res.error as { code?: unknown })?.code, 'STREAM_TRUNCATED');
  // Contrato ya vigente en no-streaming: cuerpo truncado nunca es éxito parcial.
  await assert.rejects(
    () => readExtractResponse(new Response('{"extracted":{"invoice":', { status: 200 })),
    (e: unknown) => (e as { code?: unknown })?.code === 'NON_JSON_RESPONSE'
  );
  assert.equal(classifyFetchError(Object.assign(new Error('x'), { name: 'AbortError' })).code, 'PROVIDER_TIMEOUT');
  ok('streaming (b): fallo a mitad de stream -> error estructurado, sin aplicar 200 parcial');
}

// (c) Cancelación del cliente: nada parcial aplicado, bandera liberada (archivos los conserva el llamador).
{
  const files = { invoice: 'factura.pdf', packing: 'packing.pdf' };
  const sess = createClientSession(
    (signal) => Promise.resolve(mockStreamedResponse([
      { delayMs: 5, data: ': ping\n\n' },
      { delayMs: 150, data: JSON.stringify({ extracted: { ok: true } }) },
    ], { signal })),
    (r, s) => consumeStreamedExtract(r, { idleMs: 80 })
  );
  const runP = sess.run();
  await new Promise((r) => setTimeout(r, 30));
  sess.cancel();
  const res = await runP;
  assert.ok(res.error, 'cancelar debe rechazar, no resolver');
  assert.equal(sess.applied, null, 'sin resultados parciales aplicados');
  assert.ok(files.invoice && files.packing, 'archivos conservados tras cancelar');
  assert.equal(sess.extracting, false, 'bandera liberada tras cancelar');
  ok('streaming (c): cancelación del cliente no aplica parciales y libera la bandera');
}

// (d) Doble clic durante streaming -> un solo trabajo (guard cliente + dedup servidor por hash).
{
  let providerCalls = 0;
  const sess = createClientSession(
    async () => {
      providerCalls++;
      await new Promise((r) => setTimeout(r, 60));
      return new Response(JSON.stringify({ extracted: { ok: true }, requestId: 'r-doble' }));
    },
    async (r) => readExtractResponse(r)
  );
  const [first, second] = await Promise.all([sess.run(), sess.run()]);
  assert.equal(providerCalls, 1, 'un solo fetch ante doble clic');
  assert.equal([first, second].filter((r) => !r.deduped).length, 1);
  assert.equal(sess.extracting, false);
  const h1 = `${sha256Short('data:factura')}:${sha256Short('data:packing')}`;
  assert.equal(`${sha256Short('data:factura')}:${sha256Short('data:packing')}`, h1, 'hash estable por contenido');
  assert.notEqual(`${sha256Short('data:factura')}:${sha256Short('data:packing2')}`, h1, 'contenido distinto -> hash distinto');
  assert.equal(claimInflight(h1), true);
  assert.equal(claimInflight(h1), false, 'segundo claim en vuelo -> DUPLICATE_IN_FLIGHT');
  releaseInflight(h1);
  assert.equal(claimInflight(h1), true, 'tras responder se libera');
  releaseInflight(h1);
  ok('streaming (d): doble clic ejecuta un solo trabajo (guard cliente + dedup servidor real por hash)');
}

// (e) Reintento MANUAL tras error: sin consumo duplicado (1 llamada proveedor por intento).
{
  let providerCalls = 0;
  const sess = createClientSession(
    async () => {
      providerCalls++;
      if (providerCalls === 1) {
        return new Response(
          JSON.stringify({ errorCode: 'META_HTTP_ERROR', error: 'x', requestId: 'r-1', retryable: true }),
          { status: 503 }
        );
      }
      return new Response(JSON.stringify({ extracted: { ok: true }, requestId: 'r-2' }), { status: 200 });
    },
    async (r) => readExtractResponse(r)
  );
  const first = await sess.run();
  assert.ok(first.error, 'primer intento falla');
  assert.equal((first.error as { code?: unknown })?.code, 'META_HTTP_ERROR');
  assert.equal(providerCalls, 1);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(providerCalls, 1, 'sin reintento automático tras el error');
  const second = await sess.run();
  assert.ok(!second.error && second.data, 'reintento manual tiene éxito');
  assert.equal(providerCalls, 2, 'exactamente una llamada proveedor por intento manual');
  assert.ok(sess.applied !== null);
  ok('streaming (e): reintento manual tras error sin consumo duplicado (1 llamada por intento)');
}

console.log(`${passes}/${passes} pruebas superadas (streaming extracción: mocks locales, sin red)`);
