"""In-memory RPC and signing helpers for unit tests."""

import base64
import json
import time

from solders.keypair import Keypair
from solders.transaction import VersionedTransaction

from m2m_monster.constants import DEVNET, NETWORKS, TOKEN_PROGRAM
from m2m_monster.quote import quote_message
from m2m_monster.rpc import Rpc
from m2m_monster.split import associated_token_account

USDC = NETWORKS[DEVNET]["usdc"]
TREASURY = NETWORKS[DEVNET]["treasury"]
SERVICE = Keypair.from_seed(bytes([9]) * 32)
PAYER = Keypair.from_seed(bytes([1]) * 32)
PAYEE = Keypair.from_seed(bytes([2]) * 32)


def signature_of(wire: str) -> str:
    return str(VersionedTransaction.from_bytes(base64.b64decode(wire)).signatures[0])


class FakeRpc(Rpc):
    def __init__(self) -> None:
        super().__init__("http://fake")
        self.accounts: dict[str, tuple[str, bytes]] = {}
        self.simulation: dict = {"err": None, "logs": [], "unitsConsumed": 6_000}
        self.fees: list[int] = []
        self.sent: list[str] = []
        self.simulated: list[dict] = []
        self.transactions: dict[str, dict] = {}
        self.block_height = 10
        self.finalized_slot = 1
        self.status_slot = 1
        self.failing: set[str] = set()
        self.statuses: dict[str, dict | None] = {}

    def put_token(self, owner: str, mint: str, amount: int) -> None:
        data = bytes(32) + bytes(32) + amount.to_bytes(8, "little") + bytes(93)
        self.accounts[associated_token_account(owner, mint)] = (TOKEN_PROGRAM, data)

    def call(self, method: str, params: list):
        if method in self.failing:
            raise RuntimeError(f"{method}: RPC unavailable")
        if method == "getAccountInfo":
            acc = self.accounts.get(params[0])
            value = (
                {"owner": acc[0], "data": [base64.b64encode(acc[1]).decode(), "base64"]}
                if acc
                else None
            )
            return {"value": value}
        if method == "getLatestBlockhash":
            return {
                "value": {
                    "blockhash": "EZ3rST5dvHmbanh75jc4PuLfV96vp9fEYBVeNk4FfM1k",
                    "lastValidBlockHeight": 1000,
                }
            }
        if method == "getRecentPrioritizationFees":
            return [{"slot": i, "prioritizationFee": f} for i, f in enumerate(self.fees)]
        if method == "simulateTransaction":
            self.simulated.append(params[1])
            return {"value": self.simulation}
        if method == "sendTransaction":
            wire = params[0]
            sig = signature_of(wire)
            if wire not in self.sent:
                self.sent.append(wire)
            self.transactions[sig] = {"wire": wire, "err": None}
            return sig
        if method == "getEpochInfo":
            return {"absoluteSlot": self.finalized_slot, "blockHeight": self.block_height}
        if method == "getSignatureStatuses":
            # params: [[signatures], optional config]
            return {
                "context": {"slot": self.status_slot},
                "value": [
                    self.statuses[s]
                    if s in self.statuses
                    else {"err": None, "confirmationStatus": "confirmed"}
                    if s in self.transactions
                    else None
                    for s in params[0]
                ],
            }
        if method == "getBlockHeight":
            return self.block_height
        if method == "getTransaction":
            tx = self.transactions.get(params[0])
            if not tx:
                return None
            return {
                "slot": 7,
                "blockTime": 1,
                "meta": {"err": tx["err"]},
                "transaction": [tx["wire"], "base64"],
            }
        raise NotImplementedError(method)


def signed_quote(**changes) -> dict:
    quote = {
        "id": "q_test_0001",
        "nonce": "00112233445566778899aabbccddeeff",
        "network": DEVNET,
        "mint": USDC,
        "decimals": 6,
        "amount": "10000000",
        "payee": str(PAYEE.pubkey()),
        "payee_amount": "9975000",
        "treasury": TREASURY,
        "usdc_mint": USDC,
        "usdc_decimals": 6,
        "fee_gross": "25000",
        "discount": "0",
        "fee_net": "25000",
        "expires_at": int(time.time()) + 30,
        "referral": f"https://m2m.monster/.well-known/mcp.json?ref={PAYEE.pubkey()}",
        **changes,
    }
    return {**quote, "signature": str(SERVICE.sign_message(quote_message(quote).encode()))}


def funded_rpc() -> FakeRpc:
    rpc = FakeRpc()
    rpc.put_token(str(PAYER.pubkey()), USDC, 20_000_000)
    rpc.put_token(str(PAYEE.pubkey()), USDC, 0)
    rpc.put_token(TREASURY, USDC, 0)
    return rpc


def jws(payload: dict) -> str:
    def enc(value) -> str:
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")

    signing_input = f"{enc({'alg': 'EdDSA', 'typ': 'JWT'})}.{enc(payload)}"
    sig = bytes(SERVICE.sign_message(signing_input.encode()))
    return f"{signing_input}.{base64.urlsafe_b64encode(sig).decode().rstrip('=')}"
