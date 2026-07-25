---
title: aggregateDecodedCalls
description: Send a batch and decode every successful result.
---

`aggregateDecodedCalls()` sends one `eth_call` and returns one decoded value for
each input call. Results keep the same order as the calls.

Every call must succeed. If one fails, the function throws
`GhostcallSubcallError`.

## Usage

```ts
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";
import {
	decodeFunctionResult,
	encodeFunctionData,
	parseAbi,
} from "viem";

const abi = parseAbi([
	"function totalSupply() view returns (uint256)",
	"function decimals() view returns (uint8)",
]);
const token = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const [totalSupply, decimals] = await aggregateDecodedCalls(client, [
	{
		to: token,
		data: encodeFunctionData({
			abi,
			functionName: "totalSupply",
		}),
		decodeResult: (data) =>
			decodeFunctionResult({
				abi,
				functionName: "totalSupply",
				data,
			}),
	},
	{
		to: token,
		data: encodeFunctionData({
			abi,
			functionName: "decimals",
		}),
		decodeResult: (data) =>
			decodeFunctionResult({
				abi,
				functionName: "decimals",
				data,
			}),
	},
]);
```

## Signature

```ts
async function aggregateDecodedCalls<
	const TCalls extends readonly GhostcallDecodedCall<unknown>[],
>(
	provider: EIP1193ProviderWithRequestFn,
	calls: TCalls,
	options?: GhostcallAggregateOptions,
): Promise<GhostcallDecodedResults<TCalls>>;
```

## Parameters

### provider

```ts
type EIP1193ProviderWithRequestFn = {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
};
```

The provider that sends the outer `eth_call`. A viem public client has this
`request` method.

### calls

```ts
type GhostcallDecodedCall<TResult = unknown> = {
	to: Hex;
	data: Hex;
	decodeResult: GhostcallResultDecoder<TResult>;
};

type GhostcallResultDecoder<TResult> = (
	returnData: Hex,
	entry: GhostcallSuccessResult,
	index: number,
) => TResult;
```

An ordered list of contract calls. `to` is the contract address, `data` is the
contract calldata, and `decodeResult` decodes successful return data.

This call type does not accept `allowFailure`.

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

`blockTag` defaults to `"latest"`. `maxInitcodeBytes` defaults to `49,152`, the
Ethereum initcode limit.

## Returns

```ts
Promise<GhostcallDecodedResults<TCalls>>
```

A tuple whose value types come from the `decodeResult` functions.

## Throws

- `TypeError` for invalid addresses, hex data, options, or provider responses.
- `RangeError` when one call or the full request exceeds its size limit.
- [`GhostcallSubcallError`](/api/subcall-error/) when any contract call fails.
- `Error` when the response contains a different number of results than the
  request.

Provider and transport errors pass through unchanged.

Use [`aggregateCalls()`](/api/aggregate-calls/) when a failed call should remain
in the returned results.
