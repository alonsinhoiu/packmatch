# Contributing to PackMatch

Bug reports and small, focused pull requests are welcome.

1. Describe the problem and how to reproduce it. Use synthetic shipment documents; never upload confidential supplier or customer data.
2. Install dependencies with `npm ci` on Node.js 22.18+.
3. Make a focused change and run `npm run test:qa`, `npm run verify-parity`, `npx tsc --noEmit` and `npm run build`.
4. Explain the resulting behavior and checks in your pull request.

Keep document extraction separate from reconciliation rules. Do not infer missing unit conversion factors or hide invalid rows. Include a regression case when changing reconciliation behavior.

Do not commit API keys, `.env` files or private shipment documents.
