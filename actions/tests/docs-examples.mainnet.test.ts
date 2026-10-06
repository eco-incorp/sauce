/**
 * The manual's SauceScript examples that swap or read pools — `docs/examples/router-route.sauce.ts`,
 * `router-swap.sauce.ts` and `venue-where-deployed.sauce.ts` — EXECUTED on mainnet state captured at
 * the pinned blocks (`mainnet.ts`), through the released engine, Kitchen, Pot and Router. No RPC is
 * reached.
 *
 * `docs:check` compiles each through its runner and holds the manual's quotes to the files; this
 * runs what those runners build — the same bytes, imported from them — and holds every output to
 * the venues' own contracts: Uniswap's quoter and V2 router, the 3pool's own `exchange` (its
 * `get_dy` can overstate it by one unit), the Balancer Vault's `queryBatchSwap`, and each pool
 * address to the one its deployer CREATE2s. `docs/examples/executed.json` names this suite as the
 * one that runs them, and `docs:check` fails an example no suite runs.
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  getCreate2Address,
  hexToBytes,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

import { nodeIo, runCli } from "../../sdk/dist/cli/run.js";
import { canonicalChains, destinationPot, routes } from "../../sdk/dist/index.js";
import { POT_SALT } from "../../sdk/test/evm/gated-engine.js";
import { legs, program, routeProgram, type Leg } from "../../docs/examples/router-route.js";
import { minOut as swapFloor, payload as swapPayload } from "../../docs/examples/router-swap.js";
import { onBase, onOptimism } from "../../docs/examples/registry-names.js";
import { built as firstIntent } from "../../docs/examples/first-intent.js";
import { v12KitchenAddress } from "../../sdk/dist/deployments/v12-addresses.js";
import { OWNER_KEY, REPO_ROOT, skipReason, startAnvil, type Anvil } from "./anvil.js";
import { balanceOf, setBalance, type BalanceSlot } from "./swap-venues.js";

const ONE_ETH = 10n ** 18n;
/** Each suite runs the released engine, so it skips without it — and fails without it under CI. */
const SUITE = { skip: skipReason(), timeout: 600_000 };

const abi = {
  quoterV2: parseAbi([
    "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160, uint32, uint256)",
  ]),
  curve: parseAbi([
    "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
    "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy)",
    "function approve(address spender, uint256 amount)",
  ]),
  v2Router: parseAbi([
    "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
  ]),
  vault: parseAbi([
    "function queryBatchSwap(uint8 kind, (bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, (address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds) returns (int256[])",
  ]),
  factory: parseAbi(["function getPool(address, address, uint24) view returns (address)"]),
};

/** A universal (32-byte) address the SDK decodes as the 20-byte EVM address it holds. */
const denormalize = (address: Hex) => getAddress(`0x${address.slice(-40)}`);

/** `cook`'s eth_call returns `main`'s bytes as they are: here one word. */
const word = (data: Hex): bigint => decodeAbiParameters([{ type: "uint256" }], data)[0];

/** The pool a Uniswap V3-style deployer CREATE2s for `a`/`b` at `fee`. */
function v3Pool(deployer: Address, initCodeHash: Hex, a: Address, b: Address, fee: number) {
  const [token0, token1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return getCreate2Address({
    from: deployer,
    salt: keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint24" }],
        [token0, token1, fee],
      ),
    ),
    bytecodeHash: initCodeHash,
  });
}

