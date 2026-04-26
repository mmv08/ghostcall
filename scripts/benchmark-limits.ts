import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	decodeResults,
	encodeCalls,
	type GhostcallCall,
	type Hex,
} from "../src/sdk/index.ts";

export type BenchmarkMode = "raw" | "balances" | "all";

/**
 * Runtime configuration for the limit benchmark.
 *
 * @remarks
 * This script is an internal developer tool, so the config intentionally mirrors
 * the CLI flags one-to-one instead of hiding protocol choices behind another
 * abstraction. Each size cap is a search ceiling, not a claimed chain limit.
 */
export type BenchmarkConfig = {
	rpcUrl: string;
	mode: BenchmarkMode;
	tokens: readonly Hex[];
	owners: readonly Hex[];
	blockTag: string;
	from: Hex;
	gas?: Hex;
	timeoutMs: number;
	maxCalls: number;
	maxInitcodeBytes: number;
	maxRuntimeBytes: number;
	json: boolean;
};

export type LimitResult = {
	maxPass: number;
	firstFail: number | null;
	exhaustedConfiguredMax: boolean;
	configuredMax: number;
	attempts: number;
	failure: string | null;
};

export type BenchmarkReport = {
	chainId: Hex;
	latestBlock: Hex;
	blockTag: string;
	from: Hex;
	gas: Hex | null;
	timeoutMs: number;
	ghostcallInitcodeBytes: number;
	rawInitcode: LimitResult | null;
	rawRuntime: LimitResult | null;
	balances:
		| (LimitResult & {
				tokenCount: number;
				ownerCount: number;
				fullCreateDataBytes: number;
				appendedPayloadBytes: number;
				returnedBytes: number;
				inputBytesPerCall: number;
				returnedBytesPerCall: number;
		  })
		| null;
};

export type ParsedBenchmarkArgs =
	| {
			help: true;
	  }
	| {
			help: false;
			config: BenchmarkConfig;
	  };

const balanceOfSelector = "70a08231";
const defaultFrom = "0x0000000000000000000000000000000000000000";
const emptyRuntimeInitcode = "60006000f3";
const emptyRuntimeInitcodeBytes = emptyRuntimeInitcode.length / 2;
const prettyInteger = new Intl.NumberFormat("en-US");

export const balanceInputBytesPerCall = 20 + 2 + 36;
export const balanceReturnedBytesPerCall = 2 + 32;

let nextRpcId = 1;

/**
 * Parses the small CLI surface used by `npm run benchmark:limits`.
 *
 * @remarks
 * The parser accepts repeatable flags, comma-separated `--token`/`--owner`
 * lists, and environment fallbacks for RPC URL plus benchmark inputs. It keeps
 * validation deliberately light because this is a repo-local diagnostic script:
 * malformed developer input should fail loudly at the nearest protocol boundary.
 *
 * @param argv - Arguments after the script name, usually `process.argv.slice(2)`.
 * @param env - Environment source, injectable for tests.
 * @returns Either a help marker or the benchmark config.
 *
 * @throws {Error} If required balance-mode inputs are missing.
 *
 * @example
 * const parsed = parseBenchmarkArgs([
 *   "--rpc-url", "http://127.0.0.1:8545",
 *   "--mode", "raw",
 * ]);
 */
