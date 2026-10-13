from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.quote import Quote


T = TypeVar("T", bound="PostV1PaymentsVerifyBody")


@_attrs_define
class PostV1PaymentsVerifyBody:
    """
    Attributes:
        quote (Quote):
        transaction (str):
    """

    quote: Quote
    transaction: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        quote = self.quote.to_dict()

        transaction = self.transaction

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "quote": quote,
                "transaction": transaction,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.quote import Quote  # noqa: PLC0415

        d = dict(src_dict)
        quote = Quote.from_dict(d.pop("quote"))

        transaction = d.pop("transaction")

        post_v1_payments_verify_body = cls(
            quote=quote,
            transaction=transaction,
        )

        post_v1_payments_verify_body.additional_properties = d
        return post_v1_payments_verify_body

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
