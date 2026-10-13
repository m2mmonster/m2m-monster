from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetV1AgentsMeReferralsResponse200ReferredItem")


@_attrs_define
class GetV1AgentsMeReferralsResponse200ReferredItem:
    """
    Attributes:
        pubkey (str):
        registered_at (int):
        activated_at (int | None):
    """

    pubkey: str
    registered_at: int
    activated_at: int | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        pubkey = self.pubkey

        registered_at = self.registered_at

        activated_at: int | None
        activated_at = self.activated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "pubkey": pubkey,
                "registered_at": registered_at,
                "activated_at": activated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        pubkey = d.pop("pubkey")

        registered_at = d.pop("registered_at")

        def _parse_activated_at(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        activated_at = _parse_activated_at(d.pop("activated_at"))

        get_v1_agents_me_referrals_response_200_referred_item = cls(
            pubkey=pubkey,
            registered_at=registered_at,
            activated_at=activated_at,
        )

        get_v1_agents_me_referrals_response_200_referred_item.additional_properties = d
        return get_v1_agents_me_referrals_response_200_referred_item

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
