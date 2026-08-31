/**
 * End-to-end integration tests for all SauceScript examples.
 *
 * Starts a local Hardhat node, deploys Sauce for simple V1 scripts,
 * then compiles ERC20 to V12 sauce, deploys via the V12 on-chain compiler,
 * and tests with standard ERC20 calls.
 *
 * Run:  npx tsx test/e2e.test.ts
 * Or:   npm run test:e2e
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  defineChain,
  encodeAbiParameters,
} from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { execSync, spawn } from "child_process";

import { createRequire } from "node:module";

// wasm-pack `--target nodejs` output: a CommonJS build reading its sibling `.wasm` at load.
const { compile } = createRequire(import.meta.url)("sauce-next") as {
  compile: (options: {
    target: "evm" | "svm";
    entry: string;
    resolve: (path: string) => Uint8Array | undefined;
    defines?: Array<[name: string, value: string]>;
  }) => { bytecode: Uint8Array };
};

const ENTRY = "main.js";

/** Resolve the entry, plus any import, off disk from `ROOT`. */
const resolverFor = (source: string) => (path: string): Uint8Array | undefined => {
  const key = path.replace(/^\.\//, "");
  if (key === ENTRY) return Buffer.from(source);
  for (const dir of [ROOT, join(ROOT, "node_modules")]) {
    const candidate = join(dir, key);
    if (existsSync(candidate)) return readFileSync(candidate);
  }

  return undefined;
};

const toDefines = (defines: Record<string, bigint | string>): Array<[string, string]> =>
  Object.entries(defines).map(([k, v]) => [k, v.toString()] as [string, string]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPO_ROOT = join(ROOT, "..");
const JS_DIR = join(ROOT, "sauce", "js");
const TS_DIR = join(ROOT, "sauce", "ts");
const RPC_URL = "http://127.0.0.1:8545";

const sauceAbi = parseAbi([
  "function cook(bytes[] memory calls) public payable returns (bytes memory)",
]);

// Hardhat account #0
const ACCOUNT0_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ACCOUNT0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
// Hardhat account #1
const ACCOUNT1_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ACCOUNT1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

// ── Test harness ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  ✕ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

function eq(actual: bigint | string, expected: bigint | string, msg?: string) {
  const a = BigInt(actual);
  const b = BigInt(expected);
  if (a !== b) {
    throw new Error(
      msg ||
        `Expected ${b} (0x${b.toString(16)}), got ${a} (0x${a.toString(16)})`,
    );
  }
}

// ── Compile helpers ──────────────────────────────────────────

function compileScript(path: string, defines: Record<string, bigint | string> = {}): Hex[] {
  // The compiler reads the annotated source directly, so a `.ts` script needs no strip step.
  const source = readFileSync(path, "utf-8");
  const entries = toDefines(defines);
  const result = compile({
    target: "evm",
    entry: ENTRY,
    resolve: resolverFor(source),
    ...(entries.length > 0 ? { defines: entries } : {}),
  });

  // One program; `cook()` takes a list and executes `calls[0]`.
  return [("0x" + Buffer.from(result.bytecode).toString("hex")) as Hex];
}

/** Compile a sauce script to a V12 single blob */
function compileV12(path: string): Hex {
  const source = readFileSync(path, "utf-8");
  const result = compile({ target: "evm", entry: ENTRY, resolve: resolverFor(source) });

  return ("0x" + Buffer.from(result.bytecode).toString("hex")) as Hex;
}

// ── Sauce helpers ─────────────────────────────────────────────

type Client = {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  sauceAddress: Hex;
  chain: ReturnType<typeof defineChain>;
};

/** Send a cook() transaction (mutates state), return the bytes result */
async function cook(
  client: Client,
  scriptPath: string,
  defines: Record<string, bigint | string>,
  account = privateKeyToAccount(ACCOUNT0_KEY),
): Promise<Hex> {
  const bytecodes = compileScript(scriptPath, defines);

  const hash = await client.walletClient.writeContract({
    address: client.sauceAddress,
    abi: sauceAbi,
    functionName: "cook",
    args: [bytecodes],
    chain: client.chain,
    account,
  });
  const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success")
    throw new Error(`Transaction reverted: ${hash}`);

  const { result } = await client.publicClient.simulateContract({
    address: client.sauceAddress,
    abi: sauceAbi,
    functionName: "cook",
    args: [bytecodes],
    account: account.address,
    chain: client.chain,
  });
  return result;
}

/** Simulate a cook() call (read-only, no state mutation) */
async function view(
  client: Client,
  scriptPath: string,
  defines: Record<string, bigint | string>,
  account = ACCOUNT0 as Hex,
): Promise<Hex> {
  const bytecodes = compileScript(scriptPath, defines);
  const { result } = await client.publicClient.simulateContract({
    address: client.sauceAddress,
    abi: sauceAbi,
    functionName: "cook",
    args: [bytecodes],
    account,
    chain: client.chain,
  });
  return result;
}

function resultToUint(hex: Hex): bigint {
  return BigInt(hex);
}

// ── Node lifecycle ────────────────────────────────────────────

async function waitForNode(maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const client = createPublicClient({ transport: http(RPC_URL) });
      await client.getChainId();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("Hardhat node did not start in time");
}

async function startNode(): Promise<number> {
  // Check if a node is already running
  try {
    const client = createPublicClient({ transport: http(RPC_URL) });
    await client.getChainId();
    console.log("Using existing Hardhat node");
    return 0; // sentinel: don't kill on cleanup
  } catch {}

  try {
    execSync("lsof -ti :8545 | xargs kill -9 2>/dev/null", { stdio: "ignore" });
  } catch {}
  await new Promise((r) => setTimeout(r, 500));

  const child = spawn("npx", ["hardhat", "node"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env },
  });
  child.unref();
  child.stdout?.resume();
  child.stderr?.resume();

  await waitForNode();
  return child.pid!;
}

async function deployContract(): Promise<Hex> {
  const chain = defineChain({
    id: 31337,
    name: "Hardhat",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });
  const account = privateKeyToAccount(ACCOUNT0_KEY);
  const publicClient = createPublicClient({
    chain,
    transport: http(RPC_URL),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  });

  // Deploy Router
  const routerArtifact = JSON.parse(
    readFileSync(join(ROOT, "artifacts/Router.json"), "utf-8"),
  );
  // @ts-expect-error - viem types require kzg for blob transactions, but we're not using blobs
  const routerHash = await walletClient.deployContract({
    abi: routerArtifact.abi,
    bytecode: routerArtifact.bytecode.object as Hex,
    account,
    chain,
  });
  const routerReceipt = await publicClient.waitForTransactionReceipt({
    hash: routerHash,
  });
  if (!routerReceipt.contractAddress)
    throw new Error("Router deployment failed");

  // Deploy SauceRouter with Router address
  const sauceRouterArtifact = JSON.parse(
    readFileSync(join(ROOT, "artifacts/SauceRouter.json"), "utf-8"),
  );
  // @ts-expect-error - viem types require kzg for blob transactions, but we're not using blobs
  const hash = await walletClient.deployContract({
    abi: sauceRouterArtifact.abi,
    bytecode: sauceRouterArtifact.bytecode.object as Hex,
    args: [routerReceipt.contractAddress],
    account,
    chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress)
    throw new Error("SauceRouter deployment failed");
  return receipt.contractAddress as Hex;
}

function stopNode(pid: number) {
  if (pid === 0) return; // external node, don't kill
  try {
    process.kill(-pid, "SIGTERM");
  } catch {}
  try {
    execSync("lsof -ti :8545 | xargs kill -9 2>/dev/null", { stdio: "ignore" });
  } catch {}
}

// ── V12 deployment helpers ───────────────────────────────────

/** Compile V12Compiler.huff and return its bytecode */
function getV12CompilerBytecode(): Hex {
  const output = execSync("hnc -b engine-v12/v12/V12Compiler.huff", {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env: { ...process.env },
  }).trim();
  return ("0x" + output) as Hex;
}

/** Deploy raw bytecode via CREATE, return the deployed address */
async function deployBytecode(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  bytecode: Hex,
  chain: ReturnType<typeof defineChain>,
): Promise<Hex> {
  const account = privateKeyToAccount(ACCOUNT0_KEY);
  const hash = await walletClient.sendTransaction({
    data: bytecode,
    chain,
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress)
    throw new Error("Deploy failed: no contract address");
  return receipt.contractAddress as Hex;
}

/**
 * Deploy oversized bytecode using hardhat_setCode (bypasses EIP-170 24KB limit).
 * The bytecode should be init code that includes a constructor returning the runtime.
 * We extract the runtime portion directly and set it via hardhat_setCode.
 */
async function deployWithSetCode(
  publicClient: ReturnType<typeof createPublicClient>,
  initBytecode: Hex,
): Promise<Hex> {
  // For hnc output: init code is at the start, runtime follows after
  // Execute the init code to get runtime by calling the bytecode as a contract
  // Instead, we know hnc init code format: first bytes are constructor that copies runtime.
  // Simpler: deploy to a temp address via hardhat_setCode after extracting runtime.
  //
  // hnc init code format: PUSH2 <runtimeLen> DUP1 PUSH1 <offset> RETURNDATASIZE CODECOPY ... RETURN <runtime>
  // The runtime starts at offset specified in the constructor.
  // For hnc: 61 <len:2> 80 600a 3d 39 3d f3 <runtime>
  // Constructor is 10 bytes (0x0a), runtime starts at byte 10
  const runtimeHex = ("0x" + initBytecode.slice(2 + 20)) as Hex; // skip 10 bytes (20 hex chars)

  // Use a deterministic address
  const compilerAddress = "0x00000000000000000000000000000000000c0419" as Hex;
  await publicClient.transport.request({
    method: "hardhat_setCode" as any,
    params: [compilerAddress, runtimeHex],
  });
  return compilerAddress;
}

/** Compile V12 sauce on-chain: send sauce as calldata to the compiler, get EVM bytecode back */
async function compileOnChain(
  publicClient: ReturnType<typeof createPublicClient>,
  compilerAddress: Hex,
  sauce: Hex,
): Promise<Hex> {
  const result = await publicClient.call({
    to: compilerAddress,
    data: sauce,
  });
  if (!result.data) throw new Error("On-chain compilation returned no data");
  return result.data;
}

/** Wrap runtime EVM bytecode in 14-byte init code (constructor) and return full creation code */
function buildInitCode(runtime: Hex): Hex {
  const runtimeBytes = Buffer.from(runtime.slice(2), "hex");
  const len = runtimeBytes.length;
  const initPrefix = Buffer.from([
    0x61,
    (len >> 8) & 0xff,
    len & 0xff, // PUSH2 <len>
    0x60,
    0x0e, // PUSH1 14 (constructor length)
    0x60,
    0x00, // PUSH1 0
    0x39, // CODECOPY
    0x61,
    (len >> 8) & 0xff,
    len & 0xff, // PUSH2 <len>
    0x60,
    0x00, // PUSH1 0
    0xf3, // RETURN
  ]);
  return ("0x" +
    Buffer.concat([initPrefix, runtimeBytes]).toString("hex")) as Hex;
}

/**
 * Full V12 ERC20 deployment pipeline:
 * 1. Compile sauce script to V12 blob
 * 2. Send V12 blob to on-chain compiler → EVM bytecode
 * 3. Wrap in init code, deploy as standalone contract
 */
async function deployV12ERC20(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  compilerAddress: Hex,
  scriptPath: string,
  chain: ReturnType<typeof defineChain>,
): Promise<Hex> {
  const sauceBlob = compileV12(scriptPath);
  const evmBytecode = await compileOnChain(
    publicClient,
    compilerAddress,
    sauceBlob,
  );
  const creationCode = buildInitCode(evmBytecode);
  return deployBytecode(publicClient, walletClient, creationCode, chain);
}

// ── V12 ERC20 call helpers ───────────────────────────────────

type V12Client = {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  chain: ReturnType<typeof defineChain>;
};

/** Call a deployed V12 ERC20 (read-only), return raw result as uint256 */
async function v12Call(
  client: V12Client,
  erc20: Hex,
  calldata: Hex,
  account = ACCOUNT0 as Hex,
): Promise<bigint> {
  const result = await client.publicClient.call({
    to: erc20,
    data: calldata,
    account,
  });
  if (!result.data) throw new Error("Call returned no data");
  return BigInt(result.data);
}

/** Send a transaction to a deployed V12 ERC20 (mutates state), return result as uint256 */
async function v12Send(
  client: V12Client,
  erc20: Hex,
  calldata: Hex,
  account = privateKeyToAccount(ACCOUNT0_KEY),
): Promise<bigint> {
  // Simulate first to get return value
  const simResult = await client.publicClient.call({
    to: erc20,
    data: calldata,
    account: account.address,
  });

  // Execute the actual transaction
  const hash = await client.walletClient.sendTransaction({
    to: erc20,
    data: calldata,
    chain: client.chain,
    account,
  });
  const receipt = await client.publicClient.waitForTransactionReceipt({
    hash,
  });
  if (receipt.status !== "success")
    throw new Error(`Transaction reverted: ${hash}`);

  if (!simResult.data) throw new Error("Simulation returned no data");
  return BigInt(simResult.data);
}

/** Encode a standard EVM function call: [selector:4bytes][abi-encoded args] */
function encodeCall(
  selector: Hex,
  types: { type: string }[],
  values: any[],
): Hex {
  if (types.length === 0) return selector;
  const argsHex = encodeAbiParameters(types, values);
  return (selector + argsHex.slice(2)) as Hex;
}

// ── Test suites ──────────────────────────────────────────────

/** Test a simple script (JS + TS) with given defines and expected return */
async function testSimpleScript(
  client: Client,
  name: string,
  defines: Record<string, bigint>,
  expected: bigint,
) {
  const jsPath = join(JS_DIR, `${name}.js`);
  const tsPath = join(TS_DIR, `${name}.ts`);

  await test(`${name}.js returns ${expected}`, async () => {
    const result = await view(client, jsPath, defines);
    eq(resultToUint(result), expected);
  });

  await test(`${name}.ts returns ${expected}`, async () => {
    const result = await view(client, tsPath, defines);
    eq(resultToUint(result), expected);
  });
}

/** Test a V12-deployed ERC20 with standard ERC20 calls */
async function testV12ERC20(client: V12Client, erc20: Hex, label: string) {
  const SEL_TOTAL_SUPPLY: Hex = "0x18160ddd";
  const SEL_DECIMALS: Hex = "0x313ce567";
  const SEL_BALANCE_OF: Hex = "0x70a08231";
  const SEL_ALLOWANCE: Hex = "0xdd62ed3e";
  const SEL_APPROVE: Hex = "0x095ea7b3";
  const SEL_TRANSFER: Hex = "0xa9059cbb";
  const SEL_TRANSFER_FROM: Hex = "0x23b872dd";
  const SEL_MINT: Hex = "0x40c10f19";

  const addrType = { type: "address" } as const;
  const u256Type = { type: "uint256" } as const;

  // ── Reads on empty state ────────────────────────
  console.log(`\n  ${label}: reads (empty state)`);

  await test(`${label}: totalSupply is 0`, async () => {
    eq(await v12Call(client, erc20, SEL_TOTAL_SUPPLY), 0n);
  });

  await test(`${label}: decimals is 18`, async () => {
    eq(await v12Call(client, erc20, SEL_DECIMALS), 18n);
  });

  await test(`${label}: balanceOf(account0) is 0`, async () => {
    const data = encodeCall(SEL_BALANCE_OF, [addrType], [ACCOUNT0]);
    eq(await v12Call(client, erc20, data), 0n);
  });

  // ── Mint ────────────────────────────────────────
  console.log(`  ${label}: mint`);

  await test(`${label}: mint 1000 to account0`, async () => {
    const data = encodeCall(SEL_MINT, [addrType, u256Type], [ACCOUNT0, 1000n]);
    eq(await v12Send(client, erc20, data), 1n);
  });

  await test(`${label}: balanceOf(account0) is 1000`, async () => {
    const data = encodeCall(SEL_BALANCE_OF, [addrType], [ACCOUNT0]);
    eq(await v12Call(client, erc20, data), 1000n);
  });

  await test(`${label}: totalSupply is 1000`, async () => {
    eq(await v12Call(client, erc20, SEL_TOTAL_SUPPLY), 1000n);
  });

  await test(`${label}: mint 500 to account1`, async () => {
    const data = encodeCall(SEL_MINT, [addrType, u256Type], [ACCOUNT1, 500n]);
    eq(await v12Send(client, erc20, data), 1n);
  });

  await test(`${label}: totalSupply is 1500`, async () => {
    eq(await v12Call(client, erc20, SEL_TOTAL_SUPPLY), 1500n);
  });

  // ── Transfer ────────────────────────────────────
  console.log(`  ${label}: transfer`);

  await test(`${label}: transfer 300 from account0 to account1`, async () => {
    const data = encodeCall(
      SEL_TRANSFER,
      [addrType, u256Type],
      [ACCOUNT1, 300n],
    );
    eq(await v12Send(client, erc20, data), 1n);
  });

  await test(`${label}: balanceOf(account0) is 700`, async () => {
    const data = encodeCall(SEL_BALANCE_OF, [addrType], [ACCOUNT0]);
    eq(await v12Call(client, erc20, data), 700n);
  });

  await test(`${label}: balanceOf(account1) is 800`, async () => {
    const data = encodeCall(SEL_BALANCE_OF, [addrType], [ACCOUNT1]);
    eq(await v12Call(client, erc20, data), 800n);
  });

  // ── Approve + Allowance ─────────────────────────
  console.log(`  ${label}: approve + allowance`);

  await test(`${label}: approve account1 for 200`, async () => {
    const data = encodeCall(
      SEL_APPROVE,
      [addrType, u256Type],
      [ACCOUNT1, 200n],
    );
    eq(await v12Send(client, erc20, data), 1n);
  });

  await test(`${label}: allowance(account0, account1) is 200`, async () => {
    const data = encodeCall(
      SEL_ALLOWANCE,
      [addrType, addrType],
      [ACCOUNT0, ACCOUNT1],
    );
    eq(await v12Call(client, erc20, data), 200n);
  });

  // ── TransferFrom ────────────────────────────────
  console.log(`  ${label}: transferFrom`);

  const account1Wallet = privateKeyToAccount(ACCOUNT1_KEY);

  await test(`${label}: account1 transferFrom 100`, async () => {
    const data = encodeCall(
      SEL_TRANSFER_FROM,
      [addrType, addrType, u256Type],
      [ACCOUNT0, ACCOUNT1, 100n],
    );
    eq(await v12Send(client, erc20, data, account1Wallet), 1n);
  });

  await test(`${label}: balanceOf(account0) is 600`, async () => {
    const data = encodeCall(SEL_BALANCE_OF, [addrType], [ACCOUNT0]);
    eq(await v12Call(client, erc20, data), 600n);
  });

  await test(`${label}: balanceOf(account1) is 900`, async () => {
    const data = encodeCall(SEL_BALANCE_OF, [addrType], [ACCOUNT1]);
    eq(await v12Call(client, erc20, data), 900n);
  });

  await test(`${label}: allowance decreased to 100`, async () => {
    const data = encodeCall(
      SEL_ALLOWANCE,
      [addrType, addrType],
      [ACCOUNT0, ACCOUNT1],
    );
    eq(await v12Call(client, erc20, data), 100n);
  });

  // ── Reverts ─────────────────────────────────────
  console.log(`  ${label}: reverts`);

  await test(`${label}: transfer over balance reverts`, async () => {
    const data = encodeCall(
      SEL_TRANSFER,
      [addrType, u256Type],
      [ACCOUNT1, 999999n],
    );
    try {
      await v12Send(client, erc20, data);
      throw new Error("should have reverted");
    } catch (e: any) {
      if (e.message === "should have reverted") throw e;
    }
  });

  await test(`${label}: transferFrom over allowance reverts`, async () => {
    const data = encodeCall(
      SEL_TRANSFER_FROM,
      [addrType, addrType, u256Type],
      [ACCOUNT0, ACCOUNT1, 999n],
    );
    try {
      await v12Send(client, erc20, data, account1Wallet);
      throw new Error("should have reverted");
    } catch (e: any) {
      if (e.message === "should have reverted") throw e;
    }
  });

  await test(`${label}: invalid selector reverts`, async () => {
    try {
      await v12Call(client, erc20, "0xdeadbeef");
      throw new Error("should have reverted");
    } catch (e: any) {
      if (e.message === "should have reverted") throw e;
    }
  });

  // ── Final state consistency ─────────────────────
  console.log(`  ${label}: final state`);

  await test(`${label}: totalSupply still 1500`, async () => {
    eq(await v12Call(client, erc20, SEL_TOTAL_SUPPLY), 1500n);
  });

  await test(`${label}: balances sum equals totalSupply`, async () => {
    const b0 = await v12Call(
      client,
      erc20,
      encodeCall(SEL_BALANCE_OF, [addrType], [ACCOUNT0]),
    );
    const b1 = await v12Call(
      client,
      erc20,
      encodeCall(SEL_BALANCE_OF, [addrType], [ACCOUNT1]),
    );
    const supply = await v12Call(client, erc20, SEL_TOTAL_SUPPLY);
    eq(
      b0 + b1,
      supply,
      `balances (${b0} + ${b1} = ${b0 + b1}) != totalSupply (${supply})`,
    );
  });
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log("\nSauceScript e2e tests\n");

  // Start node + deploy
  console.log("Starting Hardhat node...");
  const pid = await startNode();
  let sauceAddress: Hex;

  try {
    console.log("Deploying SauceRouter...");
    sauceAddress = await deployContract();
    console.log(`SauceRouter deployed at ${sauceAddress}\n`);
  } catch (e: any) {
    stopNode(pid);
    console.error("Setup failed:", e.message);
    process.exit(1);
  }

  const chain = defineChain({
    id: 31337,
    name: "Hardhat",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });

  const client: Client = {
    publicClient: createPublicClient({ chain, transport: http(RPC_URL) }),
    walletClient: createWalletClient({
      account: privateKeyToAccount(ACCOUNT0_KEY),
      chain,
      transport: http(RPC_URL),
    }),
    sauceAddress,
    chain,
  };

  try {
    // ── Simple scripts (JS + TS) ────────────────────

    console.log("add");
    await testSimpleScript(client, "add", { A: 5n, B: 10n }, 15n);
    await testSimpleScript(client, "add", { A: 0n, B: 0n }, 0n);
    await testSimpleScript(client, "add", { A: 100n, B: 200n }, 300n);

    console.log("\nfibonacci");
    await testSimpleScript(client, "fibonacci", { N: 1n }, 1n);
    await testSimpleScript(client, "fibonacci", { N: 10n }, 55n);
    await testSimpleScript(client, "fibonacci", { N: 20n }, 6765n);

    console.log("\nexample");
    await testSimpleScript(client, "example", { A: 42n, B: 58n }, 100n);
    await testSimpleScript(client, "example", { A: 1n, B: 0n }, 1n);

    // ── call.js (requires fork, skip on local) ──────

    console.log("\ncall");
    console.log("  - skipped (requires Uniswap fork)");

    // ── V12 ERC20 ────────────────────────────────────
    // Compile ERC20 sauce to V12, deploy via V12 on-chain compiler,
    // then test with standard ERC20 calls

    console.log("\nCompiling V12 compiler (hnc)...");
    const v12CompilerBytecode = getV12CompilerBytecode();
    console.log(
      `V12 compiler bytecode: ${(v12CompilerBytecode.length - 2) / 2} bytes`,
    );

    console.log("Deploying V12 compiler (via hardhat_setCode)...");
    const v12CompilerAddress = await deployWithSetCode(
      client.publicClient,
      v12CompilerBytecode,
    );
    console.log(`V12 compiler deployed at ${v12CompilerAddress}`);

    const v12Client: V12Client = {
      publicClient: client.publicClient,
      walletClient: client.walletClient,
      chain: client.chain,
    };

    // ── ERC20 (JS, V12) ─────────────────────────────

    console.log("\nerc20 (js) — V12 deploy");
    const jsErc20Address = await deployV12ERC20(
      client.publicClient,
      client.walletClient,
      v12CompilerAddress,
      join(JS_DIR, "erc20.js"),
      client.chain,
    );
    console.log(`JS ERC20 deployed at ${jsErc20Address}`);
    await testV12ERC20(v12Client, jsErc20Address, "erc20.js");

    // ── ERC20 (TS, V12) — fresh contract ─────────────

    console.log("\nerc20 (ts) — V12 deploy");
    const tsErc20Address = await deployV12ERC20(
      client.publicClient,
      client.walletClient,
      v12CompilerAddress,
      join(TS_DIR, "erc20.ts"),
      client.chain,
    );
    console.log(`TS ERC20 deployed at ${tsErc20Address}`);
    await testV12ERC20(v12Client, tsErc20Address, "erc20.ts");
  } finally {
    stopNode(pid);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
