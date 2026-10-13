from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetV1AgentsMeReceiptsResponse200ReceiptsItem")


@_attrs_define
class GetV1AgentsMeReceiptsResponse200ReceiptsItem:
    """
    Attributes:
        signature (str):
        receipt (str):
        receipt_data (Any | Unset):
    """

    signature: str
    receipt: str
    receipt_data: Any | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        signature = self.signature

        receipt = self.receipt

        receipt_data = self.receipt_data

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "signature": signature,
                "receipt": receipt,
            }
        )
        if receipt_data is not UNSET:
            field_dict["receipt_data"] = receipt_data

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        signature = d.pop("signature")

        receipt = d.pop("receipt")

        receipt_data = d.pop("receipt_data", UNSET)

        get_v1_agents_me_receipts_response_200_receipts_item = cls(
            signature=signature,
            receipt=receipt,
            receipt_data=receipt_data,
        )

        get_v1_agents_me_receipts_response_200_receipts_item.additional_properties = d
        return get_v1_agents_me_receipts_response_200_receipts_item

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
