import { ghostcallInitcode } from "./generated/initcode.ts";

/**
 * Hex-encoded binary data prefixed with `0x`.
 *
 * ghostcall request and response data uses raw hex strings. The
 * SDK does not accept byte arrays or ABI fragments.
 */
type Hex = `0x${string}`;

/**
 * Hex-encoded RPC quantity prefixed with `0x`.
 */
type HexQuantity = `0x${string}`;

/**
 * Block reference accepted by the outer `eth_call`.
 */
type GhostcallBlockReference = string | number | bigint;

/**
 * One ghostcall contract call.
 */
type GhostcallCall = {
	/**
	 * Target contract address to invoke.
	 */
	to: Hex;

	/**
	 * Hex-encoded calldata sent to {@link GhostcallCall.to}.
	 *
	 * Calldata is limited to `65,535` bytes because ghostcall stores each
	 * calldata length as a big-endian `uint16`.
	 */
	data: Hex;
};

/**
 * One call passed to {@link aggregateCalls}.
 *
 * `allowFailure` controls SDK behavior after ghostcall returns. It is not
 * included in the bytes sent to the EVM.
 */
type GhostcallAggregateCall = GhostcallCall & {
	/**
	 * Allows this subcall to return a failed result entry.
	 *
	 * Defaults to `false`.
	 */
	allowFailure?: boolean;
};

/**
 * One call passed to {@link aggregateDecodedCalls}.
 */
type GhostcallDecodedCall<TResult = unknown> = GhostcallCall & {
	/**
	 * Decodes this call's successful return data.
	 *
	 * Use an ABI helper such as `decodeFunctionResult` from viem or ox, or
	 * provide a custom decoder.
	 */
	decodeResult: GhostcallResultDecoder<TResult>;
};

/**
 * One successful contract call result.
 */
type GhostcallSuccessResult = {
	/**
	 * The target call completed successfully.
	 */
	success: true;

	/**
	 * Raw return data produced by the target call.
	 */
	returnData: Hex;
};

/**
 * One failed contract call result.
 */
type GhostcallFailedResult = {
	/**
	 * The target call reverted or failed.
	 */
	success: false;

	/**
	 * Raw return data produced by the target call.
	 *
	 * Contains revert data when the target returned any.
	 */
	returnData: Hex;
};

/**
 * One raw ghostcall result.
 */
type GhostcallResult = GhostcallSuccessResult | GhostcallFailedResult;

/**
 * Function used by {@link aggregateDecodedCalls} to decode one successful result.
 */
type GhostcallResultDecoder<TResult> = (
	returnData: Hex,
	entry: GhostcallSuccessResult,
	index: number,
) => TResult;

/**
 * Error thrown when a failed contract call is not allowed.
 */
class GhostcallSubcallError extends Error {
	readonly index: number;
	readonly call: GhostcallAggregateCall;
	readonly result: GhostcallFailedResult;

