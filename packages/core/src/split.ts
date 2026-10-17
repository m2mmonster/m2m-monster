// m2m-split transaction (section G): one atomic transaction signed only by the payer.
//   0 SetComputeUnitLimit
//   1 SetComputeUnitPrice   (capped, decision D16)
//   2 TransferChecked payer -> payee     payeeAmount, payment token
//   3 TransferChecked payer -> treasury  feeNet, USDC
//   4 Memo "settled via m2m.monster <receiptId>"
import {
  type Address,
  appendTransactionMessageInstructions,
  type Blockhash,
  compileTransaction,
  createTransactionMessage,
  decompileTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getUtf8Decoder,
  type Instruction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  type Transaction,
  verifySignature,
} from "@solana/kit";
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
  parseSetComputeUnitLimitInstruction,
  parseSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { getAddMemoInstruction } from "@solana-program/memo";
import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  parseTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { M2mError } from "./errors.js";
import { allowedMint, NETWORKS, type Network } from "./networks.js";

/** Maximum compute unit price: 5 lamports per compute unit, in micro-lamports (D16). */
export const MAX_COMPUTE_UNIT_PRICE = 5_000_000n;

export const MEMO_PREFIX = "settled via m2m.monster";

/** SPL Memo v2: immutable (BPF loader 2), the memo program x402 `exact` uses (D38). */
export const MEMO_PROGRAM =
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" as Address<"MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr">;

export const splitMemo = (receiptId: string) => `${MEMO_PREFIX} ${receiptId}`;

/** What the quote fixes; the payee checks the transaction against it. */
export interface SplitExpectation {
  network: Network;
  /** Payee wallet (owner of the destination token account). */
  payee: Address;
  /** Treasury wallet (owner of the treasury USDC account). */
  treasury: Address;
  paymentMint: Address;
  /** On-chain decimals of the payment mint. */
  paymentDecimals: number;
  /** On-chain decimals of the USDC mint. */
  usdcDecimals: number;
  /** amount − fee, in payment token base units (D1). */
  payeeAmount: bigint;
  /** Fee after discounts, in USDC base units. */
  feeNet: bigint;
  receiptId: string;
}

export interface SplitParams extends SplitExpectation {
  payer: Address;
  computeUnitLimit: number;
  /** Micro-lamports per compute unit, at most MAX_COMPUTE_UNIT_PRICE. */
  computeUnitPrice: bigint;
  lifetime: { blockhash: Blockhash; lastValidBlockHeight: bigint };
}

export interface VerifiedSplit {
  payer: Address;
  /** Base58 payer signature, when the transaction is signed. */
  signature?: string;
  computeUnitLimit: number;
  computeUnitPrice: bigint;
  blockhash: string;
}

const invalid = (reason: string) => new M2mError("PAYMENT_TRANSACTION_INVALID", reason);

const ata = async (owner: Address, mint: Address) =>
  (await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];

function checkMints(network: Network, paymentMint: Address): Address {
  if (!allowedMint(network, paymentMint)) throw new M2mError("MINT_NOT_ALLOWED");
  return NETWORKS[network].usdc as Address;
}

function checkComputeUnitPrice(price: bigint) {
  if (price < 0n || price > MAX_COMPUTE_UNIT_PRICE) {
    throw invalid(`compute unit price ${price} is above the cap of ${MAX_COMPUTE_UNIT_PRICE}`);
  }
}

