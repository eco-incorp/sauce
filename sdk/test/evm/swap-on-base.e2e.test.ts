/**
 * The `sauce-intents` skill's swap-on-base intent, its body EXECUTED on Base: the file the skill
 * teaches, compiled from Ethereum as `sauce intent publish --chain ethereum` compiles it and
 * published by a cook on an Ethereum anvil (`intent-anvil.ts`), which reads the intent back from
 * the Portal's `IntentPublished`; the route it opens is then fulfilled on Base through eco-routes'
 * real Portal, whose Executor delivers the WETH into the shared intent Pot and cooks the body there
 * on the released gated engine (`gated-engine.ts`). Base's Portal is put at the registry's address
 * as `cli-anvil.ts#placePortal` puts it, so no address is overridden.
 *
 * Nothing is forked. The V3 pools are Uniswap's own `UniswapV3Factory` and `UniswapV3Pool`
 * bytecode from `@uniswap/v3-core`, created by a factory whose code and storage are then replayed
 * onto Base's factory address, so `UniswapV3.Factory.getPool` in the body finds them; liquidity is
 * minted through `fixtures/UniswapV3Minter.sol`. The V4 pools are Uniswap's own `PoolManager` from
 * `@uniswap/v4-core`, run at Base's PoolManager address (its one immutable, the address it checks
 * it runs at, set to that address), with liquidity added through v4-core's own
 * `PoolModifyLiquidityTest`, and read through `fixtures/StateView.sol` at Base's StateView address:
 * v4-periphery's `getSlot0`/`getLiquidity`, the two reads the body makes. The tokens are `MockERC20`
 * runtimes at Base's WETH and USDC addresses, so WETH is token0, as on Base.
 *
 * The pools, in USDC per WETH, the body's limit being 2,695: Uniswap V3 none at fee 100, 0.05% at
 * 2,700 and 0.3% at 2,705 with liquidity, 1% at a stale 2,750 with none; Uniswap V4's hookless keys
 * none at 0.3%, 0.01% at 2,740 with no liquidity, 0.05% at 2,702 with liquidity and a protocol fee
 * of 0.1% selling token0 (0.02% the other way), and 1% at 2,710 with liquidity, already past its own
 * limit (2,695 / 0.99). What the skill says the body does, and this holds it to: a missing pool, an
 * empty one and one past its limit are skipped; each pool is offered all the WETH still unsold and
 * stops at its own limit, the caller's moved by √(1 − fee) with the fee read from the pool (for V4,
 * this direction's protocol fee composed with the LP fee), so every unit sold pays at least the
 * limit with its fee paid, and the last one pays the limit; the USDC goes to `recipient` and the
 * unsold WETH to `refundTo`, leaving the shared Pot as it was, whatever it already held; `minOut`
 * and `minAvgPrice` revert the whole fulfilment. And what the fee adjustment is for, by taking it
 * out.
 *
 * The same Base runs the nested-intents guide's swap (`docs/examples/nested-swap.sauce.ts`), opened
 * on Ethereum with its `main` arguments: its body buys WETH on the 0.05% pool it looks up and pays
 * what it bought into the next intent's vault on this Portal, publishing it for Ethereum.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite, and a hard failure
 * without it in CI.
 */
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  concatHex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hexToBytes,
  http,
  keccak256,
  maxUint256,
  pad,
  parseAbi,
  parseEventLogs,
  stringToHex,
} from "viem";
import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../../src/deployments/pot.js";
import { v12Kitchen } from "../../src/evm/engine.js";
import { Base } from "../../src/index.js";
import { sqrtPriceX96FromPrice } from "../../src/price.js";
import { PortalABI } from "../../src/protocols/eco-routes/abis.js";
import {
  ecoRoutesExecutorOf,
  ecoRoutesPortal,
  ecoRoutesVaultImplementationOf,
} from "../../src/protocols/eco-routes/lookup.js";
import { EVM_ROUTE_PARAM, encodeRouteEvm, hashIntent } from "../../src/routes/encode.js";
import { encodeEntryArguments, type EntryValue } from "../../src/routes/entry.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import type { Intent } from "../../src/routes/types.js";
import { startIntentChain, type IntentChain } from "../intent-anvil.js";
import { gateAnchors, startGatedEngine } from "./gated-engine.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip there — see the " +
      '"Fetch the v12 engines" step in .github/workflows/ci.yml.',
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const require = createRequire(import.meta.url);
const v3 = (name: string) =>
  json<{ abi: Abi; bytecode: Hex }>(
    require.resolve(`@uniswap/v3-core/artifacts/contracts/${name}.sol/${name}.json`),
  );
