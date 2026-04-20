import assert from "node:assert/strict";
import test from "node:test";
import { Abi, AbiError, AbiFunction, Hex } from "ox";
import { decodeResults, encodeCalls } from "../src/sdk/index.ts";

import {
	deployContract,
	ethCallCreate,
	ethCallCreateRaw,
	startAnvil,
	stopAnvil,
} from "./support/anvil.ts";
import {
	decodeFunctionResult,
	encodeFunctionData,
	encodeFunctionResult,
	getRevertData,
	getRpcError,
	loadArtifact,
	readAbi,
	readBytecode,
	sendFunctionTransaction,
} from "./support/ghostcall.ts";

const mockArtifactPath = "out/MockContract.sol/MockContract.json";

const emptyAbi = Abi.from([]);
const maxCreateReturnSize = 0x6000;
const encodedResultHeaderSize = 0x02;
const maxSingleReturnDataSize = maxCreateReturnSize - encodedResultHeaderSize;

test("Ghostcall integration", async (t) => {
	const anvil = await startAnvil();
	t.after(async () => {
		await stopAnvil(anvil);
	});

	const mockArtifact = await loadArtifact(mockArtifactPath);
	const mockInitcode = readBytecode(mockArtifact, mockArtifactPath);
	const mockAbi = readAbi(mockArtifact, mockArtifactPath);
	const mockAddress = await deployContract(anvil.transport, mockInitcode);

	const getValue = AbiFunction.from("function getValue() returns (uint256)");
	const getGreeting = AbiFunction.from(
		"function getGreeting() returns (string)",
	);
	const echoUint = AbiFunction.from(
		"function echoUint(uint256) returns (uint256)",
	);
	const fail = AbiFunction.from("function fail()");

	const givenCalldataReturn = AbiFunction.fromAbi(
		mockAbi,
		"givenCalldataReturn",
	);
	const givenMethodReturn = AbiFunction.fromAbi(mockAbi, "givenMethodReturn");
	const givenCalldataRevertWithMessage = AbiFunction.fromAbi(
		mockAbi,
		"givenCalldataRevertWithMessage",
	);
	const reset = AbiFunction.fromAbi(mockAbi, "reset");

	await t.test(
		"aggregates configured returndata and revert data from the mock",
		async () => {
			await sendFunctionTransaction(anvil.transport, mockAddress, reset, []);

			const getValueCall = encodeFunctionData(getValue, []);
			const getGreetingCall = encodeFunctionData(getGreeting, []);
			const failCall = encodeFunctionData(fail, []);

			await sendFunctionTransaction(
				anvil.transport,
				mockAddress,
				givenCalldataReturn,
				[getValueCall, encodeFunctionResult(getValue, 0x11223344n)],
			);
			await sendFunctionTransaction(
				anvil.transport,
				mockAddress,
				givenCalldataReturn,
				[
					getGreetingCall,
					encodeFunctionResult(getGreeting, "hello from mock-contract"),
				],
			);
			await sendFunctionTransaction(
				anvil.transport,
				mockAddress,
				givenCalldataRevertWithMessage,
				[failCall, "mocked revert"],
			);

			const result = await ethCallCreate(
				anvil.transport,
				encodeCalls([
					{ to: mockAddress, data: getValueCall },
					{ to: mockAddress, data: getGreetingCall },
					{ to: mockAddress, data: failCall },
				]),
			);

			const entries = decodeResults(result);
			const [valueEntry, greetingEntry, failureEntry] = entries;

			assert.equal(entries.length, 3);
			assert.ok(valueEntry);
			assert.ok(greetingEntry);
			assert.ok(failureEntry);
			assert.equal(valueEntry.success, true);
			assert.equal(
				decodeFunctionResult(getValue, valueEntry.returnData),
				0x11223344n,
			);

			assert.equal(greetingEntry.success, true);
			assert.equal(
				decodeFunctionResult(getGreeting, greetingEntry.returnData),
				"hello from mock-contract",
			);

			assert.equal(failureEntry.success, false);
			const revertError = AbiError.fromAbi(emptyAbi, failureEntry.returnData);
			assert.equal(revertError.name, "Error");
			assert.equal(
				AbiError.decode(revertError, failureEntry.returnData),
				"mocked revert",
			);
		},
	);

	await t.test(
		"prefers exact calldata mocks over method-level mocks",
		async () => {
			await sendFunctionTransaction(anvil.transport, mockAddress, reset, []);

			const echoSevenCall = encodeFunctionData(echoUint, [7n]);
			const echoEightCall = encodeFunctionData(echoUint, [8n]);
			const echoNineCall = encodeFunctionData(echoUint, [9n]);

			await sendFunctionTransaction(
				anvil.transport,
				mockAddress,
				givenMethodReturn,
				[echoSevenCall, encodeFunctionResult(echoUint, 700n)],
			);
			await sendFunctionTransaction(
				anvil.transport,
				mockAddress,
				givenCalldataReturn,
				[echoEightCall, encodeFunctionResult(echoUint, 800n)],
			);

			const result = await ethCallCreate(
				anvil.transport,
				encodeCalls([
					{ to: mockAddress, data: echoSevenCall },
					{ to: mockAddress, data: echoEightCall },
					{ to: mockAddress, data: echoNineCall },
				]),
			);

			const entries = decodeResults(result);
			const [firstEntry, secondEntry, thirdEntry] = entries;

			assert.equal(entries.length, 3);
			assert.ok(firstEntry);
			assert.ok(secondEntry);
			assert.ok(thirdEntry);
			assert.equal(decodeFunctionResult(echoUint, firstEntry.returnData), 700n);
			assert.equal(
				decodeFunctionResult(echoUint, secondEntry.returnData),
				800n,
			);
			assert.equal(decodeFunctionResult(echoUint, thirdEntry.returnData), 700n);
		},
	);

	await t.test("returns failure entries and continues the batch", async () => {
		await sendFunctionTransaction(anvil.transport, mockAddress, reset, []);

		const failCall = encodeFunctionData(fail, []);
		const getValueCall = encodeFunctionData(getValue, []);

		await sendFunctionTransaction(
			anvil.transport,
			mockAddress,
			givenCalldataRevertWithMessage,
			[failCall, "fatal mock revert"],
		);
		await sendFunctionTransaction(
			anvil.transport,
			mockAddress,
			givenCalldataReturn,
			[getValueCall, encodeFunctionResult(getValue, 0x55n)],
		);

		const result = await ethCallCreate(
			anvil.transport,
			encodeCalls([
				{ to: mockAddress, data: failCall },
				{ to: mockAddress, data: getValueCall },
			]),
		);

		const entries = decodeResults(result);
		const [failureEntry, successEntry] = entries;

		assert.equal(entries.length, 2);
		assert.ok(failureEntry);
		assert.ok(successEntry);
		assert.equal(failureEntry.success, false);

		const revertError = AbiError.fromAbi(emptyAbi, failureEntry.returnData);
		assert.equal(revertError.name, "Error");
		assert.equal(
			AbiError.decode(revertError, failureEntry.returnData),
			"fatal mock revert",
		);

		assert.equal(successEntry.success, true);
		assert.equal(
			decodeFunctionResult(getValue, successEntry.returnData),
			0x55n,
		);
	});

	await t.test("returns empty bytes for an empty batch", async () => {
		const result = await ethCallCreate(anvil.transport, encodeCalls([]));
		assert.equal(result, "0x");
	});

	await t.test("returns data up to the CREATE return-size limit", async () => {
		await sendFunctionTransaction(anvil.transport, mockAddress, reset, []);

		const largeCall = "0x12345678";
		const maxSizedResponse =
			`0x${"11".repeat(maxSingleReturnDataSize)}` as Hex.Hex;

		await sendFunctionTransaction(
			anvil.transport,
			mockAddress,
			givenCalldataReturn,
			[largeCall, maxSizedResponse],
		);

		const result = await ethCallCreate(
			anvil.transport,
			encodeCalls([{ to: mockAddress, data: largeCall }]),
		);
		const [entry] = decodeResults(result);

		assert.ok(entry);
		assert.equal(entry.success, true);
		assert.equal(entry.returnData, maxSizedResponse);
	});

	await t.test(
		"reverts when returndata exceeds the CREATE return-size limit",
		async () => {
			await sendFunctionTransaction(anvil.transport, mockAddress, reset, []);

			const oversizedCall = "0x87654321";
			const oversizedResponse =
				`0x${"22".repeat(maxSingleReturnDataSize + 1)}` as Hex.Hex;

			await sendFunctionTransaction(
				anvil.transport,
				mockAddress,
				givenCalldataReturn,
				[oversizedCall, oversizedResponse],
			);

			const response = await ethCallCreateRaw(
				anvil.transport,
				encodeCalls([{ to: mockAddress, data: oversizedCall }]),
			);
			const error = getRpcError(response);
			const revertData = getRevertData(error);

			assert.equal(revertData, "0x");
		},
	);

	await t.test("reverts on malformed trailing bytes", async () => {
		const response = await ethCallCreateRaw(
			anvil.transport,
			Hex.concat(encodeCalls([]), "0x00"),
		);
		const error = getRpcError(response);
		const revertData = getRevertData(error);

		assert.equal(revertData, "0x");
	});
});
