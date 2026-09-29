/**
 * Every action type, EXECUTED against the deployed mainnet contracts it names, through the released
 * engine and a real Pot — on a local anvil holding Ethereum mainnet state captured at the pinned
 * block (`mainnet.ts`). No RPC is reached; the last test fails if any action type did not run.
 *
 * Each test funds the Pot (native ETH is preset; an ERC-20 is written into its balance slot, or
 * produced by an earlier action in the same program) and checks what the action changed on-chain.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeEventLog,
  encodeAbiParameters,
  keccak256,
  pad,
  parseAbi,
  parseEther,
  toHex,
  type Abi,
  type Address,
  type TransactionReceipt,
} from "viem";

import { compileProgram } from "../src/index.js";
import { ACTION_TYPES } from "../src/spec.js";
import type { Action, ActionType } from "../src/types.js";
import { skipReason, startAnvil, type Anvil } from "./anvil.js";
import { capturing, DEADLINE, PINNED_TIMESTAMP } from "./mainnet.js";

// ---- Ethereum mainnet, at the pinned block ----------------------------------------------------

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const FRAX = "0x853d955aCEf822Db058eb8505911ED77F175b99e";
const STETH = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
const WSTETH = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
const RETH = "0xae78736Cd615f374D3085123A210448E74Fc6393";
const EETH = "0x35fA164735182de50811E8e2E824cFb9B6118ac2";

const SWAP_ROUTER_02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const UNIVERSAL_ROUTER = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const CURVE_3POOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7";
const CURVE_ROUTER_NG = "0xF0d4c12A5768D806021F80a262B4d39d26C58b8D";
const BALANCER_V2_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
const BALANCER_V2_WETH_USDC = "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019";
const BALANCER_V3_ROUTER = "0xAE563E3f8219521950555F5962419C8919758Ea2";
/** A Balancer V3 USDC/WETH pool. */
const BALANCER_V3_USDC_WETH = "0x84f2195dc84d540a3ab92e659603d770014f0440";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const AMBIENT_DEX = "0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688";
const DODO_PROXY = "0xa356867fDCEa8e71AEaF87805808803806231FdC";
/** The contract DODO's proxy pulls through: allowances go here, not to the proxy. */
const DODO_APPROVE = "0xCB859eA579b28e02B87A1FDE08d087ab9dbE5149";
/** A DODO V1 Classical WETH/USDC pair, and a DODO V2 WETH/USDC pool (base WETH). */
const DODO_V1_WETH_USDC = "0x75c23271661d9d143DCb617222BC4BEc783eff34";
const DODO_V2_WETH_USDC = "0x8B2F062d112aE1ac6Ccc6C358cc40C9518c847Dc";
const MAVERICK_V2_ROUTER = "0x62e31802c6145A2D5E842EeD8efe01fC224422fA";
/** A Maverick V2 USDC/USDT pool; token A is USDC. */
const MAVERICK_USDC_USDT = "0x31373595F40Ea48a7aAb6CBCB0d377C6066E2dCA";
const CARBON_CONTROLLER = "0xC537e898CD774e2dCBa3B14Ea6f34C93d5eA45e1";
/** A Carbon USDC/USDT strategy holding USDT. */
const CARBON_USDC_USDT = "1020847100762815390390123822295304634823";
const FRAXSWAP_ROUTER = "0xC14d550632db8592D1243Edc8B95b0Ad06703867";
/** The Fluid DEX T1 wstETH/ETH pool; token0 is wstETH. */
const FLUID_WSTETH_ETH = "0x0B1a513ee24972DAEf112bC777a5610d4325C9e7";

const ACROSS_SPOKE_POOL = "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5";
const STARGATE_POOL_USDC = "0xc026395860Db2d07ee33e05fE50ed7bD583189C7";
/** Arbitrum's LayerZero endpoint id. */
const LZ_ARBITRUM = 30110;
const CCTP_TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
/** Arbitrum's CCTP domain. */
const CCTP_ARBITRUM = 3;
/** Hyperlane's USDC collateral warp route, and Base's Hyperlane domain. */
const HYPERLANE_USDC = "0xa9c9a8fb36ce3e5ffbac3757da7141262723541f";
const HYPERLANE_BASE = 8453;

const LIDO_WITHDRAWAL_QUEUE = "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1";
/** The live RocketDepositPool, from RocketStorage at the pinned block. */
const ROCKET_DEPOSIT_POOL = "0xCE15294273CFb9D9b628F4D61636623decDF4fdC";
const ETHERFI_LIQUIDITY_POOL = "0x308861A430be4cce5502d0A12724771Fc6DaF216";
const AAVE_V3_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
const AAVE_V3_AUSDC = "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c";
const COMET_USDC = "0xc3d688B66703497DAA19211EEdff47f25384cdc3";

