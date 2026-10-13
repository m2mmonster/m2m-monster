from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.quote import Quote


T = TypeVar("T", bound="PostV1PaymentsBuildBody")


@_attrs_define
class PostV1PaymentsBuildBody:
    """
    Attributes:
        quote (Quote):
        payer (str):  Example: 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu.
        max_compute_unit_price (str | Unset): Lower priority fee cap in micro-lamports/CU (at most 5,000,000)
    """

    quote: Quote
    payer: str
    max_compute_unit_price: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        quote = self.quote.to_dict()

        payer = self.payer

        max_compute_unit_price = self.max_compute_unit_price

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "quote": quote,
                "payer": payer,
            }
        )
        if max_compute_unit_price is not UNSET:
            field_dict["max_compute_unit_price"] = max_compute_unit_price

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.quote import Quote  # noqa: PLC0415

        d = dict(src_dict)
        quote = Quote.from_dict(d.pop("quote"))

        payer = d.pop("payer")

        max_compute_unit_price = d.pop("max_compute_unit_price", UNSET)

        post_v1_payments_build_body = cls(
            quote=quote,
            payer=payer,
            max_compute_unit_price=max_compute_unit_price,
        )

        post_v1_payments_build_body.additional_properties = d
        return post_v1_payments_build_body

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
