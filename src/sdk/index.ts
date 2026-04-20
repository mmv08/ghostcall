import { ghostcallInitcode } from "./generated/initcode.ts";

/**
 * Hex-encoded binary data prefixed with `0x`.
 *
 * This SDK operates exclusively on raw hex strings and does not accept byte arrays,
 * provider objects, or ABI fragments.
 */
export type Hex = `0x${string}`;

/**
 * One Ghostcall subcall entry.
 */
export type GhostcallCall = {
	/**
	 * Target contract address to invoke.
	 */
	to: Hex;

	/**
	 * Hex-encoded call data to forward to {@link GhostcallCall.to}.
	 *
	 * The encoded payload is limited to `65535` bytes because Ghostcall stores each
	 * calldata length as a big-endian `uint16`.
	 */
	data: Hex;
};

/**
 * One decoded Ghostcall result entry.
 */
export type GhostcallResult = {
	/**
	 * Indicates whether the underlying EVM `CALL` returned successfully.
	 *
	 * A `false` value means the target call reverted or otherwise failed, but the
	 * Ghostcall batch itself still completed successfully.
	 */
	success: boolean;

	/**
	 * Raw return data produced by the target call.
	 *
	 * For failed calls this contains revert data, if any. The SDK leaves higher-level
	 * ABI decoding and failure policy to the caller.
	 */
	returnData: Hex;
};

const addressHexLength = 40;
const encodedHeaderHexLength = 4;
const maxCalldataSize = 0xffff;
const encodedCallHeaderSize = 0x16;
const maxCreateInitcodeSize = 0xc000;
const successFlagMask = 0x8000;
const returnDataLengthMask = 0x7fff;
const bundledInitcodeSize = byteLength(ghostcallInitcode);

/**
 * Encodes a list of contract calls into the full CREATE-style `eth_call` payload
 * expected by Ghostcall.
 *
 * The returned hex string already includes the bundled Ghostcall initcode followed
 * by the compact binary payload for each subcall, so callers can pass it directly
 * as the `data` field of an `eth_call` request without supplying a `to` address.
 * Each encoded subcall entry uses the compact layout `[len(2)][target(20)][data]`.
 *
 * @param calls - Ordered list of subcalls to execute. Each entry becomes one
 *                Ghostcall payload segment in the same order it appears here.
 *
 * @returns Full CREATE payload consisting of the bundled Ghostcall initcode plus
 *          the encoded call list.
 *
 * @throws {TypeError} If any call address or calldata value is not valid hex.
 * @throws {RangeError} If any call data exceeds the protocol `uint16` length limit
 *                      or if the full encoded CREATE payload would exceed the
 *                      EVM initcode size limit.
 *
 * @example
 * const data = encodeCalls([
 *   {
 *     to: "0x1111111111111111111111111111111111111111",
 *     data: "0x70a08231000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
 *   },
 *   {
 *     to: "0x2222222222222222222222222222222222222222",
 *     data: "0x18160ddd",
 *   },
 * ]);
 *
 * // Later:
 * // provider.request({ method: "eth_call", params: [{ data }, "latest"] })
 */
export function encodeCalls(calls: readonly GhostcallCall[]): Hex {
	const encodedParts = [ghostcallInitcode.slice(2)];
	let totalEncodedSize = bundledInitcodeSize;

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
		if (totalEncodedSize > maxCreateInitcodeSize) {
			throw new RangeError(
				`encoded Ghostcall initcode exceeds the ${maxCreateInitcodeSize}-byte CREATE initcode limit`,
			);
		}

		encodedParts.push(calldataSize.toString(16).padStart(4, "0"));
		encodedParts.push(call.to.slice(2));
		encodedParts.push(calldata.slice(2));
	}

	return `0x${encodedParts.join("")}` as Hex;
}

/**
 * Decodes the packed result blob returned by Ghostcall.
 *
 * Each decoded entry corresponds to exactly one subcall in the original batch and
 * preserves the original ordering. The SDK intentionally returns raw result bytes
 * rather than ABI-decoding them so higher-level callers can apply their own
 * decoding and failure policy.
 *
 * @param data - Raw bytes returned by Ghostcall, typically the direct result of a
 *               CREATE-style `eth_call`.
 *
 * @returns Ordered list of decoded Ghostcall result entries. Returns an empty
 *          array for `0x`.
 *
 * @throws {TypeError} If the provided data is not valid hex, if a result header is
 *                     truncated, or if an entry body is shorter than advertised.
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
export function decodeResults(data: Hex): GhostcallResult[] {
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
