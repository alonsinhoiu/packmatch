import { NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeExtractedPayload,
  validateDataUrlAndMagicBytes,
} from "@/lib/normalize-extracted";

function normalizeToImageDataUrl(dataUrl: string): string {
  if (!dataUrl.startsWith("data:application/pdf;base64,")) {
    return dataUrl;
  }
  try {
    const b64 = dataUrl.slice("data:application/pdf;base64,".length);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "packmatch-pdf-"));
    const pdfPath = path.join(tmpDir, "doc.pdf");
    const pngPath = path.join(tmpDir, "doc.png");
    fs.writeFileSync(pdfPath, Buffer.from(b64, "base64"));

    // Rasterize at 150 DPI on every platform. The macOS default PDF preview
    // can be below 500px wide, making decimal digits hard for OCR to distinguish.
    try {
      const prefix = path.join(tmpDir, "out");
      execFileSync("pdftoppm", ["-png", "-singlefile", "-r", "150", "-f", "1", "-l", "1", pdfPath, prefix], { stdio: "ignore" });
      fs.renameSync(`${prefix}.png`, pngPath);
    } catch {
      if (os.platform() === "darwin") {
        try {
          execFileSync("sips", ["-s", "format", "png", pdfPath, "--out", pngPath], { stdio: "ignore" });
        } catch {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          return dataUrl;
        }
      } else {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return dataUrl;
      }
    }

    if (fs.existsSync(pngPath)) {
      const pngB64 = fs.readFileSync(pngPath).toString("base64");
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return `data:image/png;base64,${pngB64}`;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return dataUrl;
  } catch {
    return dataUrl;
  }
}

const EXTRACTION_SYSTEM_PROMPT = `You are a deterministic customs document extractor.
Extract the exact structured data from the provided Commercial Invoice image and Packing List image.
Rules:
1. If the document prints explicit Line IDs (e.g. INV-L1) or Row IDs (e.g. PL-R1), preserve them. If the document uses real-world commercial columns without INV-L*/PL-R* IDs (e.g., Item #, Pos, or no index column), assign sequential IDs "INV-L1", "INV-L2", ... and "PL-R1", "PL-R2", ... in top-to-bottom table row order.
2. Map real-world column synonyms: P/N, Part No., Item Code, Model -> \`sku\`; Q'ty, Quantity -> \`qty\` or \`total_qty\`; U/M, UOM -> \`unit\`; N.W., Net Wt -> \`net_weight\`; G.W., Gross Wt -> \`gross_weight\`; Ctn No., Box No., Pallet/Box -> \`carton_range\`.
3. Do NOT perform unit conversions during extraction. Copy the unit shown in the row (normalizing PC/PCS/EA -> PCS, SET/SETS/KIT/KITS -> SETS, KG/KGS -> KG, LB/LBS -> LBS).
4. Only populate \`explicit_pcs_per_set\` (as a number, e.g. 2) if the document explicitly states a conversion ratio in the description or notes (e.g. '1 SET = 2 PCS' or '1 KIT = 6 PCS'). If no ratio is explicitly written on the document, set \`explicit_pcs_per_set\` to null.
5. If a Packing List row shows '(Shared)' in the Cartons column or shares the exact same carton/box number as a previous row, set \`carton_count\` to 0 and \`shared_carton\` to true.
6. If a row has 0 quantity and is packaging material (e.g., SPARE-FOAM, PALLET), set \`is_packaging_only\` to true.
7. For each invoice line and packing list row, include \`bbox\`: [ymin, xmin, ymax, xmax] in 0..1000 normalized image coordinates covering that row on the page. Also include \`header_bbox\`: [ymin, xmin, ymax, xmax] for the header/totals summary block.
Return ONLY valid JSON matching the requested schema.`;

function loadApiKeySafely(): string | null {
  const envVal = (process.env.MODEL_API_KEY || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  if (envVal && envVal !== "LLM_tu_clave_aqui") {
    return envVal;
  }
  const dotenvPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(dotenvPath)) {
    const lines = fs.readFileSync(dotenvPath, "utf-8").split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim().replace(/^export\s+/, "");
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const [k, ...rest] = line.split("=");
      if (k.trim() === "MODEL_API_KEY") {
        const val = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
        if (val && val !== "LLM_tu_clave_aqui") return val;
      }
    }
  }
  return null;
}

