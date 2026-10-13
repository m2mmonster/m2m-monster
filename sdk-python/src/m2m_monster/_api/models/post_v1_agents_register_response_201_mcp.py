from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_v1_agents_register_response_201_mcp_headers import (
        PostV1AgentsRegisterResponse201McpHeaders,
    )


T = TypeVar("T", bound="PostV1AgentsRegisterResponse201Mcp")


@_attrs_define
class PostV1AgentsRegisterResponse201Mcp:
    """
    Attributes:
        url (str):
        headers (PostV1AgentsRegisterResponse201McpHeaders):
    """

    url: str
    headers: PostV1AgentsRegisterResponse201McpHeaders
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        headers = self.headers.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "url": url,
                "headers": headers,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_v1_agents_register_response_201_mcp_headers import (
            PostV1AgentsRegisterResponse201McpHeaders,  # noqa: PLC0415
        )

        d = dict(src_dict)
        url = d.pop("url")

        headers = PostV1AgentsRegisterResponse201McpHeaders.from_dict(d.pop("headers"))

        post_v1_agents_register_response_201_mcp = cls(
            url=url,
            headers=headers,
        )

        post_v1_agents_register_response_201_mcp.additional_properties = d
        return post_v1_agents_register_response_201_mcp

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
