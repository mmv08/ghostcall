---
title: API Reference
description: Choose a ghostcall function based on the required result.
---

ghostcall exports four functions, one error class, and their TypeScript types.

## Choose a function

| Goal | Function |
| --- | --- |
| Send calls and decode every result | [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/) |
| Send calls and inspect raw success or failure results | [`aggregateCalls()`](/api/aggregate-calls/) |
| Build request data without sending it | [`encodeCalls()`](/api/encode-calls/) |
| Parse a manually sent response | [`decodeResults()`](/api/decode-results/) |

Use `aggregateDecodedCalls()` when every call must succeed and decoded values
are needed. Use `aggregateCalls()` when some calls may fail or raw return data
is needed. Use `encodeCalls()` and `decodeResults()` for manually sent RPC
requests.

## Exports

```ts
import {
	aggregateCalls,
	aggregateDecodedCalls,
	decodeResults,
	encodeCalls,
	GhostcallSubcallError,
} from "@volga-sh/evm-ghostcall";
```

[`GhostcallSubcallError`](/api/subcall-error/) identifies the failed call when a
batch is configured to stop on failure.

See [Types](/api/types/) for the shared input, result, option, and provider
types.

## Next

- Open the function page that matches the task.
- Read [Limits](/limits/) before building unusually large batches.
