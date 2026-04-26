# ghostcall

`ghostcall` is a zero-deployment batching program for CREATE-style `eth_call`.

Instead of calling a deployed Multicall contract, the client sends compiled initcode plus an
appended payload. The EVM executes that initcode exactly as if it were deploying a contract, but
because the transport is `eth_call`, nothing is persisted. Whatever the initcode `RETURN`s comes
back as the RPC result.

The implementation lives in [`src/Ghostcall.yul`](src/Ghostcall.yul).

## Quick example

```ts
import { decodeResults, encodeCalls } from "evm-ghostcall";
import {
	createPublicClient,
	decodeFunctionResult,
	encodeFunctionData,
	http,
	parseAbi,
} from "viem";
import { mainnet } from "viem/chains";

const erc20Abi = parseAbi([
	"function balanceOf(address account) view returns (uint256)",
	"function allowance(address owner, address spender) view returns (uint256)",
]);

const token = "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const owner = "0x1111111111111111111111111111111111111111";
const spender = "0x2222222222222222222222222222222222222222";

const client = createPublicClient({
	chain: mainnet,
	transport: http(),
});

const data = encodeCalls([
	{
		to: token,
		data: encodeFunctionData({
			abi: erc20Abi,
			functionName: "balanceOf",
			args: [owner],
		}),
	},
	{
		to: token,
		data: encodeFunctionData({
			abi: erc20Abi,
			functionName: "allowance",
			args: [owner, spender],
		}),
	},
]);

const rawResult = await client.request({
	method: "eth_call",
	params: [{ data }, "latest"],
});

const [balanceResult, allowanceResult] = decodeResults(rawResult);

if (!balanceResult?.success || !allowanceResult?.success) {
	throw new Error("Ghostcall subcall failed");
}

const balance = decodeFunctionResult({
	abi: erc20Abi,
	functionName: "balanceOf",
	data: balanceResult.returnData,
});

const allowance = decodeFunctionResult({
	abi: erc20Abi,
	functionName: "allowance",
	data: allowanceResult.returnData,
});

console.log({ balance, allowance });
```

## Why this works

- `eth_call` without a `to` field executes the supplied `data` as CREATE initcode.
- Initcode can read caller-appended bytes from its own code using `CODECOPY`.
- Initcode can perform ordinary external calls, pack the returned bytes into memory, and `RETURN` them.
- Returned bytes are still subject to CREATE limits because the client treats them as would-be
  runtime bytecode.

## Development stack

The repository now uses a minimal TypeScript-based test stack:

- Foundry for contract compilation and `anvil`
- Node's built-in [`node:test`](https://nodejs.org/api/test.html) runner
- Node's built-in TypeScript stripping for test execution
- [`ox`](https://www.npmjs.com/package/ox) for JSON-RPC, ABI, hex, and byte utilities
- [`@safe-global/mock-contract`](https://www.npmjs.com/package/@safe-global/mock-contract) for configurable mock-call behavior

That keeps the dependency footprint small while giving us a stable place to grow ABI-heavy tests.

## TypeScript SDK

The repository also includes a minimal internal-first TypeScript SDK in
[`src/sdk/index.ts`](src/sdk/index.ts).

It intentionally does only two things:

- `encodeCalls(calls)` bundles the canonical Ghostcall initcode and returns the full CREATE-style `eth_call` data blob.
- `decodeResults(data)` parses the packed Ghostcall response format into `{ success, returnData }` entries.

`encodeCalls` fails fast if any subcall exceeds the `uint16` calldata limit or if the full
encoded CREATE payload would exceed the EVM initcode size ceiling.

The SDK has no provider helpers, no ABI helpers, and no runtime artifact reads.

## Current scope

This implementation is intentionally focused on the smallest SDK-first variant:

- zero-value `CALL` for subcalls
- packed binary input instead of ABI encoding
- packed binary output instead of ABI encoding
- always-return result entries for every subcall
- SDK-enforced strict failure policy instead of engine-enforced batch reverts

That keeps the initcode small, auditable, and easy to extend.

## Why not a naive Solidity constructor

A straightforward deployless design is to write a Solidity constructor that:

- accepts an ABI-encoded array of calls,
- executes them in the constructor, and
- rewrites constructor memory so the returned bytes look like a normal ABI-encoded multicall result.

That approach works, but this project intentionally uses a lower-level Yul program instead.

Advantages of the current design:

- smaller base program, because it avoids Solidity's constructor scaffolding and generic ABI decoding,
- a tighter wire format, because both requests and responses use a compact custom binary layout instead of full ABI encoding,
- less compiler coupling, because the batching logic does not depend on Solidity memory-layout assumptions inside constructor-generated code.

In practice, this means less initcode to ship on every request, fewer bytes on the wire, and a design that is easier to reason about at the EVM level.

## Input format

The caller sends:

```text
<compiled ghostcall initcode><payload>
```

Payload layout:

```text
N bytes  repeated call entries
```

Each call entry:

```text
 2 bytes calldata length (big-endian uint16)
20 bytes target
 N bytes calldata
```

Notes:

- Payload bytes are not normal calldata. They are appended after the compiled initcode and read via
  `CODECOPY`.
- The length comes first on purpose. Ghostcall copies the 22-byte fixed header into scratch memory
  at offset `0x0a`, so one `mload(0x00)` exposes the length in the high 2 non-zero bytes and the
  target address in the low 20 bytes used by `CALL`.
- An empty payload is valid and returns an empty result blob.
- Per-call calldata is limited to `65535` bytes because the format uses `uint16`.
- The whole CREATE payload is still limited by the network/client initcode size ceiling.

## Output format

The program returns:

```text
N bytes  repeated result entries
```

Each result entry:

```text
 2 bytes packed header
         bit 15    = success flag
         bits 0-14 = returndata length (big-endian uint15)
 N bytes returndata
```

Subcall failures are returned inline as ordinary result entries with `success = 0`.

The engine only reverts for malformed payloads or per-entry return-size violations, and those
top-level reverts are intentionally empty. The SDK is expected to validate payloads up front and
impose any higher-level "fail the whole batch" policy for callers that want it.

The packed result header can represent up to `32767` bytes of returndata per entry. On
Ethereum, EIP-170's returned-code limit is usually the stricter bound: CREATE-style execution
limits the whole response to `24,576` bytes, including the 2-byte header on each entry.

## Limits

The aggregate response is returned through CREATE-style execution, so clients still treat it as
would-be runtime code. Ghostcall does not impose its own aggregate response cap; the effective
ceiling comes from the chain, client, RPC provider, gas setting, and request-size policy.

Common reference points:

- Ethereum's EIP-170 returned-code limit is `24,576` bytes.
- Ethereum's EIP-3860 initcode limit is `49,152` bytes.
- Other chains may set different values. For example, Monad documents larger contract-code and
  initcode limits.

Measure the endpoint you plan to use instead of assuming a consensus value. Provider-side request
limits can be lower than the chain limit.

## Benchmark limits

The repository includes a TypeScript benchmark for rough endpoint-specific measurements:

```bash
npm run benchmark:limits -- --rpc-url "$RPC_URL" --mode raw
```

`raw` mode probes accepted CREATE initcode bytes and returned runtime-code bytes. `balances` mode
uses a realistic ERC-20 balance workload:

```bash
npm run benchmark:limits -- \
  --rpc-url "$RPC_URL" \
  --mode balances \
  --token "$TOKEN_ADDRESS" \
  --owner "$OWNER_ADDRESS"
```

For balance benchmarking, pass token addresses that implement `balanceOf(address)` on the selected
chain. The script repeats those token and owner inputs, builds ghostcall batches with the public
SDK encoder, and searches for the largest successful call count. The balance search is capped by
both `--max-calls` and `--max-initcode-bytes`.

Useful options:

- `--mode raw|balances|all`, default `all`
- `--token` and `--owner`, repeatable or comma-separated
- `--block`, `--from`, `--gas`, and `--timeout-ms`
- `--max-calls`, `--max-initcode-bytes`, and `--max-runtime-bytes`
- `--json` for machine-readable output

## Install

```bash
npm install
```

## Build contracts

```bash
npm run build:contracts
```

The compiled artifacts are emitted into the standard Foundry artifact tree under `out/`.
That build step also refreshes the generated SDK initcode file at
[`src/sdk/generated/initcode.ts`](src/sdk/generated/initcode.ts).

## Test

```bash
npm test
```

The test suite:

- compiles the contracts with Foundry,
- starts an ephemeral `anvil` instance automatically,
- deploys and configures `MockContract` from Foundry artifacts,
- encodes function calldata with `ox`,
- executes a CREATE-style `eth_call` against Ghostcall,
- decodes both function return data and revert data with `ox`,
- verifies configurable success paths, calldata-vs-method precedence, inline failure entries, the empty-batch case, the CREATE request-size boundary, the CREATE return-size boundary, and top-level malformed-payload handling.

For static TypeScript checking:

```bash
npm run typecheck
```

## Design notes

The implementation chooses Yul over raw bytecode because it keeps the control flow legible while
still mapping one-to-one onto the EVM concepts that matter here:

- `dataoffset(...)` anchors the appended payload boundary
- `codecopy` streams headers and calldata directly from the appended payload
- the len-first header plus a `0x0a` scratch offset lets one `mload(0x00)` yield both calldata
  length and the `CALL` address word without extra masking
- `call` executes each subcall with zero value
- `returndatacopy` packs the aggregate response into a compact binary format
- `return` hands the batch result back to RPC

That gives you a maintainable base version first, with a straightforward path to hand-optimizing
hot spots later if initcode size becomes the bottleneck.