	constructor(
		index: number,
		call: GhostcallAggregateCall,
		result: GhostcallFailedResult,
	) {
		super(`Ghostcall subcall ${index} failed`);
		this.name = "GhostcallSubcallError";
		this.index = index;
		this.call = call;
		this.result = result;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

type GhostcallDecodedResults<TCalls extends readonly GhostcallDecodedCall[]> = {
	-readonly [Index in keyof TCalls]: TCalls[Index] extends {
		decodeResult: GhostcallResultDecoder<infer TResult>;
	}
		? TResult
		: never;
};

type GhostcallEncodeOptions = {
	/**
	 * Maximum allowed CREATE initcode size in bytes.
	 *
	 * This applies to the full request `data`, including bundled Ghostcall
	 * initcode and every encoded subcall entry.
	 *
	 * Defaults to Ethereum's EIP-3860 limit of `49,152` bytes.
	 */
	maxInitcodeBytes?: number;
};

type GhostcallEthCallOptions = {
	/**
	 * Optional `from` address for the outer `eth_call`.
	 */
	from?: Hex;

	/**
	 * Optional gas limit for the outer `eth_call`.
	 */
	gas?: HexQuantity;

	/**
	 * Optional block tag, hex quantity, or block number for the outer `eth_call`.
	 *
	 * Decimal strings, numbers, and bigints are normalized to hex quantities.
	 * Defaults to `latest`.
	 */
	blockTag?: GhostcallBlockReference;
};

type GhostcallAggregateOptions = GhostcallEncodeOptions & {
	/**
	 * Optional outer `eth_call` controls shared by {@link aggregateCalls} and
	 * {@link aggregateDecodedCalls}.
	 */
	ethCall?: GhostcallEthCallOptions;
};

/**
 * Minimal EIP-1193 provider shape used by the SDK.
 */
type EIP1193ProviderWithRequestFn = {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
};

const addressHexLength = 40;
const encodedHeaderHexLength = 4;
const maxCalldataSize = 0xffff;
const encodedCallHeaderSize = 0x16;
const defaultMaxCreateInitcodeSize = 0xc000;
const successFlagMask = 0x8000;
const returnDataLengthMask = 0x7fff;
const bundledInitcodeSize = byteLength(ghostcallInitcode);

/**
 * Builds the `data` value for a ghostcall `eth_call` request.
 *
 * The result contains the bundled ghostcall program followed by every encoded
 * call. Pass it as the `data` field of `eth_call` without a `to` address.
 * Each call uses `[calldata length (2)][target (20)][calldata]`.
 *
 * @param calls - Contract calls in execution order.
 * @param options - Request-size options.
 *
 * @returns Complete ghostcall request data.
 *
 * @throws {TypeError} If an address, calldata value, or option is invalid.
 * @throws {RangeError} If one call or the full request exceeds its size limit.
 *
 * @example
 * const data = encodeCalls([
 *   {
 *     // USDC on Ethereum mainnet: balanceOf(Binance 14)
 *     to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
 *     data: "0x70a0823100000000000000000000000028c6c06298d514db089934071355e5743bf21d60",
 *   },
 *   {
 *     // WETH9 on Ethereum mainnet: totalSupply()
 *     to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
 *     data: "0x18160ddd",
 *   },
 * ]);
 *
 * // Later:
 * // provider.request({ method: "eth_call", params: [{ data }, "latest"] })
 */
function encodeCalls(
	calls: readonly GhostcallCall[],
	options: GhostcallEncodeOptions = {},
): Hex {
	const encodedParts = [ghostcallInitcode.slice(2)];
	const maxInitcodeBytes = resolveMaxInitcodeBytes(options.maxInitcodeBytes);
	let totalEncodedSize = bundledInitcodeSize;

	if (totalEncodedSize > maxInitcodeBytes) {
		throw new RangeError(
			`encoded Ghostcall initcode exceeds the ${maxInitcodeBytes}-byte CREATE initcode limit`,
		);
	}

	for (const [index, call] of calls.entries()) {
		assertAddress(call.to, `calls[${index}].to`);
		const calldata = assertHex(call.data, `calls[${index}].data`);
		const calldataSize = byteLength(calldata);

		if (calldataSize > maxCalldataSize) {
			throw new RangeError(
				`calls[${index}].data exceeds the ${maxCalldataSize}-byte calldata limit`,
			);
		}

		totalEncodedSize += encodedCallHeaderSize + calldataSize;
		if (totalEncodedSize > maxInitcodeBytes) {
			throw new RangeError(
				`encoded Ghostcall initcode exceeds the ${maxInitcodeBytes}-byte CREATE initcode limit`,
			);
		}

		encodedParts.push(calldataSize.toString(16).padStart(4, "0"));
		encodedParts.push(call.to.slice(2));
		encodedParts.push(calldata.slice(2));
	}

	return `0x${encodedParts.join("")}` as Hex;
}

/**
 * Sends a ghostcall batch and returns raw results.
 *
 * Results keep the same order as the calls. A failed call throws unless its
 * entry sets `allowFailure: true`. Use {@link aggregateDecodedCalls} when every
 * call must succeed and decoded values are needed. Use `options.ethCall` to set
 * `from`, `gas`, or `blockTag` on the outer `eth_call`.
 *
 * @param provider - Provider with an EIP-1193-compatible `request` method.
 * @param calls - Contract calls in execution order.
 * @param options - Request-size and outer `eth_call` options.
 *
 * @returns Raw results in call order.
 *
 * @throws {TypeError} If an input, option, or provider response is invalid.
 * @throws {RangeError} If one call or the full request exceeds its size limit.
 * @throws {GhostcallSubcallError} If a call fails without `allowFailure: true`.
 * @throws {Error} If the response count does not match the call count.
 *
 * @example
 * const results = await aggregateCalls(provider, [
 *   {
 *     // USDC on Ethereum mainnet: balanceOf(Binance 14)
 *     to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
 *     data: "0x70a0823100000000000000000000000028c6c06298d514db089934071355e5743bf21d60",
 *   },
 *   {
 *     // WETH9 on Ethereum mainnet: totalSupply()
 *     to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
 *     data: "0x18160ddd",
 *   },
 * ]);
 */
async function aggregateCalls(
	provider: EIP1193ProviderWithRequestFn,
	calls: readonly GhostcallAggregateCall[],
	options?: GhostcallAggregateOptions,
): Promise<GhostcallResult[]> {
	const resolvedOptions = options ?? {};
	const data = encodeCalls(calls, resolvedOptions);
	const ethCall = { data } as { data: Hex; from?: Hex; gas?: HexQuantity };
	const blockTag = normalizeBlockTag(
		resolvedOptions.ethCall?.blockTag ?? "latest",
		"options.ethCall.blockTag",
	);

	if (resolvedOptions.ethCall?.from !== undefined) {
		assertAddress(resolvedOptions.ethCall.from, "options.ethCall.from");
		ethCall.from = resolvedOptions.ethCall.from;
	}

	if (resolvedOptions.ethCall?.gas !== undefined) {
		ethCall.gas = assertHexQuantity(
			resolvedOptions.ethCall.gas,
			"options.ethCall.gas",
		);
	}

	const result = await provider.request({
		method: "eth_call",
		params: [ethCall, blockTag],
	});
	const entries = decodeResults(assertHex(result, "eth_call result"));

	if (entries.length !== calls.length) {
		throw new Error(
			`Ghostcall returned ${entries.length} result entries for ${calls.length} calls`,
		);
	}

	for (const [index, entry] of entries.entries()) {
		const call = calls[index] as GhostcallAggregateCall;
		if (!entry.success && call.allowFailure !== true) {
			throw new GhostcallSubcallError(index, call, entry);
		}
	}

	return entries;
}

/**
 * Sends a ghostcall batch and decodes every result.
 *
 * Each call supplies a `decodeResult` function. The returned tuple keeps call
 * order and infers each value type from its decoder. Any failed call throws
 * {@link GhostcallSubcallError}. Use {@link aggregateCalls} when a failed call
 * should remain in the returned results.
 *
 * @param provider - Provider with an EIP-1193-compatible `request` method.
 * @param calls - Contract calls and their result decoders, in execution order.
 * @param options - Request-size and outer `eth_call` options.
 *
 * @returns Decoded values in call order.
 *
 * @throws {TypeError} If an input, option, or provider response is invalid.
 * @throws {RangeError} If one call or the full request exceeds its size limit.
 * @throws {GhostcallSubcallError} If any call fails.
 * @throws {Error} If the response count does not match the call count.
 *
 * @example
 * const erc20Abi = parseAbi([
 *   "function balanceOf(address account) view returns (uint256)",
 * ]);
 * const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
 * const owner = "0x28C6c06298d514Db089934071355E5743bf21d60";
 *
 * const [balance] = await aggregateDecodedCalls(provider, [
 *   {
 *     to: usdc,
 *     data: "0x70a0823100000000000000000000000028c6c06298d514db089934071355e5743bf21d60",
 *     decodeResult: (returnData) => decodeFunctionResult({
 *       abi: erc20Abi,
 *       functionName: "balanceOf",
 *       data: returnData,
 *     }),
 *   },
 * ]);
 */
async function aggregateDecodedCalls<
	const TCalls extends readonly GhostcallDecodedCall<unknown>[],
>(
	provider: EIP1193ProviderWithRequestFn,
	calls: TCalls,
	options?: GhostcallAggregateOptions,
): Promise<GhostcallDecodedResults<TCalls>> {
	const entries = await aggregateCalls(provider, calls, options);

	return entries.map((entry, index) => {
		const call = calls[index] as TCalls[number];
		const successEntry = entry as GhostcallSuccessResult;
		return call.decodeResult(successEntry.returnData, successEntry, index);
	}) as GhostcallDecodedResults<TCalls>;
}

/**
 * Parses raw results returned by ghostcall.
 *
 * The function returns success flags and raw return data in call order. It does
 * not ABI-decode return data.
 *
 * @param data - Raw hex returned by the outer `eth_call`.
 *
 * @returns Raw results in call order. Returns an empty array for `0x`.
 *
 * @throws {TypeError} If data is invalid hex or contains an incomplete result.
 *
 * @example
 * const results = decodeResults("0x8002cafe0004deadbeef");
 *
 * console.log(results);
 * // [
 * //   { success: true, returnData: "0xcafe" },
 * //   { success: false, returnData: "0xdeadbeef" }
 * // ]
 */
function decodeResults(data: Hex): GhostcallResult[] {
	const normalizedData = assertHex(data, "data");

	if (normalizedData === "0x") {
		return [];
	}

	const results: GhostcallResult[] = [];
	const encodedData = normalizedData.slice(2);
	let cursor = 0;

	while (cursor < encodedData.length) {
		if (cursor + encodedHeaderHexLength > encodedData.length) {
			throw new TypeError("Truncated Ghostcall response header");
		}

		const header = Number.parseInt(
			encodedData.slice(cursor, cursor + encodedHeaderHexLength),
			16,
		);
		const success = (header & successFlagMask) !== 0;
		const returnDataSize = header & returnDataLengthMask;
		const nextCursor = cursor + encodedHeaderHexLength;
		const returnDataEnd = nextCursor + returnDataSize * 2;

		if (returnDataEnd > encodedData.length) {
			throw new TypeError("Truncated Ghostcall response body");
		}

		results.push({
			success,
			returnData: `0x${encodedData.slice(nextCursor, returnDataEnd)}` as Hex,
		});

		cursor = returnDataEnd;
	}

	return results;
}

/**
 * Validates that a value is a canonical 20-byte hex address.
 *
 * @param value - Unknown input to validate.
 * @param label - Field name used in thrown error messages.
 *
 * @throws {TypeError} If the value is not valid `0x`-prefixed hex or is not
 *                     exactly 20 bytes long.
 *
 * @internal
 */
function assertAddress(value: unknown, label: string): asserts value is Hex {
	const normalizedValue = assertHex(value, label);
	if (normalizedValue.length !== addressHexLength + 2) {
		throw new TypeError(`${label} must be a 20-byte hex string`);
	}
}

/**
 * Validates that a value is an even-length `0x`-prefixed hex string.
 *
 * @param value - Unknown input to validate.
 * @param label - Field name used in thrown error messages.
 *
 * @returns The validated value narrowed to {@link Hex}.
 *
 * @throws {TypeError} If the value is not a string, lacks the `0x` prefix, has an
 *                     odd number of hex characters, or contains non-hex digits.
 *
 * @internal
 */
function assertHex(value: unknown, label: string): Hex {
	if (typeof value !== "string") {
		throw new TypeError(`${label} must be a hex string`);
	}

	if (!value.startsWith("0x")) {
		throw new TypeError(`${label} must start with 0x`);
	}

	const rawValue = value.slice(2);
	if (rawValue.length % 2 !== 0) {
		throw new TypeError(`${label} must have an even number of hex characters`);
	}

	if (!/^[0-9a-fA-F]*$/.test(rawValue)) {
		throw new TypeError(`${label} must contain only hexadecimal characters`);
	}

	return value as Hex;
}

/**
 * Validates that a value is an RPC hex quantity.
 *
 * @param value - Unknown input to validate.
 * @param label - Field name used in thrown error messages.
 * @returns The validated value narrowed to {@link HexQuantity}.
 * @throws {TypeError} If the value is not a valid `0x`-prefixed quantity.
 *
 * @internal
 */
function assertHexQuantity(value: unknown, label: string): HexQuantity {
	if (typeof value !== "string") {
		throw new TypeError(`${label} must be a hex quantity string`);
	}

	if (!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
		throw new TypeError(`${label} must be a 0x-prefixed hex quantity`);
	}

	return value as HexQuantity;
}

/**
 * Normalizes a block reference into the RPC shape expected by `eth_call`.
 *
 * @param value - Block reference to normalize.
 * @param label - Field name used in thrown error messages.
 * @returns Normalized block reference.
 * @throws {TypeError} If the value is not a supported block reference.
 *
 * @internal
 */
function normalizeBlockTag(value: unknown, label: string): string {
	if (typeof value === "number") {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new TypeError(
				`${label} must be a non-negative safe integer, bigint, or non-empty string`,
			);
		}

		return `0x${value.toString(16)}`;
	}

	if (typeof value === "bigint") {
		if (value < 0n) {
			throw new TypeError(
				`${label} must be a non-negative safe integer, bigint, or non-empty string`,
			);
		}

		return `0x${value.toString(16)}`;
	}

	if (typeof value !== "string" || value.length === 0) {
		throw new TypeError(
			`${label} must be a non-negative safe integer, bigint, or non-empty string`,
		);
	}

	if (/^-?[0-9]+$/.test(value)) {
		if (value.startsWith("-")) {
			throw new TypeError(
				`${label} must be a non-negative safe integer, bigint, or non-empty string`,
			);
		}

		return `0x${BigInt(value).toString(16)}`;
	}

	if (value.startsWith("0x") || value.startsWith("0X")) {
		return assertHexQuantity(`0x${value.slice(2)}`, label);
	}

	return value;
}

/**
 * Resolves the active CREATE initcode ceiling.
 *
 * @param value - Optional caller override.
 * @returns Active initcode ceiling in bytes.
 * @throws {TypeError} If the override is not a non-negative safe integer.
 *
 * @internal
 */
function resolveMaxInitcodeBytes(value: number | undefined): number {
	if (value === undefined) {
		return defaultMaxCreateInitcodeSize;
	}

	if (!Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(
			"options.maxInitcodeBytes must be a non-negative safe integer",
		);
	}

	return value;
}

/**
 * Returns the byte length of a validated hex string.
 *
 * @param value - Validated hex string.
 * @returns Number of bytes represented by {@link value}.
 *
 * @internal
 */
function byteLength(value: Hex): number {
	return (value.length - 2) / 2;
}

export type {
	EIP1193ProviderWithRequestFn,
	GhostcallAggregateCall,
	GhostcallAggregateOptions,
	GhostcallBlockReference,
	GhostcallCall,
	GhostcallDecodedCall,
	GhostcallDecodedResults,
	GhostcallEncodeOptions,
	GhostcallEthCallOptions,
	GhostcallFailedResult,
	GhostcallResult,
	GhostcallResultDecoder,
	GhostcallSuccessResult,
	Hex,
	HexQuantity,
};
export {
	aggregateCalls,
	aggregateDecodedCalls,
	decodeResults,
	encodeCalls,
	GhostcallSubcallError,
};
