import fs from "node:fs";
import path from "node:path";
import { reconcileShipment } from "../src/lib/reconcile.ts";

const rootDir = process.cwd();
const casesDir = path.join(rootDir, "work/prueba-packmatch/cases");
const summaryApiPath = path.join(
  rootDir,
  "work/prueba-packmatch/results/summary_api.json"
);

function evaluateFindings(
  obtained: Array<{ code: string; sku: string; origins: string[] }>,
  expected: Array<{ code: string; sku: string; origins: string[] }>
) {
  const expMap = new Map<string, Set<string>>();
  for (const f of expected) {
    expMap.set(`${f.code}::${f.sku}`, new Set(f.origins));
  }
  const obtMap = new Map<string, Set<string>>();
  for (const f of obtained) {
    obtMap.set(`${f.code}::${f.sku}`, new Set(f.origins));
  }

  let hits = 0;
  let originAccurateHits = 0;
  let falseAlerts = 0;

  for (const [k, expOrigins] of expMap.entries()) {
    const obtOrigins = obtMap.get(k);
    if (obtOrigins) {
      hits++;
      const sameSize = expOrigins.size === obtOrigins.size;
      const allPresent = Array.from(expOrigins).every((o) => obtOrigins.has(o));
      if (sameSize && allPresent) {
        originAccurateHits++;
      }
    }
  }

  for (const k of obtMap.keys()) {
    if (!expMap.has(k)) {
      falseAlerts++;
    }
  }

  return {
    expectedCount: expMap.size,
    hits,
    originAccurateHits,
    falseAlerts,
  };
}

console.log("=== 1. VERIFICACIÓN DE PARIDAD TYPESCRIPT VS GROUND TRUTH (C01-C07) ===");
const caseDirs = fs
  .readdirSync(casesDir)
  .map((name) => path.join(casesDir, name))
  .filter((p) => fs.statSync(p).isDirectory())
  .sort();

let totalExpected = 0;
let totalHits = 0;
let totalOriginHits = 0;
let totalFalseAlerts = 0;

for (const cdir of caseDirs) {
  const gt = JSON.parse(
    fs.readFileSync(path.join(cdir, "ground_truth.json"), "utf-8")
  );
  const res = reconcileShipment(gt.invoice, gt.packing_list);
  const ev = evaluateFindings(res.findings, gt.expected_findings);
  totalExpected += ev.expectedCount;
  totalHits += ev.hits;
  totalOriginHits += ev.originAccurateHits;
  totalFalseAlerts += ev.falseAlerts;
  console.log(
    `[${gt.case_id}] esp=${ev.expectedCount} aciertos=${ev.hits} (origen=${ev.originAccurateHits}) falsas_alertas=${ev.falseAlerts}`
  );
}

if (
  totalHits !== totalExpected ||
  totalOriginHits !== totalExpected ||
  totalFalseAlerts !== 0
) {
  throw new Error("Fallo de paridad en Ground Truth");
}

console.log(
  "\n=== 2. VERIFICACIÓN DE PARIDAD SOBRE EXTRACCIONES REALES DE MUSE SPARK 1.3 ==="
);
const apiResults = JSON.parse(fs.readFileSync(summaryApiPath, "utf-8"));
let apiExpected = 0;
let apiHits = 0;
let apiOriginHits = 0;
let apiFalseAlerts = 0;
for (const rec of apiResults) {
  const gt = JSON.parse(
    fs.readFileSync(
      path.join(casesDir, rec.case_id, "ground_truth.json"),
      "utf-8"
    )
  );
  const res = reconcileShipment(
    rec.extracted_raw.invoice,
    rec.extracted_raw.packing_list
  );
  const ev = evaluateFindings(res.findings, gt.expected_findings);
  apiExpected += ev.expectedCount;
  apiHits += ev.hits;
  apiOriginHits += ev.originAccurateHits;
  apiFalseAlerts += ev.falseAlerts;
  console.log(
    `[${rec.case_id} API] esp=${ev.expectedCount} aciertos=${ev.hits} (origen=${ev.originAccurateHits}) falsas_alertas=${ev.falseAlerts}`
  );
  if (
    ev.hits !== ev.expectedCount ||
    ev.originAccurateHits !== ev.expectedCount ||
    ev.falseAlerts !== 0
  ) {
    throw new Error(`Fallo de paridad en extracción real de ${rec.case_id}`);
  }
}

console.log(
  "\n=== 3. VERIFICACIÓN DE RESOLUCIÓN DE AMBIGÜEDAD POR OPERADOR (CA-2) ==="
);
const c06Rec = apiResults.find((r: any) =>
  r.case_id.startsWith("C06")
).extracted_raw;
const c06Clone = structuredClone(c06Rec);
const line806 = c06Clone.invoice.lines.find((l: any) => l.sku === "SKU-806");
line806.operator_pcs_per_set = 5; // 90 SETS * 5 = 450 PCS (concilia PL-R11)
const resAfterOperator = reconcileShipment(
  c06Clone.invoice,
  c06Clone.packing_list
);
const remainingCodes = resAfterOperator.findings.map(
  (f) => `${f.code}:${f.sku}`
);
console.log(
  "Hallazgos en C06 tras confirmar 1 SET = 5 PCS en SKU-806:",
  remainingCodes
);
if (
  remainingCodes.length !== 1 ||
  remainingCodes[0] !== "QTY_MISMATCH:SKU-804"
) {
  throw new Error("Fallo en resolución manual de ambigüedad CA-2");
}

console.log(
  `\nPARIDAD 100% VERIFICADA (GT ${totalHits}/${totalExpected} + API ${apiHits}/${apiExpected} aciertos, ${totalOriginHits + apiOriginHits}/${totalExpected + apiExpected} orígenes exactos, ${totalFalseAlerts + apiFalseAlerts} falsas alertas, $0.00 API).`
);