const v4 = (name: string) => {
  const artifact = json<{
    abi: Abi;
    bytecode: { object: Hex };
    deployedBytecode: { immutableReferences: Record<string, { start: number; length: number }[]> };
  }>(require.resolve(`@uniswap/v4-core/out/${name}.sol/${name}.json`));
  return {
    abi: artifact.abi,
    creationCode: artifact.bytecode.object,
    immutables: Object.values(artifact.deployedBytecode.immutableReferences).flat(),
  };
};
const V3_FACTORY = v3("UniswapV3Factory");
const V3_POOL = v3("UniswapV3Pool");
const POOL_MANAGER = v4("PoolManager");
const MODIFY_LIQUIDITY = v4("PoolModifyLiquidityTest");
const MOCK_ERC20 = json<{ creationCode: Hex }>(join(HERE, "../std/token/fixtures/MockERC20.json"));
const MINTER = json<{ abi: Abi; creationCode: Hex }>(join(HERE, "fixtures/UniswapV3Minter.json"));
const STATE_VIEW = json<{ abi: Abi; creationCode: Hex }>(join(HERE, "fixtures/StateView.json"));
const PORTAL = json<{ creationCode: Hex }>(join(HERE, "fixtures/Portal.json"));
const PROGRAM = readFileSync(
  join(HERE, "../../../skills/sauce-intents/examples/swap-on-base.sauce.ts"),
  "utf8",
);

/** Anvil's first dev account: the deployer, the pools' liquidity provider and the solver. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const CREATOR = getAddress("0x3333333333333333333333333333333333333333");
const RECIPIENT = getAddress("0x7777777777777777777777777777777777777777");
const REFUND_TO = getAddress("0x8888888888888888888888888888888888888888");
const DEADLINE = 4_000_000_000n;
/** A port from the OS, so no other suite or checkout meets this one on it (`anvil-process.ts`). */
const PORT = freePortSync();
const RPC_URL = `http://127.0.0.1:${PORT}`;
const GAS_LIMIT = 30_000_000n;

const transport = http(RPC_URL, { fetchOptions: { headers: { connection: "close" } } });
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: OWNER, transport });

const erc20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);
const executorAbi = parseAbi(["function executor() view returns (address)"]);

const WETH = getAddress(Base.WETH.address!);
const USDC = getAddress(Base.USDC.address!);
const PAIR = { baseDecimals: 18, quoteDecimals: 6, baseIsToken0: true };
const sqrtAt = (usdcPerWeth: string): bigint => sqrtPriceX96FromPrice(usdcPerWeth, PAIR);
const Q192 = 2n ** 192n;
const WETH_UNIT = 10n ** 18n;
/** The body's `sqrtPriceLimitX96`: no pool sells a WETH for less than 2,695 USDC, fee paid. */
const LIMIT = sqrtAt("2695");

interface Venue {
  kind: "v3" | "v4";
  fee: bigint;
  spacing: number;
  /** USDC per WETH, or none: no pool at this key. */
  price?: string;
  liquidity: bigint;
  /** A V4 pool's protocol fee: selling token0's in the low 12 bits, token1's in the next 12. */
  protocolFee?: number;
}
const VENUES: Venue[] = [
  { kind: "v3", fee: 500n, spacing: 10, price: "2700", liquidity: 15n * 10n ** 15n },
  { kind: "v3", fee: 3000n, spacing: 60, price: "2705", liquidity: 20n * 10n ** 15n },
  { kind: "v3", fee: 10000n, spacing: 200, price: "2750", liquidity: 0n },
  { kind: "v4", fee: 100n, spacing: 1, price: "2740", liquidity: 0n },
  {
    kind: "v4",
    fee: 500n,
    spacing: 10,
    price: "2702",
    liquidity: 20n * 10n ** 15n,
    protocolFee: 1000 | (200 << 12),
  },
  { kind: "v4", fee: 3000n, spacing: 60, liquidity: 0n },
  { kind: "v4", fee: 10000n, spacing: 200, price: "2710", liquidity: 20n * 10n ** 15n },
];
const venueName = (venue: Venue) => `${venue.kind}:${venue.fee}`;

/** A hookless V4 key of the pair, and its id. */
const keyOf = (venue: Venue) => ({
  currency0: WETH,
  currency1: USDC,
  fee: Number(venue.fee),
  tickSpacing: venue.spacing,
  hooks: "0x0000000000000000000000000000000000000000" as Address,
});
const idOf = (venue: Venue): Hex =>
  keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [WETH, USDC, Number(venue.fee), venue.spacing, keyOf(venue).hooks],
    ),
  );

