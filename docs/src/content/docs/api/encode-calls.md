---
title: encodeCalls
description: Build the data for a ghostcall eth_call request.
---

`encodeCalls()` combines the ghostcall program and a call list into one hex
value. Send that value as the `data` field of `eth_call` without a `to` address.

Use this function when the application sends the RPC request directly.

## Usage

```ts
import { encodeCalls } from "@volga-sh/evm-ghostcall";

const data = encodeCalls([
	{
		// WETH totalSupply()
		to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		data: "0x18160ddd",
	},
]);

const response = await fetch("https://ethereum-rpc.publicnode.com", {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "eth_call",
		params: [{ data }, "latest"],
	}),
});
```

## Signature

```ts
function encodeCalls(
	calls: readonly GhostcallCall[],
	options?: GhostcallEncodeOptions,
): Hex;
```

## Parameters

### calls

```ts
type GhostcallCall = {
	to: Hex;
	data: Hex;
};
```

An ordered list of contract addresses and calldata. Each `to` value must be a
20-byte address. Each `data` value must be even-length hex with a `0x` prefix.

One call is encoded as:

```text
2 bytes calldata length
20 bytes target address
N bytes calldata
```

### options

```ts
type GhostcallEncodeOptions = {
	maxInitcodeBytes?: number;
};
```

The maximum full request size in bytes. The default is `49,152`.

## Returns

```ts
Hex
```

The complete request data:

```text
<ghostcall program><encoded calls>
```

## Throws

- `TypeError` for an invalid address, hex value, or `maxInitcodeBytes`.
- `RangeError` when one call contains more than `65,535` bytes of calldata.
- `RangeError` when the complete request exceeds `maxInitcodeBytes`.

An empty call list is valid and returns only the ghostcall program.

Pass the RPC response to [`decodeResults()`](/api/decode-results/).