describe("router-route and router-swap on Ethereum state", SUITE, () => {
  const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
  const BALANCE: Record<string, BalanceSlot> = {
    [WETH]: { slot: 3n },
    [USDC]: { slot: 9n },
    [USDT]: { slot: 2n },
  };
  const UNIV3_USDC_WETH_500 = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
  const CURVE_3POOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7";
  /** Uniswap V2's WETH/USDT pair (WETH is token0), and its USDC/WETH pair (USDC is token0). */
  const UNIV2_WETH_USDT = "0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852";
  const UNIV2_USDC_WETH = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
  const BALANCER_V2_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  /** Balancer V2's 50/50 USDC/WETH weighted pool. */
  const BALANCER_USDC_WETH_ID =
    "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019" as Hex;
  /** Uniswap's own QuoterV2 and V2 Router02: the quotes the route is held to. */
  const UNISWAP_V3_QUOTER = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
  const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

  const leg = (
    fields: Partial<Leg> & Pick<Leg, "venue" | "pool" | "tokenIn" | "tokenOut">,
  ): Leg => ({
    i: 0n,
    j: 0n,
    poolId: 0n,
    ...fields,
  });
  /** Every venue the program has, in one route: no two legs touch the same pool. */
  const fourVenues: readonly Leg[] = [
    leg({ venue: 1n, pool: UNIV3_USDC_WETH_500, tokenIn: WETH, tokenOut: USDC }),
    leg({ venue: 3n, pool: CURVE_3POOL, tokenIn: USDC, tokenOut: USDT, i: 1n, j: 2n }),
    leg({ venue: 0n, pool: UNIV2_WETH_USDT, tokenIn: USDT, tokenOut: WETH }),
    leg({
      venue: 4n,
      pool: BALANCER_V2_VAULT,
      tokenIn: WETH,
      tokenOut: USDC,
      poolId: BigInt(BALANCER_USDC_WETH_ID),
    }),
  ];

  let env: Anvil;
  let snapshot: Hex;

  before(async () => {
    env = await startAnvil({ mainnet: "docs-examples" });
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

  const fund = (token: Address, amount: bigint) =>
    setBalance(env, token, BALANCE[token]!, env.pot, amount);

  /** What `amountIn` buys at one leg, quoted by the venue's own contracts, before anything moves. */
  async function quote(at: Leg, amountIn: bigint): Promise<bigint> {
    const client = env.publicClient;
    switch (at.venue) {
      case 1n: {
        const { result } = await client.simulateContract({
          address: UNISWAP_V3_QUOTER,
          abi: abi.quoterV2,
          functionName: "quoteExactInputSingle",
          args: [
            {
              tokenIn: at.tokenIn,
              tokenOut: at.tokenOut,
              amountIn,
              fee: 500,
              sqrtPriceLimitX96: 0n,
            },
          ],
        });
        return result[0];
      }
      case 3n: {
        // The 3pool's `get_dy` takes its fee before converting to the coin's decimals and
        // `exchange` after, so `get_dy` can quote 1 unit more than `exchange` pays. The quote is
        // the pool's own `exchange`, sent from the test account and undone.
        const quoted = await client.readContract({
          address: at.pool,
          abi: abi.curve,
          functionName: "get_dy",
          args: [at.i, at.j, amountIn],
        });
        const trader = env.account.address;
        const undo = await env.testClient.snapshot();
        try {
          await setBalance(env, at.tokenIn, BALANCE[at.tokenIn]!, trader, amountIn);
          const before = await balanceOf(env, at.tokenOut, trader);
          for (const [address, functionName, args] of [
            [at.tokenIn, "approve", [at.pool, amountIn]],
            [at.pool, "exchange", [at.i, at.j, amountIn, 0n]],
          ] as const) {
            const receipt = await env.send({
              to: address,
              data: encodeFunctionData({ abi: abi.curve, functionName, args } as never),
            });
            assert.equal(receipt.status, "success", functionName);
          }
          const paid = (await balanceOf(env, at.tokenOut, trader)) - before;
          assert.ok(paid <= quoted && quoted - paid <= 1n, `get_dy ${quoted}, exchange ${paid}`);
          return paid;
        } finally {
          await env.testClient.revert({ id: undo });
        }
      }
      case 0n: {
        const amounts = await client.readContract({
          address: UNISWAP_V2_ROUTER,
          abi: abi.v2Router,
          functionName: "getAmountsOut",
          args: [amountIn, [at.tokenIn, at.tokenOut]],
        });
        return amounts[1]!;
      }
      case 4n: {
        const { result } = await client.simulateContract({
          address: at.pool,
          abi: abi.vault,
          functionName: "queryBatchSwap",
          args: [
            0, // GIVEN_IN
            [
              {
                poolId: `0x${at.poolId.toString(16).padStart(64, "0")}`,
                assetInIndex: 0n,
                assetOutIndex: 1n,
                amount: amountIn,
                userData: "0x",
              },
            ],
            [at.tokenIn, at.tokenOut],
            {
              sender: env.pot,
              fromInternalBalance: false,
              recipient: env.pot,
              toInternalBalance: false,
            },
          ],
        });
        return -result[1]!;
      }
      default:
        throw new Error(`no quote for venue ${at.venue}`);
    }
  }

  /** The route's legs quoted in turn, each on what the previous one delivers. */
  async function quoteRoute(route: readonly Leg[], amountIn: bigint): Promise<bigint> {
    let out = amountIn;
    for (const at of route) out = await quote(at, out);
    return out;
  }

  /** Cooks `cooked` with the Pot holding `funding` of the route's input: the receipt. */
  async function cook(route: readonly Leg[], funding: bigint, cooked: Hex) {
    await fund(route[0]!.tokenIn, funding);
    return env.cook(hexToBytes(cooked));
  }

  it("router-route.ts's route, 1 WETH through Uniswap V3 then Curve's 3pool, delivers what Uniswap's quoter and the 3pool's exchange pay", async () => {
    assert.deepEqual(
      legs.map((l) => [l.venue, getAddress(l.pool)]),
      [
        [1n, UNIV3_USDC_WETH_500],
        [3n, CURVE_3POOL],
      ],
    );
    const expected = await quoteRoute(legs, ONE_ETH);
    assert.ok(expected >= 2_500_000_000n, `below the runner's floor: ${expected}`);

    await fund(WETH, ONE_ETH);
    assert.equal(word(await env.returned(hexToBytes(program))), expected, "main's return");
    assert.equal((await env.cook(hexToBytes(program))).status, "success");
    assert.equal(await balanceOf(env, USDT, env.pot), expected);
    assert.equal(await balanceOf(env, WETH, env.pot), 0n, "the whole input was spent");
    assert.equal(await balanceOf(env, USDC, env.pot), 0n, "the middle leg spent all it received");
  });

  it("one route over all four venues, V3, Curve, V2 and Balancer V2, spends each leg's output in the next", async () => {
    const expected = await quoteRoute(fourVenues, ONE_ETH);
    const cooked = hexToBytes(routeProgram(fourVenues, ONE_ETH, 0n));
    await fund(WETH, ONE_ETH);
    assert.equal(word(await env.returned(cooked)), expected, "main's return");
    assert.equal((await env.cook(cooked)).status, "success");
    assert.equal(await balanceOf(env, USDC, env.pot), expected);
    for (const token of [WETH, USDT]) {
      assert.equal(await balanceOf(env, token, env.pot), 0n, `${token} left over`);
    }
  });

  it("a floor one above what the route delivers reverts the whole route; at exactly that, it runs", async () => {
    const expected = await quoteRoute(fourVenues, ONE_ETH);
    const tooHigh = routeProgram(fourVenues, ONE_ETH, expected + 1n);
    assert.equal((await cook(fourVenues, ONE_ETH, tooHigh)).status, "reverted");
    assert.equal(await balanceOf(env, WETH, env.pot), ONE_ETH, "nothing moved");
    assert.equal(await balanceOf(env, USDC, env.pot), 0n);

    const exact = routeProgram(fourVenues, ONE_ETH, expected);
    assert.equal((await env.cook(hexToBytes(exact))).status, "success");
    assert.equal(await balanceOf(env, USDC, env.pot), expected);
  });

  it("a leg whose venue is none of the four reverts the whole route, even one Balancer V2 could run", async () => {
    const balancer = fourVenues[3]!;
    const expected = await quote(balancer, ONE_ETH);
    await fund(WETH, ONE_ETH);
    for (const venue of [2n, 5n, 2n ** 256n - 1n]) {
      const unknown = routeProgram([{ ...balancer, venue }], ONE_ETH, 0n);
      assert.equal((await env.cook(hexToBytes(unknown))).status, "reverted", `venue ${venue}`);
      assert.equal(await balanceOf(env, WETH, env.pot), ONE_ETH, "nothing moved");
    }
    // The same leg as venue 4 is the Balancer V2 swap.
    const known = routeProgram([balancer], ONE_ETH, 0n);
    assert.equal((await env.cook(hexToBytes(known))).status, "success");
    assert.equal(await balanceOf(env, USDC, env.pot), expected);
  });

  /** router-swap.sauce.ts's two swaps, as legs to quote: Uniswap V2, then Curve's 3pool. */
  const swapLegs: readonly Leg[] = [
    leg({ venue: 0n, pool: UNIV2_USDC_WETH, tokenIn: WETH, tokenOut: USDC }),
    leg({ venue: 3n, pool: CURVE_3POOL, tokenIn: USDC, tokenOut: USDT, i: 1n, j: 2n }),
  ];
  const ROUTER_SWAP = resolve(REPO_ROOT, "docs/examples/router-swap.sauce.ts");
  /** router-swap's usage line, run as written from the Pot's owner, with `floor` as its argument. */
  const runSwap = (floor: bigint) =>
    sauce(
      usageLine(ROUTER_SWAP, "run").flatMap((word, i, words) => {
        if (word === "router-swap.sauce.ts") return [ROUTER_SWAP];
        // The replay is the endpoint, whichever the line names or leaves to the defaults.
        if (word === "--config" || words[i - 1] === "--config") return [];
        if (word === "--keystore") return ["--private-key"];
        if (word === "<keystore>") return [OWNER_KEY];
        if (word === "<minOut>") return [`${floor}`];
        if (word === "--args") {
          return ["--rpc-url", env.rpc, "--salt-hex", POT_SALT, "--json", "--args"];
        }
        return [word];
      }),
    );

  it("router-swap.ts's program sells every WETH the Pot holds on Uniswap V2 and keeps what the 3pool pays for the USDC", async () => {
    const expected = await quoteRoute(swapLegs, ONE_ETH);
    assert.ok(expected >= swapFloor, `below the runner's floor: ${expected}`);
    // USDC the Pot held before is not the USDC that returns: it stays.
    const held = 5_000_000n;
    await fund(WETH, ONE_ETH);
    await fund(USDC, held);
    assert.equal((await env.cook(hexToBytes(swapPayload))).status, "success");
    assert.equal(await balanceOf(env, USDT, env.pot), expected);
    assert.equal(await balanceOf(env, WETH, env.pot), 0n, "every WETH was sold");
    assert.equal(await balanceOf(env, USDC, env.pot), held, "every USDC that returned was spent");
  });

  it("router-swap's usage line: a floor one above what the 3pool pays reverts the whole transaction; at exactly that, it runs", async () => {
    const expected = await quoteRoute(swapLegs, ONE_ETH);
    await fund(WETH, ONE_ETH);
    const tooHigh = await runSwap(expected + 1n);
    assert.notEqual(tooHigh.code, 0, "the cook reverted");
    assert.equal(await balanceOf(env, WETH, env.pot), ONE_ETH, "nothing moved");
    const exact = await runSwap(expected);
    assert.equal(exact.code, 0, `${exact.stderr}\n${exact.stdout}`);
    assert.equal(await balanceOf(env, USDT, env.pot), expected);
  });
});

const VENUE_PROGRAM = readFileSync(
  resolve(REPO_ROOT, "docs/examples/venue-where-deployed.sauce.ts"),
  "utf8",
);
/** PancakeSwap V3's pool deployer and init code hash, and Uniswap V3's, on every chain they have. */
const PANCAKE_V3 = {
  deployer: "0x41ff9AA7e16B8B1a8a8dc4f0eFacd93D02d071c9",
  initCodeHash: "0x6ce8eb472fa82df5469c6ab6d485f17c3ad13c8cd7af59b3d4a8026c5ce0f7e2",
} as const;
const UNISWAP_V3 = {
  deployer: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  initCodeHash: "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54",
} as const;

/** The registry's names `venue-where-deployed.sauce.ts` asks about, on `slug`. */
function venueNames(slug: string) {
  const globals = routes.sourceGlobals(slug);
  const factory = (namespace: string) =>
    globals.protocols
      .find((p) => p.namespace === namespace)
      ?.contracts.find((c) => c.name === "Factory")?.address as Address | undefined;
  const token = (symbol: string) =>
    globals.tokens.find((t) => t.symbol === symbol)?.address as Address | undefined;
  return {
    pancake: factory("PancakeswapV3"),
    uniswap: factory("UniswapV3"),
    usdc: token("USDC"),
    weth: token("WETH"),
  };
}

/**
 * `venue-where-deployed.sauce.ts` compiled for `slug` and run on `env`, a replay of that chain: it
 * returns the USDC/WETH 0.05% pool of the venue it picked, which is the address that venue's
 * deployer CREATE2s for the pair, holds code, and is what the factory itself answers.
 */
async function assertVenuePool(
  env: Anvil,
  slug: string,
  bytecode: Uint8Array,
  venue: "pancake" | "uniswap",
) {
  const names = venueNames(slug);
  const factory = names[venue]!;
  assert.ok(names.usdc && names.weth, `${slug} has USDC and WETH`);
  if (venue === "uniswap") assert.equal(names.pancake, undefined, `${slug} has PancakeSwap V3`);
  const { deployer, initCodeHash } = venue === "pancake" ? PANCAKE_V3 : UNISWAP_V3;
  const expected = v3Pool(deployer, initCodeHash, names.usdc, names.weth, 500);

  const pool = getAddress(
    `0x${word(await env.returned(bytecode))
      .toString(16)
      .padStart(40, "0")}`,
  );
  assert.equal(pool, expected);
  assert.equal(
    await env.publicClient.readContract({
      address: factory,
      abi: abi.factory,
      functionName: "getPool",
      args: [names.usdc, names.weth, 500],
    }),
    expected,
  );
  assert.ok(((await env.publicClient.getCode({ address: expected })) ?? "0x").length > 2);
}

/** `sauce <argv>`, in process: its exit code and what it printed. */
async function sauce(argv: readonly string[]) {
  let stdout = "";
  let stderr = "";
  const code = await runCli([...argv], {
    ...nodeIo(),
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  });

  return { code, stdout, stderr };
}

/** The `sauce …` usage line in `file`'s header, its continuation lines joined, as words. */
function usageLine(file: string, command: string): string[] {
  const header = readFileSync(file, "utf8").split("\n");
  const at = header.findIndex((line) => line.startsWith(`//   sauce ${command} `));
  assert.ok(at >= 0, `${file} has a \`sauce ${command}\` usage line`);
  const words: string[] = [];
  for (let i = at; ; i++) {
    const line = header[i]!.replace(/^\/\/\s*/, "");
    words.push(...line.replace(/\\$/, "").trim().split(/\s+/));
    if (!line.trimEnd().endsWith("\\")) break;
  }

  return words.slice(1);
}

describe("venue-where-deployed and cross-chain-intent on Base state", SUITE, () => {
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const CROSS_CHAIN = resolve(REPO_ROOT, "docs/examples/cross-chain-intent.sauce.ts");
  const RECIPIENT = "0x000000000000000000000000000000000000c0DE";
  const HELD = 12_345_678n;
  /** A fixture: Ethereum's Kitchen fee, which the body's cook pays. */
  const ETHEREUM_FEE = 1_234n;

  let env: Anvil;
  let snapshot: Hex;

  before(async () => {
    env = await startAnvil({ mainnet: "docs-examples-base", chain: "base" });
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

  it("as registry-names.ts compiles it for Base, venue-where-deployed returns PancakeSwap V3's USDC/WETH 0.05% pool", async () => {
    await assertVenuePool(env, "base", onBase.compiled.bytecode[0]!, "pancake");
  });

  /** cross-chain-intent's usage line, run as written from the Pot's owner, with `minAmount`. */
  const run = (minAmount: bigint) =>
    sauce(
      usageLine(CROSS_CHAIN, "run").flatMap((word, i, words) => {
        if (word === "cross-chain-intent.sauce.ts") return [CROSS_CHAIN];
        // The replay is the endpoint, whichever the line names or leaves to the defaults.
        if (word === "--config" || words[i - 1] === "--config") return [];
        if (word === "<keystore>") return [OWNER_KEY];
        if (word === "--keystore") return ["--private-key"];
        if (word === "<unix seconds>" || word === "<unix") return ["2000000000"];
        if (word === "seconds>") return [];
        if (word === "<address>") return [env.account.address];
        if (word === "<recipient>") return [RECIPIENT];
        if (word === "<minAmount>") return [`${minAmount}`];
        if (word === "<refundTo>") return [env.account.address];
        if (word === "--args") {
          // Ethereum's Kitchen fee, which the line leaves the command to read on Ethereum: the
          // replay is Base alone.
          const fee = ["--intent-execution-fee", String(ETHEREUM_FEE)];
          return ["--rpc-url", env.rpc, "--salt-hex", POT_SALT, ...fee, "--json", "--args"];
        }
        return [word];
      }),
    );

  it("cross-chain-intent's usage line publishes an intent paying `recipient` on Ethereum exactly what the Pot held", async () => {
    await setBalance(env, USDC, { slot: 9n }, env.pot, HELD);
    const ran = await run(1_000_000n);
    assert.equal(ran.code, 0, `${ran.stderr}\n${ran.stdout}`);
    const { cook } = JSON.parse(ran.stdout) as { cook: { hash: Hex; status: string } };
    assert.equal(cook.status, "success");

    const receipt = await env.publicClient.getTransactionReceipt({ hash: cook.hash });
    const published = receipt.logs.flatMap((log) => {
      const found = routes.intentFromPublished(log, 8453n);
      return found === undefined ? [] : [{ ...found, portal: log.address }];
    });
    assert.equal(published.length, 1, "one intent published");
    const [{ intent, portal }] = published as [(typeof published)[number]];
    assert.equal(intent.destination, 1n, "to Ethereum");
    // The reward: everything the Pot held, in Base's USDC, paid into the intent's vault.
    assert.deepEqual(
      intent.reward.tokens.map((t) => [denormalize(t.token), t.amount]),
      [[getAddress(USDC), HELD]],
    );
    const vault = routes.predictIntentVault(intent, { portal });
    assert.equal(await balanceOf(env, USDC, vault), HELD);
    assert.equal(await balanceOf(env, USDC, env.pot), 0n);
    // Delivered: Ethereum's USDC, moved into Ethereum's shared Pot, whose cook runs the body with
    // the `recipient` given on the command line, paying Ethereum's Kitchen fee.
    const pot = getAddress(destinationPot("ethereum"));
    assert.deepEqual(
      intent.route.tokens.map((t) => [denormalize(t.token), t.amount]),
      [[getAddress(ETHEREUM_USDC), HELD]],
    );
    assert.equal(intent.route.nativeAmount, ETHEREUM_FEE);
    const [moved, cooked] = intent.route.calls;
    assert.deepEqual(
      [denormalize(moved!.target), moved!.data, moved!.value],
      [
        getAddress(ETHEREUM_USDC),
        encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [pot, HELD] }),
        0n,
      ],
    );
    assert.deepEqual([denormalize(cooked!.target), cooked!.value], [pot, ETHEREUM_FEE]);
    assert.ok(cooked!.data.toLowerCase().includes(RECIPIENT.slice(2).toLowerCase()));
  });

  it("first-intent.ts's cook publishes its intent from a Pot holding the reward, its hash read from the log", async () => {
    const reward = 1_010_000n;
    await setBalance(env, USDC, { slot: 9n }, env.pot, reward);
    const fee = await env.publicClient.readContract({
      address: getAddress(v12KitchenAddress()),
      abi: parseAbi(["function executionFee() view returns (uint256)"]),
      functionName: "executionFee",
    });
    const cook = firstIntent.cook(env.pot, fee);
    const receipt = await env.send({ to: cook.to, data: cook.data, value: cook.value });
    assert.equal(receipt.status, "success");
    const [published, ...more] = firstIntent.intents(receipt.logs);
    assert.equal(more.length, 0, "one intent published");
    assert.equal(published!.destination.slug, "ethereum");
    // The hash the Portal announced, which the intent rebuilt from its log hashes to.
    assert.equal(published!.intentHash, routes.hashIntent(published!.intent).intentHash);
    assert.deepEqual(
      published!.intent.reward.tokens.map((t) => [denormalize(t.token), t.amount]),
      [[getAddress(USDC), reward]],
    );
    const vault = routes.predictIntentVault(published!.intent, { portal: published!.portal });
    assert.equal(await balanceOf(env, USDC, vault), reward);
    assert.deepEqual(
      published!.intent.route.tokens.map((t) => [denormalize(t.token), t.amount]),
      [[getAddress(ETHEREUM_USDC), 1_000_000n]],
    );
  });

  it("below `minAmount` the whole transaction reverts and nothing is published", async () => {
    await setBalance(env, USDC, { slot: 9n }, env.pot, HELD);
    const ran = await run(HELD + 1n);
    assert.notEqual(ran.code, 0, "the cook reverted");
    assert.equal(await balanceOf(env, USDC, env.pot), HELD, "nothing moved");
  });
});

describe("venue-where-deployed on OP Mainnet state", SUITE, () => {
  let env: Anvil;

  before(async () => {
    env = await startAnvil({ mainnet: "docs-examples-optimism", chain: "optimism" });
  });
  after(async () => {
    await env?.stop();
  });

  it("as registry-names.ts compiles it for OP Mainnet, which has no PancakeSwap V3, it returns Uniswap V3's pool", async () => {
    await assertVenuePool(env, "optimism", onOptimism.compiled.bytecode[0]!, "uniswap");
  });
});

describe("venue-where-deployed on every EVM chain", SUITE, () => {
  // A chain with neither venue gets a program that reads nothing, so an empty anvil runs it as well
  // as that chain would; a chain with a venue but without USDC or WETH refuses the program, naming
  // the token, which only a compiled branch resolves.
  let env: Anvil;

  before(async () => {
    env = await startAnvil();
  });
  after(async () => {
    await env?.stop();
  });

  it("compiles for every EVM chain: the venue's lookup where it has one and both tokens, and a program returning 0 where it has no venue", async () => {
    const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
    const evm = canonicalChains.filter((chain) => chain.kind === "evm");
    let looksUp = 0;
    let returnsZero = 0;
    let refused = 0;
    for (const { slug } of evm) {
      const compile = () =>
        routes.compileSauceRoute(slug, VENUE_PROGRAM, { pot: env.pot, engine: env.engine }).compiled
          .bytecode[0]!;
      const names = venueNames(slug);
      const factory = names.pancake ?? names.uniswap;
      if (factory !== undefined && (names.usdc === undefined || names.weth === undefined)) {
        const missing = names.usdc === undefined ? "USDC" : "WETH";
        assert.throws(compile, new RegExp(`\`${missing}\` is not a token or protocol on ${slug}`));
        refused++;
        continue;
      }
      const bytecode = compile();
      if (factory !== undefined) {
        assert.ok(
          hex(bytecode).includes(factory.slice(2).toLowerCase()),
          `${slug} asks ${factory}`,
        );
        looksUp++;
      } else {
        assert.equal(word(await env.returned(bytecode)), 0n, slug);
        returnsZero++;
      }
    }
    assert.ok(
      looksUp >= 3 && returnsZero >= 1 && refused >= 1,
      `${looksUp} look a pool up, ${returnsZero} return 0, ${refused} refuse it`,
    );
  });
});
