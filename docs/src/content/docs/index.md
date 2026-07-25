---
title: Batch contract reads in one call
description: Batch EVM contract reads without deploying a Multicall contract.
template: splash
hero:
  title: Batch contract reads in one call
  tagline: ghostcall sends many EVM calls through one eth_call. No deployed Multicall contract or fixed address required.
  actions:
    - text: Build a batch
      link: /getting-started/
      icon: right-arrow
    - text: API reference
      link: /api/
      variant: secondary
    - text: GitHub
      link: https://github.com/volga-sh/ghostcall
      variant: minimal
      icon: external
head:
  - tag: title
    content: ghostcall — Batch contract reads in one call
  - tag: meta
    attrs:
      property: og:title
      content: ghostcall — Batch contract reads in one call
  - tag: meta
    attrs:
      name: twitter:title
      content: ghostcall — Batch contract reads in one call
---

## Install

```sh
npm install @volga-sh/evm-ghostcall viem
```

## Read two values

This example reads the WETH total supply and one account balance on Ethereum.
ghostcall sends both reads in one RPC request and returns decoded `bigint`
values in the same order.

```ts
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";
import {
	createPublicClient,
	decodeFunctionResult,
	encodeFunctionData,
	http,
	parseAbi,
} from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
	chain: mainnet,
	transport: http(),
});

const abi = parseAbi([
	"function totalSupply() view returns (uint256)",
	"function balanceOf(address account) view returns (uint256)",
]);
const token = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const account = "0x28C6c06298d514Db089934071355E5743bf21d60";

const [totalSupply, balance] = await aggregateDecodedCalls(client, [
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
			functionName: "balanceOf",
			args: [account],
		}),
		decodeResult: (data) =>
			decodeFunctionResult({
				abi,
				functionName: "balanceOf",
				data,
			}),
	},
]);

console.log({ totalSupply, balance });
```

## How it works

ghostcall adds the calls to a small Yul program and sends the combined bytes as
an `eth_call` without a `to` address. The EVM runs the program, calls each target,
and returns every result. Because `eth_call` only simulates execution, nothing is
deployed and no state change is saved.

<p class="gc-next">
	<a href="/getting-started/">Build a batch <span aria-hidden="true">→</span></a>
</p>