export function parseBenchmarkArgs(
	argv: readonly string[],
	env: Record<string, string | undefined> = process.env,
): ParsedBenchmarkArgs {
	const flags = new Set<string>();
	const values: Record<string, string[]> = {};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index] ?? "";
		if (arg === "--help" || arg === "-h") {
			flags.add("help");
			continue;
		}

		if (arg === "--json") {
			flags.add("json");
			continue;
		}

		const [rawName, inlineValue] = arg.slice(2).split("=", 2);
		const value = inlineValue ?? argv[index + 1] ?? "";
		values[rawName ?? ""] = [...(values[rawName ?? ""] ?? []), value];

		if (inlineValue === undefined) {
			index += 1;
		}
	}

	if (flags.has("help")) {
		return { help: true };
	}

	const last = (name: string): string | undefined => values[name]?.at(-1);
	const words = (name: string, envName: string): string[] =>
		(values[name] ?? [env[envName] ?? ""]).flatMap((value) =>
			value
				.split(",")
				.map((word) => word.trim())
				.filter(Boolean),
		);
	const parseNumber = (name: string, raw: string): number => {
		const parsed = Number(raw);
		if (
			!Number.isFinite(parsed) ||
			!Number.isSafeInteger(parsed) ||
			parsed < 0
		) {
			throw new Error(
				`--${name} must be a non-negative safe integer, got "${raw}"`,
			);
		}
		return parsed;
	};
	const number = (name: string, fallback: number): number => {
		const raw = last(name);
		return raw === undefined ? fallback : parseNumber(name, raw);
	};
	const quantity = (value: number): Hex => `0x${value.toString(16)}`;

	const rpcUrl = last("rpc-url") ?? env.GHOSTCALL_BENCH_RPC_URL;
	const mode = (last("mode") ?? "all") as BenchmarkMode;
	const block = last("block") ?? "latest";
	const tokens = words("token", "GHOSTCALL_BENCH_TOKENS") as Hex[];
	const owners = words("owner", "GHOSTCALL_BENCH_OWNERS") as Hex[];

	if (rpcUrl === undefined || rpcUrl === "") {
		throw new Error(
			"Missing RPC URL. Pass --rpc-url or set GHOSTCALL_BENCH_RPC_URL.",
		);
	}

	if (mode !== "raw" && mode !== "balances" && mode !== "all") {
		throw new Error("--mode must be raw, balances, or all.");
	}

	if ((mode === "balances" || mode === "all") && tokens.length === 0) {
		throw new Error("Balance mode requires at least one token address.");
	}

	if ((mode === "balances" || mode === "all") && owners.length === 0) {
		throw new Error("Balance mode requires at least one owner address.");
	}

	const config: BenchmarkConfig = {
		rpcUrl,
		mode,
		tokens,
		owners,
		blockTag: /^[0-9]+$/.test(block) ? quantity(Number(block)) : block,
		from: (last("from") ?? defaultFrom) as Hex,
		timeoutMs: number("timeout-ms", 30_000),
		maxCalls: number("max-calls", 10_000),
		maxInitcodeBytes: number("max-initcode-bytes", 512 * 1024),
		maxRuntimeBytes: number("max-runtime-bytes", 512 * 1024),
		json: flags.has("json"),
	};
	const gas = last("gas");
	if (gas !== undefined) {
		config.gas = quantity(parseNumber("gas", gas));
	}

	return {
		help: false,
		config,
	};
}

/**
 * Encodes one ERC-20 `balanceOf(address)` call by hand.
 *
 * @remarks
 * The benchmark avoids ABI helper dependencies so the byte math stays visible:
 * `4` selector bytes plus one ABI word for the owner address. The caller is
 * expected to pass a normal 20-byte hex address.
 *
 * @param owner - Address whose token balance will be queried.
 * @returns Raw calldata for `balanceOf(address)`.
 */
export function encodeBalanceOfCalldata(owner: Hex): Hex {
	return `0x${balanceOfSelector}${owner.slice(2).padStart(64, "0")}`;
}

/**
 * Builds the repeated balance workload used by the realistic benchmark.
 *
 * @remarks
 * Token addresses rotate fastest. Owners advance after each full token cycle,
 * which makes the call sequence easy to predict:
 * token 0/owner 0, token 1/owner 0, token 0/owner 1, and so on.
 *
 * @param count - Number of `balanceOf` calls to include.
 * @param tokens - ERC-20 token contracts to cycle through.
 * @param owners - Owner addresses to cycle through.
 * @returns Ordered ghostcall entries ready for `encodeCalls`.
 */
export function buildBalanceCalls(
	count: number,
	tokens: readonly Hex[],
	owners: readonly Hex[],
): GhostcallCall[] {
	return Array.from({ length: count }, (_, index) => {
		const token = tokens[index % tokens.length] as Hex;
		const owner = owners[
			Math.floor(index / tokens.length) % owners.length
		] as Hex;

		return {
			to: token,
			data: encodeBalanceOfCalldata(owner),
		};
	});
}

/**
 * Creates an exact-size initcode probe for the initcode-size limit.
 *
 * @remarks
 * The executable prefix is `PUSH1 0 PUSH1 0 RETURN`, which returns empty
 * runtime code. Extra zero bytes are unreachable padding whose only purpose is
 * to increase the CREATE input length.
 *
 * @param sizeBytes - Desired full initcode byte length.
 * @returns Initcode whose total length is exactly `sizeBytes`.
 */
