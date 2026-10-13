from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="Quote")


@_attrs_define
class Quote:
    """
    Attributes:
        id (str): Quote id; also the receipt id in the memo
        nonce (str):
        network (str):
        mint (str):  Example: 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu.
        decimals (int):
        amount (str):  Example: 10000000.
        payee (str):  Example: 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu.
        payee_amount (str): amount − fee_net, in base units of mint Example: 10000000.
        treasury (str):  Example: 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu.
        usdc_mint (str):  Example: 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu.
        usdc_decimals (int):
        fee_gross (str):  Example: 10000000.
        discount (str):  Example: 10000000.
        fee_net (str): Fee paid to the treasury, in USDC base units Example: 10000000.
        expires_at (int): Unix seconds; quotes last 30 seconds
        referral (str):
        signature (str): Base58 ed25519 signature by the service key
    """

    id: str
    nonce: str
    network: str
    mint: str
    decimals: int
    amount: str
    payee: str
    payee_amount: str
    treasury: str
    usdc_mint: str
    usdc_decimals: int
    fee_gross: str
    discount: str
    fee_net: str
    expires_at: int
    referral: str
    signature: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        nonce = self.nonce

        network = self.network

        mint = self.mint

        decimals = self.decimals

        amount = self.amount

        payee = self.payee

        payee_amount = self.payee_amount

        treasury = self.treasury

        usdc_mint = self.usdc_mint

        usdc_decimals = self.usdc_decimals

        fee_gross = self.fee_gross

        discount = self.discount

        fee_net = self.fee_net

        expires_at = self.expires_at

        referral = self.referral

        signature = self.signature

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "nonce": nonce,
                "network": network,
                "mint": mint,
                "decimals": decimals,
                "amount": amount,
                "payee": payee,
                "payee_amount": payee_amount,
                "treasury": treasury,
                "usdc_mint": usdc_mint,
                "usdc_decimals": usdc_decimals,
                "fee_gross": fee_gross,
                "discount": discount,
                "fee_net": fee_net,
                "expires_at": expires_at,
                "referral": referral,
                "signature": signature,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        nonce = d.pop("nonce")

        network = d.pop("network")

        mint = d.pop("mint")

        decimals = d.pop("decimals")

        amount = d.pop("amount")

        payee = d.pop("payee")

        payee_amount = d.pop("payee_amount")

        treasury = d.pop("treasury")

        usdc_mint = d.pop("usdc_mint")

        usdc_decimals = d.pop("usdc_decimals")

        fee_gross = d.pop("fee_gross")

        discount = d.pop("discount")

        fee_net = d.pop("fee_net")

        expires_at = d.pop("expires_at")

        referral = d.pop("referral")

        signature = d.pop("signature")

        quote = cls(
            id=id,
            nonce=nonce,
            network=network,
            mint=mint,
            decimals=decimals,
            amount=amount,
            payee=payee,
            payee_amount=payee_amount,
            treasury=treasury,
            usdc_mint=usdc_mint,
            usdc_decimals=usdc_decimals,
            fee_gross=fee_gross,
            discount=discount,
            fee_net=fee_net,
            expires_at=expires_at,
            referral=referral,
            signature=signature,
        )

        quote.additional_properties = d
        return quote

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