/** Builds the m2m-split transaction, unsigned, as base64 wire bytes (rule 4). */
export async function buildSplitTransaction(p: SplitParams): Promise<string> {
  const usdc = checkMints(p.network, p.paymentMint);
  checkComputeUnitPrice(p.computeUnitPrice);
  if (p.payeeAmount < 0n || p.feeNet <= 0n)
    throw invalid("amounts must be non-negative and the fee positive");

  const instructions: Instruction[] = [
    getSetComputeUnitLimitInstruction({ units: p.computeUnitLimit }),
    getSetComputeUnitPriceInstruction({ microLamports: p.computeUnitPrice }),
    getTransferCheckedInstruction({
      source: await ata(p.payer, p.paymentMint),
      mint: p.paymentMint,
      destination: await ata(p.payee, p.paymentMint),
      authority: p.payer,
      amount: p.payeeAmount,
      decimals: p.paymentDecimals,
    }),
    getTransferCheckedInstruction({
      source: await ata(p.payer, usdc),
      mint: usdc,
      destination: await ata(p.treasury, usdc),
      authority: p.payer,
      amount: p.feeNet,
      decimals: p.usdcDecimals,
    }),
    getAddMemoInstruction({ memo: splitMemo(p.receiptId) }, { programAddress: MEMO_PROGRAM }),
  ];

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(p.payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(p.lifetime, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

function decode(wire: string): Transaction {
  try {
    return getTransactionDecoder().decode(getBase64Encoder().encode(wire));
  } catch {
    throw invalid("cannot decode the transaction");
  }
}

/** Signs an m2m-split transaction locally with the payer's key. Keys never leave the caller. */
export async function signSplitTransaction(
  wire: string,
  payerKey: Parameters<typeof signTransaction>[0][number],
): Promise<string> {
  return getBase64EncodedWireTransaction(await signTransaction([payerKey], decode(wire)));
}

type DecodedInstruction = Instruction & {
  accounts: NonNullable<Instruction["accounts"]>;
  data: NonNullable<Instruction["data"]>;
};

async function checkTransfer(
  index: number,
  ix: DecodedInstruction,
  payer: Address,
  expected: { mint: Address; owner: Address; amount: bigint; decimals: number },
) {
  const fail = (what: string) => invalid(`instruction ${index}: ${what}`);
  if (
    ix.programAddress !== TOKEN_PROGRAM_ADDRESS ||
    ix.data[0] !== 12 ||
    // u8 discriminator + u64 amount + u8 decimals: no trailing bytes.
    ix.data.length !== 10 ||
    ix.accounts.length !== 4
  ) {
    throw fail("expected a TransferChecked of the SPL Token program");
  }
  const { accounts, data } = parseTransferCheckedInstruction(ix);
  if (accounts.mint.address !== expected.mint) throw fail("mint does not match the quote");
  if (accounts.authority.address !== payer) throw fail("authority is not the payer");
  if (accounts.source.address !== (await ata(payer, expected.mint))) {
    throw fail("source is not the payer's associated token account");
  }
  if (accounts.destination.address !== (await ata(expected.owner, expected.mint))) {
    throw fail("destination does not match the quote");
  }
  if (data.amount !== expected.amount) throw fail("amount does not match the quote");
  if (data.decimals !== expected.decimals) throw fail("decimals do not match the mint");
}

/**
 * Verifies that a transaction is exactly the m2m-split the quote describes (sections G, K).
 * With `signed: true`, also requires a valid payer signature. Throws M2mError otherwise.
 */
export async function verifySplitTransaction(
  wire: string,
  expected: SplitExpectation,
  options: { signed: boolean },
): Promise<VerifiedSplit> {
  const usdc = checkMints(expected.network, expected.paymentMint);
  const tx = decode(wire);

  let compiled: ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>;
  try {
    compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  } catch {
    throw invalid("cannot decode the transaction message");
  }
  if (compiled.version !== 0) throw invalid("expected a version 0 transaction");
  if (compiled.addressTableLookups?.length) throw invalid("address lookup tables are not allowed");
  if (compiled.header.numSignerAccounts !== 1)
    throw invalid("expected exactly one signer: the payer");

  const message = decompileTransactionMessage(compiled);
  const payer = message.feePayer.address;
  const instructions = message.instructions as readonly DecodedInstruction[];
  if (instructions.length !== 5) throw invalid("expected exactly 5 instructions");
  const [limitIx, priceIx, paymentIx, feeIx, memoIx] = instructions as [
    DecodedInstruction,
    DecodedInstruction,
    DecodedInstruction,
    DecodedInstruction,
    DecodedInstruction,
  ];

  // Exact data lengths: no trailing bytes (u8 discriminator + u32 units / u64 micro-lamports).
  for (const [index, ix, discriminator, size] of [
    [0, limitIx, 2, 5],
    [1, priceIx, 3, 9],
  ] as const) {
    if (
      ix.programAddress !== COMPUTE_BUDGET_PROGRAM_ADDRESS ||
      ix.data?.[0] !== discriminator ||
      ix.data.length !== size ||
      ix.accounts?.length
    ) {
      throw invalid(
        `instruction ${index}: expected ${index === 0 ? "SetComputeUnitLimit" : "SetComputeUnitPrice"}`,
      );
    }
  }
  const computeUnitLimit = parseSetComputeUnitLimitInstruction(limitIx).data.units;
  const computeUnitPrice = parseSetComputeUnitPriceInstruction(priceIx).data.microLamports;
  checkComputeUnitPrice(computeUnitPrice);

  await checkTransfer(2, paymentIx, payer, {
    mint: expected.paymentMint,
    owner: expected.payee,
    amount: expected.payeeAmount,
    decimals: expected.paymentDecimals,
  });
  await checkTransfer(3, feeIx, payer, {
    mint: usdc,
    owner: expected.treasury,
    amount: expected.feeNet,
    decimals: expected.usdcDecimals,
  });

  if (
    memoIx.programAddress !== MEMO_PROGRAM ||
    memoIx.accounts?.length ||
    getUtf8Decoder().decode(memoIx.data ?? new Uint8Array()) !== splitMemo(expected.receiptId)
  ) {
    throw invalid("instruction 4: memo does not match the quote");
  }

  let signature: string | undefined;
  if (options.signed) {
    const bytes = tx.signatures[payer];
    if (
      !bytes ||
      !(await verifySignature(await getPublicKeyFromAddress(payer), bytes, tx.messageBytes))
    ) {
      throw invalid("missing or invalid payer signature");
    }
    signature = getSignatureFromTransaction(tx);
  }

  return {
    payer,
    signature,
    computeUnitLimit,
    computeUnitPrice,
    blockhash: compiled.lifetimeToken,
  };
}
