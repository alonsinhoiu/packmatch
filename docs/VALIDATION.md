# Validation and scope

## Reproducible checks

`npm run test:qa` runs 53 checks: 20 spreadsheet import cases, 5 comparison presentation cases, 8 workspace validation cases and 9 localization checks covering dictionary keys, interpolation, number formatting, persistence and localized messages, plus 11 multilingual extraction normalization checks using simulated responses.

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