export function createRawInitcodeSizeProbe(sizeBytes: number): Hex {
	if (
		!Number.isSafeInteger(sizeBytes) ||
		sizeBytes < emptyRuntimeInitcodeBytes
	) {
		throw new RangeError(
			`createRawInitcodeSizeProbe sizeBytes must be an integer >= ${emptyRuntimeInitcodeBytes}, the emptyRuntimeInitcode byte length`,
		);
	}

	return `0x${emptyRuntimeInitcode}${"00".repeat(sizeBytes - emptyRuntimeInitcodeBytes)}`;
}

/**
 * Creates initcode that returns `sizeBytes` bytes of runtime code.
 *
 * @remarks
 * The bytecode is `PUSHN(size) PUSH1(0) RETURN`. Returning from zeroed memory is
 * enough because the benchmark only cares how many bytes the execution
 * environment accepts, not what those bytes contain.
 *
 * @param sizeBytes - Number of bytes the initcode should return.
 * @returns Initcode that should produce exactly `sizeBytes` returned bytes.
 */
export function createRawRuntimeReturnProbe(sizeBytes: number): Hex {
	const size = sizeBytes.toString(16).padStart(2, "0");
	const evenSize = size.length % 2 === 0 ? size : `0${size}`;
	const pushOpcode = (0x5f + evenSize.length / 2).toString(16);

	return `0x${pushOpcode}${evenSize}6000f3`;
}

/**
 * Finds the largest passing candidate with exponential search plus binary search.
 *
 * @remarks
 * `probe(candidate)` returns `null` when the candidate works and a short failure
 * string when it does not. Unexpected conditions should throw; that keeps bad
 * token inputs separate from ordinary "too large" limit failures.
 *
 * @param min - First candidate to try.
 * @param max - Configured ceiling for the search.
 * @param probe - Candidate check.
 * @returns The largest passing value, first failing value if found, and attempt count.
 */
export async function findLimit(
	min: number,
	max: number,
	probe: (candidate: number) => Promise<string | null>,
): Promise<LimitResult> {
	if (max < min) {
		return {
			maxPass: min - 1,
			firstFail: min,
			exhaustedConfiguredMax: false,
			configuredMax: max,
			attempts: 0,
			failure: `configured max ${max} is below minimum candidate ${min}`,
		};
	}

	let attempts = 0;
	let maxPass = min - 1;
	let firstFail: number | null = null;
	let failure: string | null = null;

	for (let candidate = min; ; candidate = Math.min(candidate * 2, max)) {
		attempts += 1;
		failure = await probe(candidate);

		if (failure !== null) {
			firstFail = candidate;
			break;
		}

		maxPass = candidate;

		if (candidate === max) {
			return {
				maxPass,
				firstFail: null,
				exhaustedConfiguredMax: true,
				configuredMax: max,
				attempts,
				failure: null,
			};
		}
	}

	let low = maxPass + 1;
	let high = firstFail - 1;

	while (low <= high) {
		const candidate = Math.floor((low + high) / 2);
		attempts += 1;
		const candidateFailure = await probe(candidate);

		if (candidateFailure === null) {
			maxPass = candidate;
			low = candidate + 1;
			continue;
		}

		firstFail = candidate;
		failure = candidateFailure;
		high = candidate - 1;
	}

	return {
		maxPass,
		firstFail,
		exhaustedConfiguredMax: false,
		configuredMax: max,
		attempts,
		failure,
	};
}

/**
 * Runs the selected limit probes against one JSON-RPC endpoint.
 *
 * @remarks
 * Raw probes isolate the execution environment's CREATE input and output
 * ceilings. Balance probes then measure the real ghostcall workload shape:
 * `58` input bytes and `34` returned bytes per successful balance call.
 *
 * @param config - Benchmark configuration from CLI flags or tests.
 * @returns Machine-readable benchmark report.
 */
