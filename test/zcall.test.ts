import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {join} from 'node:path'
import test from 'node:test'

import {Abi, AbiError, AbiFunction, Bytes, Hex, RpcTransport} from 'ox'

const projectRoot = process.cwd()
const defaultSender = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

const mockArtifactPath = 'out/MockContract.sol/MockContract.json'
const zcallArtifactPath = 'out/ZCall.yul/ZCall.json'

const emptyAbi = Abi.from([])
const zcallErrorsAbi = Abi.from([
  'error ZCallMalformedPayload()',
  'error ZCallFailed(uint256)',
  'error ZCallReturnTooLarge()',
])

const zcallInputMagic = Bytes.fromString('ZCL1')
const zcallOutputMagic = Bytes.fromString('ZCR1')

test('ZCall integration', async (t) => {
  const anvil = await startAnvil()
  t.after(async () => {
    await stopAnvil(anvil)
  })

  const zcallArtifact = await loadArtifact(zcallArtifactPath)
  const mockArtifact = await loadArtifact(mockArtifactPath)

  const zcallInitcode = readBytecode(zcallArtifact, zcallArtifactPath)
  const mockInitcode = readBytecode(mockArtifact, mockArtifactPath)
  const mockAbi = readAbi(mockArtifact, mockArtifactPath)
  const mockAddress = await deployContract(anvil.transport, mockInitcode)

  const getValue = AbiFunction.from('function getValue() returns (uint256)')
  const getGreeting = AbiFunction.from('function getGreeting() returns (string)')
  const echoUint = AbiFunction.from('function echoUint(uint256) returns (uint256)')
  const fail = AbiFunction.from('function fail()')

  const givenCalldataReturn = AbiFunction.fromAbi(mockAbi, 'givenCalldataReturn')
  const givenMethodReturn = AbiFunction.fromAbi(mockAbi, 'givenMethodReturn')
  const givenCalldataRevertWithMessage = AbiFunction.fromAbi(mockAbi, 'givenCalldataRevertWithMessage')
  const reset = AbiFunction.fromAbi(mockAbi, 'reset')

  await t.test('aggregates configured returndata and an allowed revert from the mock', async () => {
    await sendFunctionTransaction(anvil.transport, mockAddress, reset, [])

    const getValueCall = encodeFunctionData(getValue, [])
    const getGreetingCall = encodeFunctionData(getGreeting, [])
    const failCall = encodeFunctionData(fail, [])

    await sendFunctionTransaction(anvil.transport, mockAddress, givenCalldataReturn, [
      getValueCall,
      encodeFunctionResult(getValue, 0x11223344n),
    ])
    await sendFunctionTransaction(anvil.transport, mockAddress, givenCalldataReturn, [
      getGreetingCall,
      encodeFunctionResult(getGreeting, 'hello from mock-contract'),
    ])
    await sendFunctionTransaction(anvil.transport, mockAddress, givenCalldataRevertWithMessage, [
      failCall,
      'mocked revert',
    ])

    const result = await ethCallCreate(
      anvil.transport,
      buildZCallData(zcallInitcode, [
        {
          target: mockAddress,
          allowFailure: false,
          calldata: getValueCall,
        },
        {
          target: mockAddress,
          allowFailure: false,
          calldata: getGreetingCall,
        },
        {
          target: mockAddress,
          allowFailure: true,
          calldata: failCall,
        },
      ]),
    )

    const entries = decodeZCallResponse(result)

    assert.equal(entries.length, 3)
    assert.equal(entries[0]?.success, true)
    assert.equal(decodeFunctionResult(getValue, entries[0]!.returndata), 0x11223344n)

    assert.equal(entries[1]?.success, true)
    assert.equal(decodeFunctionResult(getGreeting, entries[1]!.returndata), 'hello from mock-contract')

    assert.equal(entries[2]?.success, false)
    const revertError = AbiError.fromAbi(emptyAbi, entries[2]!.returndata)
    assert.equal(revertError.name, 'Error')
    assert.equal(AbiError.decode(revertError, entries[2]!.returndata), 'mocked revert')
  })

  await t.test('prefers exact calldata mocks over method-level mocks', async () => {
    await sendFunctionTransaction(anvil.transport, mockAddress, reset, [])

    const echoSevenCall = encodeFunctionData(echoUint, [7n])
    const echoEightCall = encodeFunctionData(echoUint, [8n])
    const echoNineCall = encodeFunctionData(echoUint, [9n])

    await sendFunctionTransaction(anvil.transport, mockAddress, givenMethodReturn, [
      echoSevenCall,
      encodeFunctionResult(echoUint, 700n),
    ])
    await sendFunctionTransaction(anvil.transport, mockAddress, givenCalldataReturn, [
      echoEightCall,
      encodeFunctionResult(echoUint, 800n),
    ])

    const result = await ethCallCreate(
      anvil.transport,
      buildZCallData(zcallInitcode, [
        {
          target: mockAddress,
          allowFailure: false,
          calldata: echoSevenCall,
        },
        {
          target: mockAddress,
          allowFailure: false,
          calldata: echoEightCall,
        },
        {
          target: mockAddress,
          allowFailure: false,
          calldata: echoNineCall,
        },
      ]),
    )

    const entries = decodeZCallResponse(result)

    assert.equal(entries.length, 3)
    assert.equal(decodeFunctionResult(echoUint, entries[0]!.returndata), 700n)
    assert.equal(decodeFunctionResult(echoUint, entries[1]!.returndata), 800n)
    assert.equal(decodeFunctionResult(echoUint, entries[2]!.returndata), 700n)
  })

  await t.test('reverts when a subcall failure is disallowed', async () => {
    await sendFunctionTransaction(anvil.transport, mockAddress, reset, [])

    const failCall = encodeFunctionData(fail, [])
    await sendFunctionTransaction(anvil.transport, mockAddress, givenCalldataRevertWithMessage, [
      failCall,
      'fatal mock revert',
    ])

    const response = await ethCallCreateRaw(
      anvil.transport,
      buildZCallData(zcallInitcode, [
        {
          target: mockAddress,
          allowFailure: false,
          calldata: failCall,
        },
      ]),
    )

    const error = getRpcError(response)
    const revertData = getRevertData(error)

    const abiError = AbiError.fromAbi(zcallErrorsAbi, revertData)
    assert.equal(abiError.name, 'ZCallFailed')
    assert.equal(AbiError.decode(abiError, revertData), 0n)
  })

  await t.test('reverts on malformed payload', async () => {
    const response = await ethCallCreateRaw(anvil.transport, Hex.concat(zcallInitcode, '0x00'))
    const error = getRpcError(response)
    const revertData = getRevertData(error)

    const abiError = AbiError.fromAbi(zcallErrorsAbi, revertData)
    assert.equal(abiError.name, 'ZCallMalformedPayload')
    assert.equal(AbiError.decode(abiError, revertData), undefined)
  })
})

