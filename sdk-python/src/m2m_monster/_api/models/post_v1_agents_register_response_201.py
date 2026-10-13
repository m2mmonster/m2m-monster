from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_v1_agents_register_response_201_mcp import PostV1AgentsRegisterResponse201Mcp


T = TypeVar("T", bound="PostV1AgentsRegisterResponse201")


@_attrs_define
class PostV1AgentsRegisterResponse201:
    """
    Attributes:
        api_key (str):
        mcp (PostV1AgentsRegisterResponse201Mcp):
    """

    api_key: str
    mcp: PostV1AgentsRegisterResponse201Mcp
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        api_key = self.api_key

        mcp = self.mcp.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "api_key": api_key,
                "mcp": mcp,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_v1_agents_register_response_201_mcp import (
            PostV1AgentsRegisterResponse201Mcp,  # noqa: PLC0415
        )

        d = dict(src_dict)
        api_key = d.pop("api_key")

        mcp = PostV1AgentsRegisterResponse201Mcp.from_dict(d.pop("mcp"))

        post_v1_agents_register_response_201 = cls(
            api_key=api_key,
            mcp=mcp,
        )

        post_v1_agents_register_response_201.additional_properties = d
        return post_v1_agents_register_response_201

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
