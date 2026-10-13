from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.post_v1_refunds_build_body import PostV1RefundsBuildBody
from ...models.unsigned_transaction import UnsignedTransaction
from ...types import Response


def _get_kwargs(
    *,
    body: PostV1RefundsBuildBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/v1/refunds/build",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Error | UnsignedTransaction | None:
    if response.status_code == 200:
        response_200 = UnsignedTransaction.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if response.status_code == 429:
        response_429 = Error.from_dict(response.json())

        return response_429

    if response.status_code == 500:
        response_500 = Error.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Error | UnsignedTransaction]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostV1RefundsBuildBody,
) -> Response[Error | UnsignedTransaction]:
    """Build an unsigned refund from the payee back to the payer, linked to the receipt. No fee; the
    original fee is not returned.

    Args:
        body (PostV1RefundsBuildBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | UnsignedTransaction]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    body: PostV1RefundsBuildBody,
) -> Error | UnsignedTransaction | None:
    """Build an unsigned refund from the payee back to the payer, linked to the receipt. No fee; the
    original fee is not returned.

    Args:
        body (PostV1RefundsBuildBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | UnsignedTransaction
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostV1RefundsBuildBody,
) -> Response[Error | UnsignedTransaction]:
    """Build an unsigned refund from the payee back to the payer, linked to the receipt. No fee; the
    original fee is not returned.

    Args:
        body (PostV1RefundsBuildBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | UnsignedTransaction]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostV1RefundsBuildBody,
) -> Error | UnsignedTransaction | None:
    """Build an unsigned refund from the payee back to the payer, linked to the receipt. No fee; the
    original fee is not returned.

    Args:
        body (PostV1RefundsBuildBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | UnsignedTransaction
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
