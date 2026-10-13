from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetV1AgentsMeReferralsResponse200CreditsItem")


@_attrs_define
class GetV1AgentsMeReferralsResponse200CreditsItem:
    """
    Attributes:
        amount (str):
        remaining (str):
        accrued_at (int):
        expires_at (int):
    """

    amount: str
    remaining: str
    accrued_at: int
    expires_at: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        amount = self.amount

        remaining = self.remaining

        accrued_at = self.accrued_at

        expires_at = self.expires_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "amount": amount,
                "remaining": remaining,
                "accrued_at": accrued_at,
                "expires_at": expires_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        amount = d.pop("amount")

        remaining = d.pop("remaining")

        accrued_at = d.pop("accrued_at")

        expires_at = d.pop("expires_at")

        get_v1_agents_me_referrals_response_200_credits_item = cls(
            amount=amount,
            remaining=remaining,
            accrued_at=accrued_at,
            expires_at=expires_at,
        )

        get_v1_agents_me_referrals_response_200_credits_item.additional_properties = d
        return get_v1_agents_me_referrals_response_200_credits_item

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
