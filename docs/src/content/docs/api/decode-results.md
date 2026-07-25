---
title: decodeResults
description: Parse the raw response returned by ghostcall.
---

`decodeResults()` turns the hex response from ghostcall into ordered success or
failure results. Use it after a request built with
[`encodeCalls()`](/api/encode-calls/).

## Usage

```ts
import { decodeResults } from "@volga-sh/evm-ghostcall";

const results = decodeResults("0x8002cafe0004deadbeef");

console.log(results);
// [
//   { success: true, returnData: "0xcafe" },
//   { success: false, returnData: "0xdeadbeef" },
// ]
```

## Signature

```ts
function decodeResults(data: Hex): GhostcallResult[];
```

## Parameters

### data

```ts
type Hex = `0x${string}`;
```

The raw hex returned by the outer `eth_call`.

Each result contains a two-byte header followed by return data:

```text
2 bytes header
N bytes return data
```

The first header bit records success. The remaining 15 bits record the return
data length.

## Returns

```ts
type GhostcallResult =
	| { success: true; returnData: Hex }
	| { success: false; returnData: Hex };
```

The array keeps the original call order. `decodeResults("0x")` returns an empty
array.

## Throws

- `TypeError` when `data` is not even-length hex with a `0x` prefix.
- `TypeError` when the response ends before a complete header or result body.

This function does not ABI-decode `returnData` and does not know how many calls
were sent. Applications can pass successful return data to an ABI library.
