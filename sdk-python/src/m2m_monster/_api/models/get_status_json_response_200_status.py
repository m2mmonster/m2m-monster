from enum import StrEnum


class GetStatusJsonResponse200Status(StrEnum):
    OK = "ok"

    def __str__(self) -> str:
        return str(self.value)
