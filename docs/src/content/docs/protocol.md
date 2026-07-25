---
title: Protocol
description: How ghostcall runs a batch and packs its request and response bytes.
---

This page defines the bytes sent to ghostcall and the bytes it returns. Most SDK
users do not need to build these bytes themselves.

## Contract creation through eth_call

An `eth_call` normally includes a `to` address. Without `to`, the EVM treats the
`data` as contract creation code, also called initcode:

```json
{
	"method": "eth_call",
	"params": [{ "data": "0x<ghostcall program><calls>" }, "latest"]
}
```

ghostcall uses that creation step as a one-time program. It reads the call
entries attached to its own code, runs them, and returns their results. The RPC
request only simulates execution, so no contract is deployed and no state
change is saved.

Some RPC endpoints reject `eth_call` without a `to` address. Test the endpoint
used by the application.

## Call execution

Subcalls run in order with the EVM `CALL` instruction and zero value.

`CALL` is not the same as `STATICCALL`: a target can change state during the
simulation, and a later call in the same batch can observe that change. No
change remains after `eth_call` ends.

Each call receives the gas left when it starts. Earlier calls therefore affect
the gas available to later calls.

## Request bytes

The request contains the compiled ghostcall program followed by call entries:

```text
<compiled ghostcall program><call><call>...
```

Each call has:

```text
2 bytes calldata length (big-endian uint16)
20 bytes target address
N bytes calldata
```

There is no call count. The program reads entries until it reaches the end of
the request data.

`encodeCalls()` checks addresses, hex strings, calldata lengths, and the full
request size. Manually built bytes must follow the same layout. Results from
malformed hand-built requests are not defined.

## Response bytes

The response contains one entry per call:

```text
2 bytes header
N bytes return data
```

The header uses:

```text
bit 15    call success
bits 0-14 return data length (big-endian uint15)
```

A reverted call is still a response entry. Its success bit is `0`, and its
return data contains the revert data when available.

## Whole-request failure

The ghostcall program reverts with empty data if one call returns more than
`32,767` bytes. This check must happen in the program because return size is not
known before execution.

Rules about whether an ordinary failed call should throw are applied later by
the SDK:

- `aggregateDecodedCalls()` throws for every failed call.
- `aggregateCalls()` throws unless the entry sets `allowFailure: true`.
- `decodeResults()` returns the success bit without applying a failure rule.

## Next

- See [Limits](/limits/) for request and response ceilings.
- See [`encodeCalls()`](/api/encode-calls/) and
  [`decodeResults()`](/api/decode-results/) to work with the byte format.
