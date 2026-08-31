/**
 * SauceScript Runner
 *
 * Core compilation and execution logic for SauceScript files.
 * Used by scripts/run.ts CLI and can be imported programmatically.
 */

import { createPublicClient, createWalletClient, encodeAbiParameters, http, parseAbi, Hex, defineChain } from 'viem'
import type { AbiParameter } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'

// The compiler is wasm-pack `--target nodejs` output: a CommonJS build that reads its sibling
// `.wasm` off disk at load, so Node's own CJS loader has to resolve it — an `import` does not.
const { compile } = createRequire(import.meta.url)('sauce-compiler') as {
  compile: (options: {
    target: 'evm' | 'svm'
    entry: string
    resolve: (path: string) => Uint8Array | undefined
    defines?: Array<[name: string, value: string]>
  }) => { bytecode: Uint8Array }
}

const ENTRY = 'main.js'

const MAX_DEFINE_VALUE = (1n << 256n) - 1n

// A define REPLACES a module `const` of that name, so the name has to be one the source could have
// declared. Same shape `scripts/run.ts` uses to tell a define operand from a runtime arg.
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const sauceAbi = parseAbi([
  'function cook(bytes[] memory calls) public payable returns (bytes memory)'
])

/**
 * Parse one positional CLI arg — a RUNTIME value for a `main` parameter, not a compile-time define.
 */
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
  const name = pair.slice(0, eq).trim()
  const value = pair.slice(eq + 1).trim()
  // `eq < 1` only rejects a missing or leading `=`, so ' A=5', '1BAD=5' and ' =5' all reach here: a
  // name that is not an identifier overrides no `const` and would reach the compiler as a define
  // nothing can bind to.
  if (!IDENTIFIER.test(name)) throw new Error(`define name '${name}' is not an identifier: got '${pair}'`)
  // `BigInt('')` is 0n, not a throw, so the emptiness check has to be its own — otherwise
  // `NAME=` reaches the compiler as an empty literal it will refuse mid-compile. Trimmed first, so an
  // all-whitespace value is empty rather than 0.
  if (value.length === 0) throw new Error(`define '${name}' has no value: expected NAME=VALUE`)
  // `BigInt` is a WIDER acceptor than the compiler's define grammar: it also reads `0b`/`0o`, a
  // leading `+`, and leading zeros, every one of which the compiler refuses mid-compile. Returning
  // the parsed value's own decimal form is what keeps the two in step — a canonical decimal is always
  // in grammar, so no form `BigInt` reads can slip past. An already-`0x` literal is passed through
  // instead: it is in grammar as written, and the radix a caller chose is the one they want echoed
  // back at them.
  const parsed = BigInt(value)
  // A define is one UNSIGNED 256-bit word, but `BigInt` is unbounded at both ends and both a minus
  // sign and a 100-digit decimal survive normalization, so each bound needs its own rejection rather
  // than reaching the compiler as `-5` or as a value no word can hold.
  if (parsed < 0n) throw new Error(`define '${name}' is negative ('${value}'): a define is one unsigned 256-bit word`)
  if (parsed > MAX_DEFINE_VALUE) throw new Error(`define '${name}' exceeds 2^256-1 ('${value}'): a define is one unsigned 256-bit word`)

  return [name, /^0x/i.test(value) ? value : parsed.toString()]
}

function toHex(bytes: Uint8Array): Hex {
  return ('0x' + Buffer.from(bytes).toString('hex')) as Hex
}

/**
 * `main`'s runtime args, as the byte tail the engine reads them from.
 *
 * A parameterized `main` compiles to a prologue that reads arg i out of the composite `program ++
 * args` at a baked offset, so the args are APPENDED to the program rather than passed alongside it
 * — and the tail is the ordinary ABI encoding of the arg tuple. For the scalars that is one 32-byte
 * big-endian word each, the same shape `sdk/src/svm/args.ts` gives a `scalar` slot; a `>32`-byte hex
 * string is a `bytes` param, which is dynamic and therefore head/tail encoded. A negative value is
 * `int256` so it lands as the two's complement word the source's signed ops expect.
 */
function encodeArgs(args: readonly (bigint | string)[]): string {
  const params: AbiParameter[] = args.map((arg) =>
    typeof arg === 'bigint' ? { type: arg < 0n ? 'int256' : 'uint256' } : { type: 'bytes' },
  )

  return encodeAbiParameters(params, args as unknown[]).slice(2)
}

export interface CompileScriptResult {
  /** Compiled bytecode segments (ready for cook()) */
  bytecodes: Hex[]
  /** Any compiler warnings */
  warnings: string[]
}

export interface CompileScriptOptions {
  /**
   * Compile-time consts, by name: each REPLACES the module's own `const` of that name and is
   * constant-folded, so a given set of values yields fixed bytecode.
   */
  defines?: Record<string, bigint | string>
  /**
   * Positional RUNTIME values for `main`'s parameters, appended to the compiled program (see
   * {@link encodeArgs}). Unlike a define these do not change the program bytes, so one compile
   * serves every set of values.
   */
  args?: (bigint | string)[]
}

/**
 * Compile a SauceScript file to bytecode segments.
 */
export function compileScript(
  scriptPath: string,
  baseDir: string,
  { defines, args = [] }: CompileScriptOptions = {},
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
  const program = toHex(result.bytecode)

  return {
    bytecodes: [args.length > 0 ? ((program + encodeArgs(args)) as Hex) : program],
    warnings: [],
  }
}

export interface RunOptions {
  scriptPath: string
  /** Compile-time consts, by name — see {@link CompileScriptOptions}. */
  defines?: Record<string, bigint | string>
  /** Positional runtime args for `main` — see {@link CompileScriptOptions}. */
  args?: (bigint | string)[]
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
  const { scriptPath, defines = {}, args = [], sauceAddress, rpcUrl, forkUrl, baseDir } = options

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
  if (args.length > 0) {
    console.log('Arguments:', args.map((a) => a.toString()).join(', '))
  }
  console.log('')

  // Read and display source
  const sauceScript = readFileSync(scriptPath, 'utf-8')
  console.log('Source code:')
  console.log(sauceScript)

  console.log('Compiling...')
  const compiled = compileScript(scriptPath, baseDir, {
    ...(defineEntries.length > 0 ? { defines } : {}),
    args,
  })

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
