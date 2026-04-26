import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

import { type Hex, RpcTransport } from "ox";

export const defaultSender = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

export type RpcErrorObject = {
	code: number;
	message: string;
	data?: unknown;
};

export type RawRpcResponse<result> =
	| {
			id: number;
			jsonrpc: "2.0";
			result: result;
	  }
	| {
			id: number;
			jsonrpc: "2.0";
			error: RpcErrorObject;
	  };

export type Transport = RpcTransport.Http<false>;

export type AnvilInstance = {
	child: ReturnType<typeof spawn>;
	logs: string[];
	transport: Transport;
	url: string;
};

export type StartAnvilOptions = {
	args?: readonly string[];
};

export async function startAnvil(
	options: StartAnvilOptions = {},
): Promise<AnvilInstance> {
	const port = await getFreePort();
	const url = `http://127.0.0.1:${port}`;
	const logs: string[] = [];

	const child = spawn(
		"anvil",
		["--host", "127.0.0.1", "--port", String(port), ...(options.args ?? [])],
		{
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	child.stdout?.on("data", (chunk: Buffer | string) => {
		logs.push(chunk.toString());
	});
	child.stderr?.on("data", (chunk: Buffer | string) => {
		logs.push(chunk.toString());
	});

	const transport: Transport = RpcTransport.fromHttp(url);

	try {
		await waitForRpc(transport, child, logs);
	} catch (error) {
		await stopAnvil({ child, logs, transport, url });
		throw error;
	}

	return { child, logs, transport, url };
}

export async function stopAnvil(anvil: AnvilInstance): Promise<void> {
	if (anvil.child.exitCode !== null) {
		return;
	}

	const exit = once(anvil.child, "exit");
	anvil.child.kill("SIGTERM");

	await Promise.race([exit, sleep(2_000)]);

	if (anvil.child.exitCode === null) {
		anvil.child.kill("SIGKILL");
		await exit;
	}
}

export async function deployContract(
	transport: Transport,
	bytecode: Hex.Hex,
): Promise<Hex.Hex> {
	const hash = (await transport.request({
		method: "eth_sendTransaction",
		params: [
			{
				from: defaultSender,
				data: bytecode,
			},
		],
	})) as Hex.Hex;

	const receipt = await waitForReceipt(transport, hash);
	assert.equal(typeof receipt.contractAddress, "string");
	return receipt.contractAddress as Hex.Hex;
}

export async function ethCall(
	transport: Transport,
	request: { to?: Hex.Hex; from?: Hex.Hex; data: Hex.Hex },
): Promise<Hex.Hex> {
	return (await transport.request({
		method: "eth_call",
		params: [request, "latest"],
	})) as Hex.Hex;
}

export async function ethCallCreate(
	transport: Transport,
	data: Hex.Hex,
): Promise<Hex.Hex> {
	return ethCall(transport, {
		from: defaultSender,
		data,
	});
}

export async function ethCallCreateRaw(
	transport: Transport,
	data: Hex.Hex,
): Promise<RawRpcResponse<Hex.Hex>> {
	return (await transport.request(
		{
			method: "eth_call",
			params: [
				{
					from: defaultSender,
					data,
				},
				"latest",
			],
		},
		{ raw: true },
	)) as RawRpcResponse<Hex.Hex>;
}

export async function sendTransaction(
	transport: Transport,
	request: { to?: Hex.Hex; data: Hex.Hex },
): Promise<Hex.Hex> {
	const hash = (await transport.request({
		method: "eth_sendTransaction",
		params: [
			{
				from: defaultSender,
				...request,
			},
		],
	})) as Hex.Hex;

	const receipt = await waitForReceipt(transport, hash);
	assert.notEqual(
		receipt.status,
		"0x0",
		`Transaction ${hash} reverted unexpectedly`,
	);

	return hash;
}

async function waitForRpc(
	transport: Transport,
	child: ReturnType<typeof spawn>,
	logs: string[],
): Promise<void> {
	const timeoutAt = Date.now() + 10_000;

	while (Date.now() < timeoutAt) {
		if (child.exitCode !== null) {
			throw new Error(`anvil exited before becoming ready\n${logs.join("")}`);
		}

		try {
			await transport.request({ method: "eth_blockNumber" });
			return;
		} catch {
			await sleep(100);
		}
	}

	throw new Error(
		`Timed out waiting for anvil to become ready\n${logs.join("")}`,
	);
}

async function waitForReceipt(
	transport: Transport,
	hash: Hex.Hex,
): Promise<{ contractAddress?: string | null; status?: string | null }> {
	const timeoutAt = Date.now() + 10_000;

	while (Date.now() < timeoutAt) {
		const receipt = (await transport.request({
			method: "eth_getTransactionReceipt",
			params: [hash],
		})) as { contractAddress?: string | null; status?: string | null } | null;

		if (receipt) {
			return receipt;
		}

		await sleep(100);
	}

	throw new Error(`Timed out waiting for receipt for ${hash}`);
}

async function getFreePort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = createServer();

		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				reject(new Error("Could not determine a free TCP port"));
				return;
			}

			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}

				resolve(address.port);
			});
		});
	});
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}
