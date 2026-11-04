# Validation and scope

## Reproducible checks

`npm run test:qa` runs 74 checks: 20 spreadsheet import cases, 5 comparison presentation cases, 8 workspace validation cases, 9 localization checks, 11 multilingual extraction normalization checks using simulated responses, 14 shipment-review regressions, and 7 streaming-response checks. The shipment-review regressions cover shared cartons and weights, unit conversion explanations, import-column order, CSV finding states, extraction response handling, and visual grounding. Their synthetic fixture is included at `scripts/fixtures/uat-2026-11-04-case.json`; the suite does not require private working files or an API key. The streaming checks use local mocks, not live provider calls.

`npm run verify-parity` loads the seven synthetic fixture directories in `work/prueba-packmatch/cases/`, reconciles their ground truth inputs and compares findings by code, SKU and origin set. It then repeats the comparison using recorded extraction payloads in `work/prueba-packmatch/results/summary_api.json`. Finally it checks operator confirmation of the C06 conversion factor.

Expected result: 13/13 findings and exact origin sets in each of the two passes, with zero extra alerts. The recorded-API pass replays stored output; it is not a fresh model evaluation. No API key is required for these checks.

## Dataset

| Case | Scenario |
| --- | --- |
| C01 | Matching documents with asymmetric row grouping |
| C02 | Quantity and line amount discrepancies |
| C03 | Weight discrepancies and pounds |
| C04 | Pieces versus sets without a conversion factor |
| C05 | Ambiguous SKU alias and undeclared sample |
| C06 | Dense tables, shared cells and operator-confirmed conversion |
| C07 | Commercial-style columns without explicit row IDs |

The cases are synthetic. Images/PDFs, structured reference data and expected findings are published together so results can be inspected. The model output is fallible even though reconciliation rules are deterministic.

## Streaming extraction

After validating both files, `POST /api/extract` opens an SSE response with an initial comment and heartbeat comments every 10 seconds. The complete result or structured error arrives in a final JSON data frame. Early validation failures retain ordinary JSON responses and HTTP error statuses. The client waits for the final payload before applying data; an opened HTTP 200 stream alone is not extraction success, and a truncated stream produces a localized error while preserving the files. Streaming addresses inactivity during the wait; it does not remove the provider or client time budgets or guarantee provider availability.

## Public deployment check — November 4, 2026 (before streaming)

The updated public site completed one real extraction from synthetic PNG documents with 14 physical cartons, 34 kg net and 49 kg gross. It found the four prepared issues; confirming 12 pieces per set left three. Source highlights, the supplier memo and the exported CSV were checked. Spreadsheet import, editing and undo were tested separately in the public interface.

Both PDF uploads loaded successfully, but two browser extraction attempts received a non-JSON response. A separate direct API check using rasterized PDFs returned HTTP 504 with an HTML `Inactivity Timeout` response after 30.82 seconds. The exact intermediary responsible has not been established. These observations do not demonstrate general extraction reliability; the slower public request path remains unresolved even though the deterministic checks pass.

Live extraction sends separate invoice and packing-list requests to the provider in parallel, normally two provider calls per submission. There are no automatic retries. Client-side single-flight and server-side in-flight deduplication reduce duplicate submissions, but the server guard is in memory per instance and does not guarantee deduplication across serverless instances.

## Limits

- Seven examples are a regression dataset, not an independent large-scale accuracy study.
- OCR can miss or misread rows, values and bounding boxes. Inspect extracted data before relying on a finding.
- The PDF workflow is oriented toward individual pages; arbitrary multi-page shipments are not fully supported.
- Unit conversions require explicit evidence or operator confirmation.
- Reconciliation is a review aid. It does not certify regulatory compliance or authorize customs clearance.
- API cost and latency vary with document size, provider availability and pricing. This repository does not promise a fixed cost or runtime.
- In-memory rate limiting is local to a server process. The prototype has no authentication or persistent shipment database.

## Publication provenance

The first Git commit is a source snapshot of an existing hackathon working directory. Its timestamp records publication, not the dates on which each feature was developed. Local research notes, credentials, deployment state and raw video editing files are excluded.