type Artifact = {
  abi?: Abi.Abi
  bytecode?: {
    object?: string
  }
}

type CallSpec = {
  target: Hex.Hex
  allowFailure: boolean
  calldata: Hex.Hex
}

type ZCallEntry = {
  success: boolean
  returndata: Hex.Hex
}

type RpcErrorObject = {
  code: number
  message: string
  data?: unknown
}

type RawRpcResponse<result> =
  | {
      id: number
      jsonrpc: '2.0'
      result: result
    }
  | {
      id: number
      jsonrpc: '2.0'
      error: RpcErrorObject
    }

type AnvilInstance = {
  child: ReturnType<typeof spawn>
  logs: string[]
  transport: Transport
  url: string
}

type Transport = RpcTransport.Http<false>
type AnyFunction = ReturnType<typeof AbiFunction.from>

async function loadArtifact(relativePath: string): Promise<Artifact> {
  const filePath = join(projectRoot, relativePath)
  return JSON.parse(await readFile(filePath, 'utf8')) as Artifact
}

function readAbi(artifact: Artifact, artifactPath: string): Abi.Abi {
  assert.ok(artifact.abi, `Missing ABI in ${artifactPath}`)
  return artifact.abi
}

function readBytecode(artifact: Artifact, artifactPath: string): Hex.Hex {
  const bytecode = artifact.bytecode?.object
  assert.ok(bytecode && bytecode !== '0x', `Missing bytecode in ${artifactPath}`)
  return normalizeHex(bytecode)
}

