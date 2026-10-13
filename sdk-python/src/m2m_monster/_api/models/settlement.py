from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.receipt_data import ReceiptData


T = TypeVar("T", bound="Settlement")


@_attrs_define
class Settlement:
    """
    Attributes:
        signature (str): Base58 transaction signature
        receipt (str): Compact JWS (EdDSA) signed by the service key
        receipt_data (ReceiptData):
    """

    signature: str
    receipt: str
    receipt_data: ReceiptData
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        signature = self.signature

        receipt = self.receipt

        receipt_data = self.receipt_data.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "signature": signature,
                "receipt": receipt,
                "receipt_data": receipt_data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.receipt_data import ReceiptData  # noqa: PLC0415

        d = dict(src_dict)
        signature = d.pop("signature")

        receipt = d.pop("receipt")

        receipt_data = ReceiptData.from_dict(d.pop("receipt_data"))

        settlement = cls(
            signature=signature,
            receipt=receipt,
            receipt_data=receipt_data,
        )

        settlement.additional_properties = d
        return settlement

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
