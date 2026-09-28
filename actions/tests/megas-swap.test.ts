import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { actionToQuote, megasSwapToSauce, megasUsdcUsdtSwapToSauce } from "../src/index.js";
import type {
  ApproveAction,
  CurveSwapAction,
  SwapAction,
  UniswapV2SwapAction,
  UniswapV3ExactInputAction,
} from "../src/index.js";
import { cookData, startGatedEngine } from "./gated-engine.js";
import { DEADLINE, startMainnet, type Mainnet } from "./mainnet.js";
import type { GatedEngine } from "./gated-engine.js";

// =============================================================================
// Load .env from actions/ (reusable across tests; silent no-op if missing)
// =============================================================================

(function loadEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
})();

// =============================================================================
// Configuration
// =============================================================================

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();

/** The local anvil's URL — Ethereum mainnet at the pinned block (`mainnet.ts`), set in `before()`. */
let RPC: string;
let mainnet: Mainnet;
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const CALLER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

// Mainnet addresses
const CHAIN_ID = 1;
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address;
const SWAP_ROUTER_V3 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" as Address;
const QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e" as Address;
// Curve 3pool — (DAI=0, USDC=1, USDT=2); pool also exposes `exchange(i,j,dx,min_dy,receiver)` and `get_dy`.
const CURVE_3POOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7" as Address;
// Uniswap V2 Router — direct USDC/USDT pair at 0x3041CbD36888bECc7bbCBc0045E3B1f144466f5f.
const UNIV2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" as Address;

/**
 * The acting account — the POT, not the engine.
 *
 * A released engine refuses any caller it cannot re-derive as a Pot of the Kitchen it was built
 * against, so programs reach it through `Pot.cook` and `ctx.self()` is the Pot. Everything this
 * suite funds and asserts balances on is therefore the Pot, which is what this name now holds.
 */
let SAUCE: Address;
/** The interpreter itself. Named per cook; never called directly. */
let ENGINE: Address;
let client: ReturnType<typeof createPublicClient>;

// =============================================================================
// Engine
// =============================================================================

/**
 * The Sauce ENGINE the programs run on.
 *
 * Was the v1 `Sauce.sol` from the `sauce` git dep, entered through `cook(bytes[])`. That artifact
 * lived under `compiler/node_modules/`, which goes away with the TypeScript compiler — and it is the
 * wrong engine now regardless: the published Rust compiler emits V12 bytecode. So this deploys the
 * V12 runtime instead. Its creation code returns its own bytecode, so the deployed contract IS the
 * engine, and a program is sent to it as RAW CALLDATA (the payload is `[program | args]`; there is
 * no `cook` selector to prefix).
 *
 * `runtimeCreationCode` comes from `sdk/dist/artifacts/V12RuntimeBytecode.json`, which
 * `pnpm --filter ./sdk sync-engine-artifacts --fetch-v12-engines` writes from the `v12-evm` release.
 * That release and the published compiler are cut from separate commits, so the two are NOT one
 * lineage: the tag and digest pinned in `sync-engine-artifacts.mjs` are what tie this artifact to a
 * known build. `sdk/src/artifacts/` is the fallback for a local run, and
 * `SAUCE_V12_RUNTIME_CREATION_HEX` overrides both (a file of creation hex).
 */
function v12RuntimeCreationCode(): Hex {
  const override = process.env.SAUCE_V12_RUNTIME_CREATION_HEX;
  if (override) {
    const hex = readFileSync(override, "utf-8").trim().replace(/^0x/, "");
    return `0x${hex}` as Hex;
  }
  const candidates = [
    resolve(REPO_ROOT, "sdk/dist/artifacts/V12RuntimeBytecode.json"),
    resolve(REPO_ROOT, "sdk/src/artifacts/V12RuntimeBytecode.json"),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `V12RuntimeBytecode.json not found (looked in ${candidates.join(", ")}). ` +
        "Run `pnpm --filter './sdk' sync-engine-artifacts --fetch-v12-engines`, or point " +
        "SAUCE_V12_RUNTIME_CREATION_HEX at a file of runtime creation hex.",
    );
  }
  const { runtimeCreationCode } = JSON.parse(readFileSync(found, "utf-8")) as {
    runtimeCreationCode: Hex;
  };
  if (!runtimeCreationCode) throw new Error(`${found} has no runtimeCreationCode`);
  return runtimeCreationCode;
}

