import assert from "node:assert/strict";
import test from "node:test";

import {
	balanceInputBytesPerCall,
	balanceReturnedBytesPerCall,
	buildBalanceCalls,
	createRawInitcodeSizeProbe,
	createRawRuntimeReturnProbe,
	encodeBalanceOfCalldata,
	findLimit,
	parseBenchmarkArgs,
} from "../scripts/benchmark-limits.ts";
import type { Hex } from "../src/sdk/index.ts";

const tokenA = "0x1111111111111111111111111111111111111111";
const tokenB = "0x2222222222222222222222222222222222222222";
const ownerA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ownerB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

test("benchmark limit helpers", async (t) => {
	await t.test("parses CLI and environment configuration", () => {
		const parsed = parseBenchmarkArgs(
			[
				"--rpc-url",
				"https://example.invalid/rpc",
				"--mode",
				"balances",
				"--token",
				`${tokenA},${tokenB}`,
				"--owner",
				ownerA,
				"--owner",
				ownerB,
				"--block",
				"123",
				"--from",
				ownerA,
				"--gas",
				"1000000",
				"--timeout-ms",
				"1000",
				"--max-calls",
				"200",
				"--max-initcode-bytes",
				"0x100",
				"--max-runtime-bytes",
				"0x200",
				"--json",
			],
			{},
		);

		assert.equal(parsed.help, false);
		if (parsed.help) {
			assert.fail("expected config parse result");
		}

		assert.equal(parsed.config.rpcUrl, "https://example.invalid/rpc");
		assert.equal(parsed.config.mode, "balances");
		assert.deepEqual(parsed.config.tokens, [tokenA, tokenB]);
		assert.deepEqual(parsed.config.owners, [ownerA, ownerB]);
		assert.equal(parsed.config.blockTag, "0x7b");
		assert.equal(parsed.config.from, ownerA);
		assert.equal(parsed.config.gas, "0xf4240");
		assert.equal(parsed.config.timeoutMs, 1000);
		assert.equal(parsed.config.maxCalls, 200);
		assert.equal(parsed.config.maxInitcodeBytes, 256);
		assert.equal(parsed.config.maxRuntimeBytes, 512);
		assert.equal(parsed.config.json, true);

		const rawParsed = parseBenchmarkArgs(["--mode", "raw"], {
			GHOSTCALL_BENCH_RPC_URL: "https://env.invalid/rpc",
		});

		assert.equal(rawParsed.help, false);
		if (rawParsed.help) {
			assert.fail("expected config parse result");
		}

		assert.equal(rawParsed.config.rpcUrl, "https://env.invalid/rpc");
		assert.equal(rawParsed.config.tokens.length, 0);
		assert.equal(rawParsed.config.owners.length, 0);
	});

	await t.test("requires balance-mode token and owner inputs", () => {
		assert.throws(
			() =>
				parseBenchmarkArgs(
					["--rpc-url", "https://example.invalid/rpc", "--mode", "balances"],
					{},
				),
			/token/i,
		);
	});

	await t.test("encodes ERC-20 balanceOf calldata", () => {
		assert.equal(
			encodeBalanceOfCalldata(ownerA),
			`0x70a08231${"0".repeat(24)}${ownerA.slice(2)}`,
		);
	});

	await t.test("cycles token and owner inputs deterministically", () => {
		const tokens = [tokenA, tokenB] as readonly Hex[];
		const owners = [ownerA, ownerB] as readonly Hex[];
		const calls = buildBalanceCalls(5, tokens, owners);

		assert.deepEqual(
			calls.map((call) => [call.to, call.data]),
			[
				[tokenA, encodeBalanceOfCalldata(ownerA)],
				[tokenB, encodeBalanceOfCalldata(ownerA)],
				[tokenA, encodeBalanceOfCalldata(ownerB)],
				[tokenB, encodeBalanceOfCalldata(ownerB)],
				[tokenA, encodeBalanceOfCalldata(ownerA)],
			],
		);
	});

	await t.test("builds balance calls with expected byte math", () => {
		const calls = buildBalanceCalls(2, [tokenA], [ownerA]);

		assert.equal(balanceInputBytesPerCall, 58);
		assert.equal(balanceReturnedBytesPerCall, 34);
		assert.equal(calls.length, 2);
		assert.deepEqual(calls[0], {
			to: tokenA,
			data: encodeBalanceOfCalldata(ownerA),
		});
		assert.deepEqual(calls[1], {
			to: tokenA,
			data: encodeBalanceOfCalldata(ownerA),
		});
	});

	await t.test("generates exact-size raw initcode probes", () => {
		assert.equal(createRawInitcodeSizeProbe(5), "0x60006000f3");
		assert.equal(createRawInitcodeSizeProbe(8), "0x60006000f3000000");
		assert.throws(() => createRawInitcodeSizeProbe(4), RangeError);
	});

	await t.test("generates raw runtime return probes", () => {
		assert.equal(createRawRuntimeReturnProbe(0), "0x60006000f3");
		assert.equal(createRawRuntimeReturnProbe(1), "0x60016000f3");
		assert.equal(createRawRuntimeReturnProbe(24_576), "0x6160006000f3");
	});

	await t.test(
		"finds a threshold with exponential then binary search",
		async () => {
			const candidates: number[] = [];
			const result = await findLimit(1, 20, async (candidate) => {
				candidates.push(candidate);
				return candidate <= 13 ? null : "too large";
			});

			assert.equal(result.maxPass, 13);
			assert.equal(result.firstFail, 14);
			assert.equal(result.exhaustedConfiguredMax, false);
			assert.equal(new Set(candidates).size, candidates.length);
		},
	);

	await t.test("reports lower bounds when no failure is found", async () => {
		const result = await findLimit(1, 10, async () => null);

		assert.equal(result.maxPass, 10);
		assert.equal(result.firstFail, null);
		assert.equal(result.exhaustedConfiguredMax, true);
		assert.equal(result.failure, null);
	});
});