function redactSecret(text: string, secret: string | null): string {
  if (!text) return text;
  if (secret && secret.length >= 4 && text.includes(secret)) {
    return text.split(secret).join("[REDACTED_API_KEY]");
  }
  return text;
}

// Rate-limit en memoria con ventana deslizante: máximo 10 solicitudes por
// minuto por IP (las extracciones legítimas son de baja frecuencia).
// Limitación conocida: en serverless cada instancia lleva su propio contador
// en memoria, así que esto frena el abuso casual (quemar la cuota de
// muse-spark-1.3) pero no constituye protección contra DDoS distribuido;
// para eso haría falta un store compartido (Redis/Upstash).
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitBuckets = new Map<string, number[]>();

// Tope temprano del body JSON total ANTES de parsearlo (primera barrera; la
// segunda es validateDataUrlAndMagicBytes con MAX_UPLOAD_BYTES = 4 MB por
// archivo tras el parseo):
// 2 archivos x 4 MiB (4_194_304 B) x 4/3 (sobrecarga base64 ~33%) =
// 11_184_811 B (~10,67 MiB) + margen para el envoltorio JSON y los prefijos
// "data:<mime>;base64,". Se redondea a 12 MiB (12_582_912 B) para no dar
// falsos positivos en documentos legítimos al límite y seguir frenando
// cuerpos claramente sobredimensionados sin bufferizar/parsear el body.
const MAX_JSON_BODY_BYTES = 12 * 1024 * 1024; // 12 MiB = 12_582_912 B

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  // Fallback "unknown": se aplica un bucket global conservador compartido
  // (no se bloquea todo, solo se limita ese bucket a 10/min como el resto).
  return "unknown";
}

