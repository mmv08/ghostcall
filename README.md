# evm-zcall

`evm-zcall` is a zero-deployment batching program for CREATE-style `eth_call`.

Instead of calling a deployed Multicall contract, the client sends compiled initcode plus an
appended payload. The EVM executes that initcode exactly as if it were deploying a contract, but
because the transport is `eth_call`, nothing is persisted. Whatever the initcode `RETURN`s comes
back as the RPC result.

The implementation lives in [`src/ZCall.yul`](/Users/mmv/Projects/Personal/evm-zcall/src/ZCall.yul).

## Why this works

- `eth_call` without a `to` field executes the supplied `data` as CREATE initcode.
- Initcode can read caller-appended bytes from its own code using `CODECOPY`.
- Initcode can perform `STATICCALL`s, pack the returned bytes into memory, and `RETURN` them.
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

## Current scope

This implementation is intentionally focused on the cleanest read-only variant:

- `STATICCALL` only
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
<compiled zcall initcode><payload>
```

Payload layout:

```text
N bytes  repeated call entries
```

Each call entry:

```text
20 bytes target
 2 bytes calldata length (big-endian uint16)
 N bytes calldata
```

Notes:

- Payload bytes are not normal calldata. They are appended after the compiled initcode and read via
  `CODECOPY`.
- An empty payload is valid and returns an empty result blob.
- Per-call calldata is limited to `65535` bytes because the format uses `uint16`.
- The whole CREATE payload is still limited by the initcode size ceiling.

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

The engine only reverts for malformed payloads or return-size violations, and those top-level
reverts are intentionally empty. The SDK is expected to validate payloads up front and impose any
higher-level "fail the whole batch" policy for callers that want it.

Per-call returndata is limited to `32767` bytes because the packed result header reserves one bit
for the success flag.

## Limits

Observed against local `anvil`:

- maximum returned CREATE data: `24,576` bytes
- maximum initcode size: `49,152` bytes

Those limits apply directly here because the returned batch result is interpreted as would-be
runtime code.

## Install

```bash
npm install
```

## Build contracts

```bash
npm run build:contracts
```

The compiled artifacts are emitted into the standard Foundry artifact tree under `out/`.

## Test

```bash
npm test
```

The test suite:

- compiles the contracts with Foundry,
- starts an ephemeral `anvil` instance automatically,
- deploys and configures `MockContract` from Foundry artifacts,
- encodes function calldata with `ox`,
- executes a CREATE-style `eth_call` against ZCall,
- decodes both function return data and revert data with `ox`,
- verifies configurable success paths, calldata-vs-method precedence, inline failure entries, the empty-batch case, and top-level malformed-payload handling.

For static TypeScript checking:

```bash
npm run typecheck
```

## Design notes

The implementation chooses Yul over raw bytecode because it keeps the control flow legible while
still mapping one-to-one onto the EVM concepts that matter here:

- `dataoffset(...)` anchors the appended payload boundary
- `codecopy` streams headers and calldata directly from the appended payload
- `staticcall` performs read-only subcalls
- `returndatacopy` packs the aggregate response into a compact binary format
- `return` hands the batch result back to RPC

That gives you a maintainable base version first, with a straightforward path to hand-optimizing
hot spots later if initcode size becomes the bottleneck.
