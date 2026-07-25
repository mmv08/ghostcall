---
title: GhostcallSubcallError
description: Inspect a contract call that caused a batch to throw.
---

`GhostcallSubcallError` identifies a failed contract call when the SDK is
configured to stop on failure.

- `aggregateDecodedCalls()` throws it for any failed call.
- `aggregateCalls()` throws it when a failed call does not set
  `allowFailure: true`.

## Usage

```ts
import {
	aggregateCalls,
	GhostcallSubcallError,
} from "@volga-sh/evm-ghostcall";

try {
	await aggregateCalls(client, [
		{
			to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
			data: "0xdeadbeef",
		},
	]);
} catch (error) {
	if (error instanceof GhostcallSubcallError) {
		console.log(error.index);
		console.log(error.call);
		console.log(error.result.returnData);
	}
}
```

## Signature

```ts
class GhostcallSubcallError extends Error {
	readonly index: number;
	readonly call: GhostcallAggregateCall;
	readonly result: GhostcallFailedResult;
}
```

## Properties

### index

The zero-based position of the failed call.

```ts
number
```

### call

The original call entry passed to the SDK.

```ts
GhostcallAggregateCall
```

### result

The failed result and its raw return data. `returnData` contains revert data
when the contract returned any.

```ts
type GhostcallFailedResult = {
	success: false;
	returnData: Hex;
};
```

This error means the outer ghostcall request completed and one inner contract
call failed. Provider errors and request-size errors use their own error types.

Set `allowFailure: true` on an `aggregateCalls()` entry to return the failed
result instead.
