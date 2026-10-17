// Stable error codes (section K). Never rename an existing code.
export const ERRORS = {
  INVALID_REQUEST: "The request is malformed or a field is invalid.",
  PAYMENT_BELOW_MINIMUM: "Payment amount is below the $0.001 minimum.",
  RECEIVER_TOKEN_ACCOUNT_MISSING:
    "The payee token account or the treasury USDC account does not exist. Accounts are never created inside a payment.",
  SIMULATION_FAILED: "Transaction simulation failed.",
  QUOTE_EXPIRED: "The quote has expired or was already used. Request a new quote.",
  QUOTE_INVALID: "The quote signature does not match the m2m.monster service key.",
  RATE_LIMITED: "Too many requests. Retry later.",
  MINT_NOT_ALLOWED: "The token mint is not in the whitelist for this network.",
  FEE_BALANCE_INSUFFICIENT_USDC:
    "The payer does not hold enough USDC to pay the fee. The fee is always paid in USDC.",
  PAYMENT_TRANSACTION_INVALID:
    "The transaction is not the m2m-split transaction described by the quote.",
  TRANSACTION_FAILED: "The transaction failed on-chain or was not confirmed in time.",
  RECEIPT_INVALID:
    "The receipt is not signed by the m2m.monster service key or does not match the transaction on-chain.",
  NOT_FOUND: "Not found.",
  UNAUTHORIZED: "Missing or invalid api_key.",
  CHALLENGE_INVALID:
    "The registration challenge is missing, expired, already used, or not signed by this public key.",
  IDEMPOTENCY_KEY_REUSED: "The idempotency key was already used for a different request.",
  INTERNAL_ERROR: "Internal error. Retry later.",
  PAYMENT_STATUS_UNKNOWN:
    "The status of a signed payment could not be determined. Do not pay again; retry later.",
} as const;

export type ErrorCode = keyof typeof ERRORS;

export class M2mError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string = ERRORS[code]) {
    super(message);
    this.name = "M2mError";
    this.code = code;
  }
}
