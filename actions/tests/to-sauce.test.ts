import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { actionsToSauce, actionsToSauceSource } from "../src/to-sauce.js";
import type { RoutingAction } from "../src/types.js";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  defineChain,
  decodeEventLog,
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { cookData, startGatedEngine } from "./gated-engine.js";
import { DEADLINE, startMainnet, type Mainnet } from "./mainnet.js";
import type { GatedEngine } from "./gated-engine.js";

// =============================================================================
// Configuration — Ethereum mainnet at the pinned block, replayed from captured state (mainnet.ts)
// =============================================================================

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();

const RAY = 10n ** 27n;
/** The local anvil's URL, set in `before()`. */
let RPC: string;
let mainnet: Mainnet;
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const CALLER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

// Mutable — set during before() after deploy
/** The acting account — the POT. Under a cook `ctx.self()` is the Pot, so this is what holds the
 *  balances these tests fund and assert on. */
let SAUCE: Address;
/** The interpreter. Named per cook; never called directly, because the gate refuses that. */
let ENGINE: Address;

// Ethereum mainnet addresses, at the pinned block
interface ChainAddresses {
  chainId: number;
  weth: Address;
  usdc: Address;
  usdbc: Address;
  dai: Address;
  usdt: Address;
  swapRouter: Address;
  aaveV3Pool: Address;
  aaveV3aUSDC: Address;
  compoundV3USDC: Address;
  acrossSpokePool: Address;
  balancerV2Vault: Address;
  balancerV2WethUsdcPoolId: `0x${string}`;
  curvePool: Address;
  // USDC → curveTokenOut via curvePool with these coin indices.
  // 3pool (mainnet): USDC=1, USDT=2. 4pool (base): USDC=0, USDbC=1.
  curveTokenOut: Address;
  curveI: number;
  curveJ: number;
  uniswapV4Router: Address;
  // New AMM swap addresses
  uniswapV2Router: Address;
  curveRouterNG: Address;
  balancerV3Router: Address;
  ambientDex: Address;
  dodoProxy: Address;
  // DODOApprove — the contract that DODO's proxy delegates transferFrom to.
  // Allowances must be granted here, NOT to dodoProxy itself.
  dodoApprove: Address;
  dodoPairWethUsdc: Address;
  maverickV2Router: Address;
  carbonController: Address;
  fraxswapRouter: Address;
  clipperExchange: Address;
  integralDelay: Address;
  fluidDexT1WstethEth: Address;
  fluidDexLite: Address;
  wsteth: Address;
}

const CHAINS: Record<string, ChainAddresses> = {
  "eth-mainnet": {
    chainId: 1,
    weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    usdbc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // no USDbC on mainnet, use USDC placeholder
    dai: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    swapRouter: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    aaveV3Pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    aaveV3aUSDC: "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c",
    compoundV3USDC: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
    acrossSpokePool: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
    balancerV2Vault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    balancerV2WethUsdcPoolId: "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019",
    curvePool: "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7", // 3pool (DAI/USDC/USDT)
    curveTokenOut: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
    curveI: 1,
    curveJ: 2, // USDC=1, USDT=2 in 3pool
    uniswapV4Router: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
    // New AMM addresses
    uniswapV2Router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    curveRouterNG: "0xF0d4c12A5768D806021F80a262B4d39d26C58b8D",
    balancerV3Router: "0xaE563e3F8219521950555f5962419c8919758ea2",
    ambientDex: "0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688",
    dodoProxy: "0xa356867fDCEa8e71AEaF87805808803806231FdC",
    dodoApprove: "0xCB859eA579b28e02B87A1FDE08d087ab9dbE5149",
    dodoPairWethUsdc: "0x75c23271661d9d143DCb617222BC4BEc783eFf34",
    // MaverickV2Router. The address this held before carries neither swap selector.
    maverickV2Router: "0x62e31802c6145A2D5E842EeD8efe01fC224422fA",
    carbonController: "0xC537e898CD774e2dCBa3B14Ea6f34C93d5eA45e1",
    fraxswapRouter: "0xC14d550632db8592D1243Edc8B95b0Ad06703867",
    clipperExchange: "0x655eDCE464CC797526600a462A8154650EEe4B77",
    integralDelay: "0x782534550e2553A42CDFf8D5a94066d8c7B6729B",
    fluidDexT1WstethEth: "0x0B1a513ee24972DAEf112bC777a5610d4325C9e7",
    fluidDexLite: "0xBbcb91440523216e2b87052A99F69c604A7b6e00",
    wsteth: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  },
};

const chain = CHAINS["eth-mainnet"]!;
const {
  chainId,
  weth: WETH,
  usdc: USDC,
  usdbc: _USDbC,
  dai: _DAI,
  usdt: USDT,
  swapRouter: SWAP_ROUTER,
  aaveV3Pool: AAVE_V3_POOL,
  aaveV3aUSDC: AAVE_V3_aUSDC,
  compoundV3USDC: COMPOUND_V3_USDC,
  acrossSpokePool: ACROSS_SPOKE_POOL,
  balancerV2Vault: BALANCER_V2_VAULT,
  balancerV2WethUsdcPoolId: BALANCER_V2_POOL_ID,
  curvePool: CURVE_POOL,
  curveTokenOut: CURVE_TOKEN_OUT,
  curveI: CURVE_I,
  curveJ: CURVE_J,
  uniswapV4Router: UNISWAP_V4_ROUTER,
  uniswapV2Router: UNISWAP_V2_ROUTER,
  curveRouterNG: CURVE_ROUTER_NG,
  balancerV3Router: _BALANCER_V3_ROUTER,
  ambientDex: AMBIENT_DEX,
  dodoProxy: DODO_PROXY,
  dodoApprove: DODO_APPROVE,
  dodoPairWethUsdc: DODO_PAIR_WETH_USDC,
  maverickV2Router: MAVERICK_V2_ROUTER,
  carbonController: CARBON_CONTROLLER,
  fraxswapRouter: FRAXSWAP_ROUTER,
  clipperExchange: _CLIPPER_EXCHANGE,
  integralDelay: _INTEGRAL_DELAY,
  fluidDexT1WstethEth: FLUID_DEX_T1_WSTETH_ETH,
  fluidDexLite: _FLUID_DEX_LITE,
  wsteth: WSTETH,
} = chain;

const isMainnet = chainId === 1;

/** Receives outputs whose arrival a test checks; an address nothing else touches. */
const RECEIVER = "0x000000000000000000000000000000000000c0DE" as Address;
const FRAX = "0x853d955aCEf822Db058eb8505911ED77F175b99e" as Address;
/** A Maverick V2 USDC/USDT pool (token A = USDC) with liquidity at the pinned block. */
const MAVERICK_USDC_USDT_POOL = "0x31373595F40Ea48a7aAb6CBCB0d377C6066E2dCA" as Address;
/** A Carbon USDC/USDT strategy holding USDT at the pinned block. */
const CARBON_USDC_USDT_STRATEGY = "1020847100762815390390123822295304634823";

let client: ReturnType<typeof createPublicClient>;

// =============================================================================
// Hardhat lifecycle — start before all tests, stop after
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

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
]);

const transferEventAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const approvalEventAbi = parseAbi([
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);
const wethDepositEventAbi = parseAbi(["event Deposit(address indexed dst, uint256 wad)"]);
const wethWithdrawalEventAbi = parseAbi(["event Withdrawal(address indexed src, uint256 wad)"]);
const aaveSupplyEventAbi = parseAbi([
  "event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)",
]);
const aaveWithdrawEventAbi = parseAbi([
  "event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)",
]);
const aavePoolReserveIncomeAbi = parseAbi([
  "function getReserveNormalizedIncome(address) view returns (uint256)",
]);
const compoundSupplyEventAbi = parseAbi([
  "event Supply(address indexed from, address indexed dst, uint256 amount)",
]);
const compoundWithdrawEventAbi = parseAbi([
  "event Withdraw(address indexed src, address indexed to, uint256 amount)",
]);
const acrossDepositEventAbi = parseAbi([
  "event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)",
]);

// =============================================================================
// Helpers
// =============================================================================

/**
 * Run a Sauce program on the V12 engine — the compiled bytecode IS the calldata (the payload is
 * `[program | args]`). The retired TypeScript compiler's programs entered the v1 engine through
 * `cook(bytes[])`; the V12 runtime has no such wrapper.
 */
function cookSend(bytecode: Uint8Array, value?: string): Hex {
  // Through the Pot: a gated engine refuses a direct call, and `cook` is onlyOwner so the PK below
  // (the Pot's owner) is still the right sender.
  const hex = cookData(ENGINE, bytecode);
  const valueFlag = value ? `--value ${value}` : "";
  const result = execSync(
    `cast send ${SAUCE} ${hex} --rpc-url ${RPC} --private-key ${PK} ${valueFlag} --gas-limit 5000000 --json 2>&1`,
    { encoding: "utf8" },
  ).trim();
  const tx = JSON.parse(result);
  if (tx.status !== "0x1") {
    throw new Error(`Transaction reverted: ${tx.transactionHash}`);
  }
  return tx.transactionHash as Hex;
}

function snapshot(): string {
  const raw = execSync(`cast rpc evm_snapshot --rpc-url ${RPC}`, { encoding: "utf8" }).trim();
  return JSON.parse(raw);
}

function revert(id: string): void {
  execSync(`cast rpc evm_revert "${id}" --rpc-url ${RPC}`, {
    encoding: "utf8",
  });
}

async function balanceOf(token: Address, account: Address): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
}

async function allowance(token: Address, owner: Address, spender: Address): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
}

async function ethBalance(account: Address): Promise<bigint> {
  return client.getBalance({ address: account });
}

async function getReceipt(txHash: Hex) {
  return client.getTransactionReceipt({ hash: txHash });
}

function findEvents<const T extends readonly unknown[]>(
  receipt: Awaited<ReturnType<typeof getReceipt>>,
  abi: T,
  eventName?: string,
  filter?: { address?: Address; args?: Record<string, unknown> },
) {
  const results: Array<{ address: Address; args: any }> = [];
  for (const log of receipt.logs) {
    if (filter?.address && log.address.toLowerCase() !== filter.address.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (eventName && ev.eventName !== eventName) continue;
      if (filter?.args) {
        let match = true;
        for (const [k, v] of Object.entries(filter.args)) {
          const actual = (ev.args as any)[k];
          if (typeof actual === "string" && typeof v === "string") {
            if (actual.toLowerCase() !== v.toLowerCase()) {
              match = false;
              break;
            }
          } else if (actual !== v) {
            match = false;
            break;
          }
        }
        if (!match) continue;
      }
      results.push({ address: log.address, args: ev.args });
    } catch {}
  }
  return results;
}

/** Fund Sauce with USDC: wrap ETH + approve + swap in one cook, then transfer USDC from caller to Sauce */
/** Sets `holder`'s balance of `token`, whose balances mapping lives at `slot`. */
function setErc20Balance(token: Address, holder: Address, slot: bigint, amount: bigint): void {
  const key = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, slot]),
  );
  execSync(
    `cast rpc anvil_setStorageAt ${token} ${key} ${`0x${amount.toString(16).padStart(64, "0")}`} --rpc-url ${RPC}`,
    { encoding: "utf8" },
  );
}