function checkExtractRateLimit(ip: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  // Purga entradas de la ventana expiradas en cada chequeo para no crecer
  // en memoria; elimina buckets vacíos.
  for (const [key, timestamps] of rateLimitBuckets) {
    const fresh = timestamps.filter((t) => t > windowStart);
    if (fresh.length === 0) {
      rateLimitBuckets.delete(key);
    } else if (fresh.length !== timestamps.length) {
      rateLimitBuckets.set(key, fresh);
    }
  }
  const bucketKey = ip || "unknown";
  const hits = rateLimitBuckets.get(bucketKey) ?? [];
  if (hits.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldest = hits[0];
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000)
    );
    return { allowed: false, retryAfterSeconds };
  }
  hits.push(now);
  rateLimitBuckets.set(bucketKey, hits);
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function POST(req: Request) {
  // Frenazo temprano anti-DoS: si el cliente declara Content-Length por encima
  // del tope, se rechaza con 413 SIN llamar a `await req.json()` (evita
  // bufferizar/parsear un body gigante). Si el header falta (chunked), se sigue
  // el flujo actual y la validación de 4 MB por archivo tras el parseo actúa
  // como segunda barrera.
  const contentLengthRaw = req.headers.get("content-length");
  if (contentLengthRaw !== null) {
    const contentLength = Number.parseInt(contentLengthRaw, 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
      return NextResponse.json(
        {
          errorCode: "PAYLOAD_TOO_LARGE",
          error:
            "El cuerpo de la solicitud supera el límite de 12 MB (2 documentos de hasta 4 MB cada uno en base64). Reduce el tamaño de los documentos e inténtalo de nuevo.",
        },
        { status: 413 }
      );
    }
  }

  const apiKey = loadApiKeySafely();
  if (!apiKey) {
    return NextResponse.json(
      {
        errorCode: "MISSING_API_KEY",
        error:
          "MODEL_API_KEY no está configurada en el servidor (.env). No se pueden realizar extracciones en vivo.",
      },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { invoiceDataUrl, packingListDataUrl } = body;

    if (!invoiceDataUrl || !packingListDataUrl) {
      return NextResponse.json(
        {
          errorCode: "MISSING_DOCUMENTS",
          error:
            "Se requieren tanto la imagen de Commercial Invoice como la de Packing List.",
        },
        { status: 400 }
      );
    }

    const invCheck = validateDataUrlAndMagicBytes(
      invoiceDataUrl,
      "Commercial Invoice"
    );
    if (!invCheck.valid) {
      return NextResponse.json({ errorCode: "INVALID_INVOICE_FILE", error: invCheck.error }, { status: 422 });
    }
    const plCheck = validateDataUrlAndMagicBytes(
      packingListDataUrl,
      "Packing List"
    );
    if (!plCheck.valid) {
      return NextResponse.json({ errorCode: "INVALID_PACKING_FILE", error: plCheck.error }, { status: 422 });
    }

    // Rate-limit ANTES de consumir la API de Meta (cada llamada cuesta
    // ~$0.013 y tarda 12-20 s): si se excede, 429 sin hacer fetch.
    const clientIp = getClientIp(req);
    const rate = checkExtractRateLimit(clientIp);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          errorCode: "RATE_LIMITED",
          error: `Demasiadas solicitudes. Has superado el límite de 10 extracciones por minuto. Inténtalo de nuevo en ${rate.retryAfterSeconds} segundos.`,
          retryAfterSeconds: rate.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfterSeconds) },
        }
      );
    }

    const normalizedInvUrl = normalizeToImageDataUrl(invoiceDataUrl);
    const normalizedPlUrl = normalizeToImageDataUrl(packingListDataUrl);

    const t0 = performance.now();

    const payload = {
      model: "muse-spark-1.3",
      temperature: 0.0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Extract the Commercial Invoice and Packing List tables into JSON with keys " +
                "`invoice` (fields: invoice_no, incoterm, currency, declared_total_amount, " +
                "declared_total_net_kg, declared_total_gross_kg, declared_total_cartons, header_bbox, lines: " +
                "[{line_id, sku, description, qty, unit, unit_price, line_amount, explicit_pcs_per_set, bbox}]) " +
                "and `packing_list` (fields: packing_list_no, incoterm, declared_total_cartons, " +
                "declared_total_net_kg, declared_total_gross_kg, header_bbox, rows: " +
                "[{row_id, carton_range, carton_count, sku, qty_per_carton, total_qty, unit, " +
                "net_weight, gross_weight, weight_unit, shared_carton, explicit_pcs_per_set, is_packaging_only, bbox}]).",
            },
            { type: "image_url", image_url: { url: normalizedInvUrl } },
            { type: "image_url", image_url: { url: normalizedPlUrl } },
          ],
        },
      ],
    };

    const metaResp = await fetch("https://api.meta.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "PackMatchApp/1.0",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000), // Timeout defensivo de 45s
    });

    if (!metaResp.ok) {
      const errText = await metaResp.text();
      const safeErr = redactSecret(errText.slice(0, 400), apiKey);
      return NextResponse.json(
        { errorCode: "META_HTTP_ERROR", status: metaResp.status, detail: safeErr, error: `Error HTTP ${metaResp.status} desde Meta API: ${safeErr}` },
        { status: metaResp.status }
      );
    }

    const respJson = await metaResp.json();
    const choice = respJson.choices?.[0];
    if (!choice) {
      return NextResponse.json({ errorCode: "META_EMPTY_CHOICE", error: "No response choice returned by Meta Model API" }, { status: 502 });
    }

    if (choice.finish_reason === "length") {
      return NextResponse.json(
        { errorCode: "TRUNCATED_OUTPUT", error: "Document is too dense; output was truncated by model token limits. Please split multi-page shipments." },
        { status: 422 }
      );
    }

    const latencySeconds = Number(
      ((performance.now() - t0) / 1000).toFixed(2)
    );

    let rawContent: string =
      respJson?.choices?.[0]?.message?.content || "{}";
    rawContent = redactSecret(rawContent, apiKey).trim();
    if (rawContent.startsWith("```")) {
      rawContent = rawContent
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
    }

    const extracted = normalizeExtractedPayload(JSON.parse(rawContent));
    const usage = respJson?.usage || {};
    const inTok = Number(usage.prompt_tokens || usage.input_tokens || 1600);
    const outTok = Number(
      usage.completion_tokens || usage.output_tokens || 2500
    );
    const estimatedCallCostUsd = Number(
      ((inTok / 1_000_000) * 1.25 + (outTok / 1_000_000) * 4.25).toFixed(5)
    );

    return NextResponse.json({
      extracted,
      usage,
      latency_seconds: latencySeconds,
      estimated_call_cost_usd: estimatedCallCostUsd,
      normalizedInvoiceDataUrl: normalizedInvUrl,
      normalizedPackingListDataUrl: normalizedPlUrl,
    });
  } catch (err: any) {
    const safeMsg = redactSecret(String(err?.message || err), apiKey);
    return NextResponse.json(
      { errorCode: "EXTRACTION_FAILED", detail: safeMsg, error: `Fallo en extracción: ${safeMsg}` },
      { status: 500 }
    );
  }
}
