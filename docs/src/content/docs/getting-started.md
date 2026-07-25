---
title: Getting Started
description: Install ghostcall and send a first batch of contract reads.
---

This guide installs ghostcall in an empty TypeScript project and reads two
ERC-20 values in one RPC request.

## 1. Install the packages

```sh
npm install @volga-sh/evm-ghostcall viem
```

ghostcall accepts any provider with a `request` method compatible with
[EIP-1193](https://eips.ethereum.org/EIPS/eip-1193). A provider sends JSON-RPC
requests to an EVM node. This guide uses viem for the provider and for ABI
encoding and decoding. Ethers, ox, and custom ABI helpers also work.

## 2. Create a client

```ts
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
	chain: mainnet,
	transport: http(),
});
```

Pass an RPC URL to `http("https://…")` when a specific or authenticated endpoint
is required.

## 3. Describe the reads

An ABI tells viem how to turn function names and arguments into calldata.
Calldata is the hex data sent to a contract function.

```ts
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

const erc20Abi = parseAbi([
	"function balanceOf(address account) view returns (uint256)",
	"function allowance(address owner, address spender) view returns (uint256)",
]);

const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const owner = "0x28C6c06298d514Db089934071355E5743bf21d60";
const spender = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
```

## 4. Send the batch

Each entry contains a target address, its calldata, and a function that decodes
the returned hex data.

```ts
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";

const [balance, allowance] = await aggregateDecodedCalls(client, [
	{
		to: usdc,
		data: encodeFunctionData({
			abi: erc20Abi,
			functionName: "balanceOf",
			args: [owner],
		}),
		decodeResult: (data) =>
			decodeFunctionResult({
				abi: erc20Abi,
				functionName: "balanceOf",
				data,
			}),
	},
	{
		to: usdc,
		data: encodeFunctionData({
			abi: erc20Abi,
			functionName: "allowance",
			args: [owner, spender],
		}),
		decodeResult: (data) =>
			decodeFunctionResult({
				abi: erc20Abi,
				functionName: "allowance",
				data,
			}),
	},
]);

console.log({ balance, allowance });
```

`balance` and `allowance` are inferred as `bigint`. Their order matches the call
order.

If either contract call fails, `aggregateDecodedCalls()` throws a
[`GhostcallSubcallError`](/api/subcall-error/). Use a recipe from the next page
when a failed call should not stop the batch.

## Next

- [Use a recipe](/examples/) to allow failures, query an older block, or send a
  raw RPC request.
- [Choose an API function](/api/) based on the required result shape.
