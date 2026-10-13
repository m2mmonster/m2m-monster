import { createRoute, z } from "@hono/zod-openapi";
import { ERRORS } from "@m2m-monster/core";
import { isAddress } from "@solana/kit";

const U64_MAX = 18_446_744_073_709_551_615n;

export const Pubkey = z
  .string()
  .refine((v): boolean => isAddress(v), "must be a base58 Solana public key")
  .openapi({ example: "9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu" });

export const BaseUnits = z
  .string()
  .regex(/^\d{1,20}$/, "must be an integer string of base units")
  .refine((v) => !/^\d+$/.test(v) || BigInt(v) <= U64_MAX, "must fit in u64")
  .openapi({ example: "10000000" });

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.enum(Object.keys(ERRORS) as [keyof typeof ERRORS]),
      message: z.string(),
    }),
  })
  .openapi("Error");

export const errorResponses = (...statuses: (400 | 401 | 404 | 409 | 410 | 429 | 500)[]) =>
  Object.fromEntries(
    statuses.map((s) => [
      s,
      { description: "Error", content: { "application/json": { schema: ErrorResponse } } },
    ]),
  );

export const errorsRoute = createRoute({
  method: "get",
  path: "/v1/errors",
  summary: "Stable error codes and their human-readable text",
  responses: {
    200: {
      description: "Error catalog",
      content: { "application/json": { schema: z.record(z.string(), z.string()) } },
    },
    ...errorResponses(429),
  },
});

export const serviceKeyRoute = createRoute({
  method: "get",
  path: "/v1/service-key",
  summary: "Public key that signs quotes and receipts. It never holds funds.",
  responses: {
    200: {
      description: "Service public key",
      content: { "application/json": { schema: z.object({ address: Pubkey }) } },
    },
    ...errorResponses(429),
  },
});
