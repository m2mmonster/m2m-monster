import { ERRORS, type ErrorCode, M2mError } from "@m2m-monster/core";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  INVALID_REQUEST: 400,
  PAYMENT_BELOW_MINIMUM: 400,
  MINT_NOT_ALLOWED: 400,
  PAYMENT_TRANSACTION_INVALID: 400,
  RECEIVER_TOKEN_ACCOUNT_MISSING: 400,
  SIMULATION_FAILED: 400,
  FEE_BALANCE_INSUFFICIENT_USDC: 400,
  RECEIPT_INVALID: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  CHALLENGE_INVALID: 400,
  IDEMPOTENCY_KEY_REUSED: 409,
  QUOTE_EXPIRED: 410,
  QUOTE_INVALID: 400,
  TRANSACTION_FAILED: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export const errorBody = (code: ErrorCode, message: string = ERRORS[code]) => ({
  error: { code, message },
});

export function errorResponse(c: Context, err: unknown) {
  if (err instanceof M2mError) return c.json(errorBody(err.code, err.message), STATUS[err.code]);
  console.error(err instanceof Error ? err.message : "unknown error");
  return c.json(errorBody("INTERNAL_ERROR"), 500);
}
