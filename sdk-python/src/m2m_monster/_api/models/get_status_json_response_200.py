from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_status_json_response_200_status import GetStatusJsonResponse200Status

T = TypeVar("T", bound="GetStatusJsonResponse200")


@_attrs_define
class GetStatusJsonResponse200:
    """
    Attributes:
        status (GetStatusJsonResponse200Status):
        api_version (str):
        versions (list[str]):
        network (str):
        service_key (str):
        deprecations (list[str]):
    """

    status: GetStatusJsonResponse200Status
    api_version: str
    versions: list[str]
    network: str
    service_key: str
    deprecations: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status = self.status.value

        api_version = self.api_version

        versions = self.versions

        network = self.network

        service_key = self.service_key

        deprecations = self.deprecations

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "status": status,
                "api_version": api_version,
                "versions": versions,
                "network": network,
                "service_key": service_key,
                "deprecations": deprecations,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        status = GetStatusJsonResponse200Status(d.pop("status"))

        api_version = d.pop("api_version")

        versions = cast(list[str], d.pop("versions"))

        network = d.pop("network")

        service_key = d.pop("service_key")

        deprecations = cast(list[str], d.pop("deprecations"))

        get_status_json_response_200 = cls(
            status=status,
            api_version=api_version,
            versions=versions,
            network=network,
            service_key=service_key,
            deprecations=deprecations,
        )

        get_status_json_response_200.additional_properties = d
        return get_status_json_response_200

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
