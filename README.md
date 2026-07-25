# ghostcall

`ghostcall` batches EVM contract reads without deploying a Multicall contract.

## Documentation

Start at [ghostcall.volga.sh](https://ghostcall.volga.sh) for the setup guide,
recipes, API reference, protocol, and size limits.

## Install

```sh
npm install @volga-sh/evm-ghostcall
```

## Quick start

This example uses viem for its client and ABI helpers:

```sh
npm install viem
```

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

const abi = parseAbi(["function totalSupply() view returns (uint256)"]);
const token = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const [totalSupply] = await aggregateDecodedCalls(client, [
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
]);
```

See [Getting Started](https://ghostcall.volga.sh/getting-started/) for a complete
two-call walkthrough.

## API

- `aggregateDecodedCalls()` sends calls and returns decoded values.
- `aggregateCalls()` sends calls and returns raw success or failure results.
- `encodeCalls()` builds request data for an `eth_call` without `to`.
- `decodeResults()` parses a raw ghostcall response.

Read the [API reference](https://ghostcall.volga.sh/api/) for signatures,
options, return types, and errors.

## Development

```sh
npm install
npm run build:sdk
npm run test
npm run check
```

To work on the documentation:

```sh
npm run docs:dev
npm run docs:build
```

The source is hosted at
[github.com/volga-sh/ghostcall](https://github.com/volga-sh/ghostcall).
