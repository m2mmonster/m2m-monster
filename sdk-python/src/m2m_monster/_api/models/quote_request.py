from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="QuoteRequest")


@_attrs_define
class QuoteRequest:
    """
    Attributes:
        network (str):  Example: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1.
        mint (str):  Example: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU.
        amount (str): Gross amount the payer pays, in base units of mint Example: 10000000.
        payee (str): Wallet that receives the payment Example: 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu.
    """

    network: str
    mint: str
    amount: str
    payee: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        network = self.network

        mint = self.mint

        amount = self.amount

        payee = self.payee

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "network": network,
                "mint": mint,
                "amount": amount,
                "payee": payee,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        network = d.pop("network")

        mint = d.pop("mint")

        amount = d.pop("amount")

        payee = d.pop("payee")

        quote_request = cls(
            network=network,
            mint=mint,
            amount=amount,
            payee=payee,
        )

        quote_request.additional_properties = d
        return quote_request

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
