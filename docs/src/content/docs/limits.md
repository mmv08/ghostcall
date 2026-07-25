---
title: Limits
description: Size limits for ghostcall calls, requests, and responses.
---

Check these limits when building large batches. A chain or RPC provider may set
a lower limit than the protocol.

## Calldata per call

Each call stores its calldata length in two bytes. One call can contain at most
`65,535` bytes of calldata.

`encodeCalls()` rejects larger values before sending an RPC request.

## Full request

The request data contains the ghostcall program and every encoded call:

```text
<ghostcall program><encoded calls>
```

Ethereum limits contract creation code to `49,152` bytes under EIP-3860. Other
chains may use another limit, and RPC providers may reject smaller requests.

The bundled ghostcall program is currently `91` bytes. SDK tests pin that size
so changes are explicit.

`encodeCalls()` uses `49,152` as its default limit. Pass `maxInitcodeBytes` to
set a different ceiling:

```ts
const data = encodeCalls(calls, {
	maxInitcodeBytes: 32_000,
});
```

## Return data per call

Each result stores its return-data length in 15 bits. One result can contain at
most `32,767` bytes.

The ghostcall program reverts with empty data when a call exceeds this limit.

## Full response

Ethereum normally limits returned contract code to `24,576` bytes under
EIP-170. A CREATE-style `eth_call` treats the ghostcall response as would-be
contract code, so this limit often applies to the full response, including the
two-byte header for every result.

Other chains and RPC providers may accept more or less. Test the application's
endpoint.

## Test an endpoint

The repository includes a script that probes request and response limits:

```sh
npm run benchmark:limits -- --rpc-url "$RPC_URL" --mode raw
```

Test a realistic ERC-20 balance workload with:

```sh
npm run benchmark:limits -- \
  --rpc-url "$RPC_URL" \
  --mode balances \
  --token "$TOKEN_ADDRESS" \
  --owner "$OWNER_ADDRESS"
```

Run the script with `--help` to see block, sender, gas, timeout, search ceiling,
and JSON output options.

## Next

- Use [`encodeCalls()`](/api/encode-calls/) to set the request-size ceiling.
- Read the [Protocol](/protocol/) for the length fields behind these limits.