const send = async (to: Address | null, data: Hex): Promise<TransactionReceipt> => {
  const hash = await walletClient.sendTransaction({
    account: OWNER,
    chain: null,
    data,
    gas: GAS_LIMIT,
    to,
  });
  return publicClient.waitForTransactionReceipt({ hash });
};

const deploy = async (creationCode: Hex): Promise<Address> => {
  const receipt = await send(null, creationCode);
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("deploy failed");
  return receipt.contractAddress;
};

const deployWith = (creationCode: Hex, address: Address): Promise<Address> =>
  deploy(concatHex([creationCode, encodeAbiParameters([{ type: "address" }], [address])]));

const call = async (to: Address, abi: Abi, functionName: string, args: unknown[]) => {
  const receipt = await send(to, encodeFunctionData({ abi, functionName, args }));
  if (receipt.status !== "success") throw new Error(`${functionName} on ${to} reverted`);
};

const balance = (token: Address, holder: Address): Promise<bigint> =>
  publicClient.readContract({
    abi: erc20,
    address: token,
    args: [holder],
    functionName: "balanceOf",
  });

/** The tick of a sqrtPriceX96, rounded down to the tick spacing. */
const tickOf = (sqrtPriceX96: bigint, spacing: number): number => {
  const ratio = Number(sqrtPriceX96 * sqrtPriceX96) / Number(Q192);
  return Math.floor(Math.log(ratio) / Math.log(1.0001) / spacing) * spacing;
};

/** Replays `from`'s storage onto `to`, and its code, or `code` in its place. */
const replay = async (from: Address, to: Address, code?: Hex) => {
  const dumped = JSON.parse(
    new TextDecoder().decode(gunzipSync(hexToBytes(await testClient.dumpState()))),
  ) as { accounts: Record<string, { code: Hex; storage: Record<Hex, Hex> }> };
  const state = dumped.accounts[from.toLowerCase()] ?? dumped.accounts[from];
  await testClient.setCode({ address: to, bytecode: code ?? state!.code });
  for (const [index, value] of Object.entries(state!.storage))
    await testClient.setStorageAt({ address: to, index: index as Hex, value });
};

let anvil: ChildProcess;
/** The source: an Ethereum anvil whose Pot publishes each intent, the reward its WETH. */
let ethereum: IntentChain;
let portal: Address;
/** The Pot the Portal's Executor cooks the body on: the shared intent Pot, salt zero. */
let pot: Address;
const POOL_MANAGER_AT = getAddress(Base.UniswapV4.PoolManager.address!);
const STATE_VIEW_AT = getAddress(Base.UniswapV4.StateView.address!);
/** Each V3 pool by its venue name. */
const v3Pools = new Map<string, Address>();

/** A V3 pool's price, or a V4 pool's as the StateView reads it. */
const priceOf = async (venue: Venue): Promise<bigint> => {
  if (venue.kind === "v3") {
    const [sqrtPriceX96] = (await publicClient.readContract({
      abi: V3_POOL.abi,
      address: v3Pools.get(venueName(venue))!,
      functionName: "slot0",
    })) as [bigint];
    return sqrtPriceX96;
  }
  const [sqrtPriceX96] = (await publicClient.readContract({
    abi: STATE_VIEW.abi,
    address: STATE_VIEW_AT,
    args: [idOf(venue)],
    functionName: "getSlot0",
  })) as [bigint];
  return sqrtPriceX96;
};

/** main's arguments, as `--args` gives them: the rest take the suite's defaults. */
interface Args {
  amountIn: bigint;
  sqrtPriceLimitX96?: bigint;
  minOut?: bigint;
  minAvgPrice?: bigint;
}

/**
 * The intent `source` opens, published as `sauce intent publish --chain ethereum --args …`
 * publishes it: compiled for Ethereum, cooked on the Ethereum anvil's Pot with `main`'s `values`,
 * and read back from the Portal's `IntentPublished`.
 */
const publishedIntent = async (source: string, values: readonly EntryValue[]): Promise<Intent> => {
  const compiled = compileSauceProgram("ethereum", source, {
    intents: { deadline: DEADLINE, executionFee: 0n },
  });
  const intents = await ethereum.publish(
    compiled,
    `0x${Buffer.from(encodeEntryArguments(compiled, values)).toString("hex")}`,
  );
  expect(intents).toHaveLength(1);
  return intents[0]!.intent;
};

/**
 * The fulfilment of the intent the file opens, as published on Ethereum: the solver's side on
 * Base, after it holds the delivery and lets the Portal pull it.
 */
const fulfilment = async (args: Args, source = PROGRAM): Promise<{ data: Hex; value: bigint }> => {
  const intent = await publishedIntent(source, [
    args.amountIn,
    args.amountIn + 10n ** 15n,
    args.sqrtPriceLimitX96 ?? LIMIT,
    args.minOut ?? 1n,
    args.minAvgPrice ?? 0n,
    RECIPIENT,
    REFUND_TO,
  ]);
  return fulfilOf(intent);
};