async function deploySauce(): Promise<GatedEngine> {
  const account = privateKeyToAccount(PK);
  const tempClient = createPublicClient({ transport: http(RPC) });
  const actualChainId = await tempClient.getChainId();

  const localChain = defineChain({
    id: actualChainId,
    name: "Local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });

  const publicClient = createPublicClient({ chain: localChain, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: localChain, transport: http(RPC) });

  return startGatedEngine(
    REPO_ROOT,
    { chain: localChain, publicClient, walletClient },
    account.address,
    v12RuntimeCreationCode(),
    (address, code) =>
      publicClient.request({ method: "hardhat_setCode", params: [address, code] } as never),
    (address, slot, value) =>
      publicClient.request({
        method: "hardhat_setStorageAt",
        params: [address, slot, value],
      } as never),
  );
}

// =============================================================================
// Helpers
// =============================================================================

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
]);

/**
 * Run a Sauce program on the V12 engine.
 *
 * `megasSwapToSauce` returns a one-element list (the whole split-swap is one program now — see its
 * own header), so this takes that list and sends `programs[0]` as raw calldata. The retired
 * TypeScript compiler emitted `N + 3` programs entered through `cook(bytes[])`, where the leading
 * entries were function-table ingredients; a V12 cook executes `ingredients[0]` only, and here
 * there is no cook wrapper at all.
 */
function cookSend(programs: Uint8Array[], value?: string, gasLimit = 500_000_000): Hex {
  if (programs.length !== 1) throw new Error(`expected one program, got ${programs.length}`);
  // Wrapped in the Pot's `cook`, because a gated engine refuses a direct call. `cook` is onlyOwner
  // and the PK below is the Pot's owner, so the same sender keeps working.
  const hex = cookData(ENGINE, programs[0]);
  const valueFlag = value ? `--value ${value}` : "";
  let result: string;
  try {
    result = execSync(
      `cast send ${SAUCE} ${hex} --rpc-url ${RPC} --private-key ${PK} ${valueFlag} --gas-limit ${gasLimit} --json 2>&1`,
      { encoding: "utf8" },
    ).trim();
  } catch (err: unknown) {
    const { output } = err as { output?: readonly unknown[] };
    const outputStr = (output ?? []).map((b: unknown) => (b ? String(b) : "")).join("\n");
    const m = /txHash"?\s*:\s*"?(0x[a-fA-F0-9]{64})/.exec(outputStr);
    if (m) {
      const receipt = execSync(`cast receipt ${m[1]} --rpc-url ${RPC} --json 2>&1 || true`, {
        encoding: "utf8",
      }).trim();
      console.error(`\nFailed tx ${m[1]}. Receipt: ${receipt}\n`);
    }
    throw err;
  }
  const tx = JSON.parse(result);
  if (tx.status !== "0x1") throw new Error(`Transaction reverted: ${tx.transactionHash}`);
  return tx.transactionHash as Hex;
}

function snapshot(): string {
  const raw = execSync(`cast rpc evm_snapshot --rpc-url ${RPC}`, { encoding: "utf8" }).trim();
  return JSON.parse(raw);
}

function revert(id: string): void {
  execSync(`cast rpc evm_revert "${id}" --rpc-url ${RPC}`, { encoding: "utf8" });
}

// Every quote here is read off the pre-transaction state, while the swap executes after the
// prepended approvals inside the transaction, so the realized amount drifts from the quote — by a
// unit or two, measured. This slack absorbs that while staying four orders of magnitude below the
// ~1.7e7-unit gap between the best pool and the next one, so these comparisons still prove which
// pool the greedy loop picked. A relative bound cannot: that gap is only ~0.17 bps wide.
const QUOTE_DRIFT = 1_000n;

const withinDrift = (actual: bigint, expected: bigint): boolean =>
  (actual > expected ? actual - expected : expected - actual) <= QUOTE_DRIFT;

const atLeastWithinDrift = (actual: bigint, expected: bigint): boolean =>
  actual + QUOTE_DRIFT >= expected;