async function fundSauceUSDC(ethAmount: string): Promise<void> {
  cookSend(
    actionsToSauce([
      { type: "wrapETH", chainId, weth: WETH, amount: ethAmount },
      { type: "approve", chainId, token: WETH, spender: SWAP_ROUTER, amount: ethAmount },
      {
        type: "uniswapV3ExactInput",
        chainId,
        router: SWAP_ROUTER,
        tokenIn: WETH,
        tokenOut: USDC,
        fee: 500,
        amountIn: ethAmount,
        amountOutMin: "1",
        recipient: CALLER,
        deadline: DEADLINE,
      },
    ]),
    ethAmount,
  );
  const usdcBal = await balanceOf(USDC, CALLER);
  if (usdcBal === 0n) throw new Error("fundSauceUSDC: swap produced no USDC");
  execSync(
    `cast send ${USDC} "transfer(address,uint256)" ${SAUCE} ${usdcBal.toString()} --rpc-url ${RPC} --private-key ${PK} --gas-limit 200000 --json 2>/dev/null`,
    { encoding: "utf8" },
  );
}

// =============================================================================
// Tests
// =============================================================================

describe("Sauce Action Integration Tests", { timeout: 120_000 }, () => {
  let snap: string;

  before(async () => {
    mainnet = await startMainnet("to-sauce");
    RPC = mainnet.rpc;
    ({ engine: ENGINE, pot: SAUCE } = await deploySauce());
    client = createPublicClient({ transport: http(RPC) });
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

  describe("ERC20 Basics", () => {
    it("wrapETH: wraps ETH into WETH", async () => {
      const amount = 2_000000000000000000n;
      const before = await balanceOf(WETH, SAUCE);
      const txHash = cookSend(
        actionsToSauce([{ type: "wrapETH", chainId, weth: WETH, amount: amount.toString() }]),
        "2ether",
      );
      const after = await balanceOf(WETH, SAUCE);
      assert.equal(
        after - before,
        amount,
        `WETH balance should increase by 2, got ${formatUnits(after - before, 18)}`,
      );

      const receipt = await getReceipt(txHash);
      const deposits = findEvents(receipt, wethDepositEventAbi, "Deposit", {
        address: WETH,
        args: { dst: SAUCE },
      });
      assert.equal(deposits.length, 1, "Should emit exactly one WETH Deposit event");
      assert.equal(deposits[0].args.wad, amount, `Deposit event wad should be ${amount}`);
    });

    it("unwrapETH: unwraps WETH back to ETH", async () => {
      const amount = 1_000000000000000000n;
      const wethBefore = await balanceOf(WETH, SAUCE);
      const ethBefore = await ethBalance(SAUCE);
      const txHash = cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amount.toString() },
          { type: "unwrapETH", chainId, weth: WETH, amount: amount.toString() },
        ]),
        amount.toString(),
      );
      const wethAfter = await balanceOf(WETH, SAUCE);
      const ethAfter = await ethBalance(SAUCE);
      assert.equal(wethAfter, wethBefore, `WETH should be unchanged after wrap+unwrap`);
      assert.equal(
        ethAfter - ethBefore,
        amount,
        `ETH should increase by 1 (value sent stays in Sauce)`,
      );

      const receipt = await getReceipt(txHash);
      const deposits = findEvents(receipt, wethDepositEventAbi, "Deposit", { address: WETH });
      assert.equal(deposits.length, 1, "Should emit one WETH Deposit event");
      assert.equal(deposits[0].args.wad, amount, "Deposit amount should match");
      const withdrawals = findEvents(receipt, wethWithdrawalEventAbi, "Withdrawal", {
        address: WETH,
      });
      assert.equal(withdrawals.length, 1, "Should emit one WETH Withdrawal event");
      assert.equal(withdrawals[0].args.wad, amount, "Withdrawal amount should match");
    });

    it("transfer: sends WETH from Sauce to another address", async () => {
      const recipient = "0x000000000000000000000000000000000000dEaD" as Address;
      const recipientBefore = await balanceOf(WETH, recipient);
      const sauceBefore = await balanceOf(WETH, SAUCE);
      const txHash = cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: "1000000000000000000" },
          { type: "transfer", chainId, token: WETH, to: recipient, amount: "500000000000000000" },
        ]),
        "1ether",
      );
      const recipientAfter = await balanceOf(WETH, recipient);
      const sauceAfter = await balanceOf(WETH, SAUCE);
      assert.equal(
        recipientAfter - recipientBefore,
        500000000000000000n,
        `Recipient should receive 0.5 WETH`,
      );
      assert.equal(
        sauceAfter - sauceBefore,
        500000000000000000n,
        `Sauce WETH should increase by 0.5`,
      );

      const receipt = await getReceipt(txHash);
      const transfers = findEvents(receipt, transferEventAbi, "Transfer", {
        address: WETH,
        args: { from: SAUCE, to: recipient },
      });
      assert.equal(transfers.length, 1, "Should emit one Transfer event from Sauce to recipient");
      assert.equal(
        transfers[0].args.value,
        500000000000000000n,
        "Transfer amount should be 0.5 WETH",
      );
    });

    it("approve: sets allowance for spender", async () => {
      const amount = 1_000000000000000000n;
      const spender = "0x000000000000000000000000000000000000bEEF" as Address;
      const txHash = cookSend(
        actionsToSauce([
          {
            type: "approve",
            chainId,
            token: WETH,
            spender,
            amount: amount.toString(),
          },
        ]),
      );
      const a = await allowance(WETH, SAUCE, spender);
      assert.equal(a, amount, `Allowance should be 1 WETH, got ${formatUnits(a, 18)}`);

      const receipt = await getReceipt(txHash);
      const approvals = findEvents(receipt, approvalEventAbi, "Approval", {
        address: WETH,
        args: { owner: SAUCE, spender },
      });
      assert.equal(approvals.length, 1, "Should emit one Approval event");
      assert.equal(approvals[0].args.value, amount, "Approval value should match");
    });
  });

  describe("Uniswap V3 Swaps", () => {
    it("exactInput: swaps WETH -> USDC", async () => {
      const amountIn = "1000000000000000000";
      const wethBefore = await balanceOf(WETH, SAUCE);
      const usdcBefore = await balanceOf(USDC, CALLER);
      const txHash = cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          { type: "approve", chainId, token: WETH, spender: SWAP_ROUTER, amount: amountIn },
          {
            type: "uniswapV3ExactInput",
            chainId,
            router: SWAP_ROUTER,
            tokenIn: WETH,
            tokenOut: USDC,
            fee: 500,
            amountIn,
            amountOutMin: "1",
            recipient: CALLER,
            deadline: DEADLINE,
          },
        ]),
        "1ether",
      );
      const wethAfter = await balanceOf(WETH, SAUCE);
      const usdcAfter = await balanceOf(USDC, CALLER);
      assert.equal(wethAfter - wethBefore, 0n, `Sauce WETH delta should be 0 after wrap+swap`);
      assert.ok(usdcAfter > usdcBefore, `Caller should receive USDC`);
      assert.ok(usdcAfter - usdcBefore > 1000_000000n, `Should receive >$1000 USDC for 1 ETH`);

      const receipt = await getReceipt(txHash);
      // Verify each action emitted the right events with expected amounts
      const deposits = findEvents(receipt, wethDepositEventAbi, "Deposit", { address: WETH });
      assert.equal(deposits.length, 1, "Should emit one WETH Deposit event");
      assert.equal(deposits[0].args.wad, BigInt(amountIn), "Deposit amount should equal amountIn");
      const approvals = findEvents(receipt, approvalEventAbi, "Approval", {
        address: WETH,
        args: { owner: SAUCE, spender: SWAP_ROUTER },
      });
      assert.ok(approvals.length >= 1, "Should emit WETH Approval for swap router");
      assert.equal(
        approvals[0].args.value,
        BigInt(amountIn),
        "Approval amount should equal amountIn",
      );
      // WETH transferred from Sauce to the pool
      const wethOut = findEvents(receipt, transferEventAbi, "Transfer", {
        address: WETH,
        args: { from: SAUCE },
      });
      assert.ok(wethOut.length >= 1, "Should emit WETH Transfer from Sauce");
      assert.equal(
        wethOut[0].args.value,
        BigInt(amountIn),
        "WETH transfer amount should match amountIn",
      );
      // USDC transferred to CALLER
      const usdcIn = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { to: CALLER },
      });
      assert.ok(usdcIn.length >= 1, "Should emit USDC Transfer to caller");
      assert.ok(usdcIn[0].args.value > 1000_000000n, "USDC received should be >$1000");
    });

    it("exactInputMultiHop: swaps WETH -> USDC via encoded path", async () => {
      const amountIn = "1000000000000000000";
      const path = "0x" + WETH.slice(2).toLowerCase() + "0001f4" + USDC.slice(2).toLowerCase();
      const usdcBefore = await balanceOf(USDC, CALLER);
      const txHash = cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          { type: "approve", chainId, token: WETH, spender: SWAP_ROUTER, amount: amountIn },
          {
            type: "uniswapV3ExactInputMultiHop",
            chainId,
            router: SWAP_ROUTER,
            path: path as `0x${string}`,
            amountIn,
            amountOutMin: "1",
            recipient: CALLER,
            deadline: DEADLINE,
          },
        ]),
        "1ether",
      );
      const usdcAfter = await balanceOf(USDC, CALLER);
      assert.ok(usdcAfter > usdcBefore, `Caller should receive USDC`);
      assert.ok(usdcAfter - usdcBefore > 1000_000000n, `Should receive >$1000 USDC for 1 ETH`);

      const receipt = await getReceipt(txHash);
      // Verify each action emitted the right events with expected amounts
      const deposits = findEvents(receipt, wethDepositEventAbi, "Deposit", { address: WETH });
      assert.equal(deposits.length, 1, "Should emit one WETH Deposit event");
      assert.equal(deposits[0].args.wad, BigInt(amountIn), "Deposit amount should equal amountIn");
      const approvals = findEvents(receipt, approvalEventAbi, "Approval", {
        address: WETH,
        args: { owner: SAUCE, spender: SWAP_ROUTER },
      });
      assert.ok(approvals.length >= 1, "Should emit WETH Approval for swap router");
      assert.equal(
        approvals[0].args.value,
        BigInt(amountIn),
        "Approval amount should equal amountIn",
      );
      // WETH transferred from Sauce to the pool
      const wethOut = findEvents(receipt, transferEventAbi, "Transfer", {
        address: WETH,
        args: { from: SAUCE },
      });
      assert.ok(wethOut.length >= 1, "Should emit WETH Transfer from Sauce");
      assert.equal(
        wethOut[0].args.value,
        BigInt(amountIn),
        "WETH transfer amount should match amountIn",
      );
      // USDC transferred to CALLER
      const usdcIn = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { to: CALLER },
      });
      assert.ok(usdcIn.length >= 1, "Should emit USDC Transfer to caller");
      assert.ok(usdcIn[0].args.value > 1000_000000n, "USDC received should be >$1000");
    });
  });

  describe("Aave V3 Lending", () => {
    it("supply: supplies USDC to Aave and receives aToken", async () => {
      await fundSauceUSDC("1000000000000000000");
      const usdcBal = await balanceOf(USDC, SAUCE);
      const supplyAmount = (usdcBal / 2n).toString();
      const aTokenBefore = await balanceOf(AAVE_V3_aUSDC, SAUCE);
      const txHash = cookSend(
        actionsToSauce([
          { type: "approve", chainId, token: USDC, spender: AAVE_V3_POOL, amount: supplyAmount },
          {
            type: "aaveV3Supply",
            chainId,
            pool: AAVE_V3_POOL,
            token: USDC,
            amount: supplyAmount,
            onBehalfOf: SAUCE,
            referralCode: 0,
          },
        ]),
      );
      const aTokenAfter = await balanceOf(AAVE_V3_aUSDC, SAUCE);
      const usdcAfter = await balanceOf(USDC, SAUCE);
      assert.ok(aTokenAfter > aTokenBefore, `aToken balance should increase`);
      assert.ok(usdcAfter < usdcBal, `USDC balance should decrease`);

      const receipt = await getReceipt(txHash);
      // Approval should match supplyAmount
      const approvals = findEvents(receipt, approvalEventAbi, "Approval", {
        address: USDC,
        args: { owner: SAUCE, spender: AAVE_V3_POOL },
      });
      assert.ok(approvals.length >= 1, "Should emit USDC Approval for Aave pool");
      assert.equal(
        approvals[0].args.value,
        BigInt(supplyAmount),
        "Approval amount should equal supplyAmount",
      );
      // Supply event
      const supplyEvents = findEvents(receipt, aaveSupplyEventAbi, "Supply", {
        args: { reserve: USDC, onBehalfOf: SAUCE },
      });
      assert.equal(supplyEvents.length, 1, "Should emit one Aave Supply event");
      assert.equal(
        supplyEvents[0].args.amount,
        BigInt(supplyAmount),
        "Supply event amount should equal input supplyAmount",
      );
      // USDC transferred from Sauce to Aave pool — amount should match supplyAmount
      const usdcOut = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { from: SAUCE },
      });
      assert.ok(usdcOut.length >= 1, "Should emit USDC Transfer from Sauce");
      assert.equal(
        usdcOut[0].args.value,
        BigInt(supplyAmount),
        "USDC transfer out should equal supplyAmount",
      );
      // aToken minted to Sauce — amount should match supplyAmount
      const aTokenMint = findEvents(receipt, transferEventAbi, "Transfer", {
        address: AAVE_V3_aUSDC,
        args: { to: SAUCE },
      });
      assert.ok(aTokenMint.length >= 1, "Should emit aToken Transfer (mint) to Sauce");
      // Aave mints against the scaled balance — floor(floor(amount·RAY/index)·index/RAY) — so it
      // truncates twice, losing strictly less than index/RAY + 1 units and never minting more than
      // was supplied. Deriving the bound from the live index keeps it correct as the index grows.
      const liquidityIndex = await client.readContract({
        address: AAVE_V3_POOL,
        abi: aavePoolReserveIncomeAbi,
        functionName: "getReserveNormalizedIncome",
        args: [USDC],
      });
      const mintShortfall = BigInt(supplyAmount) - aTokenMint[0].args.value;
      assert.ok(
        mintShortfall >= 0n && mintShortfall <= liquidityIndex / RAY + 1n,
        `aToken mint should be within scaled-balance truncation of supplyAmount, shortfall=${mintShortfall}`,
      );
    });

    it("withdraw: withdraws USDC from Aave", async () => {
      await fundSauceUSDC("1000000000000000000");
      const usdcBal = await balanceOf(USDC, SAUCE);
      const supplyAmount = (usdcBal / 2n).toString();
      cookSend(
        actionsToSauce([
          { type: "approve", chainId, token: USDC, spender: AAVE_V3_POOL, amount: supplyAmount },
          {
            type: "aaveV3Supply",
            chainId,
            pool: AAVE_V3_POOL,
            token: USDC,
            amount: supplyAmount,
            onBehalfOf: SAUCE,
            referralCode: 0,
          },
        ]),
      );
      // Withdraw actual aToken balance (may differ from supplyAmount due to rounding)
      const aTokenBal = await balanceOf(AAVE_V3_aUSDC, SAUCE);
      const withdrawAmount = aTokenBal.toString();
      const usdcBefore = await balanceOf(USDC, SAUCE);
      const txHash = cookSend(
        actionsToSauce([
          {
            type: "aaveV3Withdraw",
            chainId,
            pool: AAVE_V3_POOL,
            token: USDC,
            amount: withdrawAmount,
            to: SAUCE,
          },
        ]),
      );
      const usdcAfter = await balanceOf(USDC, SAUCE);
      const returned = usdcAfter - usdcBefore;
      assert.ok(returned > 0n, `USDC should return after withdraw`);
      assert.ok(returned >= aTokenBal - 1n, `Should get back ~full supply amount`);

      const receipt = await getReceipt(txHash);
      const withdrawEvents = findEvents(receipt, aaveWithdrawEventAbi, "Withdraw", {
        args: { reserve: USDC, to: SAUCE },
      });
      assert.equal(withdrawEvents.length, 1, "Should emit one Aave Withdraw event");
      assert.equal(
        withdrawEvents[0].args.amount,
        BigInt(withdrawAmount),
        "Withdraw event amount should equal requested withdrawAmount",
      );
      // USDC transferred back to Sauce — amount should match the withdraw event
      const usdcTransfer = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { to: SAUCE },
      });
      assert.ok(usdcTransfer.length >= 1, "Should emit USDC Transfer to Sauce on withdraw");
      assert.equal(
        usdcTransfer[0].args.value,
        withdrawEvents[0].args.amount,
        "USDC transfer amount should equal Aave Withdraw event amount",
      );
    });
  });

  describe("Compound V3 Lending", () => {
    it("supply: supplies USDC to Compound", async () => {
      await fundSauceUSDC("1000000000000000000");
      const usdcBal = await balanceOf(USDC, SAUCE);
      const supplyAmount = (usdcBal / 2n).toString();
      const usdcBefore = await balanceOf(USDC, SAUCE);
      const txHash = cookSend(
        actionsToSauce([
          {
            type: "approve",
            chainId,
            token: USDC,
            spender: COMPOUND_V3_USDC,
            amount: supplyAmount,
          },
          {
            type: "compoundV3Supply",
            chainId,
            comet: COMPOUND_V3_USDC,
            token: USDC,
            amount: supplyAmount,
          },
        ]),
      );
      const usdcAfter = await balanceOf(USDC, SAUCE);
      assert.equal(
        usdcBefore - usdcAfter,
        BigInt(supplyAmount),
        `USDC should decrease by supply amount`,
      );
      const cometBal = await client.readContract({
        address: COMPOUND_V3_USDC,
        abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
        functionName: "balanceOf",
        args: [SAUCE],
      });
      assert.ok(cometBal > 0n, `Comet balance should be > 0`);

      const receipt = await getReceipt(txHash);
      // Approval should match supplyAmount
      const approvals = findEvents(receipt, approvalEventAbi, "Approval", {
        address: USDC,
        args: { owner: SAUCE, spender: COMPOUND_V3_USDC },
      });
      assert.ok(approvals.length >= 1, "Should emit USDC Approval for Compound");
      assert.equal(
        approvals[0].args.value,
        BigInt(supplyAmount),
        "Approval amount should equal supplyAmount",
      );
      // Supply event
      const supplyEvents = findEvents(receipt, compoundSupplyEventAbi, "Supply", {
        address: COMPOUND_V3_USDC,
        args: { dst: SAUCE },
      });
      assert.equal(supplyEvents.length, 1, "Should emit one Compound Supply event");
      assert.equal(
        supplyEvents[0].args.amount,
        BigInt(supplyAmount),
        "Compound Supply event amount should equal input supplyAmount",
      );
      // USDC transferred from Sauce to Comet — amount should match supplyAmount
      const usdcTransfer = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { from: SAUCE, to: COMPOUND_V3_USDC },
      });
      assert.ok(usdcTransfer.length >= 1, "Should emit USDC Transfer from Sauce to Comet");
      assert.equal(
        usdcTransfer[0].args.value,
        BigInt(supplyAmount),
        "USDC transfer amount should equal supplyAmount",
      );
    });

    it("withdraw: withdraws USDC from Compound", async () => {
      await fundSauceUSDC("1000000000000000000");
      const usdcBal = await balanceOf(USDC, SAUCE);
      const supplyAmount = (usdcBal / 2n).toString();
      cookSend(
        actionsToSauce([
          {
            type: "approve",
            chainId,
            token: USDC,
            spender: COMPOUND_V3_USDC,
            amount: supplyAmount,
          },
          {
            type: "compoundV3Supply",
            chainId,
            comet: COMPOUND_V3_USDC,
            token: USDC,
            amount: supplyAmount,
          },
        ]),
      );
      // Query actual Comet balance (may differ from supplyAmount due to internal rounding)
      const cometBal = await client.readContract({
        address: COMPOUND_V3_USDC,
        abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
        functionName: "balanceOf",
        args: [SAUCE],
      });
      const withdrawAmount = cometBal.toString();
      const usdcBefore = await balanceOf(USDC, SAUCE);
      const txHash = cookSend(
        actionsToSauce([
          {
            type: "compoundV3Withdraw",
            chainId,
            comet: COMPOUND_V3_USDC,
            token: USDC,
            amount: withdrawAmount,
          },
        ]),
      );
      const usdcAfter = await balanceOf(USDC, SAUCE);
      const returned = usdcAfter - usdcBefore;
      assert.ok(returned > 0n, `USDC should return after withdraw`);
      assert.ok(returned >= cometBal - 2n, `Should get back ~full supply amount`);

      const receipt = await getReceipt(txHash);
      const withdrawEvents = findEvents(receipt, compoundWithdrawEventAbi, "Withdraw", {
        address: COMPOUND_V3_USDC,
        args: { to: SAUCE },
      });
      assert.equal(withdrawEvents.length, 1, "Should emit one Compound Withdraw event");
      assert.equal(
        withdrawEvents[0].args.amount,
        BigInt(withdrawAmount),
        "Compound Withdraw event amount should equal requested withdrawAmount",
      );
      // USDC transferred back to Sauce — amount should match withdraw event
      const usdcTransfer = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { to: SAUCE },
      });
      assert.ok(usdcTransfer.length >= 1, "Should emit USDC Transfer to Sauce on withdraw");
      assert.equal(
        usdcTransfer[0].args.value,
        withdrawEvents[0].args.amount,
        "USDC transfer amount should equal Compound Withdraw event amount",
      );
    });
  });

  describe("Bridge Actions", () => {
    it("acrossBridge: deposits into Across SpokePool", async () => {
      await fundSauceUSDC("1000000000000000000");
      const usdcBal = await balanceOf(USDC, SAUCE);
      const bridgeAmount = (usdcBal / 2n).toString();
      const block = await client.getBlock();
      const blockTs = Number(block.timestamp);
      const usdcBefore = await balanceOf(USDC, SAUCE);
      const txHash = cookSend(
        actionsToSauce([
          {
            type: "approve",
            chainId,
            token: USDC,
            spender: ACROSS_SPOKE_POOL,
            amount: bridgeAmount,
          },
          {
            type: "acrossBridge",
            srcChainId: chainId,
            destChainId: 1,
            spokePool: ACROSS_SPOKE_POOL,
            token: USDC,
            amount: bridgeAmount,
            relayerFeePct: "0",
            quoteTimestamp: blockTs,
            fillDeadline: blockTs + 7200,
            exclusivityDeadline: 0,
            message: "0x",
          },
        ]),
      );
      const usdcAfter = await balanceOf(USDC, SAUCE);
      assert.equal(
        usdcBefore - usdcAfter,
        BigInt(bridgeAmount),
        `USDC should decrease by bridge amount`,
      );

      const receipt = await getReceipt(txHash);
      // Approval should match bridgeAmount
      const approvals = findEvents(receipt, approvalEventAbi, "Approval", {
        address: USDC,
        args: { owner: SAUCE, spender: ACROSS_SPOKE_POOL },
      });
      assert.ok(approvals.length >= 1, "Should emit USDC Approval for SpokePool");
      assert.equal(
        approvals[0].args.value,
        BigInt(bridgeAmount),
        "Approval amount should equal bridgeAmount",
      );
      // FundsDeposited event from SpokePool
      const depositEvents = findEvents(receipt, acrossDepositEventAbi, "FundsDeposited", {
        address: ACROSS_SPOKE_POOL,
      });
      assert.equal(depositEvents.length, 1, "Should emit one FundsDeposited event");
      assert.equal(
        depositEvents[0].args.inputAmount,
        BigInt(bridgeAmount),
        "Deposit input amount should equal bridgeAmount",
      );
      // inputToken is bytes32-padded address
      const inputTokenAddr = "0x" + (depositEvents[0].args.inputToken as string).slice(26);
      assert.equal(
        inputTokenAddr.toLowerCase(),
        USDC.toLowerCase(),
        "Deposit input token should be USDC",
      );
      // USDC transferred from Sauce to SpokePool — amount should match
      const usdcTransfer = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { from: SAUCE, to: ACROSS_SPOKE_POOL },
      });
      assert.ok(usdcTransfer.length >= 1, "Should emit USDC Transfer from Sauce to SpokePool");
      assert.equal(
        usdcTransfer[0].args.value,
        BigInt(bridgeAmount),
        "Transfer amount should equal bridgeAmount",
      );
    });
  });

  describe("Chaining — implicit (previous output)", () => {
    it("wrapETH → approve → swap: amount flows through", async () => {
      const amount = "1000000000000000000";
      const usdcBefore = await balanceOf(USDC, CALLER);
      const txHash = cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount },
          { type: "approve", chainId, token: WETH, spender: SWAP_ROUTER },
          {
            type: "uniswapV3ExactInput",
            chainId,
            router: SWAP_ROUTER,
            tokenIn: WETH,
            tokenOut: USDC,
            fee: 500,
            amountOutMin: "1",
            recipient: CALLER,
            deadline: DEADLINE,
          },
        ]),
        "1ether",
      );
      const usdcAfter = await balanceOf(USDC, CALLER);
      assert.ok(usdcAfter - usdcBefore > 1000_000000n, `Should receive >$1000 USDC`);

      const receipt = await getReceipt(txHash);
      // Verify the full chain: Deposit → Approval → Transfer(WETH) → Transfer(USDC)
      const deposits = findEvents(receipt, wethDepositEventAbi, "Deposit", { address: WETH });
      assert.equal(deposits.length, 1, "Should emit WETH Deposit");
      assert.equal(deposits[0].args.wad, BigInt(amount), "Deposit amount should match");
      // Approval should use the chained amount from wrapETH (no explicit amount on approve)
      const approvals = findEvents(receipt, approvalEventAbi, "Approval", {
        address: WETH,
        args: { owner: SAUCE, spender: SWAP_ROUTER },
      });
      assert.ok(approvals.length >= 1, "Should emit WETH Approval for swap router");
      assert.equal(
        approvals[0].args.value,
        deposits[0].args.wad,
        "Approval value should equal wrapETH Deposit amount (implicit chaining)",
      );
      // Swap WETH input should also equal the chained amount
      const wethOut = findEvents(receipt, transferEventAbi, "Transfer", {
        address: WETH,
        args: { from: SAUCE },
      });
      assert.ok(wethOut.length >= 1, "Should emit WETH Transfer from Sauce to pool");
      assert.equal(
        wethOut[0].args.value,
        deposits[0].args.wad,
        "Swap WETH input should equal wrapETH Deposit amount (implicit chaining)",
      );
      // USDC output
      const usdcIn = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { to: CALLER },
      });
      assert.ok(usdcIn.length >= 1, "Should emit USDC Transfer to caller");
      assert.ok(usdcIn[0].args.value > 1000_000000n, "USDC received should be >$1000");
    });

    it("wrapETH → unwrapETH: amount chains through", async () => {
      const amount = 1_000000000000000000n;
      const ethBefore = await ethBalance(SAUCE);
      const txHash = cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amount.toString() },
          { type: "unwrapETH", chainId, weth: WETH },
        ]),
        amount.toString(),
      );
      const ethAfter = await ethBalance(SAUCE);
      assert.equal(
        ethAfter - ethBefore,
        amount,
        `ETH should increase by 1 (wrap+unwrap, value stays)`,
      );

      const receipt = await getReceipt(txHash);
      const deposits = findEvents(receipt, wethDepositEventAbi, "Deposit", { address: WETH });
      assert.equal(deposits.length, 1, "Should emit WETH Deposit");
      assert.equal(deposits[0].args.wad, amount, "Deposit amount should match");
      // unwrapETH has no explicit amount — it should chain from wrapETH output
      const withdrawals = findEvents(receipt, wethWithdrawalEventAbi, "Withdrawal", {
        address: WETH,
      });
      assert.equal(withdrawals.length, 1, "Should emit WETH Withdrawal");
      assert.equal(
        withdrawals[0].args.wad,
        deposits[0].args.wad,
        "Withdrawal amount should equal Deposit amount (implicit chaining from wrapETH output)",
      );
    });
  });

  describe("Chaining — swap saveOutputAs / amountRef", () => {
    it("swap(saveOutputAs) → approve(amountRef) → transfer(amountRef): swap output used by later actions", async () => {
      const amountIn = "1000000000000000000";
      const recipient = "0x000000000000000000000000000000000000dEaD" as Address;
      const recipientBefore = await balanceOf(USDC, recipient);
      const txHash = cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          { type: "approve", chainId, token: WETH, spender: SWAP_ROUTER, amount: amountIn },
          {
            type: "uniswapV3ExactInput",
            chainId,
            router: SWAP_ROUTER,
            tokenIn: WETH,
            tokenOut: USDC,
            fee: 500,
            amountIn,
            amountOutMin: "1",
            recipient: CALLER,
            deadline: DEADLINE,
            saveOutputAs: "swapOut",
          },
          { type: "approve", chainId, token: USDC, spender: SAUCE, amountRef: "swapOut" },
          { type: "transfer", chainId, token: USDC, to: recipient, amountRef: "swapOut" },
        ]),
        "1ether",
      );
      const recipientAfter = await balanceOf(USDC, recipient);
      assert.ok(
        recipientAfter - recipientBefore > 1000_000000n,
        `Recipient should receive >$1000 USDC via saved swap output`,
      );

      const receipt = await getReceipt(txHash);
      // Swap output (USDC to Sauce — recipient is overridden to addressSelf when saveOutputAs is set)
      const usdcFromSwap = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { to: SAUCE },
      });
      assert.ok(usdcFromSwap.length >= 1, "Should emit USDC Transfer from swap");
      const swapOutput = usdcFromSwap[0].args.value;
      // Approval should use swap output via amountRef
      const approvals = findEvents(receipt, approvalEventAbi, "Approval", {
        address: USDC,
        args: { owner: SAUCE, spender: SAUCE },
      });
      assert.equal(approvals.length, 1, "Should emit one USDC Approval event");
      assert.equal(
        approvals[0].args.value,
        swapOutput,
        "Approval amount should equal swap output (amountRef chaining)",
      );
      // Transfer should use swap output via amountRef
      const usdcToRecipient = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { from: SAUCE, to: recipient },
      });
      assert.equal(
        usdcToRecipient.length,
        1,
        "Should emit one USDC Transfer from Sauce to recipient",
      );
      assert.equal(
        usdcToRecipient[0].args.value,
        swapOutput,
        "Transfer amount should equal swap output (amountRef chaining)",
      );
    });

    it("swap(saveOutputAs) → compound supply(amountRef): swap output feeds into supply", async () => {
      const amountIn = "1000000000000000000";
      const txHash = cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          { type: "approve", chainId, token: WETH, spender: SWAP_ROUTER, amount: amountIn },
          {
            type: "uniswapV3ExactInput",
            chainId,
            router: SWAP_ROUTER,
            tokenIn: WETH,
            tokenOut: USDC,
            fee: 500,
            amountIn,
            amountOutMin: "1",
            recipient: CALLER,
            deadline: DEADLINE,
            saveOutputAs: "swapOut",
          },
          {
            type: "approve",
            chainId,
            token: USDC,
            spender: COMPOUND_V3_USDC,
            amountRef: "swapOut",
          },
          {
            type: "compoundV3Supply",
            chainId,
            comet: COMPOUND_V3_USDC,
            token: USDC,
            amountRef: "swapOut",
          },
        ]),
        "1ether",
      );
      const cometBal = await client.readContract({
        address: COMPOUND_V3_USDC,
        abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
        functionName: "balanceOf",
        args: [SAUCE],
      });
      assert.ok(cometBal > 1000_000000n, `Comet balance should be >$1000 USDC`);

      const receipt = await getReceipt(txHash);
      // Swap output (USDC to Sauce — recipient overridden to addressSelf when saveOutputAs is set)
      const usdcFromSwap = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { to: SAUCE },
      });
      assert.ok(usdcFromSwap.length >= 1, "Should emit USDC Transfer from swap");
      const swapOutput = usdcFromSwap[0].args.value;
      // Approval should use swap output via amountRef
      const approvals = findEvents(receipt, approvalEventAbi, "Approval", {
        address: USDC,
        args: { owner: SAUCE, spender: COMPOUND_V3_USDC },
      });
      assert.ok(approvals.length >= 1, "Should emit USDC Approval for Compound");
      assert.equal(
        approvals[0].args.value,
        swapOutput,
        "Approval amount should equal swap output (amountRef chaining)",
      );
      // Compound supply should use swap output via amountRef
      const supplyEvents = findEvents(receipt, compoundSupplyEventAbi, "Supply", {
        address: COMPOUND_V3_USDC,
        args: { dst: SAUCE },
      });
      assert.equal(supplyEvents.length, 1, "Should emit one Compound Supply event");
      assert.equal(
        supplyEvents[0].args.amount,
        swapOutput,
        "Compound supply amount should equal swap output (amountRef chaining)",
      );
      // USDC transfer to Comet should also match
      const usdcToComet = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { from: SAUCE, to: COMPOUND_V3_USDC },
      });
      assert.ok(usdcToComet.length >= 1, "Should emit USDC Transfer from Sauce to Comet");
      assert.equal(
        usdcToComet[0].args.value,
        swapOutput,
        "USDC transfer to Comet should equal swap output (amountRef chaining)",
      );
    });
  });

  describe("Swap output chaining", () => {
    it("uniswapV3ExactInput output → approve: swap output amount used as approval", async () => {
      const amountIn = "1000000000000000000";
      const spender = "0x000000000000000000000000000000000000bEEF" as Address;
      const txHash = cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          { type: "approve", chainId, token: WETH, spender: SWAP_ROUTER, amount: amountIn },
          {
            type: "uniswapV3ExactInput",
            chainId,
            router: SWAP_ROUTER,
            tokenIn: WETH,
            tokenOut: USDC,
            fee: 500,
            amountIn,
            amountOutMin: "1",
            recipient: CALLER,
            deadline: DEADLINE,
            saveOutputAs: "swapOut",
          },
          { type: "approve", chainId, token: USDC, spender, amountRef: "swapOut" },
        ]),
        "1ether",
      );
      const a = await allowance(USDC, SAUCE, spender);
      assert.ok(
        a > 1000_000000n,
        `Allowance should reflect swap output (>$1000 USDC), got ${formatUnits(a, 6)}`,
      );

      const receipt = await getReceipt(txHash);
      // Verify approval amount equals swap output via events (recipient overridden to Sauce when saveOutputAs is set)
      const usdcFromSwap = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { to: SAUCE },
      });
      assert.ok(usdcFromSwap.length >= 1, "Should emit USDC Transfer from swap");
      const approvals = findEvents(receipt, approvalEventAbi, "Approval", {
        address: USDC,
        args: { owner: SAUCE, spender },
      });
      assert.equal(approvals.length, 1, "Should emit one USDC Approval event");
      assert.equal(
        approvals[0].args.value,
        usdcFromSwap[0].args.value,
        "Approval value should equal swap output (amountRef chaining)",
      );
    });

    it("uniswapV3ExactInputMultiHop output → approve: multi-hop swap output used as approval", async () => {
      const amountIn = "1000000000000000000";
      const path = "0x" + WETH.slice(2).toLowerCase() + "0001f4" + USDC.slice(2).toLowerCase();
      const spender = "0x000000000000000000000000000000000000bEEF" as Address;
      const txHash = cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          { type: "approve", chainId, token: WETH, spender: SWAP_ROUTER, amount: amountIn },
          {
            type: "uniswapV3ExactInputMultiHop",
            chainId,
            router: SWAP_ROUTER,
            path: path as `0x${string}`,
            amountIn,
            amountOutMin: "1",
            recipient: CALLER,
            deadline: DEADLINE,
            saveOutputAs: "swapOut",
          },
          { type: "approve", chainId, token: USDC, spender, amountRef: "swapOut" },
        ]),
        "1ether",
      );
      const a = await allowance(USDC, SAUCE, spender);
      assert.ok(
        a > 1000_000000n,
        `Allowance should reflect swap output (>$1000 USDC), got ${formatUnits(a, 6)}`,
      );

      const receipt = await getReceipt(txHash);
      const usdcFromSwap = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { to: SAUCE },
      });
      assert.ok(usdcFromSwap.length >= 1, "Should emit USDC Transfer from swap");
      const approvals = findEvents(receipt, approvalEventAbi, "Approval", {
        address: USDC,
        args: { owner: SAUCE, spender },
      });
      assert.equal(approvals.length, 1, "Should emit one USDC Approval event");
      assert.equal(
        approvals[0].args.value,
        usdcFromSwap[0].args.value,
        "Approval value should equal multi-hop swap output (amountRef chaining)",
      );
    });

    it("uniswapV4ExactInput output → approve: V4 swap output chains into approval", async () => {
      const amountIn = "100000000000000000"; // 0.1 ETH
      const spender = "0x000000000000000000000000000000000000bEEF" as Address;
      cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          {
            type: "uniswapV4ExactInput",
            chainId,
            router: UNISWAP_V4_ROUTER,
            // V4 orders a pool's currencies by address, so USDC is currency0; WETH -> USDC is
            // therefore one-for-zero. The 0.05% pool is the liquid one at the pinned block.
            poolKey: {
              currency0: USDC,
              currency1: WETH,
              fee: 500,
              tickSpacing: 10,
              hooks: "0x0000000000000000000000000000000000000000",
            },
            zeroForOne: false,
            amountIn,
            amountOutMin: "1",
            recipient: CALLER,
            saveOutputAs: "swapOut",
          },
          { type: "approve", chainId, token: USDC, spender, amountRef: "swapOut" },
        ]),
        amountIn,
      );
      const a = await allowance(USDC, SAUCE, spender);
      assert.ok(
        a > 100_000000n,
        `Allowance should reflect V4 swap output (>$100 USDC), got ${formatUnits(a, 6)}`,
      );
    });

    it("uniswapV4ExactInputMultiHop output → approve: V4 multi-hop output chains into approval", async () => {
      const amountIn = "100000000000000000"; // 0.1 ETH
      const spender = "0x000000000000000000000000000000000000bEEF" as Address;
      cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          {
            type: "uniswapV4ExactInputMultiHop",
            chainId,
            router: UNISWAP_V4_ROUTER,
            currencyIn: WETH,
            path: [
              {
                intermediateCurrency: USDC,
                fee: 500,
                tickSpacing: 10,
                hooks: "0x0000000000000000000000000000000000000000",
              },
            ],
            amountIn,
            amountOutMin: "1",
            recipient: CALLER,
            saveOutputAs: "swapOut",
          },
          { type: "approve", chainId, token: USDC, spender, amountRef: "swapOut" },
        ]),
        amountIn,
      );
      const a = await allowance(USDC, SAUCE, spender);
      assert.ok(
        a > 100_000000n,
        `Allowance should reflect V4 multi-hop swap output (>$100 USDC), got ${formatUnits(a, 6)}`,
      );
    });

    it("curveSwap output → approve: Curve swap output chains into approval", async () => {
      // Fund Sauce with USDC, then swap USDC → curveTokenOut via the chain's curve stable pool
      await fundSauceUSDC("1000000000000000000");
      const usdcBal = await balanceOf(USDC, SAUCE);
      const swapAmount = (usdcBal / 2n).toString();
      const spender = "0x000000000000000000000000000000000000bEEF" as Address;
      const txHash = cookSend(
        actionsToSauce([
          { type: "approve", chainId, token: USDC, spender: CURVE_POOL, amount: swapAmount },
          {
            type: "curveSwap",
            chainId,
            pool: CURVE_POOL,
            tokenIn: USDC,
            tokenOut: CURVE_TOKEN_OUT,
            i: CURVE_I,
            j: CURVE_J,
            amountIn: swapAmount,
            amountOutMin: "1",
            recipient: CALLER,
            saveOutputAs: "swapOut",
          },
          { type: "approve", chainId, token: CURVE_TOKEN_OUT, spender, amountRef: "swapOut" },
        ]),
      );
      const a = await allowance(CURVE_TOKEN_OUT, SAUCE, spender);
      assert.ok(a > 0n, `Allowance should reflect Curve swap output, got ${a}`);

      const receipt = await getReceipt(txHash);
      // Verify USDC input to Curve matches swapAmount
      const usdcToCurve = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { from: SAUCE, to: CURVE_POOL },
      });
      assert.ok(usdcToCurve.length >= 1, "Should emit USDC Transfer from Sauce to Curve");
      assert.equal(
        usdcToCurve[0].args.value,
        BigInt(swapAmount),
        "USDC input to Curve should equal swapAmount",
      );
      // curveTokenOut transferred from Curve pool to Sauce (swap output)
      const curveOutput = findEvents(receipt, transferEventAbi, "Transfer", {
        address: CURVE_TOKEN_OUT,
        args: { to: SAUCE },
      });
      assert.ok(curveOutput.length >= 1, "Should emit curveTokenOut Transfer to Sauce from Curve");
      // Approval amount should match Curve output (amountRef chaining)
      const approvals = findEvents(receipt, approvalEventAbi, "Approval", {
        address: CURVE_TOKEN_OUT,
        args: { owner: SAUCE, spender },
      });
      assert.equal(approvals.length, 1, "Should emit one curveTokenOut Approval event");
      assert.equal(
        approvals[0].args.value,
        curveOutput[0].args.value,
        "Approval value should equal Curve swap output (amountRef chaining)",
      );
    });

    it("curveSwap → uniswapV3: chain Curve output into V3 swap", async () => {
      // Curve exchange() sends output to msg.sender (Sauce), so it stays in Sauce
      // for the next swap. V3 then pulls from Sauce and sends output to caller.
      await fundSauceUSDC("1000000000000000000");
      const usdcBal = await balanceOf(USDC, SAUCE);
      const swapAmount = (usdcBal / 2n).toString();
      const txHash = cookSend(
        actionsToSauce([
          { type: "approve", chainId, token: USDC, spender: CURVE_POOL, amount: swapAmount },
          {
            type: "curveSwap",
            chainId,
            pool: CURVE_POOL,
            tokenIn: USDC,
            tokenOut: CURVE_TOKEN_OUT,
            i: CURVE_I,
            j: CURVE_J,
            amountIn: swapAmount,
            amountOutMin: "1",
            recipient: CALLER,
            saveOutputAs: "curveOut",
          },
          {
            type: "approve",
            chainId,
            token: CURVE_TOKEN_OUT,
            spender: SWAP_ROUTER,
            amountRef: "curveOut",
          },
          {
            type: "uniswapV3ExactInput",
            chainId,
            router: SWAP_ROUTER,
            tokenIn: CURVE_TOKEN_OUT,
            tokenOut: USDC,
            fee: 100,
            amountOutMin: "1",
            recipient: CALLER,
            deadline: DEADLINE,
            amountRef: "curveOut",
          },
        ]),
      );

      const receipt = await getReceipt(txHash);

      // Curve output: curveTokenOut Transfer from CurvePool → Sauce
      const curveOutput = findEvents(receipt, transferEventAbi, "Transfer", {
        address: CURVE_TOKEN_OUT,
        args: { from: CURVE_POOL, to: SAUCE },
      });
      assert.ok(curveOutput.length >= 1, "Should emit curveTokenOut Transfer from Curve to Sauce");
      const curveOutAmount = curveOutput[0].args.value;

      // Approval should use Curve output via amountRef
      const approvals = findEvents(receipt, approvalEventAbi, "Approval", {
        address: CURVE_TOKEN_OUT,
        args: { owner: SAUCE, spender: SWAP_ROUTER },
      });
      assert.ok(approvals.length >= 1, "Should emit curveTokenOut Approval for swap router");
      assert.equal(
        approvals[0].args.value,
        curveOutAmount,
        "Approval amount should equal Curve output (amountRef chaining)",
      );

      // V3 input: curveTokenOut Transfer from Sauce → pool (not router)
      const v3Input = findEvents(receipt, transferEventAbi, "Transfer", {
        address: CURVE_TOKEN_OUT,
        args: { from: SAUCE },
      }).filter((e) => e.args.to.toLowerCase() !== SWAP_ROUTER.toLowerCase());
      assert.ok(v3Input.length >= 1, "Should emit curveTokenOut Transfer from Sauce to V3 pool");
      assert.equal(
        v3Input[0].args.value,
        curveOutAmount,
        `V3 input (${formatUnits(v3Input[0].args.value, 6)} curveTokenOut) should equal Curve output (${formatUnits(curveOutAmount, 6)} curveTokenOut) (amountRef chaining)`,
      );
    });

    it("balancerV2Swap output → approve: Balancer swap output chains into approval", async () => {
      const amountIn = "100000000000000"; // 0.0001 ETH (pool has low liquidity)
      const spender = "0x000000000000000000000000000000000000bEEF" as Address;
      cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          { type: "approve", chainId, token: WETH, spender: BALANCER_V2_VAULT, amount: amountIn },
          {
            type: "balancerV2Swap",
            chainId,
            vault: BALANCER_V2_VAULT,
            poolId: BALANCER_V2_POOL_ID,
            tokenIn: WETH,
            tokenOut: USDC,
            amountIn,
            amountOutMin: "1",
            recipient: CALLER,
            deadline: DEADLINE,
            saveOutputAs: "swapOut",
          },
          { type: "approve", chainId, token: USDC, spender, amountRef: "swapOut" },
        ]),
        amountIn,
      );
      const a = await allowance(USDC, SAUCE, spender);
      assert.ok(a > 0n, `Allowance should reflect Balancer swap output, got ${a}`);
    });

    it("balancerV2BatchSwap output → approve: Balancer batch swap output chains into approval", async () => {
      const amountIn = "100000000000000"; // 0.0001 ETH
      const spender = "0x000000000000000000000000000000000000bEEF" as Address;
      cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          { type: "approve", chainId, token: WETH, spender: BALANCER_V2_VAULT, amount: amountIn },
          {
            type: "balancerV2BatchSwap",
            chainId,
            vault: BALANCER_V2_VAULT,
            steps: [
              {
                poolId: BALANCER_V2_POOL_ID,
                assetInIndex: 0,
                assetOutIndex: 1,
                amount: amountIn,
              },
            ],
            assets: [WETH, USDC],
            amountOutMin: "1",
            recipient: CALLER,
            deadline: DEADLINE,
            saveOutputAs: "swapOut",
          },
          { type: "approve", chainId, token: USDC, spender, amountRef: "swapOut" },
        ]),
        amountIn,
      );
      const a = await allowance(USDC, SAUCE, spender);
      assert.ok(a > 0n, `Allowance should reflect Balancer batch swap output, got ${a}`);
    });
  });

  describe("Bytecode generation", () => {
    // Chaining is `let v_<name> = …` locals in the emitted SauceScript, so it is observable in the
    // source and not as an opcode. A byte scan cannot assert it either way.

    /** Check that a 4-byte selector (hex string like '0xa9059cbb') appears in bytecode */
    function containsSelector(bytecode: Uint8Array, selectorHex: string): boolean {
      const sel = selectorHex.startsWith("0x") ? selectorHex.slice(2) : selectorHex;
      const bytes = [
        parseInt(sel.slice(0, 2), 16),
        parseInt(sel.slice(2, 4), 16),
        parseInt(sel.slice(4, 6), 16),
        parseInt(sel.slice(6, 8), 16),
      ];
      for (let i = 0; i <= bytecode.length - 4; i++) {
        if (
          bytecode[i] === bytes[0] &&
          bytecode[i + 1] === bytes[1] &&
          bytecode[i + 2] === bytes[2] &&
          bytecode[i + 3] === bytes[3]
        )
          return true;
      }
      return false;
    }

    // Selectors
    const SEL_TRANSFER = "0xa9059cbb"; // transfer(address,uint256)
    const SEL_EXECUTE = "0x24856bc3"; // execute(bytes,bytes[])
    const SEL_APPROVE = "0x095ea7b3"; // approve(address,uint256)
    const SEL_EXCHANGE = "0x3df02124"; // exchange(int128,int128,uint256,uint256) — 4-arg variant emitted by curveSwap impl
    const SEL_BAL_SWAP = "0x52bbbe29"; // swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)
    const SEL_BAL_BATCH = "0x945bcec9"; // batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)
    const SEL_WRAP = "0xea598cb0"; // wrap(uint256)
    const SEL_UNWRAP = "0xde0e9a3e"; // unwrap(uint256)
    const SEL_DEPOSIT = "0xd0e30db0"; // deposit()
    const SEL_SUBMIT = "0xa1903eab"; // submit(address)
    const SEL_REQUEST_WITHDRAWALS = "0xd6681042"; // requestWithdrawals(uint256[],address)
    const SEL_BURN = "0x42966c68"; // burn(uint256)
    const SEL_AAVE_BORROW = "0xa415bcad"; // borrow(address,uint256,uint256,uint16,address)
    const SEL_AAVE_REPAY = "0x573ade81"; // repay(address,uint256,uint256,address)
    // The V1 router's real `swap` (lzTxObj, to, payload). The `(address,address,bytes)` overload
    // this pinned before (0x13d356b9) is not on the router — checked against its mainnet bytecode.
    const SEL_STARGATE_SWAP = "0x9fbf10fc"; // swap(uint16,uint256,uint256,address,uint256,uint256,(uint256,uint256,bytes),bytes,bytes)
    const SEL_CCTP_DEPOSIT = "0x6fd3504e"; // depositForBurn(uint256,uint32,bytes32,address)
    const SEL_HYPERLANE_DISPATCH = "0xfa31de01"; // dispatch(uint32,bytes32,bytes)

    it("uniswapV4ExactInput", () => {
      const actions = [
        {
          type: "uniswapV4ExactInput",
          chainId,
          router: "0x0000000000000000000000000000000000000001",
          poolKey: {
            currency0: "0x0000000000000000000000000000000000000002",
            currency1: "0x0000000000000000000000000000000000000003",
            fee: 3000,
            tickSpacing: 60,
            hooks: "0x0000000000000000000000000000000000000000",
          },
          zeroForOne: true,
          amountIn: "1000000000000000000",
          amountOutMin: "1",
          recipient: CALLER,
        },
      ] satisfies RoutingAction[];
      const bytecode = actionsToSauce(actions);
      const source = actionsToSauceSource(actions);
      assert.ok(containsSelector(bytecode, SEL_TRANSFER), "should contain transfer selector");
      assert.ok(containsSelector(bytecode, SEL_EXECUTE), "should contain execute selector");
      assert.doesNotMatch(source, /let v_/, "no chaining — no output local should be declared");
    });

    it("uniswapV4ExactInput with saveOutputAs", () => {
      const actions = [
        {
          type: "uniswapV4ExactInput",
          chainId,
          router: "0x0000000000000000000000000000000000000001",
          poolKey: {
            currency0: "0x0000000000000000000000000000000000000002",
            currency1: "0x0000000000000000000000000000000000000003",
            fee: 3000,
            tickSpacing: 60,
            hooks: "0x0000000000000000000000000000000000000000",
          },
          zeroForOne: true,
          amountIn: "1000000000000000000",
          amountOutMin: "1",
          recipient: CALLER,
          saveOutputAs: "v4Out",
        },
        {
          type: "approve",
          chainId,
          token: "0x0000000000000000000000000000000000000003",
          spender: "0x000000000000000000000000000000000000bEEF",
          amountRef: "v4Out",
        },
      ] satisfies RoutingAction[];
      const bytecode = actionsToSauce(actions);
      const source = actionsToSauceSource(actions);
      assert.ok(containsSelector(bytecode, SEL_TRANSFER), "should contain transfer selector");
      assert.ok(containsSelector(bytecode, SEL_EXECUTE), "should contain execute selector");
      assert.ok(containsSelector(bytecode, SEL_APPROVE), "should contain approve selector");
      assert.match(source, /let v_v4Out = /, "saveOutputAs should declare the local");
      assert.match(
        source,
        /\.concat\(v_v4Out\.toBytesBe\(32\)\)/,
        "amountRef should read the local, not a literal",
      );
    });

    it("uniswapV4ExactInputMultiHop", () => {
      const actions = [
        {
          type: "uniswapV4ExactInputMultiHop",
          chainId,
          router: "0x0000000000000000000000000000000000000001",
          currencyIn: "0x0000000000000000000000000000000000000002",
          path: [
            {
              intermediateCurrency: "0x0000000000000000000000000000000000000003",
              fee: 3000,
              tickSpacing: 60,
              hooks: "0x0000000000000000000000000000000000000000",
            },
            {
              intermediateCurrency: "0x0000000000000000000000000000000000000004",
              fee: 500,
              tickSpacing: 10,
              hooks: "0x0000000000000000000000000000000000000000",
            },
          ],
          amountIn: "1000000000000000000",
          amountOutMin: "1",
          recipient: CALLER,
        },
      ] satisfies RoutingAction[];
      const bytecode = actionsToSauce(actions);
      const source = actionsToSauceSource(actions);
      assert.ok(containsSelector(bytecode, SEL_TRANSFER), "should contain transfer selector");
      assert.ok(containsSelector(bytecode, SEL_EXECUTE), "should contain execute selector");
      // The negative twin of the chained case, and it has to be checked the same way: the old
      // `bytecode[0] !== 0xc0` held for every program ever emitted, chained or not, so it proved
      // nothing.
      assert.doesNotMatch(source, /let v_/, "no chaining — no output local should be declared");
    });

    it("uniswapV4ExactInputMultiHop with saveOutputAs", () => {
      const actions = [
        {
          type: "uniswapV4ExactInputMultiHop",
          chainId,
          router: "0x0000000000000000000000000000000000000001",
          currencyIn: "0x0000000000000000000000000000000000000002",
          path: [
            {
              intermediateCurrency: "0x0000000000000000000000000000000000000003",
              fee: 3000,
              tickSpacing: 60,
              hooks: "0x0000000000000000000000000000000000000000",
            },
            {
              intermediateCurrency: "0x0000000000000000000000000000000000000004",
              fee: 500,
              tickSpacing: 10,
              hooks: "0x0000000000000000000000000000000000000000",
            },
          ],
          amountIn: "1000000000000000000",
          amountOutMin: "1",
          recipient: CALLER,
          saveOutputAs: "v4MultiOut",
        },
        {
          type: "approve",
          chainId,
          token: "0x0000000000000000000000000000000000000004",
          spender: "0x000000000000000000000000000000000000bEEF",
          amountRef: "v4MultiOut",
        },
      ] satisfies RoutingAction[];
      const bytecode = actionsToSauce(actions);
      const source = actionsToSauceSource(actions);
      assert.ok(containsSelector(bytecode, SEL_TRANSFER), "should contain transfer selector");
      assert.ok(containsSelector(bytecode, SEL_EXECUTE), "should contain execute selector");
      assert.ok(containsSelector(bytecode, SEL_APPROVE), "should contain approve selector");
      assert.match(source, /let v_v4MultiOut = /, "saveOutputAs should declare the local");
      assert.match(
        source,
        /\.concat\(v_v4MultiOut\.toBytesBe\(32\)\)/,
        "amountRef should read the local, not a literal",
      );
    });

    it("curveSwap", () => {
      const bytecode = actionsToSauce([
        {
          type: "curveSwap",
          chainId,
          pool: "0x0000000000000000000000000000000000000001",
          tokenIn: WETH,
          tokenOut: USDC,
          i: 0,
          j: 1,
          amountIn: "1000000000000000000",
          amountOutMin: "1",
          recipient: CALLER,
        },
      ]);
      assert.ok(containsSelector(bytecode, SEL_EXCHANGE), "should contain exchange selector");
    });

    it("balancerV2Swap", () => {
      const bytecode = actionsToSauce([
        {
          type: "balancerV2Swap",
          chainId,
          vault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
          poolId: "0x0000000000000000000000000000000000000000000000000000000000000001",
          tokenIn: WETH,
          tokenOut: USDC,
          amountIn: "1000000000000000000",
          amountOutMin: "1",
          recipient: CALLER,
          deadline: 9999999999,
        },
      ]);
      assert.ok(containsSelector(bytecode, SEL_BAL_SWAP), "should contain swap selector");
    });

    it("balancerV2BatchSwap", () => {
      const bytecode = actionsToSauce([
        {
          type: "balancerV2BatchSwap",
          chainId,
          vault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
          steps: [
            {
              poolId: "0x0000000000000000000000000000000000000000000000000000000000000001",
              assetInIndex: 0,
              assetOutIndex: 1,
              amount: "1000000000000000000",
            },
          ],
          assets: [WETH, USDC],
          amountOutMin: "1",
          recipient: CALLER,
          deadline: 9999999999,
        },
      ]);
      assert.ok(containsSelector(bytecode, SEL_BAL_BATCH), "should contain batchSwap selector");
    });

    it("wrapStETH", () => {
      const bytecode = actionsToSauce([
        {
          type: "wrapStETH",
          chainId: 1,
          wstETH: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
          stETHAmount: "1000000000000000000",
        },
      ]);
      assert.ok(containsSelector(bytecode, SEL_WRAP), "should contain wrap selector");
    });

    it("unwrapStETH", () => {
      const bytecode = actionsToSauce([
        {
          type: "unwrapStETH",
          chainId: 1,
          wstETH: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
          wstETHAmount: "1000000000000000000",
        },
      ]);
      assert.ok(containsSelector(bytecode, SEL_UNWRAP), "should contain unwrap selector");
    });

    it("lidoStake", () => {
      const bytecode = actionsToSauce([
        {
          type: "lidoStake",
          chainId: 1,
          stETH: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
          amount: "1000000000000000000",
          referral: "0x0000000000000000000000000000000000000000",
        },
      ]);
      assert.ok(containsSelector(bytecode, SEL_SUBMIT), "should contain submit selector");
    });

    it("lidoUnstake", () => {
      const bytecode = actionsToSauce([
        {
          type: "lidoUnstake",
          chainId: 1,
          withdrawalQueue: "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1",
          stETHAmount: "1000000000000000000",
        },
      ]);
      assert.ok(
        containsSelector(bytecode, SEL_REQUEST_WITHDRAWALS),
        "should contain requestWithdrawals selector",
      );
    });

    it("rocketPoolStake", () => {
      const bytecode = actionsToSauce([
        {
          type: "rocketPoolStake",
          chainId: 1,
          rETH: "0xae78736Cd615f374D3085123A210448E74Fc6393",
          depositPool: "0xDD3f50F8A6CafbE9b31a427582963f465E745AF8",
          amount: "1000000000000000000",
        },
      ]);
      assert.ok(containsSelector(bytecode, SEL_DEPOSIT), "should contain deposit selector");
    });

    it("rocketPoolUnstake", () => {
      const bytecode = actionsToSauce([
        {
          type: "rocketPoolUnstake",
          chainId: 1,
          rETH: "0xae78736Cd615f374D3085123A210448E74Fc6393",
          amount: "1000000000000000000",
        },
      ]);
      assert.ok(containsSelector(bytecode, SEL_BURN), "should contain burn selector");
    });

    it("etherFiStake", () => {
      const bytecode = actionsToSauce([
        {
          type: "etherFiStake",
          chainId: 1,
          liquidityPool: "0x308861A430be4cce5502d0A12724771Fc6DaF216",
          amount: "1000000000000000000",
        },
      ]);
      assert.ok(containsSelector(bytecode, SEL_DEPOSIT), "should contain deposit selector");
    });

    it("aaveV3Borrow", () => {
      const bytecode = actionsToSauce([
        {
          type: "aaveV3Borrow",
          chainId,
          pool: AAVE_V3_POOL,
          token: USDC,
          amount: "1000000",
          interestRateMode: 2,
          onBehalfOf: SAUCE,
          referralCode: 0,
        },
      ]);
      assert.ok(containsSelector(bytecode, SEL_AAVE_BORROW), "should contain borrow selector");
    });

    it("aaveV3Repay", () => {
      const bytecode = actionsToSauce([
        {
          type: "aaveV3Repay",
          chainId,
          pool: AAVE_V3_POOL,
          token: USDC,
          amount: "1000000",
          interestRateMode: 2,
          onBehalfOf: SAUCE,
        },
      ]);
      assert.ok(containsSelector(bytecode, SEL_AAVE_REPAY), "should contain repay selector");
    });

    it("stargateBridge", () => {
      const bytecode = actionsToSauce([
        {
          type: "stargateBridge",
          srcChainId: chainId,
          destChainId: 1,
          router: "0x0000000000000000000000000000000000000001",
          token: USDC,
          srcPoolId: 1,
          dstPoolId: 1,
          amount: "1000000",
          amountOutMin: "900000",
          lzFee: "100000000000000",
        },
      ]);
      assert.ok(
        containsSelector(bytecode, SEL_STARGATE_SWAP),
        "should contain stargate swap selector",
      );
    });

    it("cctpBridge", () => {
      const bytecode = actionsToSauce([
        {
          type: "cctpBridge",
          srcChainId: chainId,
          destChainId: 1,
          tokenMessenger: "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
          token: USDC,
          srcDomain: 6,
          destDomain: 0,
          amount: "1000000",
          mintRecipient: "0x000000000000000000000000f39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        },
      ]);
      assert.ok(
        containsSelector(bytecode, SEL_CCTP_DEPOSIT),
        "should contain depositForBurn selector",
      );
    });

    it("hyperlaneBridge", () => {
      const bytecode = actionsToSauce([
        {
          type: "hyperlaneBridge",
          srcChainId: chainId,
          destChainId: 1,
          router: "0x0000000000000000000000000000000000000001",
          token: USDC,
          amount: "1000000",
          destinationDomain: 1,
          gasPayment: "100000000000000",
        },
      ]);
      assert.ok(
        containsSelector(bytecode, SEL_HYPERLANE_DISPATCH),
        "should contain dispatch selector",
      );
    });
  });

  // ==========================================================================
  // New AMM Swap Integration Tests
  // ==========================================================================

  describe("UniswapV2 Swaps", () => {
    it("uniswapV2Swap: swaps WETH → USDC via V2 Router", async () => {
      if (!isMainnet) return; // V2 Router only on mainnet
      const amountIn = "1000000000000000000"; // 1 ETH
      const usdcBefore = await balanceOf(USDC, CALLER);
      const txHash = cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          { type: "approve", chainId, token: WETH, spender: UNISWAP_V2_ROUTER, amount: amountIn },
          {
            type: "uniswapV2Swap",
            chainId,
            router: UNISWAP_V2_ROUTER,
            amountIn,
            amountOutMin: "1",
            path: [WETH, USDC],
            recipient: CALLER,
            deadline: DEADLINE,
          },
        ]),
        "1ether",
      );
      const usdcAfter = await balanceOf(USDC, CALLER);
      assert.ok(usdcAfter > usdcBefore, "Caller should receive USDC");
      assert.ok(usdcAfter - usdcBefore > 1000_000000n, "Should receive >$1000 USDC for 1 ETH");

      const receipt = await getReceipt(txHash);
      const deposits = findEvents(receipt, wethDepositEventAbi, "Deposit", { address: WETH });
      assert.equal(deposits.length, 1, "Should emit one WETH Deposit event");
      const usdcIn = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { to: CALLER },
      });
      assert.ok(usdcIn.length >= 1, "Should emit USDC Transfer to caller");
      assert.ok(usdcIn[0].args.value > 1000_000000n, "USDC received should be >$1000");
    });

    it("uniswapV2Swap output chains into approve via saveOutputAs", async () => {
      if (!isMainnet) return;
      const amountIn = "1000000000000000000";
      const spender = "0x000000000000000000000000000000000000bEEF" as Address;
      const txHash = cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          { type: "approve", chainId, token: WETH, spender: UNISWAP_V2_ROUTER, amount: amountIn },
          {
            type: "uniswapV2Swap",
            chainId,
            router: UNISWAP_V2_ROUTER,
            amountIn,
            amountOutMin: "1",
            path: [WETH, USDC],
            recipient: CALLER,
            deadline: DEADLINE,
            saveOutputAs: "v2Out",
          },
          { type: "approve", chainId, token: USDC, spender, amountRef: "v2Out" },
        ]),
        "1ether",
      );
      const a = await allowance(USDC, SAUCE, spender);
      assert.ok(
        a > 1000_000000n,
        `Allowance should reflect V2 swap output (>$1000 USDC), got ${formatUnits(a, 6)}`,
      );

      const receipt = await getReceipt(txHash);
      const usdcFromSwap = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { to: SAUCE },
      });
      assert.ok(usdcFromSwap.length >= 1, "Should emit USDC Transfer from swap");
      const approvals = findEvents(receipt, approvalEventAbi, "Approval", {
        address: USDC,
        args: { owner: SAUCE, spender },
      });
      assert.equal(approvals.length, 1, "Should emit one USDC Approval event");
      assert.equal(
        approvals[0].args.value,
        usdcFromSwap[0].args.value,
        "Approval value should equal V2 swap output (amountRef chaining)",
      );
    });
  });

  describe("Curve RouterNG Swaps", () => {
    it("curveRouterNGSwap: swaps USDC → USDT via Curve RouterNG", async () => {
      if (!isMainnet) return;
      await fundSauceUSDC("1000000000000000000");
      const usdcBal = await balanceOf(USDC, SAUCE);
      const swapAmount = (usdcBal / 2n).toString();

      // Curve 3pool: DAI=0, USDC=1, USDT=2; swap_type=1 (StableSwap exchange)
      // Route: USDC → 3pool → USDT
      const txHash = cookSend(
        actionsToSauce([
          { type: "approve", chainId, token: USDC, spender: CURVE_ROUTER_NG, amount: swapAmount },
          {
            type: "curveRouterNGSwap",
            chainId,
            router: CURVE_ROUTER_NG,
            route: [USDC, CURVE_POOL, USDT],
            swapParams: [[1, 2, 1, 1, 3]], // i=1 (USDC), j=2 (USDT), swap_type=1, pool_type=1, n_coins=3
            amountIn: swapAmount,
            amountOutMin: "1",
            pools: ["0x0000000000000000000000000000000000000000" as Address],
            recipient: SAUCE,
          },
        ]),
      );
      const usdtAfter = await balanceOf(USDT, SAUCE);
      assert.ok(usdtAfter > 0n, "Sauce should receive USDT");

      const receipt = await getReceipt(txHash);
      // USDC transferred from Sauce to router
      const usdcOut = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { from: SAUCE },
      });
      assert.ok(usdcOut.length >= 1, "Should emit USDC Transfer from Sauce");
    });
  });

  describe("DODO Swaps", () => {
    it("dodoSwap: swaps WETH → USDC via DODO V1 Proxy", async () => {
      if (!isMainnet) return;
      const amountIn = "100000000000000000"; // 0.1 ETH (use small amount for DODO liquidity)
      const usdcBefore = await balanceOf(USDC, SAUCE);
      const txHash = cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          { type: "approve", chainId, token: WETH, spender: DODO_APPROVE, amount: amountIn },
          {
            type: "dodoSwap",
            chainId,
            proxy: DODO_PROXY,
            fromToken: WETH,
            toToken: USDC,
            amountIn,
            amountOutMin: "1",
            dodoPairs: [DODO_PAIR_WETH_USDC],
            directions: 0, // sellBase at pool 0
            deadline: DEADLINE,
            version: "v1", // configured pair is a DODO V1 Classical pool
          },
        ]),
        amountIn,
      );
      // DODO proxy has no recipient param — output lands in msg.sender (Sauce).
      const usdcAfter = await balanceOf(USDC, SAUCE);
      assert.ok(usdcAfter > usdcBefore, "Sauce should receive USDC from DODO swap");

      const receipt = await getReceipt(txHash);
      const usdcIn = findEvents(receipt, transferEventAbi, "Transfer", {
        address: USDC,
        args: { to: SAUCE },
      });
      assert.ok(usdcIn.length >= 1, "Should emit USDC Transfer to Sauce");
    });
  });

  describe("Ambient (CrocSwap) Swaps", () => {
    it("ambientSwap: swaps WETH → USDC via CrocSwapDex userCmd", async () => {
      if (!isMainnet) return;
      // Ambient uses base/quote ordering: base < quote numerically
      // WETH (0xC02a..) > USDC (0xA0b8..) so: base=USDC, quote=WETH
      // isBuy=false means paying quote (WETH), receiving base (USDC)
      // inBaseQty=false means qty is denominated in quote (WETH)
      const amountIn = "100000000000000000"; // 0.1 ETH
      const usdcBefore = await balanceOf(USDC, SAUCE);
      cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          { type: "approve", chainId, token: WETH, spender: AMBIENT_DEX, amount: amountIn },
          {
            type: "ambientSwap",
            chainId,
            dex: AMBIENT_DEX,
            base: USDC, // lower address
            quote: WETH, // higher address
            poolIdx: 420,
            isBuy: false, // paying quote (WETH)
            inBaseQty: false, // qty in quote (WETH)
            amountIn,
            tip: 0,
            limitPrice: "65537", // minPrice Q64.64 — must be > 0 for sells
            minOut: "1",
            reserveFlags: 0,
          },
        ]),
        amountIn,
      );
      const usdcAfter = await balanceOf(USDC, SAUCE);
      assert.ok(usdcAfter > usdcBefore, "Sauce should receive USDC from Ambient swap");
    });
  });

  describe("Fluid DEX T1 Swaps", () => {
    it("fluidDexT1Swap: sells wstETH for ETH through the Fluid DEX T1 wstETH/ETH pool", async () => {
      // token0 is wstETH, token1 native ETH. The action attaches no value, so it sells the ERC-20
      // side: the pool pulls wstETH by allowance and pays ETH to the recipient.
      const amountIn = 100000000000000000n; // 0.1 wstETH
      setErc20Balance(WSTETH, SAUCE, 0n, amountIn); // OpenZeppelin ERC20: balances at slot 0
      const before = await ethBalance(RECEIVER);
      cookSend(
        actionsToSauce([
          {
            type: "approve",
            chainId,
            token: WSTETH,
            spender: FLUID_DEX_T1_WSTETH_ETH,
            amount: `${amountIn}`,
          },
          {
            type: "fluidDexT1Swap",
            chainId,
            pool: FLUID_DEX_T1_WSTETH_ETH,
            swap0to1: true,
            amountIn: `${amountIn}`,
            amountOutMin: "1",
            recipient: RECEIVER,
          },
        ]),
      );
      assert.equal(await balanceOf(WSTETH, SAUCE), 0n);
      // wstETH is worth more than ETH, so 0.1 of it buys more than 0.1 ETH.
      assert.ok(
        (await ethBalance(RECEIVER)) - before > amountIn,
        "the recipient should receive ETH",
      );
    });
  });

  describe("Clipper Swaps", () => {
    it.skip("clipperSwap: prices only through a quote signed by Clipper's off-chain signer, which no captured state can hold (the exchange's own getSellQuote reverts at the pinned block)", () => {});
  });

  describe("Integral Swaps", () => {
    it.skip("integralSwap: at the pinned block Integral's TwapDelay rejects a WETH/USDC sell (OS13, with or without a keeper fee) and its relayer rejects the quote (TR5A)", () => {});
  });

  describe("Carbon (Bancor) Swaps", () => {
    it("carbonSwap: sells USDC for USDT against a Carbon strategy, and chains the output", async () => {
      await fundSauceUSDC("1000000000000000000");
      const before = await balanceOf(USDT, RECEIVER);
      cookSend(
        actionsToSauce([
          { type: "approve", chainId, token: USDC, spender: CARBON_CONTROLLER, amount: "1000000" },
          {
            type: "carbonSwap",
            chainId,
            controller: CARBON_CONTROLLER,
            sourceToken: USDC,
            targetToken: USDT,
            // A USDC/USDT strategy holding USDT at the pinned block.
            tradeActions: [{ strategyId: CARBON_USDC_USDT_STRATEGY, amount: "1000000" }],
            amountIn: "1000000",
            amountOutMin: "1",
            deadline: DEADLINE,
            saveOutputAs: "usdt",
          },
          { type: "transfer", chainId, token: USDT, to: RECEIVER, amountRef: "usdt" },
        ]),
      );
      const received = (await balanceOf(USDT, RECEIVER)) - before;
      assert.ok(received > 990_000n, `1 USDC should buy ~0.99 USDT, got ${received}`);
      assert.equal(
        await balanceOf(USDT, SAUCE),
        0n,
        "the transfer should spend exactly the output",
      );
    });
  });

  describe("Maverick V2 Swaps", () => {
    it("maverickSwap: swaps USDC → USDT through a Maverick V2 pool", async () => {
      await fundSauceUSDC("1000000000000000000");
      const before = await balanceOf(USDT, RECEIVER);
      cookSend(
        actionsToSauce([
          {
            type: "approve",
            chainId,
            token: USDC,
            spender: MAVERICK_V2_ROUTER,
            amount: "10000000",
          },
          {
            type: "maverickSwap",
            chainId,
            router: MAVERICK_V2_ROUTER,
            pool: MAVERICK_USDC_USDT_POOL,
            tokenAIn: true, // token A is USDC
            amountIn: "10000000",
            amountOutMin: "9900000",
            recipient: RECEIVER,
          },
        ]),
      );
      assert.ok((await balanceOf(USDT, RECEIVER)) - before >= 9_900_000n);
    });

    it("maverickMultiHopSwap: swaps along a packed pool/direction path, and chains the output", async () => {
      await fundSauceUSDC("1000000000000000000");
      const spender = "0x000000000000000000000000000000000000bEEF" as Address;
      cookSend(
        actionsToSauce([
          {
            type: "approve",
            chainId,
            token: USDC,
            spender: MAVERICK_V2_ROUTER,
            amount: "10000000",
          },
          {
            type: "maverickMultiHopSwap",
            chainId,
            router: MAVERICK_V2_ROUTER,
            // Per hop: the pool's 20 bytes, then one byte for tokenAIn.
            path: `${MAVERICK_USDC_USDT_POOL}01` as Hex,
            amountIn: "10000000",
            amountOutMin: "9900000",
            recipient: RECEIVER,
            saveOutputAs: "usdt",
          },
          { type: "approve", chainId, token: USDT, spender, amountRef: "usdt" },
        ]),
      );
      const out = await balanceOf(USDT, SAUCE);
      assert.ok(out >= 9_900_000n, "a chained output lands in the Pot");
      assert.equal(await allowance(USDT, SAUCE, spender), out);
    });
  });

  describe("Fraxswap Swaps", () => {
    it("fraxswapSwap: swaps WETH → FRAX through Fraxswap's FRAX/WETH pair", async () => {
      const amountIn = "10000000000000000"; // 0.01 ETH
      cookSend(
        actionsToSauce([
          { type: "wrapETH", chainId, weth: WETH, amount: amountIn },
          { type: "approve", chainId, token: WETH, spender: FRAXSWAP_ROUTER, amount: amountIn },
          {
            type: "fraxswapSwap",
            chainId,
            router: FRAXSWAP_ROUTER,
            amountIn,
            amountOutMin: "1",
            path: [WETH, FRAX],
            recipient: RECEIVER,
            deadline: DEADLINE,
          },
        ]),
        amountIn,
      );
      // ~$27 of FRAX at the pinned block's price.
      assert.ok((await balanceOf(FRAX, RECEIVER)) > 10n ** 19n);
    });
  });

  describe("BalancerV3 Swaps", () => {
    it.skip("balancerV3Swap: the V3 Router pulls its input through Permit2, and no action grants the Pot a Permit2 allowance", () => {});
  });

  describe("Fluid DEX Lite Swaps", () => {
    it.skip("fluidDexLiteSwap: a DEX Lite pool is addressed by a DexKey only its resolver lists, and no resolver is known here; the singleton's events are bit-packed and it had no swaps in the 10,000 blocks before the pinned block", () => {});
  });
});