async function startAnvil(): Promise<AnvilInstance> {
  const port = await getFreePort()
  const url = `http://127.0.0.1:${port}`
  const logs: string[] = []

  const child = spawn('anvil', ['--host', '127.0.0.1', '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout?.on('data', (chunk: Buffer | string) => {
    logs.push(chunk.toString())
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    logs.push(chunk.toString())
  })

  const transport: Transport = RpcTransport.fromHttp(url)

  try {
    await waitForRpc(transport, child, logs)
  } catch (error) {
    await stopAnvil({child, logs, transport, url})
    throw error
  }

  return {child, logs, transport, url}
}

async function stopAnvil(anvil: AnvilInstance): Promise<void> {
  if (anvil.child.exitCode !== null) {
    return
  }

  const exit = once(anvil.child, 'exit')
  anvil.child.kill('SIGTERM')

  await Promise.race([exit, sleep(2_000)])

  if (anvil.child.exitCode === null) {
    anvil.child.kill('SIGKILL')
    await exit
  }
}

async function waitForRpc(
  transport: Transport,
  child: ReturnType<typeof spawn>,
  logs: string[],
): Promise<void> {
  const timeoutAt = Date.now() + 10_000

  while (Date.now() < timeoutAt) {
    if (child.exitCode !== null) {
      throw new Error(`anvil exited before becoming ready\n${logs.join('')}`)
    }

    try {
      await transport.request({method: 'eth_blockNumber'})
      return
    } catch {
      await sleep(100)
    }
  }

  throw new Error(`Timed out waiting for anvil to become ready\n${logs.join('')}`)
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not determine a free TCP port'))
        return
      }

      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(address.port)
      })
    })
  })
}

async function deployContract(
  transport: Transport,
  bytecode: Hex.Hex,
): Promise<Hex.Hex> {
  const hash = (await transport.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from: defaultSender,
        data: bytecode,
      },
    ],
  })) as Hex.Hex

  const receipt = await waitForReceipt(transport, hash)
  assert.equal(typeof receipt.contractAddress, 'string')
  return receipt.contractAddress as Hex.Hex
}

async function waitForReceipt(
  transport: Transport,
  hash: Hex.Hex,
): Promise<{contractAddress?: string | null; status?: string | null}> {
  const timeoutAt = Date.now() + 10_000

  while (Date.now() < timeoutAt) {
    const receipt = (await transport.request({
      method: 'eth_getTransactionReceipt',
      params: [hash],
    })) as {contractAddress?: string | null; status?: string | null} | null

    if (receipt) {
      return receipt
    }

    await sleep(100)
  }

  throw new Error(`Timed out waiting for receipt for ${hash}`)
}

function buildZCallData(zcallInitcode: Hex.Hex, calls: readonly CallSpec[]): Hex.Hex {
  const parts = [zcallInputMagic]

  for (const call of calls) {
    parts.push(Bytes.from(call.target))
    parts.push(Bytes.fromNumber(call.allowFailure ? 1 : 0, {size: 1}))
    parts.push(Bytes.fromNumber(Hex.size(call.calldata), {size: 2}))
    parts.push(Bytes.from(call.calldata))
  }

  return Hex.concat(zcallInitcode, Bytes.toHex(Bytes.concat(...parts)))
}

