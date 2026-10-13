// Shared constants (spec/test-vectors/constants.json) so other SDKs can prove they enforce the
// same values. Regenerate with UPDATE_VECTORS=1 after a deliberate change.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { AGENT_FEE, MIN_PAYMENT, QUOTE_TTL_SECONDS, REFERRAL, USD_UNITS } from "./constants.js";
import { ERRORS } from "./errors.js";
import { NETWORKS } from "./networks.js";
import { REFUND_MEMO_PREFIX } from "./refund.js";
import { MAX_COMPUTE_UNIT_PRICE, MEMO_PREFIX, MEMO_PROGRAM } from "./split.js";
import { M2M_SPLIT, X402_VERSION } from "./x402.js";

const FILE = new URL("../../../spec/test-vectors/constants.json", import.meta.url);

it("matches spec/test-vectors/constants.json", () => {
  const constants = {
    description: "Constants enforced by core. Integers are strings of base units.",
    usd_units: USD_UNITS,
    agent_fee: AGENT_FEE,
    min_payment: MIN_PAYMENT,
    referral: REFERRAL,
    quote_ttl_seconds: QUOTE_TTL_SECONDS,
    max_compute_unit_price: MAX_COMPUTE_UNIT_PRICE,
    memo: { program: MEMO_PROGRAM, prefix: MEMO_PREFIX, refund_prefix: REFUND_MEMO_PREFIX },
    x402: { version: X402_VERSION, scheme: M2M_SPLIT },
    networks: NETWORKS,
    errors: ERRORS,
  };
  const json = `${JSON.stringify(constants, (_k, v) => (typeof v === "bigint" ? `${v}` : v), 2)}\n`;
  if (process.env.UPDATE_VECTORS || !existsSync(FILE)) writeFileSync(FILE, json);
  expect(readFileSync(FILE, "utf8")).toBe(json);
});
