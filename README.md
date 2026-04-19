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
- per-call `allowFailure`

That keeps the initcode small, auditable, and easy to extend.

## Input format

The caller sends:

```text
<compiled zcall initcode><payload>
```

Payload layout:

```text
4 bytes  magic = "ZCL1"
N bytes  repeated call entries
```

Each call entry:

```text
20 bytes target
 1 byte  flags, bit 0 = allowFailure
 2 bytes calldata length (big-endian uint16)
 N bytes calldata
```

Notes:

- Payload bytes are not normal calldata. They are appended after the compiled initcode and read via
  `CODECOPY`.
- Per-call calldata is limited to `65535` bytes because the format uses `uint16`.
- The whole CREATE payload is still limited by the initcode size ceiling.

## Output format

The program returns:

```text
4 bytes  magic = "ZCR1"
N bytes  repeated result entries
```

Each result entry:

```text
 1 byte  success flag
 2 bytes returndata length (big-endian uint16)
 N bytes returndata
```

If a subcall fails and `allowFailure` is unset, the whole aggregate reverts with:

- `ZCallFailed(uint256)` selector `0x2dd41103`

Other top-level validation errors use:

- `ZCallMalformedPayload()` selector `0x0ea77364`
- `ZCallReturnTooLarge()` selector `0xe5f212d6`

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
- verifies configurable success paths, calldata-vs-method precedence, allowed failures, and top-level revert handling.

For static TypeScript checking:

```bash
npm run typecheck
```

## Design notes

The implementation chooses Yul over raw bytecode because it keeps the control flow legible while
still mapping one-to-one onto the EVM concepts that matter here:

- `dataoffset(...)` anchors the appended payload boundary
- `codecopy` loads the appended payload
- `staticcall` performs read-only subcalls
- `returndatacopy` packs the aggregate response
- `return` hands the batch result back to RPC

That gives you a maintainable base version first, with a straightforward path to hand-optimizing
hot spots later if initcode size becomes the bottleneck.