async function balanceOf(token: Address, account: Address): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/**
 * Fund SAUCE with `amount` USDC by impersonating a whale (Binance 14 hot wallet,
 * which has a few billion USDC). Avoids the large slippage of swapping a big
 * WETH bag into USDC on the fork.
 */
async function fundSauceUSDCFromWhale(amount: bigint): Promise<bigint> {
  // Try known USDC-rich addresses in order. Balances on the forked block can
  // shift over time, so keep a few fallbacks.
  const WHALES: Address[] = [
    "0x55FE002aefF02F77364de339a1292923A15844B8", // Circle
    "0x28C6c06298d514Db089934071355E5743bf21d60", // Binance 14
    "0x0A59649758aa4d66E25f08Dd01271e891fe52199", // Maker PSM USDC-A
  ];
  const recipient = SAUCE.slice(2).toLowerCase().padStart(64, "0");

  let remaining = amount;
  for (const WHALE of WHALES) {
    if (remaining === 0n) break;
    const balRaw = (await rpc("eth_call", [
      { to: USDC, data: `0x70a08231${WHALE.slice(2).toLowerCase().padStart(64, "0")}` },
      "latest",
    ])) as string;
    const whaleBal = BigInt(balRaw);
    if (whaleBal === 0n) continue;

    const take = whaleBal < remaining ? whaleBal : remaining;
    await rpc("hardhat_impersonateAccount", [WHALE]);
    await rpc("hardhat_setBalance", [WHALE, "0xDE0B6B3A7640000"]);
    const amountHex = take.toString(16).padStart(64, "0");
    const input = `0xa9059cbb${recipient}${amountHex}`;
    await rpc("eth_sendTransaction", [{ from: WHALE, to: USDC, input, gas: "0x30d40" }]);
    remaining -= take;
  }

  const bal = await balanceOf(USDC, SAUCE);
  if (bal < amount) {
    throw new Error(`fundSauceUSDCFromWhale: only collected ${bal} of ${amount} USDC from whales`);
  }
  return bal;
}

// =============================================================================
// Tests
// =============================================================================

