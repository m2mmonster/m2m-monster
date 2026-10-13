from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostV1AgentsRegisterBody")


@_attrs_define
class PostV1AgentsRegisterBody:
    """
    Attributes:
        agent_id (str):
        solana_pubkey (str):  Example: 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu.
        signature (str): Base58 ed25519 signature
        capabilities (list[str] | Unset):
        referred_by (str | Unset):  Example: 9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu.
    """

    agent_id: str
    solana_pubkey: str
    signature: str
    capabilities: list[str] | Unset = UNSET
    referred_by: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        agent_id = self.agent_id

        solana_pubkey = self.solana_pubkey

        signature = self.signature

        capabilities: list[str] | Unset = UNSET
        if not isinstance(self.capabilities, Unset):
            capabilities = self.capabilities

        referred_by = self.referred_by

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "agent_id": agent_id,
                "solana_pubkey": solana_pubkey,
                "signature": signature,
            }
        )
        if capabilities is not UNSET:
            field_dict["capabilities"] = capabilities
        if referred_by is not UNSET:
            field_dict["referred_by"] = referred_by

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        agent_id = d.pop("agent_id")

        solana_pubkey = d.pop("solana_pubkey")

        signature = d.pop("signature")

        capabilities = cast(list[str], d.pop("capabilities", UNSET))

        referred_by = d.pop("referred_by", UNSET)

        post_v1_agents_register_body = cls(
            agent_id=agent_id,
            solana_pubkey=solana_pubkey,
            signature=signature,
            capabilities=capabilities,
            referred_by=referred_by,
        )

        post_v1_agents_register_body.additional_properties = d
        return post_v1_agents_register_body

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
