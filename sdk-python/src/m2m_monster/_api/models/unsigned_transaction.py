from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="UnsignedTransaction")


@_attrs_define
class UnsignedTransaction:
    """
    Attributes:
        transaction (str): Base64 wire transaction, unsigned
        compute_unit_limit (int):
        compute_unit_price (str): Micro-lamports per compute unit
        last_valid_block_height (str):
    """

    transaction: str
    compute_unit_limit: int
    compute_unit_price: str
    last_valid_block_height: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        transaction = self.transaction

        compute_unit_limit = self.compute_unit_limit

        compute_unit_price = self.compute_unit_price

        last_valid_block_height = self.last_valid_block_height

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "transaction": transaction,
                "compute_unit_limit": compute_unit_limit,
                "compute_unit_price": compute_unit_price,
                "last_valid_block_height": last_valid_block_height,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        transaction = d.pop("transaction")

        compute_unit_limit = d.pop("compute_unit_limit")

        compute_unit_price = d.pop("compute_unit_price")

        last_valid_block_height = d.pop("last_valid_block_height")

        unsigned_transaction = cls(
            transaction=transaction,
            compute_unit_limit=compute_unit_limit,
            compute_unit_price=compute_unit_price,
            last_valid_block_height=last_valid_block_height,
        )

        unsigned_transaction.additional_properties = d
        return unsigned_transaction

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
