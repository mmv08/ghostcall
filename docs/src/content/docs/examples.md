---
title: Recipes
description: Copy-ready ghostcall patterns for failures, block options, and manual RPC requests.
---

These recipes cover cases beyond the first decoded batch. The snippets use a
viem client:

```ts
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
	chain: mainnet,
	transport: http(),
});

const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
```

## Allow one call to fail

`aggregateCalls()` returns raw hex results. A failed call throws unless that
entry sets `allowFailure: true`.

```ts
import { aggregateCalls } from "@volga-sh/evm-ghostcall";

const results = await aggregateCalls(client, [
	{
		// totalSupply()
		to: weth,
		data: "0x18160ddd",
	},
	{
		// Unknown function selector
		to: weth,
		data: "0xdeadbeef",
		allowFailure: true,
	},
]);

for (const result of results) {
	console.log(result.success, result.returnData);
}
```

The second entry remains in `results` with `success: false`. Its `returnData`
contains revert data when the contract returned any.

## Set the block, sender, and gas

Pass outer `eth_call` options through `ethCall`. Numeric block values are sent as
hex quantities.

```ts
import { aggregateCalls } from "@volga-sh/evm-ghostcall";

const [result] = await aggregateCalls(
	client,
	[
		{
			// totalSupply()
			to: weth,
			data: "0x18160ddd",
		},
	],
	{
		ethCall: {
			blockTag: 19_000_000n,
			from: "0x0000000000000000000000000000000000000000",
			gas: "0x2dc6c0",
		},
	},
);
```

Omitted options use provider defaults. The block defaults to `"latest"`.

## Send a raw RPC request

Use `encodeCalls()` to build the request data and `decodeResults()` to parse the
response.

```ts
import { decodeResults, encodeCalls } from "@volga-sh/evm-ghostcall";

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

const body = (await response.json()) as {
	error?: { message?: string };
	result?: `0x${string}`;
};

if (!body.result) {
	throw new Error(body.error?.message ?? "eth_call returned no result");
}

const results = decodeResults(body.result);
```

The `eth_call` object has no `to` field. This tells the EVM to run `data` as
contract creation code instead of calling an existing contract.

## Next

- [Compare the API functions](/api/).
- [Read the protocol](/protocol/) for the request and response byte layouts.
