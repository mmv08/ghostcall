import assert from "node:assert/strict";
import test from "node:test";

import { decodeResults, encodeCalls } from "../src/sdk/index.ts";

const maxCreateInitcodeSize = 0xc000;
const encodedCallHeaderSize = 0x16;

test("Ghostcall SDK", async (t) => {
	await t.test("returns bundled initcode for an empty call list", () => {
		const data = encodeCalls([]);

		assert.match(data, /^0x[0-9a-fA-F]+$/);
		assert.notEqual(data, "0x");
	});

	await t.test(
		"encodes single and multi-call payloads with len-first headers",
		() => {
			const baseData = encodeCalls([]);
			const firstCall = {
				to: "0x1111111111111111111111111111111111111111",
				data: "0xaabb",
			} as const;
			const secondCall = {
				to: "0x2222222222222222222222222222222222222222",
				data: "0x",
			} as const;

			assert.equal(
				encodeCalls([firstCall]),
				`${baseData}0002${firstCall.to.slice(2)}aabb`,
			);
			assert.equal(
				encodeCalls([firstCall, secondCall]),
				`${baseData}0002${firstCall.to.slice(2)}aabb0000${secondCall.to.slice(2)}`,
			);
		},
	);

	await t.test("rejects invalid addresses", () => {
		assert.throws(
			() =>
				encodeCalls([
					{
						to: "0x1234" as const,
						data: "0x",
					},
				]),
			TypeError,
		);
		assert.throws(
			() =>
				encodeCalls([
					{
						to: "0xzz11111111111111111111111111111111111111" as const,
						data: "0x",
					},
				]),
			TypeError,
		);
	});

	await t.test("rejects invalid calldata hex", () => {
		assert.throws(
			() =>
				encodeCalls([
					{
						to: "0x1111111111111111111111111111111111111111",
						data: "1234" as unknown as `0x${string}`,
					},
				]),
			TypeError,
		);
		assert.throws(
			() =>
				encodeCalls([
					{
						to: "0x1111111111111111111111111111111111111111",
						data: "0xabc" as const,
					},
				]),
			TypeError,
		);
		assert.throws(
			() =>
				encodeCalls([
					{
						to: "0x1111111111111111111111111111111111111111",
						data: "0xzz" as const,
					},
				]),
			TypeError,
		);
	});

	await t.test("rejects calldata over the uint16 limit", () => {
		assert.throws(
			() =>
				encodeCalls([
					{
						to: "0x1111111111111111111111111111111111111111",
						data: `0x${"00".repeat(0x10000)}` as `0x${string}`,
					},
				]),
			RangeError,
		);
	});

	await t.test("enforces the CREATE initcode size limit", () => {
		const baseData = encodeCalls([]);
		const emptyCall = {
			to: "0x1111111111111111111111111111111111111111",
			data: "0x",
		} as const;
		const bundledInitcodeSize = (baseData.length - 2) / 2;
		const maxEmptyCalls = Math.floor(
			(maxCreateInitcodeSize - bundledInitcodeSize) / encodedCallHeaderSize,
		);

		const maxSizedBatch = Array.from(
			{ length: maxEmptyCalls },
			() => emptyCall,
		);
		const maxSizedData = encodeCalls(maxSizedBatch);

		assert.ok((maxSizedData.length - 2) / 2 < maxCreateInitcodeSize);
		assert.throws(() => encodeCalls([...maxSizedBatch, emptyCall]), RangeError);
	});

	await t.test("decodes empty and mixed result payloads", () => {
		assert.deepEqual(decodeResults("0x"), []);
		assert.deepEqual(decodeResults("0x8002cafe0003deadbe"), [
			{ success: true, returnData: "0xcafe" },
			{ success: false, returnData: "0xdeadbe" },
		]);
	});

	await t.test("rejects truncated result headers and bodies", () => {
		assert.throws(() => decodeResults("0x00"), TypeError);
		assert.throws(() => decodeResults("0x8002ff"), TypeError);
	});
});