/** `fulfill` of `intent` on this Base, from the solver, once it holds the delivery. */
const fulfilOf = async (intent: Intent): Promise<{ data: Hex; value: bigint }> => {
  const [route] = decodeAbiParameters([EVM_ROUTE_PARAM], encodeRouteEvm(intent.route));
  for (const { token, amount } of route.tokens) {
    await call(token, erc20, "mint", [OWNER.address, amount]);
    await call(token, erc20, "approve", [portal, amount]);
  }
  const { intentHash, rewardHash } = hashIntent(intent);
  const claimant = pad(OWNER.address, { size: 32 });
  return {
    data: encodeFunctionData({
      abi: PortalABI,
      functionName: "fulfill",
      args: [intentHash, route, rewardHash, claimant],
    }),
    value: route.nativeAmount,
  };
};

/** Sends that fulfilment from the solver; the receipt, reverted or not. */
const fulfil = async (args: Args, source = PROGRAM): Promise<TransactionReceipt> => {
  const { data, value } = await fulfilment(args, source);
  const hash = await walletClient.sendTransaction({
    account: OWNER,
    chain: null,
    data,
    gas: GAS_LIMIT,
    to: portal,
    value,
  });
  return publicClient.waitForTransactionReceipt({ hash });
};

/** The revert data of that fulfilment, simulated: the Portal's, which carries the body's. */
const revertOf = async (args: Args): Promise<Hex> => {
  const { data, value } = await fulfilment(args);
  try {
    await publicClient.call({ account: OWNER.address, data, to: portal, value });
  } catch (error) {
    for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
      const reverted = (cause as { data?: unknown }).data;
      if (typeof reverted === "string") return reverted as Hex;
    }
  }
  throw new Error("the fulfilment did not revert");
};
/** A revert reason as it appears in revert data. */
const reason = (text: string): string => stringToHex(text).slice(2);

/** The file with one of its own pieces replaced, to show what that piece guards against. */
const replacing = (piece: string, instead: string): string => {
  const edited = PROGRAM.replace(piece, instead);
  if (edited === PROGRAM) throw new Error(`the file has no ${piece}`);
  return edited;
};

interface Fill {
  venue: string;
  fee: bigint;
  /** The WETH the pool took, its fee included, and the USDC it paid out. */
  paid: bigint;
  got: bigint;
  /** The pool's price after the swap. */
  sqrtPriceX96: bigint;
}
/** Every swap in a fulfilment, in order: a V3 pool's `Swap` (amounts the pool's), and the
 *  PoolManager's (amounts the swapper's, its fee the one charged, protocol fee included). */
const fills = (receipt: TransactionReceipt): Fill[] =>
  receipt.logs.flatMap((log): Fill[] => {
    if (getAddress(log.address) === POOL_MANAGER_AT) {
      return parseEventLogs({ abi: POOL_MANAGER.abi, eventName: "Swap", logs: [log] }).map(
        (event) => {
          const { amount0, amount1, fee, id, sqrtPriceX96 } = event.args as unknown as {
            amount0: bigint;
            amount1: bigint;
            fee: number;
            id: Hex;
            sqrtPriceX96: bigint;
          };
          const venue = VENUES.find((v) => v.kind === "v4" && idOf(v) === id)!;
          return {
            fee: BigInt(fee),
            got: amount1,
            paid: -amount0,
            sqrtPriceX96,
            venue: venueName(venue),
          };
        },
      );
    }
    const name = [...v3Pools].find(([, at]) => at === getAddress(log.address))?.[0];
    if (name === undefined) return [];
    return parseEventLogs({ abi: V3_POOL.abi, eventName: "Swap", logs: [log] }).map((event) => {
      const { amount0, amount1, sqrtPriceX96 } = event.args as unknown as {
        amount0: bigint;
        amount1: bigint;
        sqrtPriceX96: bigint;
      };
      const venue = VENUES.find((v) => venueName(v) === name)!;
      return { fee: venue.fee, got: -amount1, paid: amount0, sqrtPriceX96, venue: name };
    });
  });

/**
 * A fill pays at least the limit, 2,695 USDC for each WETH with the pool's fee paid: on average,
 * and at its last unit, the pool's price after the swap less the fee. `atLimit`: and that last
 * unit pays the limit itself, to within 0.001%, as it does from a pool that stopped at its own.
 */