describe("megasSwapToSauce — mainnet state", { timeout: 180_000 }, () => {
  let snap: string;

  before(async () => {
    mainnet = await startMainnet("megas-swap");
    RPC = mainnet.rpc;
    // Lift the block gas limit so Sauce programs with many QuoterV2 CALLs at
    // million-USDC depth fit in one tx. The pinned block's limit is 60M.
    await rpc("evm_setBlockGasLimit", ["0x3B9ACA00"]); // 1_000_000_000 gas
    ({ engine: ENGINE, pot: SAUCE } = await deploySauce());
    client = createPublicClient({ transport: http(RPC, { timeout: 300_000 }) });
  });

  after(async () => {
    await mainnet?.stop();
  });

  beforeEach(() => {
    snap = snapshot();
  });
  afterEach(() => {
    revert(snap);
  });

  it("splits USDC→USDT across four protocols and matches-or-beats any single pool", async () => {
    const amountIn = 10_000_000n * 1_000_000n; // 10,000,000 USDC
    const startUsdc = await fundSauceUSDCFromWhale(amountIn);
    assert.ok(startUsdc >= amountIn, `needed >= ${amountIn} USDC on SAUCE, got ${startUsdc}`);

    const usdtBefore = await balanceOf(USDT, CALLER);
    const usdcBefore = await balanceOf(USDC, SAUCE);

    const deadline = DEADLINE;
    const mkUniV3 = (fee: 100 | 500): UniswapV3ExactInputAction => ({
      type: "uniswapV3ExactInput",
      chainId: CHAIN_ID,
      router: SWAP_ROUTER_V3,
      tokenIn: USDC,
      tokenOut: USDT,
      fee,
      amountIn: amountIn.toString(),
      amountOutMin: "1",
      recipient: CALLER,
      deadline,
    });
    const curveCandidate: CurveSwapAction = {
      type: "curveSwap",
      chainId: CHAIN_ID,
      pool: CURVE_3POOL,
      tokenIn: USDC,
      tokenOut: USDT,
      i: 1, // USDC index in 3pool
      j: 2, // USDT index in 3pool
      amountIn: amountIn.toString(),
      amountOutMin: "1",
      recipient: CALLER,
    };
    const uniV2Candidate: UniswapV2SwapAction = {
      type: "uniswapV2Swap",
      chainId: CHAIN_ID,
      router: UNIV2_ROUTER,
      path: [USDC, USDT],
      amountIn: amountIn.toString(),
      amountOutMin: "1",
      recipient: CALLER,
      deadline,
    };

    const candidates: SwapAction[] = [mkUniV3(100), mkUniV3(500), curveCandidate, uniV2Candidate];
    const labels = ["UniV3 100bps ", "UniV3 500bps ", "Curve 3pool  ", "UniV2 router "];
    const quoterOpts = { quoterV3: QUOTER_V2, minTotalOut: "0" };

    // Off-chain quotes at the FULL amount: what each single pool would yield
    // on its own, for an apples-to-apples comparison against the split.
    const singleQuotes = await Promise.all(
      candidates.map(async (cand) => {
        const q = actionToQuote(cand, amountIn, quoterOpts);
        const res = await client.call({ to: q.to, data: q.data });
        return q.decode(res.data as Hex);
      }),
    );
    const bestSingle = singleQuotes.reduce((a, b) => (a > b ? a : b));

    // Self-contained: the helper inlines all 4 required approvals, compiles
    // the 5-candidate split for USDC→USDT, and hands back one cook-ready
    // programs array. No separate approval tx needed.
    const n = 10;
    // "0" waives the aggregate floor: this fork test asserts the split BEATS a single venue, an
    // economic-quality property, and a real floor would make it a slippage test instead.
    cookSend(megasUsdcUsdtSwapToSauce(amountIn, n, CALLER, "0"));

    const usdtAfter = await balanceOf(USDT, CALLER);
    const usdcAfter = await balanceOf(USDC, SAUCE);

    const bucket = amountIn / BigInt(n);
    const spent = bucket * BigInt(n);
    const received = usdtAfter - usdtBefore;

    // Report comparison. "bps vs best single" = improvement basis points
    // (1 bp = 0.01%) relative to the best full-amount single-pool execution.
    const delta = received - bestSingle;
    const bps = (delta * 10000n) / bestSingle;
    const fmt = (v: bigint) => v.toString().padStart(12);
    console.log("\n— single-pool full-amount output (from on-chain quoters) —");
    singleQuotes.forEach((q, i) => console.log(`  ${labels[i]} ${fmt(q)} USDT`));
    console.log(`  best single   ${fmt(bestSingle)} USDT`);
    console.log(`— split (n=${n}) —`);
    console.log(`  received      ${fmt(received)} USDT`);
    console.log(`  vs best single: ${delta >= 0n ? "+" : ""}${delta} (${bps} bps)\n`);

    assert.equal(usdcBefore - usdcAfter, spent, "SAUCE USDC should decrease by exactly bucket*n");
    // Core invariant of greedy split routing on concave AMMs: the split is
    // always at least as good as the best single-pool execution.
    assert.ok(
      atLeastWithinDrift(received, bestSingle),
      `split (${received}) < best single (${bestSingle})`,
    );
  });

  // -------------------------------------------------------------------------
  // Edge cases on n
  // -------------------------------------------------------------------------

  /** Build the same 5-candidate USDC→USDT spread used by the main test. */
  function buildUsdcUsdtCandidates(
    amountIn: bigint,
    recipient: Address,
  ): {
    candidates: SwapAction[];
    approves: ApproveAction[];
  } {
    const amount = amountIn.toString();
    const dl = DEADLINE;
    const mkUniV3 = (fee: 100 | 500): UniswapV3ExactInputAction => ({
      type: "uniswapV3ExactInput",
      chainId: CHAIN_ID,
      router: SWAP_ROUTER_V3,
      tokenIn: USDC,
      tokenOut: USDT,
      fee,
      amountIn: amount,
      amountOutMin: "1",
      recipient,
      deadline: dl,
    });
    const candidates: SwapAction[] = [
      mkUniV3(100),
      mkUniV3(500),
      {
        type: "curveSwap",
        chainId: CHAIN_ID,
        pool: CURVE_3POOL,
        tokenIn: USDC,
        tokenOut: USDT,
        i: 1,
        j: 2,
        amountIn: amount,
        amountOutMin: "1",
        recipient,
      } satisfies CurveSwapAction,
      {
        type: "uniswapV2Swap",
        chainId: CHAIN_ID,
        router: UNIV2_ROUTER,
        path: [USDC, USDT],
        amountIn: amount,
        amountOutMin: "1",
        recipient,
        deadline: dl,
      } satisfies UniswapV2SwapAction,
    ];
    const approves: ApproveAction[] = [
      { type: "approve", chainId: CHAIN_ID, token: USDC, spender: SWAP_ROUTER_V3, amount },
      { type: "approve", chainId: CHAIN_ID, token: USDC, spender: CURVE_3POOL, amount },
      { type: "approve", chainId: CHAIN_ID, token: USDC, spender: UNIV2_ROUTER, amount },
    ];
    return { candidates, approves };
  }

  it("n=1 picks the single best pool at full size (degenerate case)", async () => {
    const amountIn = 1_000_000n * 1_000_000n; // 1M USDC
    await fundSauceUSDCFromWhale(amountIn);
    const { candidates, approves } = buildUsdcUsdtCandidates(amountIn, CALLER);

    const usdtBefore = await balanceOf(USDT, CALLER);
    const usdcBefore = await balanceOf(USDC, SAUCE);

    const quoterOpts = { quoterV3: QUOTER_V2, minTotalOut: "0" };
    const singleQuotes = await Promise.all(
      candidates.map(async (cand) => {
        const q = actionToQuote(cand, amountIn, quoterOpts);
        const res = await client.call({ to: q.to, data: q.data });
        return q.decode(res.data as Hex);
      }),
    );
    const bestSingle = singleQuotes.reduce((a, b) => (a > b ? a : b));

    cookSend(
      megasSwapToSauce(candidates, amountIn, 1, {
        ...quoterOpts,
        prepend: approves,
        sweep: { token: USDT, to: CALLER },
      }),
    );

    const usdtAfter = await balanceOf(USDT, CALLER);
    const usdcAfter = await balanceOf(USDC, SAUCE);
    const received = usdtAfter - usdtBefore;
    assert.equal(usdcBefore - usdcAfter, amountIn, "n=1 should spend the full amount");
    // With one bucket, the greedy algorithm reduces to "pick the best pool";
    // received should match the best single quote exactly.
    assert.ok(
      withinDrift(received, bestSingle),
      `n=1: received (${received}) != best single (${bestSingle})`,
    );
  });

  it("n=N (one bucket per candidate) compiles and executes", async () => {
    const N = 5;
    const n = N;
    const amountIn = BigInt(n) * 1_000_000n * 1_000_000n; // n * 1M USDC, exactly divisible
    await fundSauceUSDCFromWhale(amountIn);
    const { candidates, approves } = buildUsdcUsdtCandidates(amountIn, CALLER);

    const usdtBefore = await balanceOf(USDT, CALLER);
    const usdcBefore = await balanceOf(USDC, SAUCE);

    const quoterOpts = { quoterV3: QUOTER_V2, minTotalOut: "0" };
    const singleQuotes = await Promise.all(
      candidates.map(async (cand) => {
        const q = actionToQuote(cand, amountIn, quoterOpts);
        const res = await client.call({ to: q.to, data: q.data });
        return q.decode(res.data as Hex);
      }),
    );
    const bestSingle = singleQuotes.reduce((a, b) => (a > b ? a : b));

    cookSend(
      megasSwapToSauce(candidates, amountIn, n, {
        ...quoterOpts,
        prepend: approves,
        sweep: { token: USDT, to: CALLER },
      }),
    );

    const usdtAfter = await balanceOf(USDT, CALLER);
    const usdcAfter = await balanceOf(USDC, SAUCE);
    const received = usdtAfter - usdtBefore;
    assert.equal(usdcBefore - usdcAfter, amountIn, "should spend the full amountIn");
    assert.ok(
      atLeastWithinDrift(received, bestSingle),
      `split (${received}) < best single (${bestSingle})`,
    );
  });
});