function decodeZCallResponse(data: Hex.Hex): ZCallEntry[] {
  const bytes = Bytes.fromHex(data)
  assert.equal(Bytes.toHex(Bytes.slice(bytes, 0, 4)), Bytes.toHex(zcallOutputMagic))

  const entries: ZCallEntry[] = []
  let cursor = 4

  while (cursor < Bytes.size(bytes)) {
    assert.ok(cursor + 3 <= Bytes.size(bytes), 'Truncated ZCall response header')

    const success = Bytes.toNumber(Bytes.slice(bytes, cursor, cursor + 1), {size: 1}) === 1
    const returndataLength = Bytes.toNumber(Bytes.slice(bytes, cursor + 1, cursor + 3), {size: 2})
    const returndataStart = cursor + 3
    const returndataEnd = returndataStart + returndataLength

    assert.ok(returndataEnd <= Bytes.size(bytes), 'Truncated ZCall response body')

    entries.push({
      success,
      returndata: Bytes.toHex(Bytes.slice(bytes, returndataStart, returndataEnd)),
    })

    cursor = returndataEnd
  }

  return entries
}

async function sendFunctionTransaction(
  transport: Transport,
  to: Hex.Hex,
  abiFunction: AnyFunction,
  args: readonly unknown[],
): Promise<void> {
  await sendTransaction(transport, {
    to,
    data: encodeFunctionData(abiFunction, args),
  })
}

async function ethCallCreate(
  transport: Transport,
  data: Hex.Hex,
): Promise<Hex.Hex> {
  return ethCall(transport, {
    from: defaultSender,
    data,
  })
}

async function ethCall(
  transport: Transport,
  request: {to?: Hex.Hex; from?: Hex.Hex; data: Hex.Hex},
): Promise<Hex.Hex> {
  return (await transport.request({
    method: 'eth_call',
    params: [
      request,
      'latest',
    ],
  })) as Hex.Hex
}

async function ethCallCreateRaw(
  transport: Transport,
  data: Hex.Hex,
): Promise<RawRpcResponse<Hex.Hex>> {
  return (await transport.request(
    {
      method: 'eth_call',
      params: [
        {
          from: defaultSender,
          data,
        },
        'latest',
      ],
    },
    {raw: true},
  )) as RawRpcResponse<Hex.Hex>
}

async function sendTransaction(
  transport: Transport,
  request: {to?: Hex.Hex; data: Hex.Hex},
): Promise<Hex.Hex> {
  const hash = (await transport.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from: defaultSender,
        ...request,
      },
    ],
  })) as Hex.Hex

  const receipt = await waitForReceipt(transport, hash)
  assert.notEqual(receipt.status, '0x0', `Transaction ${hash} reverted unexpectedly`)

  return hash
}

function getRpcError(response: RawRpcResponse<Hex.Hex>): RpcErrorObject {
  if ('error' in response) {
    return response.error
  }

  assert.fail(`Expected RPC error, received result ${response.result}`)
}

function getRevertData(error: RpcErrorObject): Hex.Hex {
  const {data} = error
  if (typeof data !== 'string') {
    throw new Error(`Expected string revert data, received ${typeof data}`)
  }

  return normalizeHex(data)
}

function encodeFunctionData(abiFunction: AnyFunction, args: readonly unknown[]): Hex.Hex {
  return AbiFunction.encodeData(abiFunction as never, args as never)
}

function encodeFunctionResult(abiFunction: AnyFunction, output: unknown): Hex.Hex {
  return AbiFunction.encodeResult(abiFunction as never, output as never)
}

function decodeFunctionResult(abiFunction: AnyFunction, result: Hex.Hex): unknown {
  return AbiFunction.decodeResult(abiFunction as never, result)
}

function normalizeHex(value: string): Hex.Hex {
  return (value.startsWith('0x') ? value : `0x${value}`) as Hex.Hex
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}
