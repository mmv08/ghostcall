---
title: aggregateCalls
description: Send a batch and return raw success or failure results.
---

`aggregateCalls()` sends one `eth_call` and returns raw results in call order.
Use it when success flags, revert data, or permission for selected
calls to fail.

## Usage

```ts
import { aggregateCalls } from "@volga-sh/evm-ghostcall";

const results = await aggregateCalls(client, [
	{
		// WETH totalSupply()
		to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		data: "0x18160ddd",
	},
	{
		to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		data: "0xdeadbeef",
		allowFailure: true,
	},
]);
```

## Signature

```ts
async function aggregateCalls(
	provider: EIP1193ProviderWithRequestFn,
	calls: readonly GhostcallAggregateCall[],
	options?: GhostcallAggregateOptions,
): Promise<GhostcallResult[]>;
```

## Parameters

### provider

```ts
type EIP1193ProviderWithRequestFn = {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
};
```

The provider that sends the outer `eth_call`.

### calls

```ts
type GhostcallAggregateCall = {
	to: Hex;
	data: Hex;
	allowFailure?: boolean;
};
```

An ordered list of contract calls. Set `allowFailure: true` when that entry
should be returned with `success: false` instead of throwing an error.

`allowFailure` controls SDK behavior after the response arrives. It is not part
of the bytes sent to the EVM.

### options

```ts
type GhostcallAggregateOptions = {
	maxInitcodeBytes?: number;
	ethCall?: {
		from?: Hex;
		gas?: HexQuantity;
		blockTag?: string | number | bigint;
	};
};
```

`blockTag` defaults to `"latest"`. Decimal block numbers are converted to RPC
hex quantities. `maxInitcodeBytes` defaults to `49,152`.

## Returns

```ts
type GhostcallResult =
	| { success: true; returnData: Hex }
	| { success: false; returnData: Hex };
```

The promise resolves to one result per call, in the same order.

## Throws

- `TypeError` for invalid addresses, hex data, options, or provider responses.
- `RangeError` when one call or the full request exceeds its size limit.
- [`GhostcallSubcallError`](/api/subcall-error/) when a call fails without
  `allowFailure: true`.
- `Error` when the response contains a different number of results than the
  request.

Provider and transport errors pass through unchanged.

Use [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/) when every call
must succeed and decoded values are needed.
