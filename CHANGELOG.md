# Changelog

## 1.1.0 (not published yet)

Packages: `@m2m-monster/core`, `@m2m-monster/sdk`, `@m2m-monster/mcp` and PyPI `m2m-monster`, all
1.1.0 (previous: core and sdk 0.1.0, mcp 0.1.1, PyPI 0.1.0).

- **Mainnet.** API `https://api.m2m.monster`, agent docs `https://m2m.monster/llms.txt`. The free
  Devnet sandbox stays at `https://sandbox.m2m.monster`.
- **Payers never pay twice for one request.** `createPaymentFetch` (TS) and `PaymentClient`
  (Python) keep each signed payment until its outcome is known and resend it on retry instead of
  paying again. They decide from the seller's answer, a verified receipt and the chain. Read the
  outcome with `paymentOutcome(response)` / `payment_outcome(response)`: `paid`, `already_paid` or
  `not_paid`. Concurrent calls for the same request share one attempt. Pending payments live in
  memory only: after a restart, check the chain before paying again.
- **New error code `PAYMENT_STATUS_UNKNOWN`**, raised by the payer SDKs when a payment's outcome
  cannot be determined; the payment stays pending and nothing is paid. No code was renamed.
- **Paywalls (TS and Python):** a resent `PAYMENT-SIGNATURE` never unlocks the resource again; it
  gets `402` with `errorReason: "QUOTE_EXPIRED"`, the original transaction and its receipt.
- **TS verifier:** exact instruction data lengths, as the Python verifier already enforced.
- **TS:** `PaidQuote` gains `lastValidBlockHeight`.
- **MCP stdio:** `M2M_API_URL` now defaults to `https://api.m2m.monster` (before: the Devnet
  sandbox). Set `M2M_API_URL=https://sandbox.m2m.monster` to keep using Devnet.
- **Python:** the docstring wording on keys and signing matches the other packages; the sdist no
  longer contains the tests.
