from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_v1_agents_me_referrals_response_200_credits_item import (
        GetV1AgentsMeReferralsResponse200CreditsItem,
    )
    from ..models.get_v1_agents_me_referrals_response_200_referred_item import (
        GetV1AgentsMeReferralsResponse200ReferredItem,
    )


T = TypeVar("T", bound="GetV1AgentsMeReferralsResponse200")


@_attrs_define
class GetV1AgentsMeReferralsResponse200:
    """
    Attributes:
        referrer (None | str):
        referral_link (str):
        referred_discount_until (int | None):
        referred (list[GetV1AgentsMeReferralsResponse200ReferredItem]):
        credits_ (list[GetV1AgentsMeReferralsResponse200CreditsItem]):
        available_credits (str):
    """

    referrer: None | str
    referral_link: str
    referred_discount_until: int | None
    referred: list[GetV1AgentsMeReferralsResponse200ReferredItem]
    credits_: list[GetV1AgentsMeReferralsResponse200CreditsItem]
    available_credits: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        referrer: None | str
        referrer = self.referrer

        referral_link = self.referral_link

        referred_discount_until: int | None
        referred_discount_until = self.referred_discount_until

        referred = []
        for referred_item_data in self.referred:
            referred_item = referred_item_data.to_dict()
            referred.append(referred_item)

        credits_ = []
        for credits_item_data in self.credits_:
            credits_item = credits_item_data.to_dict()
            credits_.append(credits_item)

        available_credits = self.available_credits

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "referrer": referrer,
                "referral_link": referral_link,
                "referred_discount_until": referred_discount_until,
                "referred": referred,
                "credits": credits_,
                "available_credits": available_credits,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_v1_agents_me_referrals_response_200_credits_item import (
            GetV1AgentsMeReferralsResponse200CreditsItem,  # noqa: PLC0415
        )
        from ..models.get_v1_agents_me_referrals_response_200_referred_item import (
            GetV1AgentsMeReferralsResponse200ReferredItem,  # noqa: PLC0415
        )

        d = dict(src_dict)

        def _parse_referrer(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        referrer = _parse_referrer(d.pop("referrer"))

        referral_link = d.pop("referral_link")

        def _parse_referred_discount_until(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        referred_discount_until = _parse_referred_discount_until(d.pop("referred_discount_until"))

        referred = []
        _referred = d.pop("referred")
        for referred_item_data in _referred:
            referred_item = GetV1AgentsMeReferralsResponse200ReferredItem.from_dict(
                referred_item_data
            )

            referred.append(referred_item)

        credits_ = []
        _credits_ = d.pop("credits")
        for credits_item_data in _credits_:
            credits_item = GetV1AgentsMeReferralsResponse200CreditsItem.from_dict(credits_item_data)

            credits_.append(credits_item)

        available_credits = d.pop("available_credits")

        get_v1_agents_me_referrals_response_200 = cls(
            referrer=referrer,
            referral_link=referral_link,
            referred_discount_until=referred_discount_until,
            referred=referred,
            credits_=credits_,
            available_credits=available_credits,
        )

        get_v1_agents_me_referrals_response_200.additional_properties = d
        return get_v1_agents_me_referrals_response_200

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
