/**
 * SauceScript Runner
 *
 * Core compilation and execution logic for SauceScript files.
 * Used by scripts/run.ts CLI and can be imported programmatically.
 */

import { createPublicClient, createWalletClient, http, parseAbi, Hex, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'

// The compiler is wasm-pack `--target nodejs` output: a CommonJS build that reads its sibling
// `.wasm` off disk at load, so Node's own CJS loader has to resolve it — an `import` does not.
const { compile } = createRequire(import.meta.url)('sauce-next') as {
  compile: (options: {
    target: 'evm' | 'svm'
    entry: string
    resolve: (path: string) => Uint8Array | undefined
    defines?: Array<[name: string, value: string]>
  }) => { bytecode: Uint8Array }
}

const ENTRY = 'main.js'

const sauceAbi = parseAbi([
  'function cook(bytes[] memory calls) public payable returns (bytes memory)'
])

export function parseArg(arg: string): bigint | string {
  // Hex strings longer than 32 bytes (66 chars with 0x) are passed as bytes, not bigint
  if (arg.startsWith('0x') && arg.length > 66) {
    return arg
  }
  return BigInt(arg)
}

/**
 * Parse one `NAME=VALUE` CLI define. A value is one 256-bit word, so it is an integer literal —
 * decimal or `0x`-hex — never an array.
 */
export function parseDefine(pair: string): [string, string] {
  const eq = pair.indexOf('=')
  if (eq < 1) throw new Error(`expected NAME=VALUE, got '${pair}'`)
  const name = pair.slice(0, eq)
  const value = pair.slice(eq + 1)
  // Reject early rather than handing the compiler something it will refuse mid-compile.
  BigInt(value)

  return [name, value]
}

function toHex(bytes: Uint8Array): Hex {
  return ('0x' + Buffer.from(bytes).toString('hex')) as Hex
}

export interface CompileScriptResult {
  /** Compiled bytecode segments (ready for cook()) */
  bytecodes: Hex[]
  /** Any compiler warnings */
  warnings: string[]
}

/**
 * Compile a SauceScript file to bytecode segments.
 *
 * `defines` are compile-time consts: each REPLACES the module's own `const` of that name and is
 * constant-folded, so a given set of values yields fixed bytecode. (The compiler has no
 * positional compile-time `args`; a script that wants build-time values declares consts and the
 * caller overrides them by name.)
 */
export function compileScript(
  scriptPath: string,
  baseDir: string,
  defines?: Record<string, bigint | string>,
): CompileScriptResult {
  const sauceScript = readFileSync(scriptPath, 'utf-8')
  const scriptDir = dirname(scriptPath)

  const resolve = (path: string): Uint8Array | undefined => {
    const key = path.replace(/^\.\//, '')
    if (key === ENTRY) return Buffer.from(sauceScript)
    // A miss is `undefined` — "nothing at this path" — never a throw, which would mean
    // "present but unreadable" and stop the compiler falling back.
    for (const dir of [scriptDir, baseDir, join(baseDir, 'node_modules')]) {
      const candidate = join(dir, key)
      if (existsSync(candidate)) return readFileSync(candidate)
    }

    return undefined
  }

  const entries = Object.entries(defines ?? {})
  const result = compile({
    target: 'evm',
    entry: ENTRY,
    resolve,
    ...(entries.length > 0 ? { defines: entries.map(([k, v]) => [k, v.toString()] as [string, string]) } : {}),
  })

  // The compiler emits ONE program; `cook()` takes a list, and executes `calls[0]`.
  return { bytecodes: [toHex(result.bytecode)], warnings: [] }
}

export interface RunOptions {
  scriptPath: string
  /** Compile-time consts, by name — see {@link compileScript}. */
  defines?: Record<string, bigint | string>
  sauceAddress: string
  rpcUrl: string
  forkUrl?: string
  /** Project root directory where node_modules/ lives (for import resolution) */
  baseDir: string
}

/**
 * Compile and execute a SauceScript on a Sauce contract.
 */
export async function executeScript(options: RunOptions): Promise<void> {
  const { scriptPath, defines = {}, sauceAddress, rpcUrl, forkUrl, baseDir } = options

  console.log('=== SauceScript Runner ===\n')
  console.log('File:', scriptPath)
  console.log('Sauce contract:', sauceAddress)
  console.log('RPC URL:', rpcUrl)
  if (forkUrl) {
    console.log('Fork URL:', forkUrl)
  }
  const defineEntries = Object.entries(defines)
  if (defineEntries.length > 0) {
    console.log('Defines:', defineEntries.map(([k, v]) => `${k}=${v}`).join(', '))
  }
  console.log('')

  // Read and display source
  const sauceScript = readFileSync(scriptPath, 'utf-8')
  console.log('Source code:')
  console.log(sauceScript)

  console.log('Compiling...')
  const compiled = compileScript(scriptPath, baseDir, defineEntries.length > 0 ? defines : undefined)

  console.log('Segments:', compiled.bytecodes.length)
  for (let i = 0; i < compiled.bytecodes.length; i++) {
    const seg = compiled.bytecodes[i]
    console.log(`  [${i}] ${(seg.length - 2) / 2} bytes: ${seg.slice(0, 42)}${seg.length > 42 ? '...' : ''}`)
  }

  if (compiled.warnings.length > 0) {
    console.log('\nWarnings:')
    compiled.warnings.forEach((w) => console.log('  -', w))
  }

  // Set up viem clients (using Anvil's default pre-funded account)
  const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  const account = privateKeyToAccount(privateKey)

  // Fetch the actual chain ID from the RPC (fork may use original chain ID)
  const tempClient = createPublicClient({ transport: http(rpcUrl) })
  const chainId = await tempClient.getChainId()

  const chain = defineChain({
    id: chainId,
    name: 'Anvil',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } }
  })

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl)
  })

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl)
  })

  console.log('\nExecuting on Sauce contract...')
  console.log('Caller:', account.address)

  // Call cook() with the compiled bytecode segments
  const hash = await walletClient.writeContract({
    address: sauceAddress as Hex,
    abi: sauceAbi,
    functionName: 'cook',
    args: [compiled.bytecodes],
    chain,
    account
  })

  console.log('Transaction hash:', hash)

  // Wait for the transaction receipt
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log('Transaction status:', receipt.status)

  // Simulate to get the return value
  const returnData = await publicClient.simulateContract({
    address: sauceAddress as Hex,
    abi: sauceAbi,
    functionName: 'cook',
    args: [compiled.bytecodes],
    account: account.address,
    chain
  })

  console.log('\nReturn value:', returnData.result)
  console.log('\nDone!')
}
