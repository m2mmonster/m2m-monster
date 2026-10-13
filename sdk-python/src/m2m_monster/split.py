"""m2m-split transaction (section G): one atomic transaction signed only by the payer.

  0 SetComputeUnitLimit
  1 SetComputeUnitPrice   (capped, D16)
  2 TransferChecked payer -> payee     payee_amount, payment token
  3 TransferChecked payer -> treasury  fee_net, USDC
  4 Memo "settled via m2m.monster <receipt id>"   (SPL Memo v2, D38)

Built byte for byte like the TypeScript SDK (@solana/kit account ordering).
"""

import base64

from solders.hash import Hash
from solders.instruction import CompiledInstruction
from solders.keypair import Keypair
from solders.message import MessageHeader, MessageV0, to_bytes_versioned
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import VersionedTransaction

from .constants import (
    ASSOCIATED_TOKEN_PROGRAM,
    COMPUTE_BUDGET_PROGRAM,
    MAX_COMPUTE_UNIT_PRICE,
    MEMO_PREFIX,
    MEMO_PROGRAM,
    NETWORKS,
    TOKEN_PROGRAM,
    allowed_mint,
)
from .errors import M2mError

_TOKEN = Pubkey.from_string(TOKEN_PROGRAM)
_ATA = Pubkey.from_string(ASSOCIATED_TOKEN_PROGRAM)
_TRANSFER_CHECKED = 12


def associated_token_account(owner: str, mint: str) -> str:
    seeds = [bytes(Pubkey.from_string(owner)), bytes(_TOKEN), bytes(Pubkey.from_string(mint))]
    return str(Pubkey.find_program_address(seeds, _ATA)[0])


def split_memo(receipt_id: str) -> str:
    return f"{MEMO_PREFIX} {receipt_id}"


def _invalid(reason: str) -> M2mError:
    return M2mError("PAYMENT_TRANSACTION_INVALID", reason)


def _address_key(address: str) -> tuple:
    """Intl.Collator("en", { caseFirst: "lower", sensitivity: "variant" }) on base58 text."""
    return (address.lower(), tuple(c.isupper() for c in address))


def compile_v0(fee_payer: str, instructions: list, blockhash: str) -> MessageV0:
    """Compiles like @solana/kit: fee payer, then signers, then writables, then by address.

    `instructions` is a list of (program, [(address, is_signer, is_writable)], data).
    """
    roles: dict[str, list[bool]] = {fee_payer: [True, True]}
    for program, accounts, _ in instructions:
        roles.setdefault(program, [False, False])
        for address, signer, writable in accounts:
            role = roles.setdefault(address, [False, False])
            role[0] = role[0] or signer
            role[1] = role[1] or writable
    ordered = sorted(
        roles,
        key=lambda a: (a != fee_payer, not roles[a][0], not roles[a][1], _address_key(a)),
    )
    index = {a: i for i, a in enumerate(ordered)}
    header = MessageHeader(
        num_required_signatures=sum(1 for a in ordered if roles[a][0]),
        num_readonly_signed_accounts=sum(1 for a in ordered if roles[a][0] and not roles[a][1]),
        num_readonly_unsigned_accounts=sum(
            1 for a in ordered if not roles[a][0] and not roles[a][1]
        ),
    )
    compiled = [
        CompiledInstruction(index[program], data, bytes(index[a] for a, _, _ in accounts))
        for program, accounts, data in instructions
    ]
    return MessageV0(
        header,
        [Pubkey.from_string(a) for a in ordered],
        Hash.from_string(blockhash),
        compiled,
        [],
    )


def unsigned_wire(message: MessageV0) -> str:
    signatures = [Signature.default()] * message.header.num_required_signatures
    return base64.b64encode(bytes(VersionedTransaction.populate(message, signatures))).decode()


def _transfer_checked(source, mint, destination, authority, amount: int, decimals: int):
    data = bytes([_TRANSFER_CHECKED]) + amount.to_bytes(8, "little") + bytes([decimals])
    accounts = [
        (source, False, True),
        (mint, False, False),
        (destination, False, True),
        (authority, True, False),
    ]
    return (TOKEN_PROGRAM, accounts, data)


def compute_budget(limit: int, price: int) -> list:
    return [
        (COMPUTE_BUDGET_PROGRAM, [], bytes([2]) + limit.to_bytes(4, "little")),
        (COMPUTE_BUDGET_PROGRAM, [], bytes([3]) + price.to_bytes(8, "little")),
    ]


def memo(text: str) -> tuple:
    return (MEMO_PROGRAM, [], text.encode("utf-8"))


def _check_compute_unit_price(price: int) -> None:
    if price < 0 or price > MAX_COMPUTE_UNIT_PRICE:
        raise _invalid(f"compute unit price {price} is above the cap of {MAX_COMPUTE_UNIT_PRICE}")


def _usdc(network: str, payment_mint: str) -> str:
    if not allowed_mint(network, payment_mint):
        raise M2mError("MINT_NOT_ALLOWED")
    return NETWORKS[network]["usdc"]


