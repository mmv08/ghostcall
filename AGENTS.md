# agents.md

This file provides project instructions for coding agents working in the `ghostcall` repository.

## Project Overview

`ghostcall` is a minimal Yul plus TypeScript SDK for batching CREATE-style `eth_call` requests.

- `src/Ghostcall.yul` is the core protocol implementation. It is initcode, not deployed runtime code.
- `src/sdk/index.ts` is the public SDK surface for request encoding and response decoding.
- `src/sdk/generated/initcode.ts` is generated from the Foundry artifact and must not be edited by hand.
- `test/ghostcall.test.ts` covers end-to-end protocol behavior against a real local chain.
- `test/sdk.test.ts` covers the SDK's wire-format encoding and decoding rules.

The project should stay small, auditable, and explicit. Prefer code that maps cleanly onto the underlying EVM and wire-format behavior.

## Key Commands

Run all commands from the repository root.

```bash
npm run build:contracts      # Build the Yul contract with Foundry and refresh generated SDK initcode
npm run build:sdk            # Build contracts, refresh initcode, then typecheck
npm run generate:sdk:initcode
npm run check                # Lint and static checks with Biome
npm run check:fix            # Auto-fix Biome issues where possible
npm run format               # Format with Biome
npm run typecheck            # TypeScript type checking
npm run test                 # Rebuild contracts and run the full Node test suite
npm run check:sdk:initcode   # Verify generated initcode is up to date
```

## Architecture

### Core Structure

- `src/Ghostcall.yul` is the source of truth for protocol semantics, payload parsing, result packing, and CREATE-return constraints.
- `src/sdk/index.ts` is a thin translation layer over the wire format. It should stay provider-agnostic and hex-oriented.
- `scripts/generate-sdk-initcode.mjs` derives the bundled initcode from the Foundry artifact. Fix generation issues in the source or generator, not in the generated file.
- `test/support/` contains RPC, Anvil, ABI, and artifact helpers for integration tests.
- `README.md` documents the public protocol and SDK contract. If public semantics change, update it.

### Main Design Philosophy

The project follows a small, protocol-first lifecycle:

1. Accept explicit caller intent as raw call entries.
2. Encode that intent into a compact binary payload plus bundled initcode.
3. Execute the initcode through CREATE-style `eth_call` semantics and decode the packed result blob.

The SDK should remain a translation layer, not a framework. Avoid adding abstractions that hide protocol rules, wire-format limits, ordering guarantees, or failure semantics.

### Core Principles

1. Keep the surface minimal and auditable.
2. Prefer protocol correctness over convenience helpers.
3. Keep the SDK provider-agnostic unless there is a strong reason not to.
4. Maintain strict TypeScript types and explicit runtime invariants at wire boundaries.
5. Prefer integration testing with real Anvil execution over mocks of protocol behavior.
6. Let provider and RPC errors bubble unless wrapping adds real clarity.
7. Keep implementations straightforward; do not trade readability for cleverness.
8. Keep Yul, generated initcode, SDK behavior, tests, and README examples in lockstep.

### API Design Philosophy

This repository is a library. Its API is part of its documentation.

North star: by reading a function name and its parameters, a developer should be able to predict the implementation's behavior.

- Choose literal, self-descriptive names.
- Prefer explicit data structures over magic defaults.
- Keep return values predictable and stable.
- Make limits and failure behavior obvious in names, types, docs, or thrown errors.
- Do not add thin convenience layers that obscure ordering, length limits, revert behavior, or transport assumptions.

## Workflow Rules

1. Lead with the user or protocol outcome before making changes.
2. Read the affected Yul, SDK, tests, and docs before changing semantics.
3. Work incrementally: complete one coherent protocol or API change at a time.
4. Update tests in the same change as the implementation.
5. If `src/Ghostcall.yul` changes, regenerate `src/sdk/generated/initcode.ts` immediately.
6. Run relevant checks frequently: `npm run build:contracts`, `npm run test`, `npm run typecheck`, and `npm run check`.
7. Surface edge cases early: empty batches, malformed payloads, size limits, revert data, and result ordering.
8. Ask for clarification when semantics are ambiguous instead of inventing protocol behavior.
9. Comments should explain why, especially around EVM offsets, bit packing, memory layout, and size ceilings.
10. When behavior is subtle, verify against actual EVM and JSON-RPC behavior rather than relying on guesswork.

## Testing Approach

