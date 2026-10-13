// In-memory stand-in for the few Solana RPC methods used by core and the SDKs. Tests only.
import {
  type Address,
  getBase64Decoder,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
} from "@solana/kit";
import { getMintEncoder, getTokenEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { SolanaRpc } from "./rpc.js";

export interface MockRpcState {
  accounts: Map<string, { owner: string; data: Uint8Array }>;
  simulation: { err: unknown; logs: string[]; unitsConsumed?: bigint };
  priorityFees: bigint[];
  sent: string[];
  statuses: Map<string, { err: unknown; confirmationStatus: string } | null>;
  simulated: { wire: string; config: Record<string, unknown> }[];
  /** Confirmed transactions by signature, as returned by getTransaction. */
  transactions: Map<string, { wire: string; err: unknown }>;
  /** Confirm every broadcast transaction immediately. */
  autoConfirm: boolean;
}

/** Base58 fee-payer signature of a base64 wire transaction. */
export const signatureOf = (wire: string) =>
  getSignatureFromTransaction(getTransactionDecoder().decode(getBase64Encoder().encode(wire)));

export function mockRpc(): { rpc: SolanaRpc; state: MockRpcState } {
  const state: MockRpcState = {
    accounts: new Map(),
    simulation: { err: null, logs: [], unitsConsumed: 6_000n },
    priorityFees: [],
    sent: [],
    statuses: new Map(),
    simulated: [],
    transactions: new Map(),
    autoConfirm: false,
  };
  const ok = <T>(value: T) => ({ send: async () => value });
  const rpc = {
    getAccountInfo: (address: string) => {
      const account = state.accounts.get(address);
      return ok({
        context: { slot: 1n },
        value: account
          ? {
              data: [getBase64Decoder().decode(account.data), "base64"],
              executable: false,
              lamports: 2_039_280n,
              owner: account.owner,
              space: BigInt(account.data.length),
              rentEpoch: 0n,
            }
          : null,
      });
    },
    getLatestBlockhash: () =>
      ok({
        context: { slot: 1n },
        value: {
          blockhash: "EZ3rST5dvHmbanh75jc4PuLfV96vp9fEYBVeNk4FfM1k",
          lastValidBlockHeight: 1_000n,
        },
      }),
    getRecentPrioritizationFees: () =>
      ok(state.priorityFees.map((fee, i) => ({ slot: BigInt(i), prioritizationFee: fee }))),
    simulateTransaction: (wire: string, config: Record<string, unknown>) => {
      state.simulated.push({ wire, config });
      return ok({ context: { slot: 1n }, value: { ...state.simulation, accounts: null } });
    },
    sendTransaction: (wire: string) => {
      state.sent.push(wire);
      try {
        const signature = signatureOf(wire);
        if (state.autoConfirm) {
          state.statuses.set(signature, { err: null, confirmationStatus: "confirmed" });
          state.transactions.set(signature, { wire, err: null });
        }
        return ok(signature);
      } catch {
        return ok(
          "5j7s6NiJS3JAkvgkoc18WVAsiSaci2pxB2A6ueCJP4tprA2TFg9wSyTLeYouxPBJEMzJinENTkpA52YStRW5Dia7",
        );
      }
    },
    getSignatureStatuses: (signatures: string[]) =>
      ok({ context: { slot: 1n }, value: signatures.map((s) => state.statuses.get(s) ?? null) }),
    getBlockHeight: () => ok(10n),
    getTransaction: (signature: string) => {
      const tx = state.transactions.get(signature);
      return ok(
        tx
          ? {
              slot: 7n,
              blockTime: 1_791_460_000n,
              meta: { err: tx.err },
              transaction: [tx.wire, "base64"],
            }
          : null,
      );
    },
  };
  return { rpc: rpc as unknown as SolanaRpc, state };
}

export function putTokenAccount(
  state: MockRpcState,
  address: Address,
  owner: Address,
  mint: Address,
  amount: bigint,
) {
  const data = getTokenEncoder().encode({
    mint,
    owner,
    amount,
    delegate: null,
    state: 1,
    isNative: null,
    delegatedAmount: 0n,
    closeAuthority: null,
  });
  state.accounts.set(address, { owner: TOKEN_PROGRAM_ADDRESS, data: new Uint8Array(data) });
}

export function putMint(state: MockRpcState, address: Address, decimals: number) {
  const data = getMintEncoder().encode({
    mintAuthority: null,
    supply: 1_000_000_000_000n,
    decimals,
    isInitialized: true,
    freezeAuthority: null,
  });
  state.accounts.set(address, { owner: TOKEN_PROGRAM_ADDRESS, data: new Uint8Array(data) });
}