const expectWithin = (fill: Fill, atLimit = false) => {
  const floor = LIMIT * LIMIT; // USDC units per WETH unit, times 2^192
  expect(fill.got * Q192).toBeGreaterThanOrEqual(floor * fill.paid);
  const last = fill.sqrtPriceX96 * fill.sqrtPriceX96 * (1_000_000n - fill.fee);
  expect(last).toBeGreaterThanOrEqual(floor * 1_000_000n);
  if (atLimit) expect(last * 100_000n).toBeLessThanOrEqual(floor * 1_000_000n * 100_001n);
};

describeEvm("the sauce-intents swap-on-base body, on real Uniswap V3 and V4 pools", () => {
  let snapshot: Hex;

  beforeAll(async () => {
    anvil = await spawnAnvil(PORT, ["--chain-id", "8453"]);
    const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
    await startGatedEngine({ publicClient, testClient, walletClient }, OWNER.address, creationCode);

    // eco-routes' Portal at Base's registry address, with its vault implementation and Executor
    // where a Portal deployed there puts them, each one's references to the others rewritten; and
    // the shared Pot its Executor cooks on, minted by the Kitchen.
    const deployed = await deployWith(
      PORTAL.creationCode,
      "0x0000000000000000000000000000000000000000",
    );
    portal = getAddress(ecoRoutesPortal("base"));
    const moves = [
      [deployed, portal],
      [
        getAddress(ecoRoutesVaultImplementationOf(deployed)),
        getAddress(ecoRoutesVaultImplementationOf(portal)),
      ],
      [
        getAddress(
          await publicClient.readContract({
            abi: executorAbi,
            address: deployed,
            functionName: "executor",
          }),
        ),
        getAddress(ecoRoutesExecutorOf(portal)),
      ],
    ] as const;
    for (const [from, to] of moves) {
      const code = (await publicClient.getCode({ address: from }))!.toLowerCase();
      await testClient.setCode({
        address: to,
        bytecode: moves.reduce(
          (text, [a, b]) => text.split(a.slice(2).toLowerCase()).join(b.slice(2).toLowerCase()),
          code,
        ) as Hex,
      });
    }
    const executor = getAddress(ecoRoutesExecutorOf(portal));
    const minted = await send(
      gateAnchors().kitchen,
      v12Kitchen.encodeDeployPot(executor, SAUCE_INTENT_POT_SALT),
    );
    expect(minted.status).toBe("success");
    pot = getAddress(v12PredictPot(executor as Hex));

    // The tokens, at Base's WETH and USDC addresses.
    const token = await deploy(MOCK_ERC20.creationCode);
    const tokenCode = (await publicClient.getCode({ address: token }))!;
    for (const at of [WETH, USDC]) {
      await testClient.setCode({ address: at, bytecode: tokenCode });
      await call(at, erc20, "mint", [OWNER.address, 10n ** 30n]);
    }

    // Uniswap V4: the PoolManager at Base's address, its immutable record of the address it was
    // deployed at, which it requires to run at, set to Base's; its storage (the owner) replayed.
    const manager = await deployWith(POOL_MANAGER.creationCode, OWNER.address);
    let code = (await publicClient.getCode({ address: manager }))!.slice(2);
    const word = (address: Address) => pad(address, { size: 32 }).slice(2).toLowerCase();
    for (const { start, length } of POOL_MANAGER.immutables) {
      const [from, to] = [start * 2, (start + length) * 2];
      expect(code.slice(from, to)).toBe(word(manager));
      code = code.slice(0, from) + word(POOL_MANAGER_AT) + code.slice(to);
    }
    await replay(manager, POOL_MANAGER_AT, `0x${code}`);
    const stateView = await deployWith(STATE_VIEW.creationCode, POOL_MANAGER_AT);
    await testClient.setCode({
      address: STATE_VIEW_AT,
      bytecode: (await publicClient.getCode({ address: stateView }))!,
    });
    const liquidityRouter = await deployWith(MODIFY_LIQUIDITY.creationCode, POOL_MANAGER_AT);
    await call(POOL_MANAGER_AT, POOL_MANAGER.abi, "setProtocolFeeController", [OWNER.address]);

    // Uniswap V3: pools created by Uniswap's own factory.
    const factory = await deploy(V3_FACTORY.bytecode);
    const minter = await deploy(MINTER.creationCode);
    for (const at of [WETH, USDC]) {
      await call(at, erc20, "approve", [minter, maxUint256]);
      await call(at, erc20, "approve", [liquidityRouter, maxUint256]);
    }

    for (const venue of VENUES) {
      if (venue.price === undefined) continue;
      const start = sqrtAt(venue.price);
      const tick = tickOf(start, venue.spacing);
      const [tickLower, tickUpper] = [tick - 200 * venue.spacing, tick + 200 * venue.spacing];
      if (venue.kind === "v3") {
        await call(factory, V3_FACTORY.abi, "createPool", [WETH, USDC, venue.fee]);
        const pool = getAddress(
          (await publicClient.readContract({
            abi: V3_FACTORY.abi,
            address: factory,
            args: [WETH, USDC, venue.fee],
            functionName: "getPool",
          })) as Address,
        );
        v3Pools.set(venueName(venue), pool);
        await call(pool, V3_POOL.abi, "initialize", [start]);
        if (venue.liquidity > 0n)
          await call(minter, MINTER.abi, "mint", [pool, tickLower, tickUpper, venue.liquidity]);
      } else {
        const key = keyOf(venue);
        await call(POOL_MANAGER_AT, POOL_MANAGER.abi, "initialize", [key, start]);
        if (venue.liquidity > 0n)
          await call(liquidityRouter, MODIFY_LIQUIDITY.abi, "modifyLiquidity", [
            key,
            { liquidityDelta: venue.liquidity, salt: pad("0x00"), tickLower, tickUpper },
            "0x",
            false, // paid by transfer, not by burning claims
            false, // taken as tokens, not as claims
          ]);
        if (venue.protocolFee !== undefined)
          await call(POOL_MANAGER_AT, POOL_MANAGER.abi, "setProtocolFee", [key, venue.protocolFee]);
      }
    }
    // The V3 factory's code and state onto Base's factory address, where the body looks.
    await replay(factory, getAddress(Base.UniswapV3.Factory.address!));

    ethereum = await startIntentChain("ethereum", PORT + 50, ["WETH"]);

    snapshot = await testClient.snapshot();
  }, 180_000);

  beforeEach(async () => {
    await testClient.revert({ id: snapshot });
    snapshot = await testClient.snapshot();
  });

  afterAll(async () => {
    await ethereum?.stop();
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  it("finds the pools at Base's addresses: the V3 factory's, and the V4 pools by the StateView", async () => {
    const lookup = (fee: bigint) =>
      publicClient.readContract({
        abi: V3_FACTORY.abi,
        address: getAddress(Base.UniswapV3.Factory.address!),
        args: [WETH, USDC, fee],
        functionName: "getPool",
      });
    expect(await lookup(100n)).toBe("0x0000000000000000000000000000000000000000");
    for (const fee of [500n, 3000n, 10000n])
      expect(getAddress((await lookup(fee)) as Address)).toBe(v3Pools.get(`v3:${fee}`));
    for (const venue of VENUES.filter((v) => v.kind === "v4")) {
      const [sqrtPriceX96, , protocolFee, lpFee] = (await publicClient.readContract({
        abi: STATE_VIEW.abi,
        address: STATE_VIEW_AT,
        args: [idOf(venue)],
        functionName: "getSlot0",
      })) as [bigint, number, number, number];
      const liquidity = await publicClient.readContract({
        abi: STATE_VIEW.abi,
        address: STATE_VIEW_AT,
        args: [idOf(venue)],
        functionName: "getLiquidity",
      });
      expect([sqrtPriceX96, liquidity, protocolFee]).toEqual([
        venue.price === undefined ? 0n : sqrtAt(venue.price),
        venue.liquidity,
        venue.protocolFee ?? 0,
      ]);
      expect(lpFee).toBe(venue.price === undefined ? 0 : Number(venue.fee));
    }
  });

  it("sells to every pool with liquidity down to its own limit, and returns the unsold WETH", async () => {
    const amountIn = WETH_UNIT;
    const untouched = VENUES.filter((v) =>
      ["v3:10000", "v4:100", "v4:10000"].includes(venueName(v)),
    );
    const before = await Promise.all(untouched.map(priceOf));
    const solverWeth = await balance(WETH, OWNER.address);

    // The average floor at the limit itself: every unit pays at least 2,695 with its fee paid.
    const receipt = await fulfil({ amountIn: amountIn, minAvgPrice: 2_695n * 10n ** 6n });
    expect(receipt.status).toBe("success");
    const swapped = fills(receipt);
    // In the body's order: V3 by fee tier, then V4. The 0.05% V4 pool's fee is its LP fee and the
    // 0.1% protocol fee for selling token0, composed.
    expect(swapped.map((fill) => fill.venue)).toEqual(["v3:500", "v3:3000", "v4:500"]);
    expect(swapped[2]!.fee).toBe(1500n);
    for (const fill of swapped) expectWithin(fill, true);

    const sold = swapped.reduce((sum, fill) => sum + fill.paid, 0n);
    const bought = swapped.reduce((sum, fill) => sum + fill.got, 0n);
    expect(sold).toBeLessThan(amountIn);
    // The solver was minted the delivery, and the Portal took all of it.
    expect(await balance(WETH, OWNER.address)).toBe(solverWeth);
    expect(await balance(USDC, RECIPIENT)).toBe(bought);
    expect(await balance(WETH, REFUND_TO)).toBe(amountIn - sold);
    expect(await balance(WETH, pot)).toBe(0n);
    expect(await balance(USDC, pot)).toBe(0n);
    // The empty V3 pool, the empty V4 pool and the V4 pool past its own limit were not touched.
    expect(await Promise.all(untouched.map(priceOf))).toEqual(before);
    console.log(
      `partial fill: gas ${receipt.gasUsed}, sold ${sold} of ${amountIn} WETH units for ${bought} USDC units`,
    );
  });

  it("moves only what this intent delivered: what the shared Pot already held stays there", async () => {
    // Another intent's WETH and USDC, resting in the Pot every intent to Base shares.
    const resting = 3n * WETH_UNIT;
    const restingUsdc = 5_000n * 10n ** 6n;
    await call(WETH, erc20, "mint", [pot, resting]);
    await call(USDC, erc20, "mint", [pot, restingUsdc]);
    const amountIn = WETH_UNIT;
    const receipt = await fulfil({ amountIn: amountIn, minAvgPrice: 2_695n * 10n ** 6n });
    expect(receipt.status).toBe("success");
    const swapped = fills(receipt);
    expect(swapped.map((fill) => fill.venue)).toEqual(["v3:500", "v3:3000", "v4:500"]);
    const sold = swapped.reduce((sum, fill) => sum + fill.paid, 0n);
    const bought = swapped.reduce((sum, fill) => sum + fill.got, 0n);
    expect(sold).toBeLessThan(amountIn);
    expect(await balance(USDC, RECIPIENT)).toBe(bought);
    expect(await balance(WETH, REFUND_TO)).toBe(amountIn - sold);
    expect(await balance(WETH, pot)).toBe(resting);
    expect(await balance(USDC, pot)).toBe(restingUsdc);
  });

  it("sells a small amount to the first pool, within its limit, and returns nothing", async () => {
    const amountIn = WETH_UNIT / 20n;
    const receipt = await fulfil({ amountIn: amountIn });
    expect(receipt.status).toBe("success");
    const swapped = fills(receipt);
    expect(swapped.map((fill) => fill.venue)).toEqual(["v3:500"]);
    expectWithin(swapped[0]!);
    expect(swapped[0]!.paid).toBe(amountIn);
    expect(await balance(USDC, RECIPIENT)).toBe(swapped[0]!.got);
    expect(await balance(WETH, REFUND_TO)).toBe(0n);
    expect(await balance(WETH, pot)).toBe(0n);
  });

  it("sells nothing under a limit above every pool's price, and returns all the WETH", async () => {
    const amountIn = WETH_UNIT;
    const receipt = await fulfil({
      amountIn: amountIn,
      sqrtPriceLimitX96: sqrtAt("2800"),
      minOut: 0n,
    });
    expect(receipt.status).toBe("success");
    expect(fills(receipt)).toEqual([]);
    expect(await balance(WETH, REFUND_TO)).toBe(amountIn);
    expect(await balance(USDC, RECIPIENT)).toBe(0n);
    expect(await balance(WETH, pot)).toBe(0n);
  });

  it("reverts the whole fulfilment below minOut, and below minAvgPrice", async () => {
    // A million USDC for one WETH.
    const short = { amountIn: WETH_UNIT, minOut: 10n ** 12n };
    expect(await revertOf(short)).toContain(reason("output below minOut"));
    // Every unit sold below 2,705 less its fee, and most below 2,700: an average of 2,700 is more
    // than the pools pay.
    const dear = { amountIn: WETH_UNIT, minAvgPrice: 2_700n * 10n ** 6n };
    expect(await revertOf(dear)).toContain(reason("average price below minAvgPrice"));
    const solverWeth = await balance(WETH, OWNER.address);
    for (const args of [short, dear]) expect((await fulfil(args)).status).toBe("reverted");
    // The solver keeps its WETH (each attempt minted its own delivery first), and nothing moved.
    expect(await balance(WETH, OWNER.address)).toBe(solverWeth + 2n * WETH_UNIT);
    expect(await balance(USDC, RECIPIENT)).toBe(0n);
    expect(await balance(WETH, REFUND_TO)).toBe(0n);
  });

  it("runs the nested-intents guide's swap: the body buys WETH on Base and opens the next intent with it", async () => {
    // docs/examples/nested-swap.sauce.ts as written, opened on Ethereum and its main arguments fixed
    // into the intents as `sauce intent publish --args` fixes them. This anvil's Portal is the one
    // the outer route names and the one the body publishes the inner intent on; the pool is the
    // 0.05% one, which the body finds through Base's factory.
    const source = readFileSync(join(HERE, "../../../docs/examples/nested-swap.sauce.ts"), "utf8");
    const delivered = 1_000n * 10n ** 6n; // 1,000 USDC
    // Its reward is Ethereum's USDC, which the source's Pot pays into the vault.
    await ethereum.local.plant(
      JSON.parse(readFileSync(join(HERE, "../std/token/fixtures/MockERC20.json"), "utf8"))
        .creationCode as Hex,
      ethereum.token("USDC"),
    );
    await ethereum.local.mint(ethereum.token("USDC"), ethereum.pot, 10n ** 12n);
    const outer = await publishedIntent(source, [
      RECIPIENT,
      delivered,
      delivered + 10n ** 6n,
      1n,
      CREATOR,
    ]);
    const [route] = decodeAbiParameters([EVM_ROUTE_PARAM], encodeRouteEvm(outer.route));
    expect(route.tokens).toEqual([{ token: USDC, amount: delivered }]);
    const { data } = await fulfilOf(outer);
    const receipt = await send(portal, data);
    expect(receipt.status).toBe("success");

    // The swap ran on the 0.05% pool, and what it bought is the inner intent's reward, in Base's
    // WETH, paid into its vault on this Portal and published there for Ethereum.
    const [swap] = fills(receipt);
    expect(swap!.venue).toBe("v3:500");
    const [published] = parseEventLogs({
      abi: PortalABI,
      eventName: "IntentPublished",
      logs: receipt.logs,
    });
    const inner = published!.args;
    expect(inner.destination).toBe(1n);
    expect(inner.rewardTokens).toHaveLength(1);
    const [{ token, amount: bought }] = inner.rewardTokens;
    expect(getAddress(token)).toBe(WETH);
    expect(bought).toBeGreaterThan(0n);
    const reward = {
      deadline: inner.rewardDeadline,
      creator: inner.creator,
      prover: inner.prover,
      nativeAmount: inner.rewardNativeAmount,
      tokens: inner.rewardTokens,
    };
    const funded = await publicClient.readContract({
      abi: PortalABI,
      address: portal,
      functionName: "isIntentFunded",
      args: [inner.destination, inner.route, reward],
    });
    expect(funded).toBe(true);
    // Its route delivers on Ethereum what was bought, less the next solver's tenth of a percent,
    // in Ethereum's WETH, moved into Ethereum's shared Pot, whose cook pays the recipient.
    const [next] = decodeAbiParameters([EVM_ROUTE_PARAM], inner.route);
    expect(next.tokens.map((token) => token.amount)).toEqual([bought - bought / 1000n]);
    expect(next.calls).toHaveLength(2);
    expect(next.calls[0]!.data).toBe(
      encodeFunctionData({
        abi: parseAbi(["function transfer(address to, uint256 amount)"]),
        functionName: "transfer",
        args: [
          getAddress(v12PredictPot(ecoRoutesExecutorOf(ecoRoutesPortal("ethereum")))),
          bought - bought / 1000n,
        ],
      }),
    );
    // The shared Pot keeps nothing: the USDC went into the pool, the WETH into the vault.
    expect(await balance(USDC, pot)).toBe(0n);
    expect(await balance(WETH, pot)).toBe(0n);
  });

  it("without the √(1 − fee), the 0.3% V3 pool's last unit pays less than the limit", async () => {
    const receipt = await fulfil(
      { amountIn: WETH_UNIT },
      replacing("Math.sqrt((1000000 - fee) * 10 ** 30)", "10 ** 18"),
    );
    expect(receipt.status).toBe("success");
    const pricier = fills(receipt).find((fill) => fill.venue === "v3:3000")!;
    const last = pricier.sqrtPriceX96 * pricier.sqrtPriceX96 * (1_000_000n - pricier.fee);
    expect(last).toBeLessThan(LIMIT * LIMIT * 1_000_000n);
  });

  it("with the other direction's protocol fee, the V4 pool's last unit pays less than the limit", async () => {
    const receipt = await fulfil(
      { amountIn: WETH_UNIT },
      replacing(
        "if (!sellsToken0) {\n          protocolFee",
        "if (sellsToken0) {\n          protocolFee",
      ),
    );
    expect(receipt.status).toBe("success");
    const v4 = fills(receipt).find((fill) => fill.venue === "v4:500")!;
    const last = v4.sqrtPriceX96 * v4.sqrtPriceX96 * (1_000_000n - v4.fee);
    expect(last).toBeLessThan(LIMIT * LIMIT * 1_000_000n);
  });
});
