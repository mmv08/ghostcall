---
title: Types
description: TypeScript types exported by ghostcall.
---

This page lists the shared types used by the SDK functions.

## Hex values

```ts
type Hex = `0x${string}`;
type HexQuantity = `0x${string}`;
```

SDK functions check that hex strings have a `0x` prefix, an even number of
characters, and only hexadecimal digits.

`HexQuantity` is used for RPC values such as `ethCall.gas`.

## Calls

```ts
type GhostcallCall = {
	to: Hex;
	data: Hex;
};
```

The base call type. `to` is a 20-byte contract address and `data` is contract
calldata.

```ts
type GhostcallAggregateCall = GhostcallCall & {
	allowFailure?: boolean;
};
```

The input for `aggregateCalls()`. `allowFailure` controls whether a failed entry
is returned or throws.

```ts
type GhostcallDecodedCall<TResult = unknown> = GhostcallCall & {
	decodeResult: GhostcallResultDecoder<TResult>;
};
```

The input for `aggregateDecodedCalls()`. Each entry includes a result decoder.

## Results

```ts
type GhostcallSuccessResult = {
	success: true;
	returnData: Hex;
};

type GhostcallFailedResult = {
	success: false;
	returnData: Hex;
};

type GhostcallResult = GhostcallSuccessResult | GhostcallFailedResult;
```

Result order matches call order.

```ts
type GhostcallResultDecoder<TResult> = (
	returnData: Hex,
	entry: GhostcallSuccessResult,
	index: number,
) => TResult;
```

The decoder used by `aggregateDecodedCalls()`.

```ts
type GhostcallDecodedResults<TCalls extends readonly GhostcallDecodedCall[]> = {
	-readonly [Index in keyof TCalls]: TCalls[Index] extends {
		decodeResult: GhostcallResultDecoder<infer TResult>;
	}
		? TResult
		: never;
};
```

The tuple type inferred from the input decoders.

## Options

```ts
type GhostcallEncodeOptions = {
	maxInitcodeBytes?: number;
};
```

Sets the maximum full request size. The default is `49,152` bytes.

```ts
type GhostcallBlockReference = string | number | bigint;

type GhostcallEthCallOptions = {
	from?: Hex;
	gas?: HexQuantity;
	blockTag?: GhostcallBlockReference;
};
```

Controls the outer `eth_call`. Decimal block numbers are converted to RPC hex
quantities.

```ts
type GhostcallAggregateOptions = GhostcallEncodeOptions & {
	ethCall?: GhostcallEthCallOptions;
};
```

Options shared by `aggregateCalls()` and `aggregateDecodedCalls()`.

## Provider

```ts
type EIP1193ProviderWithRequestFn = {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
};
```

The minimum provider shape required by the SDK.