export async function runBenchmark(
	config: BenchmarkConfig,
): Promise<BenchmarkReport> {
	const chainId = await rpc(config, "eth_chainId", []);
	const latestBlock = await rpc(config, "eth_blockNumber", []);
	const ghostcallInitcodeBytes = bytes(encodeCalls([]));

	const rawInitcode =
		config.mode === "raw" || config.mode === "all"
			? await findLimit(
					emptyRuntimeInitcode.length / 2,
					config.maxInitcodeBytes,
					async (size) => {
						let result: Hex;
						try {
							result = await ethCallCreate(
								config,
								createRawInitcodeSizeProbe(size),
							);
						} catch (error) {
							return messageFrom(error);
						}

						return result === "0x"
							? null
							: `expected 0x, received ${bytes(result)} bytes`;
					},
				)
			: null;

	const rawRuntime =
		config.mode === "raw" || config.mode === "all"
			? await findLimit(1, config.maxRuntimeBytes, async (size) => {
					let result: Hex;
					try {
						result = await ethCallCreate(
							config,
							createRawRuntimeReturnProbe(size),
						);
					} catch (error) {
						return messageFrom(error);
					}

					return bytes(result) === size
						? null
						: `expected ${size} returned bytes, received ${bytes(result)}`;
				})
			: null;

	const maxBalanceCallsByInitcode = Math.max(
		0,
		Math.floor(
			(config.maxInitcodeBytes - ghostcallInitcodeBytes) /
				balanceInputBytesPerCall,
		),
	);
	const balanceSearchMax = Math.min(config.maxCalls, maxBalanceCallsByInitcode);
	const balanceLimit =
		config.mode === "balances" || config.mode === "all"
			? await findLimit(1, balanceSearchMax, async (count) =>
					balanceBatchFailure(config, count),
				)
			: null;

	return {
		chainId,
		latestBlock,
		blockTag: config.blockTag,
		from: config.from,
		gas: config.gas ?? null,
		timeoutMs: config.timeoutMs,
		ghostcallInitcodeBytes,
		rawInitcode,
		rawRuntime,
		balances:
			balanceLimit === null
				? null
				: {
						...balanceLimit,
						tokenCount: config.tokens.length,
						ownerCount: config.owners.length,
						fullCreateDataBytes:
							ghostcallInitcodeBytes +
							balanceLimit.maxPass * balanceInputBytesPerCall,
						appendedPayloadBytes:
							balanceLimit.maxPass * balanceInputBytesPerCall,
						returnedBytes: balanceLimit.maxPass * balanceReturnedBytesPerCall,
						inputBytesPerCall: balanceInputBytesPerCall,
						returnedBytesPerCall: balanceReturnedBytesPerCall,
					},
	};
}

/**
 * Formats benchmark output for humans.
 *
 * @param report - Report returned by `runBenchmark`.
 * @returns Multi-line text without the RPC URL, so provider keys are not printed.
 */
export function formatBenchmarkReport(report: BenchmarkReport): string {
	const lines = [
		"ghostcall limit benchmark",
		`chain id: ${report.chainId}`,
		`latest observed block: ${report.latestBlock}`,
		`block tag: ${report.blockTag}`,
		`from: ${report.from}`,
		`gas: ${report.gas ?? "provider default"}`,
		`timeout: ${format(report.timeoutMs)} ms`,
		`ghostcall initcode: ${format(report.ghostcallInitcodeBytes)} bytes`,
	];

	if (report.rawInitcode !== null) {
		lines.push(
			"",
			"raw initcode size",
			formatLimit(report.rawInitcode, "bytes"),
		);
	}

	if (report.rawRuntime !== null) {
		lines.push(
			"",
			"raw returned runtime code",
			formatLimit(report.rawRuntime, "bytes"),
		);
	}

	if (report.balances !== null) {
		lines.push(
			"",
			"ERC-20 balanceOf ghostcall batch",
			`token inputs: ${format(report.balances.tokenCount)}`,
			`owner inputs: ${format(report.balances.ownerCount)}`,
			formatLimit(report.balances, "calls"),
			`full CREATE data: ${format(report.balances.fullCreateDataBytes)} bytes`,
			`appended payload: ${format(report.balances.appendedPayloadBytes)} bytes`,
			`returned bytes: ${format(report.balances.returnedBytes)} bytes`,
			`per call input/return: ${report.balances.inputBytesPerCall}/${report.balances.returnedBytesPerCall} bytes`,
		);
	}

	return lines.join("\n");
}

