from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.receipt_data import ReceiptData


T = TypeVar("T", bound="PostV1ReceiptsVerifyResponse200")


@_attrs_define
class PostV1ReceiptsVerifyResponse200:
    """
    Attributes:
        valid (bool):
        receipt_data (ReceiptData):
        slot (str):
    """

    valid: bool
    receipt_data: ReceiptData
    slot: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        valid = self.valid

        receipt_data = self.receipt_data.to_dict()

        slot = self.slot

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "valid": valid,
                "receipt_data": receipt_data,
                "slot": slot,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.receipt_data import ReceiptData  # noqa: PLC0415

        d = dict(src_dict)
        valid = d.pop("valid")

        receipt_data = ReceiptData.from_dict(d.pop("receipt_data"))

        slot = d.pop("slot")

        post_v1_receipts_verify_response_200 = cls(
            valid=valid,
            receipt_data=receipt_data,
            slot=slot,
        )

        post_v1_receipts_verify_response_200.additional_properties = d
        return post_v1_receipts_verify_response_200

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
