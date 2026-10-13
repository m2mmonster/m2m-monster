from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.receipt_data_version import ReceiptDataVersion

T = TypeVar("T", bound="ReceiptData")


@_attrs_define
class ReceiptData:
    """
    Attributes:
        version (ReceiptDataVersion):
        id (str):
        network (str):
        transaction (str):
        payer (str):  Example: 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu.
        payee (str):  Example: 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu.
        mint (str):  Example: 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu.
        decimals (int):
        amount (str):  Example: 10000000.
        payee_amount (str):  Example: 10000000.
        usdc_mint (str):  Example: 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu.
        usdc_decimals (int):
        treasury (str):  Example: 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu.
        fee_gross (str):  Example: 10000000.
        discount (str):  Example: 10000000.
        fee_net (str):  Example: 10000000.
        issued_at (int):
        referral (str):
    """

    version: ReceiptDataVersion
    id: str
    network: str
    transaction: str
    payer: str
    payee: str
    mint: str
    decimals: int
    amount: str
    payee_amount: str
    usdc_mint: str
    usdc_decimals: int
    treasury: str
    fee_gross: str
    discount: str
    fee_net: str
    issued_at: int
    referral: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        version = self.version.value

        id = self.id

        network = self.network

        transaction = self.transaction

        payer = self.payer

        payee = self.payee

        mint = self.mint

        decimals = self.decimals

        amount = self.amount

        payee_amount = self.payee_amount

        usdc_mint = self.usdc_mint

        usdc_decimals = self.usdc_decimals

        treasury = self.treasury

        fee_gross = self.fee_gross

        discount = self.discount

        fee_net = self.fee_net

        issued_at = self.issued_at

        referral = self.referral

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "version": version,
                "id": id,
                "network": network,
                "transaction": transaction,
                "payer": payer,
                "payee": payee,
                "mint": mint,
                "decimals": decimals,
                "amount": amount,
                "payee_amount": payee_amount,
                "usdc_mint": usdc_mint,
                "usdc_decimals": usdc_decimals,
                "treasury": treasury,
                "fee_gross": fee_gross,
                "discount": discount,
                "fee_net": fee_net,
                "issued_at": issued_at,
                "referral": referral,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        version = ReceiptDataVersion(d.pop("version"))

        id = d.pop("id")

        network = d.pop("network")

        transaction = d.pop("transaction")

        payer = d.pop("payer")

        payee = d.pop("payee")

        mint = d.pop("mint")

        decimals = d.pop("decimals")

        amount = d.pop("amount")

        payee_amount = d.pop("payee_amount")

        usdc_mint = d.pop("usdc_mint")

        usdc_decimals = d.pop("usdc_decimals")

        treasury = d.pop("treasury")

        fee_gross = d.pop("fee_gross")

        discount = d.pop("discount")

        fee_net = d.pop("fee_net")

        issued_at = d.pop("issued_at")

        referral = d.pop("referral")

        receipt_data = cls(
            version=version,
            id=id,
            network=network,
            transaction=transaction,
            payer=payer,
            payee=payee,
            mint=mint,
            decimals=decimals,
            amount=amount,
            payee_amount=payee_amount,
            usdc_mint=usdc_mint,
            usdc_decimals=usdc_decimals,
            treasury=treasury,
            fee_gross=fee_gross,
            discount=discount,
            fee_net=fee_net,
            issued_at=issued_at,
            referral=referral,
        )

        receipt_data.additional_properties = d
        return receipt_data

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
