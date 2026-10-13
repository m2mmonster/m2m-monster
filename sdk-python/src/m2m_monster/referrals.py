"""Registration challenge (section D)."""


def registration_message(pubkey: str, nonce: str) -> str:
    """The exact text an agent signs with its Solana key to register."""
    return f"m2m.monster registration\npubkey: {pubkey}\nnonce: {nonce}"
