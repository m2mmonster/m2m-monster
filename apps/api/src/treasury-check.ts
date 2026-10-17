// Read-only checks of a treasury address before it is set in core (rule 9, section K, D58).
// Only a public address goes in; no key is asked for or accepted.
import {
  associatedTokenAccount,
  mintDecimals,
  NETWORKS,
  type Network,
  type SolanaRpc,
} from "@m2m-monster/core";
import { type Address, address, isAddress, isOffCurveAddress } from "@solana/kit";
import { AccountState, fetchMaybeToken, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { FEE_UNIT_DECIMALS } from "./startup.js";

/** Genesis hash of Solana mainnet-beta. */
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export interface TreasuryCheck {
  check: string;
  ok: boolean;
  detail?: string;
}

/** Checks the treasury's USDC account on the network; every result is returned, none thrown. */
export async function checkTreasury(
  rpc: SolanaRpc,
  network: Network,
  treasury: string,
): Promise<TreasuryCheck[]> {
  if (!isAddress(treasury)) {
    return [{ check: "Treasury is a base58 Solana address", ok: false, detail: treasury }];
  }
  const owner = address(treasury);
  const usdc = address(NETWORKS[network].usdc);
  const ata = await associatedTokenAccount(owner, usdc);
  const results: TreasuryCheck[] = [
    { check: "Treasury is a base58 Solana address", ok: true, detail: owner },
    {
      check: "Treasury is a normal wallet address (on curve, single key)",
      ok: !isOffCurveAddress(owner),
    },
  ];

  const account = await fetchMaybeToken(rpc, ata);
  results.push({ check: "USDC associated token account exists", ok: account.exists, detail: ata });
  if (account.exists) {
    const { data } = account;
    results.push(
      {
        check: "Owned by the classic SPL Token program (not Token-2022)",
        ok: account.programAddress === TOKEN_PROGRAM_ADDRESS,
        detail: account.programAddress,
      },
      { check: "Mint is exactly USDC", ok: data.mint === usdc, detail: data.mint },
      {
        check: "Token account owner is the treasury",
        ok: data.owner === owner,
        detail: data.owner,
      },
      { check: "Account is initialized", ok: data.state === AccountState.Initialized },
      { check: "No delegate", ok: data.delegate.__option === "None" },
      {
        check: "No close authority other than the treasury",
        ok: data.closeAuthority.__option === "None" || data.closeAuthority.value === owner,
      },
    );
  }

  const decimals = await mintDecimals(rpc, usdc as Address).catch(() => undefined);
  results.push({
    check: `USDC mint has ${FEE_UNIT_DECIMALS} decimals on-chain`,
    ok: decimals === FEE_UNIT_DECIMALS,
    detail: `${decimals ?? "unreadable"}`,
  });
  return results;
}
