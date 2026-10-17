"""Values taken literally from the specification (sections C, E, F, G, K). Do not adjust them.

Mint whitelists are by exact address and per network; decimals are read on-chain (rule 10).
"""

USD_UNITS = 1_000_000
"""USDC base units per dollar: fees are computed in units of 0.000001 USD (section F)."""

AGENT_FEE = {"rate_bps": 25, "min": 1_000, "max": 500_000}
"""min(max(0.25% x amount, $0.001), $0.50) (section F)."""

MIN_PAYMENT = 1_000
"""$0.001 (sections F, K)."""

REFERRAL = {
    "referred_discount_percent": 25,
    "referred_discount_days": 90,
    "credit_percent": 10,
    "credit_months": 12,
    "max_combined_discount_percent": 50,
    "activation_settlements": 20,
    "activation_volume": 10_000_000,
}
"""Referral program (section C)."""

QUOTE_TTL_SECONDS = 30

MAX_COMPUTE_UNIT_PRICE = 5_000_000
"""5 lamports per compute unit, in micro-lamports (D16)."""

MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
"""SPL Memo v2, immutable (D38)."""
MEMO_PREFIX = "settled via m2m.monster"
REFUND_MEMO_PREFIX = "refund via m2m.monster"

X402_VERSION = 2
M2M_SPLIT = "m2m-split"

TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111"

MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"

NETWORKS: dict[str, dict] = {
    MAINNET: {
        "name": "solana-mainnet",
        "treasury": "D68nkVrQD3pcs6qNcadXqWvoKqsNCKpLemy3zYVmGHym",
        "usdc": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "mints": [
            {"symbol": "USDC", "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"},
            {"symbol": "USDT", "mint": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"},
        ],
    },
    DEVNET: {
        "name": "solana-devnet",
        "treasury": "DeQ2ZniNv2BiK746guCUz8tcxJ1HvmLW1e7EjjTiMFMj",
        "usdc": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        "mints": [
            {"symbol": "USDC", "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"},
        ],
    },
}


def allowed_mint(network: str, mint: str) -> dict | None:
    """The whitelist entry for an exact mint address on a network, or None."""
    config = NETWORKS.get(network)
    if not config:
        return None
    return next((m for m in config["mints"] if m["mint"] == mint), None)