/** The storage slot of each funded token's `balances` mapping. */
const BALANCE_SLOT: Record<string, bigint> = { [USDC]: 9n, [USDT]: 2n, [WSTETH]: 0n };

/** Receives outputs a test checks: an address nothing else touches. */
const RECEIVER = "0x000000000000000000000000000000000000c0DE";
const ONE_ETH = parseEther("1");
const USDC_100 = 100_000_000n;

const abi = {
  erc20: parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
  ]),
  permit2: parseAbi([
    "function allowance(address,address,address) view returns (uint160, uint48, uint48)",
  ]),
  aave: parseAbi([
    "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)",
  ]),
  stargate: parseAbi([
    "function quoteSend((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),bool) view returns ((uint256,uint256))",
  ]),
  warpRoute: parseAbi(["function quoteGasPayment(uint32) view returns (uint256)"]),
  across: parseAbi([
    "event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)",
  ]),
};

describe("every action, on mainnet state", { skip: skipReason(), timeout: 600_000 }, () => {
  let env: Anvil;
  let snapshot: `0x${string}`;
  const executed = new Set<ActionType>();

  before(async () => {
    env = await startAnvil({ mainnet: "actions" });
    await env.testClient.setBalance({ address: env.pot, value: parseEther("1000") });
  });
  after(async () => {
    await env?.stop();
  });
  beforeEach(async () => {
    snapshot = await env.testClient.snapshot();
  });
  afterEach(async () => {
    await env.testClient.revert({ id: snapshot });
  });

  // ---- helpers --------------------------------------------------------------------------------

  /** Compiles `actions` as one program on mainnet, cooks it in the Pot, and requires success. */
  async function run(actions: Action[]): Promise<TransactionReceipt> {
    const { bytecode } = compileProgram({ version: 1, chainId: 1, actions });
    const receipt = await env.cook(bytecode);
    assert.equal(receipt.status, "success", `reverted: ${actions.map((a) => a.type).join(", ")}`);
    for (const action of actions) executed.add(action.type);

    return receipt;
  }

  const read = (address: string, contract: Abi, functionName: string, args: unknown[] = []) =>
    env.publicClient.readContract({
      address: address as Address,
      abi: contract,
      functionName,
      args,
    } as never) as Promise<unknown>;
  const balance = async (token: string, owner: string) =>
    (await read(token, abi.erc20, "balanceOf", [owner])) as bigint;
  const allowance = async (token: string, owner: string, spender: string) =>
    (await read(token, abi.erc20, "allowance", [owner, spender])) as bigint;
  const ether = (owner: string) => env.publicClient.getBalance({ address: owner as Address });

  /** Writes `amount` into the Pot's balance of `token`. */
  async function fund(token: string, amount: bigint): Promise<void> {
    const slot = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [env.pot, BALANCE_SLOT[token]!],
      ),
    );
    await env.testClient.setStorageAt({
      address: token as Address,
      index: slot,
      value: pad(toHex(amount)),
    });
  }

  /** Wraps `amount` of the Pot's ETH and approves `spender` for it — a swap's first two actions. */
  const wrapAndApprove = (amount: bigint, spender: string): Action[] => [
    { type: "wrapETH", amount: `${amount}`, weth: WETH },
    { type: "approve", token: WETH, spender: spender as Address },
  ];

  it("a replayed suite cannot reach the network", async () => {
    if (capturing) return; // capture forks through the RPC by design
    await assert.rejects(fetch("https://example.com"), /network access to example\.com/);
  });

  // ---- tokens and wrapping ------------------------------------------------------------------

  describe("tokens", () => {
    it("wrapETH and unwrapETH round-trip the Pot's ETH", async () => {
      const before = await ether(env.pot);
      await run([{ type: "wrapETH", amount: `${ONE_ETH}`, weth: WETH }]);
      assert.equal(await balance(WETH, env.pot), ONE_ETH);
      await run([{ type: "unwrapETH", amount: `${ONE_ETH}`, weth: WETH }]);
      assert.equal(await balance(WETH, env.pot), 0n);
      assert.equal(await ether(env.pot), before);
    });

    it("transfer and approve move USDT, which returns nothing from either", async () => {
      await fund(USDT, USDC_100);
      await run([
        { type: "approve", amount: "5000000", token: USDT, spender: RECEIVER },
        { type: "transfer", amount: "7000000", token: USDT, recipient: RECEIVER },
      ]);
      assert.equal(await allowance(USDT, env.pot, RECEIVER), 5_000_000n);
      assert.equal(await balance(USDT, RECEIVER), 7_000_000n);
    });

    it("permit2Approve grants a Permit2 allowance with its expiration", async () => {
      await run([
        {
          type: "permit2Approve",
          amount: "123",
          permit2: PERMIT2,
          token: USDC,
          spender: RECEIVER,
          expiration: DEADLINE,
        },
      ]);
      const [amount, expiration] = (await read(PERMIT2, abi.permit2, "allowance", [
        env.pot,
        USDC,
        RECEIVER,
      ])) as [bigint, number];
      assert.equal(amount, 123n);
      assert.equal(expiration, DEADLINE);
    });
  });

  // ---- swaps --------------------------------------------------------------------------------

  describe("swaps", () => {
    it("uniswapV3ExactInput sells WETH for USDC, paid to the recipient", async () => {
      await run([
        ...wrapAndApprove(ONE_ETH, SWAP_ROUTER_02),
        {
          type: "uniswapV3ExactInput",
          router: SWAP_ROUTER_02,
          tokenIn: WETH,
          tokenOut: USDC,
          fee: 500,
          amountOutMin: "1000000000",
          recipient: RECEIVER,
        },
      ]);
      assert.ok((await balance(USDC, RECEIVER)) > 1_000_000_000n);
    });

    it("uniswapV3ExactInputMultiHop sells along a packed path", async () => {
      await run([
        ...wrapAndApprove(ONE_ETH, SWAP_ROUTER_02),
        {
          type: "uniswapV3ExactInputMultiHop",
          router: SWAP_ROUTER_02,
          // WETH -0.05%-> USDC -0.01%-> USDT
          path: `${WETH}0001f4${USDC.slice(2)}000064${USDT.slice(2)}` as `0x${string}`,
          amountOutMin: "1000000000",
          recipient: RECEIVER,
        },
      ]);
      assert.ok((await balance(USDT, RECEIVER)) > 1_000_000_000n);
    });

    const V4_USDC_USDT = {
      currency0: USDC,
      currency1: USDT,
      fee: 10,
      tickSpacing: 1,
      hooks: "0x0000000000000000000000000000000000000000",
    } as const;

    it("uniswapV4ExactInput swaps USDC for USDT, and the saved output pays for a transfer", async () => {
      await fund(USDC, USDC_100);
      await run([
        {
          type: "uniswapV4ExactInput",
          amount: "10000000",
          router: UNIVERSAL_ROUTER,
          poolKey: V4_USDC_USDT,
          zeroForOne: true,
          amountOutMin: "9900000",
          recipient: RECEIVER,
          saveOutputAs: "usdt",
        },
        { type: "transfer", token: USDT, recipient: RECEIVER, amountRef: "usdt" },
      ]);
      assert.ok((await balance(USDT, RECEIVER)) >= 9_900_000n);
      assert.equal(await balance(USDT, env.pot), 0n, "the transfer spends exactly the output");
    });

    it("uniswapV4ExactInputMultiHop swaps the Pot's whole balance, read by a balanceOf", async () => {
      await fund(USDC, USDC_100);
      await run([
        { type: "balanceOf", token: USDC },
        {
          type: "uniswapV4ExactInputMultiHop",
          router: UNIVERSAL_ROUTER,
          currencyIn: USDC,
          path: [
            { intermediateCurrency: USDT, fee: 10, tickSpacing: 1, hooks: V4_USDC_USDT.hooks },
          ],
          amountOutMin: "99000000",
          recipient: "self",
        },
      ]);
      assert.equal(await balance(USDC, env.pot), 0n);
      assert.ok((await balance(USDT, env.pot)) >= 99_000_000n);
    });

    it("curveSwap sells USDC for USDT in 3pool, and forwards the delta to the recipient", async () => {
      await fund(USDC, USDC_100);
      await run([
        { type: "approve", amount: `${USDC_100}`, token: USDC, spender: CURVE_3POOL },
        {
          type: "curveSwap",
          pool: CURVE_3POOL,
          tokenOut: USDT,
          i: 1,
          j: 2,
          amountOutMin: "99000000",
          recipient: RECEIVER,
        },
      ]);
      assert.ok((await balance(USDT, RECEIVER)) >= 99_000_000n);
      assert.equal(await balance(USDT, env.pot), 0n);
    });

    it("curveRouterNGSwap routes USDC to USDT through 3pool", async () => {
      await fund(USDC, USDC_100);
      await run([
        { type: "approve", amount: `${USDC_100}`, token: USDC, spender: CURVE_ROUTER_NG },
        {
          type: "curveRouterNGSwap",
          router: CURVE_ROUTER_NG,
          route: [USDC, CURVE_3POOL, USDT],
          // i=1 (USDC), j=2 (USDT), swap_type=1 (exchange), pool_type=1 (stable), n_coins=3
          swapParams: [[1, 2, 1, 1, 3]],
          pools: [],
          amountOutMin: "99000000",
          recipient: RECEIVER,
        },
      ]);
      assert.ok((await balance(USDT, RECEIVER)) >= 99_000_000n);
    });

    it("balancerV2Swap sells WETH for USDC through one pool", async () => {
      await run([
        ...wrapAndApprove(ONE_ETH, BALANCER_V2_VAULT),
        {
          type: "balancerV2Swap",
          vault: BALANCER_V2_VAULT,
          poolId: BALANCER_V2_WETH_USDC,
          tokenIn: WETH,
          tokenOut: USDC,
          amountOutMin: "1",
          recipient: RECEIVER,
          deadline: DEADLINE,
        },
      ]);
      assert.ok((await balance(USDC, RECEIVER)) > 0n);
    });

    it("balancerV2BatchSwap's output is its balance delta, spent by the next action", async () => {
      await run([
        ...wrapAndApprove(ONE_ETH, BALANCER_V2_VAULT),
        {
          type: "balancerV2BatchSwap",
          vault: BALANCER_V2_VAULT,
          steps: [
            {
              poolId: BALANCER_V2_WETH_USDC,
              assetInIndex: 0,
              assetOutIndex: 1,
              amount: `${ONE_ETH}`,
            },
          ],
          assets: [WETH, USDC],
          amountOutMin: "1",
          recipient: "self",
          deadline: DEADLINE,
        },
        { type: "transfer", token: USDC, recipient: RECEIVER },
      ]);
      assert.ok((await balance(USDC, RECEIVER)) > 0n);
      assert.equal(await balance(USDC, env.pot), 0n);
    });

    it("balancerV3Swap sells USDC for WETH, pulled through a Permit2 allowance", async () => {
      await fund(USDC, USDC_100);
      await run([
        { type: "approve", amount: `${USDC_100}`, token: USDC, spender: PERMIT2 },
        {
          type: "permit2Approve",
          permit2: PERMIT2,
          token: USDC,
          spender: BALANCER_V3_ROUTER,
          expiration: DEADLINE,
        },
        {
          type: "balancerV3Swap",
          router: BALANCER_V3_ROUTER,
          pool: BALANCER_V3_USDC_WETH,
          tokenIn: USDC,
          tokenOut: WETH,
          amountOutMin: "1",
          deadline: DEADLINE,
          wethIsEth: false,
        },
        { type: "transfer", token: WETH, recipient: RECEIVER },
      ]);
      assert.equal(await balance(USDC, env.pot), 0n);
      assert.ok((await balance(WETH, RECEIVER)) > 0n);
      assert.equal(await balance(WETH, env.pot), 0n, "the transfer spends exactly the output");
    });

    it("uniswapV2Swap sells WETH for USDC, and its delta output pays an approval", async () => {
      await run([
        ...wrapAndApprove(ONE_ETH, UNISWAP_V2_ROUTER),
        {
          type: "uniswapV2Swap",
          router: UNISWAP_V2_ROUTER,
          path: [WETH, USDC],
          amountOutMin: "1",
          recipient: RECEIVER,
          deadline: DEADLINE,
        },
        { type: "approve", token: USDC, spender: RECEIVER },
      ]);
      const received = await balance(USDC, env.pot);
      assert.ok(received > 1_000_000_000n, "a spent output is delivered to the Pot");
      assert.equal(await allowance(USDC, env.pot, RECEIVER), received);
    });

    it("ambientSwap sells WETH for USDC", async () => {
      const amount = ONE_ETH / 10n;
      await run([
        ...wrapAndApprove(amount, AMBIENT_DEX),
        {
          type: "ambientSwap",
          dex: AMBIENT_DEX,
          base: USDC, // the numerically lower token
          quote: WETH,
          poolIdx: 420,
          isBuy: false, // pays quote (WETH), receives base (USDC)
          inBaseQty: false,
          tip: 0,
          limitPrice: "65537", // the lowest price a sell accepts, Q64.64
          amountOutMin: "1",
          reserveFlags: 0,
        },
      ]);
      assert.ok((await balance(USDC, env.pot)) > 0n);
    });

    it("dodoSwap sells WETH for USDC through a V1 pair and a V2 pool", async () => {
      const dodo = (version: "v1" | "v2", pair: string): Action => ({
        type: "dodoSwap",
        proxy: DODO_PROXY,
        fromToken: WETH,
        toToken: USDC,
        pairs: [pair as Address],
        directions: 0, // sells base (WETH)
        amountOutMin: "1",
        deadline: DEADLINE,
        version,
      });
      const amount = ONE_ETH / 100n;
      await run([...wrapAndApprove(amount, DODO_APPROVE), dodo("v1", DODO_V1_WETH_USDC)]);
      const afterV1 = await balance(USDC, env.pot);
      assert.ok(afterV1 > 0n);
      await run([...wrapAndApprove(amount, DODO_APPROVE), dodo("v2", DODO_V2_WETH_USDC)]);
      assert.ok((await balance(USDC, env.pot)) > afterV1);
    });

    it("maverickSwap sells USDC for USDT", async () => {
      await fund(USDC, USDC_100);
      await run([
        { type: "approve", amount: "10000000", token: USDC, spender: MAVERICK_V2_ROUTER },
        {
          type: "maverickSwap",
          router: MAVERICK_V2_ROUTER,
          pool: MAVERICK_USDC_USDT,
          tokenAIn: true,
          amountOutMin: "9900000",
          recipient: RECEIVER,
        },
      ]);
      assert.ok((await balance(USDT, RECEIVER)) >= 9_900_000n);
    });

    it("maverickMultiHopSwap sells along a packed path, and its output pays an approval", async () => {
      await fund(USDC, USDC_100);
      await run([
        { type: "approve", amount: "10000000", token: USDC, spender: MAVERICK_V2_ROUTER },
        {
          type: "maverickMultiHopSwap",
          router: MAVERICK_V2_ROUTER,
          // One hop: the pool's 20 bytes, then 01 — it sells token A.
          path: `${MAVERICK_USDC_USDT}01` as `0x${string}`,
          amountOutMin: "9900000",
          recipient: RECEIVER,
          saveOutputAs: "usdt",
        },
        { type: "approve", token: USDT, spender: RECEIVER, amountRef: "usdt" },
      ]);
      const out = await balance(USDT, env.pot);
      assert.ok(out >= 9_900_000n);
      assert.equal(await allowance(USDT, env.pot, RECEIVER), out);
    });

    it("carbonSwap trades USDC for USDT against a strategy, and its output pays a transfer", async () => {
      await fund(USDC, USDC_100);
      await run([
        { type: "approve", amount: "1000000", token: USDC, spender: CARBON_CONTROLLER },
        {
          type: "carbonSwap",
          controller: CARBON_CONTROLLER,
          sourceToken: USDC,
          targetToken: USDT,
          tradeActions: [{ strategyId: CARBON_USDC_USDT, amount: "1000000" }],
          amountOutMin: "990000",
          deadline: DEADLINE,
        },
        { type: "transfer", token: USDT, recipient: RECEIVER },
      ]);
      assert.ok((await balance(USDT, RECEIVER)) >= 990_000n);
      assert.equal(await balance(USDT, env.pot), 0n);
    });

    it("fraxswapSwap sells WETH for FRAX", async () => {
      const amount = ONE_ETH / 100n;
      await run([
        ...wrapAndApprove(amount, FRAXSWAP_ROUTER),
        {
          type: "fraxswapSwap",
          router: FRAXSWAP_ROUTER,
          path: [WETH, FRAX],
          amountOutMin: "1",
          recipient: RECEIVER,
          deadline: DEADLINE,
        },
      ]);
      assert.ok((await balance(FRAX, RECEIVER)) > 10n ** 19n);
    });

    it("fluidDexT1Swap sells wstETH for native ETH", async () => {
      const amount = ONE_ETH / 10n;
      await fund(WSTETH, amount);
      const before = await ether(RECEIVER);
      await run([
        { type: "approve", amount: `${amount}`, token: WSTETH, spender: FLUID_WSTETH_ETH },
        {
          type: "fluidDexT1Swap",
          pool: FLUID_WSTETH_ETH,
          swap0to1: true,
          amountOutMin: "1",
          recipient: RECEIVER,
        },
      ]);
      // wstETH is worth more than ETH.
      assert.ok((await ether(RECEIVER)) - before > amount);
    });
  });

  // ---- bridges ------------------------------------------------------------------------------

  describe("bridges", () => {
    it("acrossBridge deposits USDC for the destination, less the relayer fee", async () => {
      await fund(USDC, USDC_100);
      const receipt = await run([
        { type: "approve", amount: `${USDC_100}`, token: USDC, spender: ACROSS_SPOKE_POOL },
        {
          type: "acrossBridge",
          spokePool: ACROSS_SPOKE_POOL,
          token: USDC,
          destChainId: 10,
          recipient: RECEIVER,
          relayerFee: "250000",
          quoteTimestamp: PINNED_TIMESTAMP,
          fillDeadline: PINNED_TIMESTAMP + 3600,
          exclusivityDeadline: 0,
          message: "0x",
        },
      ]);
      const deposit = receipt.logs
        .filter((log) => log.address.toLowerCase() === ACROSS_SPOKE_POOL.toLowerCase())
        .map((log) => {
          try {
            return decodeEventLog({ abi: abi.across, ...log });
          } catch {
            return undefined;
          }
        })
        .find((event) => event?.eventName === "FundsDeposited");
      assert.ok(deposit, "no FundsDeposited event");
      assert.equal(deposit.args.inputAmount, USDC_100);
      assert.equal(deposit.args.outputAmount, USDC_100 - 250_000n);
      assert.equal(deposit.args.destinationChainId, 10n);
      assert.equal(deposit.args.depositor, pad(env.pot.toLowerCase() as Address));
      assert.equal(deposit.args.recipient, pad(RECEIVER.toLowerCase() as Address));
    });

    it("stargateBridge sends USDC to Arbitrum, paying exactly the fee the pool quotes", async () => {
      await fund(USDC, USDC_100);
      const amount = 10_000_000n;
      const [fee] = (await read(STARGATE_POOL_USDC, abi.stargate, "quoteSend", [
        [LZ_ARBITRUM, pad(RECEIVER.toLowerCase() as Address), amount, 9_900_000n, "0x", "0x", "0x"],
        false,
      ])) as readonly [bigint, bigint];
      assert.ok(fee > 0n);
      const eth = await ether(env.pot);
      await run([
        { type: "approve", amount: `${amount}`, token: USDC, spender: STARGATE_POOL_USDC },
        {
          type: "stargateBridge",
          pool: STARGATE_POOL_USDC,
          dstEid: LZ_ARBITRUM,
          recipient: RECEIVER,
          amountOutMin: "9900000",
        },
      ]);
      assert.equal(await balance(USDC, env.pot), USDC_100 - amount);
      assert.equal(eth - (await ether(env.pot)), fee);
    });

    it("cctpBridge burns USDC for minting on Arbitrum", async () => {
      await fund(USDC, USDC_100);
      const supply = (await read(USDC, abi.erc20, "totalSupply")) as bigint;
      await run([
        { type: "approve", amount: `${USDC_100}`, token: USDC, spender: CCTP_TOKEN_MESSENGER_V2 },
        {
          type: "cctpBridge",
          tokenMessenger: CCTP_TOKEN_MESSENGER_V2,
          token: USDC,
          destinationDomain: CCTP_ARBITRUM,
          recipient: RECEIVER,
        },
      ]);
      assert.equal(await balance(USDC, env.pot), 0n);
      assert.equal((await read(USDC, abi.erc20, "totalSupply")) as bigint, supply - USDC_100);
    });

    it("hyperlaneBridge transfers USDC to Base, paying exactly the gas the route quotes", async () => {
      await fund(USDC, USDC_100);
      const gas = (await read(HYPERLANE_USDC, abi.warpRoute, "quoteGasPayment", [
        HYPERLANE_BASE,
      ])) as bigint;
      assert.ok(gas > 0n);
      const eth = await ether(env.pot);
      await run([
        // The route pulls the amount plus its fee, so the approval covers more than the amount.
        { type: "approve", amount: `${USDC_100}`, token: USDC, spender: HYPERLANE_USDC },
        {
          type: "hyperlaneBridge",
          amount: "10000000",
          router: HYPERLANE_USDC,
          destinationDomain: HYPERLANE_BASE,
          recipient: RECEIVER,
        },
      ]);
      assert.ok(USDC_100 - (await balance(USDC, env.pot)) >= 10_000_000n);
      assert.equal(eth - (await ether(env.pot)), gas);
    });
  });

  // ---- staking ------------------------------------------------------------------------------

  describe("staking", () => {
    it("lidoStake's output is the stETH received, which a transfer spends", async () => {
      await run([
        { type: "lidoStake", amount: `${ONE_ETH}`, stETH: STETH },
        { type: "transfer", token: STETH, recipient: RECEIVER },
      ]);
      const received = await balance(STETH, RECEIVER);
      // stETH moves shares, so a balance can round a wei or two below the ETH staked.
      assert.ok(received >= ONE_ETH - 3n && received <= ONE_ETH, `${received}`);
    });

    it("wrapStETH wraps what Lido staked; its output is the wstETH minted", async () => {
      await run([
        { type: "lidoStake", amount: `${ONE_ETH}`, stETH: STETH },
        { type: "approve", token: STETH, spender: WSTETH },
        { type: "wrapStETH", wstETH: WSTETH },
        { type: "transfer", token: WSTETH, recipient: RECEIVER },
      ]);
      const wrapped = await balance(WSTETH, RECEIVER);
      assert.ok(wrapped > 0n && wrapped < ONE_ETH, "wstETH is worth more than stETH");
      assert.equal(await balance(WSTETH, env.pot), 0n);
    });

    it("unwrapStETH releases stETH; its output is what a transfer can spend", async () => {
      await fund(WSTETH, ONE_ETH);
      await run([
        { type: "unwrapStETH", amount: `${ONE_ETH}`, wstETH: WSTETH },
        { type: "transfer", token: STETH, recipient: RECEIVER },
      ]);
      assert.equal(await balance(WSTETH, env.pot), 0n);
      assert.ok((await balance(STETH, RECEIVER)) > ONE_ETH);
    });

    it("lidoUnstake requests a withdrawal; the Pot holds the withdrawal NFT", async () => {
      await run([
        { type: "lidoStake", amount: `${ONE_ETH}`, stETH: STETH, saveOutputAs: "steth" },
        { type: "approve", token: STETH, spender: LIDO_WITHDRAWAL_QUEUE, amountRef: "steth" },
        { type: "lidoUnstake", withdrawalQueue: LIDO_WITHDRAWAL_QUEUE, owner: "self" },
      ]);
      assert.equal(await balance(LIDO_WITHDRAWAL_QUEUE, env.pot), 1n);
      assert.ok((await balance(STETH, env.pot)) < 3n);
    });

    it("rocketPoolStake's output is the rETH received, and rocketPoolUnstake burns it for ETH", async () => {
      // rETH refuses to move in the block it was minted in, so the output is checked by an
      // approval, and the burn runs in the next program.
      await run([
        {
          type: "rocketPoolStake",
          amount: `${ONE_ETH}`,
          depositPool: ROCKET_DEPOSIT_POOL,
          rETH: RETH,
        },
        { type: "approve", token: RETH, spender: RECEIVER },
      ]);
      const reth = await balance(RETH, env.pot);
      assert.ok(reth > 0n && reth < ONE_ETH, "rETH is worth more than ETH");
      assert.equal(await allowance(RETH, env.pot, RECEIVER), reth);

      await run([
        { type: "balanceOf", token: RETH },
        { type: "rocketPoolUnstake", rETH: RETH, saveOutputAs: "eth" },
        { type: "wrapETH", weth: WETH, amountRef: "eth" },
      ]);
      assert.equal(await balance(RETH, env.pot), 0n);
      const eth = await balance(WETH, env.pot);
      assert.ok(eth > ONE_ETH - ONE_ETH / 100n && eth <= ONE_ETH, `${eth}`);
    });

    it("etherFiStake's output is the eETH received, which a transfer spends", async () => {
      await run([
        {
          type: "etherFiStake",
          amount: `${ONE_ETH}`,
          liquidityPool: ETHERFI_LIQUIDITY_POOL,
          eETH: EETH,
        },
        { type: "transfer", token: EETH, recipient: RECEIVER },
      ]);
      const received = await balance(EETH, RECEIVER);
      assert.ok(received >= ONE_ETH - 3n && received <= ONE_ETH, `${received}`);
    });
  });

  // ---- lending ------------------------------------------------------------------------------

  describe("lending", () => {
    const aave = async () =>
      (await read(AAVE_V3_POOL, abi.aave, "getUserAccountData", [env.pot])) as bigint[];

    it("aaveV3Supply and aaveV3Withdraw: the withdrawal's output is the amount withdrawn", async () => {
      await fund(USDC, USDC_100);
      await run([
        { type: "approve", amount: `${USDC_100}`, token: USDC, spender: AAVE_V3_POOL },
        { type: "aaveV3Supply", pool: AAVE_V3_POOL, token: USDC, onBehalfOf: "self" },
      ]);
      assert.equal(await balance(USDC, env.pot), 0n);
      // An aToken balance is a scaled amount read back through the liquidity index, rounded each
      // way, so it can land up to 2 units under the supply; which depends on the block's index.
      assert.ok((await balance(AAVE_V3_AUSDC, env.pot)) >= USDC_100 - 2n);

      await run([
        {
          type: "aaveV3Withdraw",
          amount: "40000000",
          pool: AAVE_V3_POOL,
          token: USDC,
          recipient: "self",
        },
        { type: "transfer", token: USDC, recipient: RECEIVER },
      ]);
      assert.equal(await balance(USDC, RECEIVER), 40_000_000n);
    });

    it("aaveV3Borrow borrows USDC against WETH collateral, and aaveV3Repay repays it", async () => {
      await run([
        ...wrapAndApprove(ONE_ETH, AAVE_V3_POOL),
        { type: "aaveV3Supply", pool: AAVE_V3_POOL, token: WETH, onBehalfOf: "self" },
        {
          type: "aaveV3Borrow",
          amount: "1000000",
          pool: AAVE_V3_POOL,
          token: USDC,
          onBehalfOf: "self",
        },
      ]);
      assert.equal(await balance(USDC, env.pot), 1_000_000n);
      const [, debt] = await aave();
      assert.ok(debt! > 0n, "the Pot owes the borrow");

      await fund(USDC, 2_000_000n);
      await run([
        { type: "approve", amount: "2000000", token: USDC, spender: AAVE_V3_POOL },
        {
          type: "aaveV3Repay",
          amount: "1000000",
          pool: AAVE_V3_POOL,
          token: USDC,
          onBehalfOf: "self",
        },
      ]);
      const [, remaining] = await aave();
      assert.ok(remaining! < debt! / 1000n, `repaid: ${remaining} of ${debt} left`);
    });

    it("compoundV3Supply and compoundV3Withdraw move USDC into and out of Comet", async () => {
      await fund(USDC, USDC_100);
      await run([
        { type: "approve", amount: `${USDC_100}`, token: USDC, spender: COMET_USDC },
        { type: "compoundV3Supply", comet: COMET_USDC, token: USDC },
      ]);
      // Comet stores a supply as a principal and reads it back through the supply index, rounding
      // down both ways, so a balance can land up to 2 units under the amount supplied (index > 1):
      // which of 0, 1 or 2 depends on the index at the block the supply lands in.
      assert.ok((await balance(COMET_USDC, env.pot)) >= USDC_100 - 2n);
      await run([
        { type: "compoundV3Withdraw", amount: "40000000", comet: COMET_USDC, token: USDC },
      ]);
      assert.equal(await balance(USDC, env.pot), 40_000_000n);
    });
  });

  // ---- sources ------------------------------------------------------------------------------

  describe("sources", () => {
    it("nativeBalance: the next action spends the Pot's whole ETH balance", async () => {
      const eth = await ether(env.pot);
      await run([{ type: "nativeBalance" }, { type: "wrapETH", weth: WETH }]);
      assert.equal(await ether(env.pot), 0n);
      assert.equal(await balance(WETH, env.pot), eth);
    });

    it("argument: one compiled program swaps whatever amount it is given", async () => {
      await fund(USDC, USDC_100);
      const compiled = compileProgram({
        version: 1,
        chainId: 1,
        actions: [
          { type: "argument", name: "amount" },
          { type: "approve", token: USDC, spender: CURVE_3POOL },
          {
            type: "curveSwap",
            pool: CURVE_3POOL,
            tokenOut: USDT,
            i: 1,
            j: 2,
            amountOutMin: "1",
            recipient: RECEIVER,
          },
        ],
      });
      for (const amount of [1_000_000n, 5_000_000n]) {
        const before = await balance(USDT, RECEIVER);
        const receipt = await env.cook(compiled.payload({ amount }));
        assert.equal(receipt.status, "success");
        assert.ok((await balance(USDT, RECEIVER)) - before >= (amount * 99n) / 100n);
      }
      assert.equal(await balance(USDC, env.pot), USDC_100 - 6_000_000n);
      executed.add("argument");
    });
  });

  it("every action type executed", () => {
    assert.deepEqual(
      ACTION_TYPES.filter((type) => !executed.has(type)),
      [],
      "an action type no test executed",
    );
  });
});
