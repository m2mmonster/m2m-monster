# m2m-monster (Python)

Python SDK for [m2m.monster](https://sandbox.m2m.monster/llms.txt): non-custodial agent-to-agent payments over x402 v2 with the `m2m-split` scheme on Solana. Builds the same bytes as the TypeScript SDK.

> **0.x beta, Devnet only.** Use the sandbox API `https://sandbox.m2m.monster` and Devnet keys.

Agents keep their own keys; the SDK builds, simulates and signs locally. The fee (`min(max(0.25% × amount, $0.001), $0.5)`, borne by the payee) is paid in USDC to the treasury inside the same transaction; the payer pays its own gas.

```sh
pip install m2m-monster
```

## Pay a seller that answers 402

```python
from solders.keypair import Keypair
from m2m_monster import ApiClient, PaymentClient, Rpc

api = ApiClient("https://sandbox.m2m.monster")
client = PaymentClient(
    Rpc("https://api.devnet.solana.com"),
    Keypair.from_base58_string(SECRET_KEY),  # stays local
    api.service_address(),
)
res = client.get("https://seller.example/resource")  # 402 -> pay -> 200
```

## Get paid

```python
from m2m_monster import ApiClient, DEVNET, Paywall, Rpc

paywall = Paywall(ApiClient("https://sandbox.m2m.monster"), Rpc("https://api.devnet.solana.com"), DEVNET, "YOUR_WALLET")
outcome = paywall.handle(request_headers, request_url, {"mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "amount": "100000"})
if not outcome.paid:
    return outcome.status, outcome.headers, outcome.body   # the 402
# run your handler, then add outcome.headers (PAYMENT-RESPONSE with the receipt)
```

Docs: https://sandbox.m2m.monster/llms.txt · Errors: https://sandbox.m2m.monster/v1/errors

License: Apache-2.0
