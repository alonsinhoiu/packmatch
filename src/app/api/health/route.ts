import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

function hasApiKeyConfigured(): boolean {
  const envVal = (process.env.MODEL_API_KEY || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  if (envVal && envVal !== "LLM_tu_clave_aqui") return true;
  const dotenvPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(dotenvPath)) {
    const content = fs.readFileSync(dotenvPath, "utf-8");
    return /MODEL_API_KEY\s*=\s*['"]?LLM_[A-Za-z0-9_]+/.test(content);
  }
  return false;
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "packmatch-reconciliation-workbench",
    engine: "deterministic-ts-v1",
    model: "muse-spark-1.3",
    apiKeyConfigured: hasApiKeyConfigured(),
    timestamp: new Date().toISOString(),
  });
}