export function formatUsage(): string {
	return [
		"Usage:",
		"  npm run benchmark:limits -- --rpc-url <url> --mode raw",
		"  npm run benchmark:limits -- --rpc-url <url> --token <address> --owner <address>",
		"",
		"Options:",
		"  --rpc-url <url>              JSON-RPC endpoint, or GHOSTCALL_BENCH_RPC_URL",
		"  --mode raw|balances|all      Probe mode (default: all)",
		"  --token <addresses>          Repeatable or comma-separated token addresses",
		"  --owner <addresses>          Repeatable or comma-separated owner addresses",
		"  --block <tag|number>         Block tag or block number (default: latest)",
		"  --from <address>             eth_call sender (default: zero address)",
		"  --gas <quantity>             Optional eth_call gas quantity",
		"  --timeout-ms <ms>            Per-request timeout (default: 30000)",
		"  --max-calls <count>          Balance benchmark search ceiling",
		"  --max-initcode-bytes <bytes> Raw initcode and balance CREATE-data ceiling",
		"  --max-runtime-bytes <bytes>  Raw returned-code search ceiling",
		"  --json                       Print machine-readable JSON",
	].join("\n");
}

async function balanceBatchFailure(
	config: BenchmarkConfig,
	count: number,
): Promise<string | null> {
	let result: Hex;
	let data: Hex;

	try {
		data = encodeCalls(buildBalanceCalls(count, config.tokens, config.owners));
	} catch (error) {
		if (error instanceof RangeError) {
			return `SDK encoding limit: ${error.message}`;
		}
		throw error;
	}

	try {
		result = await ethCallCreate(config, data);
	} catch (error) {
		return messageFrom(error);
	}

	const entries = decodeResults(result);

	if (entries.length !== count) {
		throw new Error(
			`expected ${count} result entries, received ${entries.length}`,
		);
	}

	for (const [index, entry] of entries.entries()) {
		if (!entry.success) {
			throw new Error(`balanceOf call ${index} returned a failed result entry`);
		}

		if (bytes(entry.returnData) !== 32) {
			throw new Error(
				`balanceOf call ${index} returned ${bytes(entry.returnData)} bytes instead of 32`,
			);
		}
	}

	return null;
}

async function ethCallCreate(config: BenchmarkConfig, data: Hex): Promise<Hex> {
	const call: { from: Hex; data: Hex; gas?: Hex } = {
		from: config.from,
		data,
	};

	if (config.gas !== undefined) {
		call.gas = config.gas;
	}

	return await rpc(config, "eth_call", [call, config.blockTag]);
}

async function rpc(
	config: BenchmarkConfig,
	method: string,
	params: readonly unknown[],
): Promise<Hex> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
	const id = nextRpcId;
	nextRpcId += 1;

	try {
		const response = await fetch(config.rpcUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id,
				method,
				params,
			}),
			signal: controller.signal,
		});

		const body = await response.text();

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
		}

		const payload = JSON.parse(body) as {
			result?: unknown;
			error?: { code?: number; message?: string; data?: unknown };
		};

		if (payload.error !== undefined) {
			throw new Error(
				`RPC ${payload.error.code ?? "error"}: ${payload.error.message ?? "unknown error"} ${JSON.stringify(payload.error.data ?? "").slice(0, 240)}`,
			);
		}

		if (typeof payload.result !== "string") {
			throw new Error(`${method} returned a non-string result`);
		}

		return payload.result as Hex;
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error(`request timed out after ${config.timeoutMs} ms`);
		}

		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

function formatLimit(result: LimitResult, unit: string): string {
	const limit = result.exhaustedConfiguredMax
		? `max pass: >= ${format(result.maxPass)} ${unit}`
		: `max pass: ${format(result.maxPass)} ${unit}; first fail ${format(result.firstFail ?? 0)} ${unit}`;
	const failure =
		result.failure === null ? "none before configured max" : result.failure;

	return [
		limit,
		`attempts: ${format(result.attempts)}`,
		`first failure: ${failure}`,
	].join("\n");
}

function bytes(hex: Hex): number {
	return (hex.length - 2) / 2;
}

function format(value: number): string {
	return prettyInteger.format(value);
}

function messageFrom(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
	const parsed = parseBenchmarkArgs(process.argv.slice(2));

	if (parsed.help) {
		console.log(formatUsage());
		return;
	}

	const report = await runBenchmark(parsed.config);
	console.log(
		parsed.config.json
			? JSON.stringify(report, null, 2)
			: formatBenchmarkReport(report),
	);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	main().catch((error: unknown) => {
		console.error(messageFrom(error));
		process.exitCode = 1;
	});
}