Tests in this repository are real execution tests, not abstract unit exercises.

- Prefer `npm run test` as the default validation path for behavior changes.
- `test/ghostcall.test.ts` should cover protocol semantics end to end with a real ephemeral `anvil` instance.
- `test/sdk.test.ts` should cover SDK encoding, decoding, and validation behavior directly.
- Keep tests self-contained and descriptive.
- Use `test/support/` helpers for repeated chain setup, ABI operations, and RPC interactions.
- Wait for receipts before asserting state changes when transactions are sent in tests.
- Add regression coverage for every bug in payload parsing, result decoding, or size-limit enforcement.

## Best Practices

### Documentation and Examples

- Public SDK functions should have accurate JSDoc.
- Examples should be runnable, concise, and focused on `ghostcall`, not on provider boilerplate.
- README examples should reflect actual tested behavior.
- Internal helpers with non-obvious invariants should have short comments or docstrings.

### TypeScript Conventions

- Use strict typing and avoid `any`.
- Prefer `type` aliases unless an `interface` is clearly better.
- Exported functions should have explicit return types.
- Use runtime validation at string and wire boundaries, where TypeScript cannot protect callers.
- Avoid unnecessary assertions and wrappers; use them only when narrowing external input or bridging third-party type limitations.

### Generated Artifacts

- Do not hand-edit `src/sdk/generated/initcode.ts`.
- Treat generated output as derived state.
- If the generated file changes unexpectedly, inspect `src/Ghostcall.yul`, Foundry artifacts, and `scripts/generate-sdk-initcode.mjs`.

## Common Patterns

### SDK Boundary Pattern

The public SDK should continue to accept and return raw `0x`-prefixed hex strings. Provider integration, ABI decoding, and higher-level call policy belong to callers.

### Validation Pattern

Use runtime checks where data crosses an untyped boundary:

- hex shape and prefix validation
- address length validation
- protocol size limits
- truncated payload or response detection

Do not add redundant runtime validation where TypeScript already proves the invariant and the missing check does not create a protocol or safety risk.

### Error Handling Pattern

- Fail fast on malformed caller input.
- Preserve deterministic behavior for batch ordering and packed output shape.
- Bubble provider and transport failures unless extra context materially improves debugging.
- Keep top-level protocol failure behavior intentional. If the Yul program reverts with empty data for malformed payloads or return-size overflow, preserve that behavior unless the protocol itself is being revised.

## Security Considerations

`ghostcall` executes in `eth_call`, so it does not persist state onchain, but correctness still matters because downstream code may make decisions from these results.

### Critical Safety Requirements

1. Treat encoding, decoding, and ordering bugs as security-relevant correctness issues.
2. Preserve fail-closed behavior for malformed input, truncated payloads, and return-size overflow.
3. Treat wire-format limits as protocol constraints, not advisory suggestions.
4. Keep bit packing, offsets, and size constants named and explained.
5. Any change to public semantics must come with tests and documentation updates.

### Code Review Checklist

- [ ] Public behavior changes are covered by tests.
- [ ] Edge cases and failure paths are tested.
- [ ] `src/Ghostcall.yul` changes are reflected in regenerated SDK initcode.
- [ ] README and JSDoc still match actual behavior.
- [ ] No new abstraction hides important protocol semantics.
- [ ] Runtime validation is present at untrusted input boundaries.

## Developer Notes

- Use lowercase `ghostcall` for the project or protocol name in prose.
- Use `Ghostcall...` for exported TypeScript type and symbol names where appropriate.
- Keep the public SDK intentionally narrow: encode calls, decode results, and little else.
- Prefer readable Yul with explicit comments over dense micro-optimizations unless size or gas pressure makes optimization necessary.
- If initcode size or return-size ceilings become a concern, optimize deliberately and keep the rationale documented.

## File Scope Guidelines

This file should stay stable and process-oriented.

### What to Include

- architectural decisions
- coding and API design principles
- testing and verification workflow
- safety and review expectations
- essential project commands

### What Not to Include

- temporary TODOs
- volatile implementation details
- dependency-version churn
- issue-specific notes that belong in code or PR discussion
- library-specific preferences that do not matter to this repository

### Maintenance Principles

1. Prefer durable guidance over exhaustive detail.
2. Document how to work in the codebase, not every fact about it.
3. Favor principles over brittle instructions.
4. Keep the file aligned with the repository's actual structure and workflows.
