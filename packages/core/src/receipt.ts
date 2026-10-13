// Verifiable receipts (sections 0, C, G; decisions D8, D14): one per settlement, signed by the
// service key as a compact JWS (EdDSA), linked to the on-chain transaction signature.
import {
  type Address,
  getAddressEncoder,
  getBase58Decoder,
  getPublicKeyFromAddress,
  getUtf8Encoder,
  type SignatureBytes,
  signBytes,
  verifySignature,
} from "@solana/kit";
import { M2mError } from "./errors.js";
import type { Network } from "./networks.js";
import type { Quote } from "./quote.js";

export interface Receipt {
  version: 1;
  /** Quote id; the same id is in the transaction memo. */
  id: string;
  network: Network;
  /** Base58 transaction signature on-chain. */
  transaction: string;
  payer: string;
  payee: string;
  mint: string;
  decimals: number;
  amount: string;
  payee_amount: string;
  usdc_mint: string;
  usdc_decimals: number;
  treasury: string;
  fee_gross: string;
  discount: string;
  fee_net: string;
  issued_at: number;
  referral: string;
}

export function receiptFromQuote(
  quote: Quote,
  settlement: { payer: string; transaction: string; issuedAt: number },
): Receipt {
  return {
    version: 1,
    id: quote.id,
    network: quote.network,
    transaction: settlement.transaction,
    payer: settlement.payer,
    payee: quote.payee,
    mint: quote.mint,
    decimals: quote.decimals,
    amount: quote.amount,
    payee_amount: quote.payee_amount,
    usdc_mint: quote.usdc_mint,
    usdc_decimals: quote.usdc_decimals,
    treasury: quote.treasury,
    fee_gross: quote.fee_gross,
    discount: quote.discount,
    fee_net: quote.fee_net,
    issued_at: settlement.issuedAt,
    referral: quote.referral,
  };
}

/** did:key of an ed25519 public key: multibase base58btc of 0xed01 + key bytes. */
export function didKey(address: string): string {
  const key = getAddressEncoder().encode(address as Address);
  return `did:key:z${getBase58Decoder().decode(new Uint8Array([0xed, 0x01, ...key]))}`;
}

const b64url = (bytes: ArrayLike<number>) =>
  Buffer.from(Uint8Array.from(bytes)).toString("base64url");
const fromB64url = (text: string) => new Uint8Array(Buffer.from(text, "base64url"));

export async function signReceipt(
  receipt: Receipt,
  privateKey: Parameters<typeof signBytes>[0],
  serviceAddress: string,
): Promise<string> {
  const did = didKey(serviceAddress);
  const header = { alg: "EdDSA", typ: "JWT", kid: `${did}#${did.slice("did:key:".length)}` };
  const encode = (value: unknown) => b64url(getUtf8Encoder().encode(JSON.stringify(value)));
  const signingInput = `${encode(header)}.${encode(receipt)}`;
  const signature = await signBytes(privateKey, getUtf8Encoder().encode(signingInput));
  return `${signingInput}.${b64url(signature)}`;
}

/** Checks the service signature of a receipt JWS and returns its payload. */
export async function verifyReceiptSignature(
  jws: string,
  serviceAddress: string,
): Promise<Receipt> {
  const invalid = () => new M2mError("RECEIPT_INVALID");
  const parts = jws.split(".");
  if (parts.length !== 3) throw invalid();
  const [header, payload, signature] = parts as [string, string, string];
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64url").toString());
    const bytes = fromB64url(signature);
    if (parsed.alg !== "EdDSA" || bytes.length !== 64) throw invalid();
    const valid = await verifySignature(
      await getPublicKeyFromAddress(serviceAddress as Address),
      bytes as SignatureBytes,
      getUtf8Encoder().encode(`${header}.${payload}`),
    );
    if (!valid) throw invalid();
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as Receipt;
  } catch {
    throw invalid();
  }
}
