---
title: Development
description: Build, test, and update the ghostcall repository.
---

This page is for contributors working in the ghostcall repository. Run all
commands from the repository root.

## Install and check the project

```sh
npm install
npm run build:sdk
npm run test
npm run typecheck
npm run check
```

`build:sdk` compiles the Yul program, regenerates the bundled SDK initcode, and
type-checks the SDK build.

## Work on the Yul program

```sh
npm run build:contracts
npm run check:sdk:initcode
```

`build:contracts` compiles `src/Ghostcall.yul` and regenerates
`src/sdk/generated/initcode.ts`. Never edit the generated initcode file by hand.

After a Yul change, run the full test suite. The integration tests start Anvil
and exercise the compiled program on a real local EVM.

## Work on the docs

```sh
npm run docs:dev
npm run docs:build
npm run docs:preview
```

Documentation source files live in `docs/src`. The static build is written to
`docs/dist`.

## Repository map

- `src/Ghostcall.yul` contains the EVM program.
- `src/sdk/index.ts` contains the public TypeScript API.
- `scripts/generate-sdk-initcode.mjs` copies compiled initcode into the SDK.
- `test/ghostcall.test.ts` tests program behavior against Anvil.
- `test/sdk.test.ts` tests encoding, decoding, validation, and SDK failure
  behavior.

When public behavior changes, update the implementation, generated initcode,
tests, API comments, README, and docs in the same pull request.
