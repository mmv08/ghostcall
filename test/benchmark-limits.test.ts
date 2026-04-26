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
	runBenchmark,
} from "../scripts/benchmark-limits.ts";
import { encodeCalls, type Hex } from "../src/sdk/index.ts";

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
		assert.throws(
			() =>
				parseBenchmarkArgs(
					[
						"--rpc-url",
						"https://example.invalid/rpc",
						"--mode",
						"balances",
						"--token",
						tokenA,
					],
					{},
				),
			/owner/i,
		);
	});

	await t.test("rejects non-numeric numeric CLI options locally", () => {
		assert.throws(
			() =>
				parseBenchmarkArgs(
					[
						"--rpc-url",
						"https://example.invalid/rpc",
						"--mode",
						"raw",
						"--gas",
						"banana",
					],
					{},
				),
			/--gas must be a non-negative safe integer/,
		);
		assert.throws(
			() =>
				parseBenchmarkArgs(
					[
						"--rpc-url",
						"https://example.invalid/rpc",
						"--mode",
						"raw",
						"--max-calls",
						"Infinity",
					],
					{},
				),
			/--max-calls must be a non-negative safe integer/,
		);
		assert.throws(
			() =>
				parseBenchmarkArgs(
					[
						"--rpc-url",
						"https://example.invalid/rpc",
						"--mode",
						"raw",
						"--timeout-ms",
					],
					{},
				),
			/--timeout-ms must be a non-negative safe integer/,
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
		assert.throws(
			() => createRawInitcodeSizeProbe(4),
			/createRawInitcodeSizeProbe sizeBytes must be an integer >= 5/,
		);
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

	await t.test(
		"caps balance searches by configured initcode bytes",
		async () => {
			const originalFetch = globalThis.fetch;
			const ghostcallInitcodeBytes = byteLength(encodeCalls([]));
			const maxInitcodeBytes =
				ghostcallInitcodeBytes + 3 * balanceInputBytesPerCall;
			const observedCreateDataBytes: number[] = [];

			globalThis.fetch = async (_input, init) => {
				const request = JSON.parse(String(init?.body)) as {
					id: number;
					method: string;
					params: unknown[];
				};

				if (request.method === "eth_chainId") {
					return jsonRpcResponse(request.id, "0x1");
				}

				if (request.method === "eth_blockNumber") {
					return jsonRpcResponse(request.id, "0x2");
				}

				assert.equal(request.method, "eth_call");
				const call = request.params[0] as { data: Hex };
				const createDataBytes = byteLength(call.data);
				const count =
					(createDataBytes - ghostcallInitcodeBytes) / balanceInputBytesPerCall;
				assert.equal(Number.isInteger(count), true);
				observedCreateDataBytes.push(createDataBytes);

				return jsonRpcResponse(request.id, balanceResultPayload(count));
			};

			try {
				const report = await runBenchmark({
					rpcUrl: "https://example.invalid/rpc",
					mode: "balances",
					tokens: [tokenA],
					owners: [ownerA],
					blockTag: "latest",
					from: ownerA,
					timeoutMs: 30_000,
					maxCalls: 10,
					maxInitcodeBytes,
					maxRuntimeBytes: 1,
					json: false,
				});

				assert.equal(report.balances?.maxPass, 3);
				assert.equal(report.balances?.exhaustedConfiguredMax, true);
				assert.equal(report.balances?.fullCreateDataBytes, maxInitcodeBytes);
				assert.deepEqual(observedCreateDataBytes, [
					ghostcallInitcodeBytes + balanceInputBytesPerCall,
					ghostcallInitcodeBytes + 2 * balanceInputBytesPerCall,
					maxInitcodeBytes,
				]);
			} finally {
				globalThis.fetch = originalFetch;
			}
		},
	);

	await t.test(
		"reports failed balance subcalls as probe failures",
		async () => {
			const originalFetch = globalThis.fetch;
			const ghostcallInitcodeBytes = byteLength(encodeCalls([]));
			const observedCounts: number[] = [];

			globalThis.fetch = async (_input, init) => {
				const request = JSON.parse(String(init?.body)) as {
					id: number;
					method: string;
					params: unknown[];
				};

				if (request.method === "eth_chainId") {
					return jsonRpcResponse(request.id, "0x1");
				}

				if (request.method === "eth_blockNumber") {
					return jsonRpcResponse(request.id, "0x2");
				}

				assert.equal(request.method, "eth_call");
				const call = request.params[0] as { data: Hex };
				const count =
					(byteLength(call.data) - ghostcallInitcodeBytes) /
					balanceInputBytesPerCall;
				assert.equal(Number.isInteger(count), true);
				observedCounts.push(count);

				return jsonRpcResponse(
					request.id,
					balanceResultPayload(count, count <= 2),
				);
			};

			try {
				const report = await runBenchmark({
					rpcUrl: "https://example.invalid/rpc",
					mode: "balances",
					tokens: [tokenA],
					owners: [ownerA],
					blockTag: "latest",
					from: ownerA,
					timeoutMs: 30_000,
					maxCalls: 5,
					maxInitcodeBytes:
						ghostcallInitcodeBytes + 5 * balanceInputBytesPerCall,
					maxRuntimeBytes: 1,
					json: false,
				});

				assert.equal(report.balances?.maxPass, 2);
				assert.equal(report.balances?.firstFail, 3);
				assert.equal(
					report.balances?.failure,
					"balanceOf call 0 returned a failed result entry",
				);
				assert.deepEqual(observedCounts, [1, 2, 4, 3]);
			} finally {
				globalThis.fetch = originalFetch;
			}
		},
	);

	await t.test("propagates invalid balance input errors", async () => {
		const originalFetch = globalThis.fetch;
		const methods: string[] = [];

		globalThis.fetch = async (_input, init) => {
			const request = JSON.parse(String(init?.body)) as {
				id: number;
				method: string;
			};
			methods.push(request.method);

			if (request.method === "eth_chainId") {
				return jsonRpcResponse(request.id, "0x1");
			}

			if (request.method === "eth_blockNumber") {
				return jsonRpcResponse(request.id, "0x2");
			}

			assert.fail("invalid balance inputs should not reach eth_call");
		};

		try {
			await assert.rejects(
				runBenchmark({
					rpcUrl: "https://example.invalid/rpc",
					mode: "balances",
					tokens: ["0x1234" as Hex],
					owners: [ownerA],
					blockTag: "latest",
					from: ownerA,
					timeoutMs: 30_000,
					maxCalls: 10,
					maxInitcodeBytes: 1_000,
					maxRuntimeBytes: 1,
					json: false,
				}),
				/calls\[0\]\.to must be a 20-byte hex string/,
			);
			assert.deepEqual(methods, ["eth_chainId", "eth_blockNumber"]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

function byteLength(value: Hex): number {
	return (value.length - 2) / 2;
}

function jsonRpcResponse(id: number, result: Hex): Response {
	return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
		headers: { "content-type": "application/json" },
	});
}

function balanceResultPayload(count: number, success = true): Hex {
	const resultEntry = `${success ? "8020" : "0020"}${"00".repeat(32)}`;
	return `0x${resultEntry.repeat(count)}` as Hex;
}