def build_split_transaction(
    *,
    network: str,
    payer: str,
    payee: str,
    treasury: str,
    payment_mint: str,
    payment_decimals: int,
    usdc_decimals: int,
    payee_amount: int,
    fee_net: int,
    receipt_id: str,
    compute_unit_limit: int,
    compute_unit_price: int,
    blockhash: str,
) -> str:
    """The m2m-split transaction, unsigned, as base64 wire bytes (rule 4)."""
    usdc = _usdc(network, payment_mint)
    _check_compute_unit_price(compute_unit_price)
    if payee_amount < 0 or fee_net <= 0:
        raise _invalid("amounts must be non-negative and the fee positive")
    ata = associated_token_account
    instructions = [
        *compute_budget(compute_unit_limit, compute_unit_price),
        _transfer_checked(
            ata(payer, payment_mint),
            payment_mint,
            ata(payee, payment_mint),
            payer,
            payee_amount,
            payment_decimals,
        ),
        _transfer_checked(
            ata(payer, usdc), usdc, ata(treasury, usdc), payer, fee_net, usdc_decimals
        ),
        memo(split_memo(receipt_id)),
    ]
    return unsigned_wire(compile_v0(payer, instructions, blockhash))


def _decode(wire: str) -> VersionedTransaction:
    try:
        return VersionedTransaction.from_bytes(base64.b64decode(wire, validate=True))
    except Exception as e:
        raise _invalid("cannot decode the transaction") from e


def sign_transaction(wire: str, keypair: Keypair) -> str:
    """Signs locally with the fee payer's key. Keys never leave the caller."""
    tx = _decode(wire)
    if tx.message.account_keys[0] != keypair.pubkey():
        raise M2mError("INVALID_REQUEST", "The key is not the transaction's fee payer.")
    return base64.b64encode(bytes(VersionedTransaction(tx.message, [keypair]))).decode()


def verify_split_transaction(wire: str, expected: dict, *, signed: bool) -> dict:
    """Checks that a transaction is exactly the m2m-split of the quote (sections G, K)."""
    usdc = _usdc(expected["network"], expected["payment_mint"])
    tx = _decode(wire)
    message = tx.message
    if not isinstance(message, MessageV0):
        raise _invalid("expected a version 0 transaction")
    if message.address_table_lookups:
        raise _invalid("address lookup tables are not allowed")
    if message.header.num_required_signatures != 1:
        raise _invalid("expected exactly one signer: the payer")

    keys = [str(k) for k in message.account_keys]
    payer = keys[0]
    ixs = message.instructions
    if len(ixs) != 5:
        raise _invalid("expected exactly 5 instructions")

    for i, (name, discriminator, size) in enumerate(
        [("SetComputeUnitLimit", 2, 5), ("SetComputeUnitPrice", 3, 9)]
    ):
        ix = ixs[i]
        if (
            keys[ix.program_id_index] != COMPUTE_BUDGET_PROGRAM
            or not ix.data
            or ix.data[0] != discriminator
            or len(ix.data) != size
            or len(ix.accounts) != 0
        ):
            raise _invalid(f"instruction {i}: expected {name}")
    compute_unit_limit = int.from_bytes(ixs[0].data[1:5], "little")
    compute_unit_price = int.from_bytes(ixs[1].data[1:9], "little")
    _check_compute_unit_price(compute_unit_price)

    def check_transfer(i: int, mint: str, owner: str, amount: int, decimals: int) -> None:
        ix = ixs[i]
        if (
            keys[ix.program_id_index] != TOKEN_PROGRAM
            or len(ix.data) != 10
            or ix.data[0] != _TRANSFER_CHECKED
            or len(ix.accounts) != 4
        ):
            raise _invalid(f"instruction {i}: expected a TransferChecked of the SPL Token program")
        source, ix_mint, destination, authority = (keys[a] for a in ix.accounts)
        if ix_mint != mint:
            raise _invalid(f"instruction {i}: mint does not match the quote")
        if authority != payer:
            raise _invalid(f"instruction {i}: authority is not the payer")
        if source != associated_token_account(payer, mint):
            raise _invalid(f"instruction {i}: source is not the payer's associated token account")
        if destination != associated_token_account(owner, mint):
            raise _invalid(f"instruction {i}: destination does not match the quote")
        if int.from_bytes(ix.data[1:9], "little") != amount:
            raise _invalid(f"instruction {i}: amount does not match the quote")
        if ix.data[9] != decimals:
            raise _invalid(f"instruction {i}: decimals do not match the mint")

    check_transfer(
        2,
        expected["payment_mint"],
        expected["payee"],
        expected["payee_amount"],
        expected["payment_decimals"],
    )
    check_transfer(3, usdc, expected["treasury"], expected["fee_net"], expected["usdc_decimals"])

    memo_ix = ixs[4]
    try:
        memo_text = bytes(memo_ix.data).decode("utf-8")
    except UnicodeDecodeError:
        memo_text = None
    if (
        keys[memo_ix.program_id_index] != MEMO_PROGRAM
        or len(memo_ix.accounts) != 0
        or memo_text != split_memo(expected["receipt_id"])
    ):
        raise _invalid("instruction 4: memo does not match the quote")

    signature = None
    if signed:
        sig = tx.signatures[0]
        if sig == Signature.default() or not sig.verify(
            message.account_keys[0], to_bytes_versioned(message)
        ):
            raise _invalid("missing or invalid payer signature")
        signature = str(sig)

    return {
        "payer": payer,
        "signature": signature,
        "compute_unit_limit": compute_unit_limit,
        "compute_unit_price": compute_unit_price,
        "blockhash": str(message.recent_blockhash),
    }
