/**
 * A dynamic child intent EXECUTED: a real v12 engine, a real Pot, and the real eco-routes Portal,
 * on an anvil. This is the suite `routes-nest-dynamic.test.ts`'s header says does not exist — that
 * one proves byte identity, hash identity and compilation, and explicitly disclaims everything
 * below. Each item here was listed there as unproven.
 *
 * THE QUESTION THIS EXISTS FOR. The emitted program throws (`minAmountIn`, the scale-overflow
 * guard, the width guard). If a throw mid-`cook()` reverted only that one `route.calls` entry, a
 * parent could complete with its dynamic child silently unpublished and the measured funds stranded
 * in the Pot — which would make those guards decoration and the design wrong, not just the tests.
 * The first describe below settles it against the real `Executor.execute` loop, with a
 * state-changing call on EITHER side of the throwing cook, so "whole transaction reverts", "only
 * that call reverts" and "earlier calls stay applied" are three distinguishable outcomes.
 *
 * THE PORTAL IS THE REAL ONE. `fixtures/Portal.json` is `eco-routes`' own forge creation code,
 * vendored so this suite needs no Solidity toolchain (the same posture as
 * `std/token/fixtures/MockERC20.json`). Its `Inbox._fulfill` recomputes
 * `keccak256(abi.encodePacked(uint64 chainid, keccak256(abi.encode(route)), rewardHash))` and
 * refuses anything else, so a route this suite builds wrong cannot pass — the fulfilment itself is
 * the check on the encoding. anvil runs with `--chain-id 8453` so that identity is Base's, which the
 * SDK's canonical registry knows.
 *
 * WHAT THE LAST TEST ESTABLISHES, and why it is one test rather than four. The child's route bytes
 * are read back OUT of the Portal's own `IntentPublished` log and compared to what the SDK predicted
 * off-chain. Those bytes exist on-chain only because the program concatenated them, so if
 * `.toBytesBe(32)` were not zero-padded big-endian, or `.concat` inserted a length prefix, or
 * `evm.call` delivered a different payload, or `ctx.self()` were not the Pot whose balance was
 * measured, the comparison fails — and so, before it, does the Portal's own hash check.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX, like every other executing EVM suite here.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  getCreate2Address,
  http,
  keccak256,
  parseAbi,
  encodePacked,
  numberToHex,
} from "viem";
import type { Address, Hex, Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { compileProgram, SDK_SOURCE_DIRS } from "./helpers";
import { gateAnchors, startGatedEngine, type GatedEngine } from "./evm/gated-engine.js";
import { v12Kitchen, v12Pot } from "../src/evm/engine.js";
import {
  EVM_REWARD_PARAM,
  EVM_ROUTE_PARAM,
  denormalizeToEvm,
  encodeRouteEvm,
  hashIntent,
} from "../src/routes/encode.js";
import {
  AMOUNT_IN_PLACEHOLDER,
  AMOUNT_OUT_PLACEHOLDER,
  dynamicChildProgram,
  dynamicChildStatements,
  type DynamicChildOptions,
} from "../src/routes/nest-dynamic.js";
import { decodeAbiParameters } from "viem";
import { nestedTransferProgram } from "../src/routes/nest.js";
import { safeApproveStatements, safeTransferStatements } from "../src/token/safe.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { sauceEvmDeployPotCall } from "../src/routes/sauce-calls.js";
import {
  ECO_ROUTES_EXECUTOR_NONCE,
  ecoRoutesExecutor,
} from "../src/protocols/eco-routes/lookup.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import { destinationPot } from "../src/routes/intent-pot.js";
import { openRoute } from "../src/routes/intent-dsl.js";
import { Token as TokenCalls } from "../src/token/api.js";
import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { normalizeReward, normalizeRoute, toUniversalAddress } from "../src/routes/normalize.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import { requireChain } from "../src/chains/canonical.js";
import { scaleAmount, WAD } from "../src/routes/template.js";
import type { Intent } from "../src/routes/types.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { predictIntentVault } from "../src/routes/portal.js";
import { BODY_TO_ARBITRUM } from "./fixtures/routes/bodies.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;

const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;

// A skipped suite and a passing one are the same line in jest's summary. CI supplies the engine, so
// there an absent one is a failure rather than a silent no-op.
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI — this suite must never skip here.",
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PORTAL_FIXTURE = JSON.parse(readFileSync(join(HERE, "evm/fixtures/Portal.json"), "utf8")) as {
  creationCode: Hex;
};
const MOCK_ERC20 = JSON.parse(
  readFileSync(join(HERE, "std/token/fixtures/MockERC20.json"), "utf8"),
) as { creationCode: Hex };
/** USDT's shape: `transfer`/`approve`/`transferFrom` return NOTHING, and `approve` refuses to move a
 *  nonzero allowance to another nonzero value. Byte-identical to the fixture on
 *  `fix/settle-no-return-token`, deliberately, so the two add/add cleanly when that lands. */
const NO_RETURN_ERC20 = JSON.parse(
  readFileSync(join(HERE, "std/token/fixtures/NoReturnERC20.json"), "utf8"),
) as { creationCode: Hex };
/** The other way an ERC-20 lies about a write: `transfer`/`approve` return `false` and move
 *  nothing. A caller that ignores the return believes it worked; `SafeERC20` exists for this. */
const FALSE_RETURN_ERC20 = JSON.parse(
  readFileSync(join(HERE, "std/token/fixtures/FalseReturnERC20.json"), "utf8"),
) as { creationCode: Hex };

const DEPLOYER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

/** Base — anvil runs as this chain id so `_fulfill`'s `uint64(block.chainid)` is one the canonical
 *  registry knows, and the SDK's own `hashIntent` therefore agrees with the Portal's. */
const CHAIN_ID = 8453;
const CHILD_DESTINATION = 42161n; // Arbitrum: the child's own execution chain, never reached here

const PORT = 8700 + (Number(process.env.JEST_WORKER_ID ?? "1") % 100);
const RPC_URL = `http://127.0.0.1:${PORT}`;
const GAS_LIMIT = 30_000_000n;
const STARTUP_TIMEOUT_MS = 20_000;

/** The Pot the Executor owns. `Pot.cook` is `onlyOwner`, and every `route.calls` entry runs AS the
 *  Executor — so a Pot owned by anyone else rejects the cook with `NotOwner()` before a single
 *  opcode of the program runs. This is the production shape, not a test convenience. */
const EXECUTOR_POT_SALT = `0x${"00".repeat(31)}11` as Hex;

const transport = http(RPC_URL, { fetchOptions: { headers: { connection: "close" } } });
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: DEPLOYER, transport });

const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
]);
const erc20ApproveAbi = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
]);
const erc20AllowanceAbi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
]);

const portalAbi = [
  {
    type: "function",
    name: "fulfill",
    stateMutability: "payable",
    inputs: [
      { name: "intentHash", type: "bytes32" },
      EVM_ROUTE_PARAM,
      { name: "rewardHash", type: "bytes32" },
      { name: "claimant", type: "bytes32" },
    ],
    outputs: [{ type: "bytes[]" }],
  },
  {
    type: "function",
    name: "executor",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "claimants",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "getRewardStatus",
    stateMutability: "view",
    inputs: [{ name: "intentHash", type: "bytes32" }],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "intentVaultAddress",
    stateMutability: "view",
    inputs: [
      { name: "destination", type: "uint64" },
      { name: "route", type: "bytes" },
      EVM_REWARD_PARAM,
    ],
    outputs: [{ type: "address" }],
  },
  {
    type: "event",
    name: "IntentPublished",
    inputs: [
      { name: "intentHash", type: "bytes32", indexed: true },
      { name: "destination", type: "uint64", indexed: false },
      { name: "route", type: "bytes", indexed: false },
      { name: "creator", type: "address", indexed: true },
      { name: "prover", type: "address", indexed: true },
      { name: "rewardDeadline", type: "uint64", indexed: false },
      { name: "rewardNativeAmount", type: "uint256", indexed: false },
      {
        name: "rewardTokens",
        type: "tuple[]",
        indexed: false,
        components: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
      },
    ],
  },
] as const;

/** The EVM-shaped `Route` tuple `Portal.fulfill` takes and `abi.encode`s to hash. */
interface EvmRoute {
  salt: Hex;
  deadline: bigint;
  portal: Address;
  nativeAmount: bigint;
  tokens: readonly { token: Address; amount: bigint }[];
  calls: readonly { target: Address; data: Hex; value: bigint }[];
}

let sauce: GatedEngine;
let portal: Address;
let executor: Address;
/** The Pot the cooks run on — owned by the Executor, so `ctx.self()` is this address. */
let executorPot: Address;
let markerToken: Address;
let rewardToken: Address;
/** The depth-2 cascade's three assets: what the parent's "swap" yields, what the child's yields,
 *  and the delivery obligation neither level ever moves. */
let tokenB: Address;
let tokenC: Address;
let deliveredToken: Address;
/** A reward token that returns nothing from `approve`/`transfer`. */
let usdt: Address;
/** A token that returns `false` from both, and moves nothing. */
let liar: Address;

/**
 * A contract whose every call reverts, hand-assembled because it needs no state and no ABI:
 * creation copies a 5-byte runtime and returns it; the runtime is `PUSH1 0 PUSH1 0 REVERT`.
 */
const REVERTING_ERC20_CREATION = "0x6005600c60003960056000f360006000fd" as Hex;

const waitForRpc = (deadline: number): Promise<void> =>
  Date.now() >= deadline
    ? Promise.reject(new Error(`anvil did not come up on ${RPC_URL}`))
    : publicClient
        .getChainId()
        .then(() => undefined)
        .catch(() =>
          new Promise((resolve) => setTimeout(resolve, 100)).then(() => waitForRpc(deadline)),
        );

const deploy = async (data: Hex): Promise<Address> => {
  const hash = await walletClient.sendTransaction({
    account: DEPLOYER,
    chain: null,
    data,
    gas: GAS_LIMIT,
  });
  const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash });
  if (!contractAddress) throw new Error("a deployment produced no contract address");

  return contractAddress;
};

const mintTo = async (token: Address, holder: Address, amount: bigint): Promise<void> => {
  const hash = await walletClient.sendTransaction({
    account: DEPLOYER,
    chain: null,
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "mint", args: [holder, amount] }),
    gas: GAS_LIMIT,
  });
  await publicClient.waitForTransactionReceipt({ hash });
};

const balanceOf = (token: Address, holder: Address): Promise<bigint> =>
  publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder],
  }) as Promise<bigint>;

const toHex = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString("hex")}`;

/** A `route.calls` entry that cooks `source` on the Executor-owned Pot. */
const cookCall = (source: string) => ({
  target: executorPot,
  data: v12Pot.encodeCook(
    sauce.engine,
    toHex(compileProgram(source, { baseDirs: [...SDK_SOURCE_DIRS] }).bytecode[0]!),
  ),
  value: 0n,
});

/** `approve(spender, amount)` calldata as the SauceScript `hex` literal a probe program can send
 *  through `evm.call` -- the same output-free shape the emitters under test produce. */
const approveLiteral = (spender: Address, amount: bigint): string =>
  `hex\`${encodeFunctionData({ abi: erc20ApproveAbi, functionName: "approve", args: [spender, amount] }).slice(2)}\``;

/** A `route.calls` entry that mints 1 wei of the marker token — an unmistakable, readable state
 *  change, used to tell "this call ran" from "this call was rolled back". */
const markerCall = (to: Address) => ({
  target: markerToken,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "mint", args: [to, 1n] }),
  value: 0n,
});

let saltCounter = 0;
const nextSalt = (): Hex => `0x${(++saltCounter).toString(16).padStart(64, "0")}` as Hex;

interface Fulfilment {
  status: "success" | "reverted";
  intentHash: Hex;
  gasUsed: bigint;
  logs: readonly Log[];
}

/** Hashes `route` exactly as `Inbox._fulfill` does and submits `Portal.fulfill` to `via`. */
const fulfilRoute = async (
  route: EvmRoute,
  rewardHash: Hex,
  via: Address = portal,
): Promise<Fulfilment> => {
  const routeHash = keccak256(encodeAbiParameters([EVM_ROUTE_PARAM], [route]));
  const intentHash = keccak256(
    encodePacked(["uint64", "bytes32", "bytes32"], [BigInt(CHAIN_ID), routeHash, rewardHash]),
  );
  const claimant = `0x${"00".repeat(12)}${DEPLOYER.address.slice(2)}` as Hex;

  // Sent as a TRANSACTION even when it is expected to revert: a revert has to be observed as a
  // receipt status plus the on-chain state it left behind, which an `eth_call` cannot show.
  const hash = await walletClient.sendTransaction({
    account: DEPLOYER,
    chain: null,
    to: via,
    data: encodeFunctionData({
      abi: portalAbi,
      functionName: "fulfill",
      args: [intentHash, route, rewardHash, claimant],
    }),
    gas: GAS_LIMIT,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return { status: receipt.status, intentHash, gasUsed: receipt.gasUsed, logs: receipt.logs };
};

/** A fresh top-level route around `calls`, with a reward this suite never has to produce. */
const fulfil = (
  calls: readonly { target: Address; data: Hex; value: bigint }[],
): Promise<Fulfilment> =>
  fulfilRoute(
    {
      salt: nextSalt(),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      portal,
      nativeAmount: 0n,
      tokens: [],
      calls,
    },
    keccak256("0xbeef"),
  );

/** Every `IntentPublished` the Portal emitted in one fulfilment, decoded. */
const publishedIn = (logs: readonly Log[]) =>
  logs
    .filter((l) => l.address.toLowerCase() === portal.toLowerCase())
    .flatMap((l) => {
      try {
        const decoded = decodeEventLog({ abi: portalAbi, data: l.data, topics: l.topics });
        return decoded.eventName === "IntentPublished" ? [decoded.args] : [];
      } catch {
        return [];
      }
    }) as unknown as PublishedIntent[];

interface PublishedIntent {
  intentHash: Hex;
  destination: bigint;
  route: Hex;
  creator: Address;
  prover: Address;
  rewardDeadline: bigint;
  rewardNativeAmount: bigint;
  rewardTokens: readonly { token: Address; amount: bigint }[];
}

/** The reward tuple and its hash, rebuilt from what the Portal logged — so the follow-on fulfilment
 *  uses the bytes the chain published rather than anything this suite predicted. */
const rewardOf = (published: PublishedIntent) => {
  const reward = {
    deadline: published.rewardDeadline,
    creator: published.creator,
    prover: published.prover,
    nativeAmount: published.rewardNativeAmount,
    tokens: published.rewardTokens.map((t) => ({ token: t.token, amount: t.amount })),
  };

  return { reward, rewardHash: keccak256(encodeAbiParameters([EVM_REWARD_PARAM], [reward])) };
};

/**
 * What the Portal itself says of an intent it published, over the bytes it logged: the vault it
 * derives, whether that vault holds the reward (`isIntentFunded`, what the solver validates), and
 * the status it recorded — `Funded` (1) only when `publishAndFund` pulled the reward itself.
 */
const portalView = async (published: PublishedIntent) => {
  const { reward } = rewardOf(published);
  const args = [published.destination, published.route, reward] as const;
  const vault = (await publicClient.readContract({
    abi: PortalABI,
    address: portal,
    functionName: "intentVaultAddress",
    args,
  })) as Address;
  const funded = (await publicClient.readContract({
    abi: PortalABI,
    address: portal,
    functionName: "isIntentFunded",
    args,
  })) as boolean;
  const status = Number(
    await publicClient.readContract({
      abi: portalAbi,
      address: portal,
      functionName: "getRewardStatus",
      args: [published.intentHash],
    }),
  );

  return { vault, funded, status };
};

/** What the Portal logged in a fulfilment about the intents its route published, by event name in
 *  emission order, with each one's index among all the logs — leaving out the fulfilment's own
 *  `IntentFulfilled`. */
const portalEventsIn = (logs: readonly Log[]): { name: string; at: number }[] =>
  logs.flatMap((l, at) => {
    if (l.address.toLowerCase() !== portal.toLowerCase()) return [];
    try {
      const name = decodeEventLog({ abi: PortalABI, data: l.data, topics: l.topics }).eventName;
      return name === "IntentFulfilled" ? [] : [{ name, at }];
    } catch {
      return [];
    }
  });

const startEvm = async (): Promise<ChildProcess> => {
  const anvil = spawn(
    "anvil",
    ["--port", String(PORT), "--chain-id", String(CHAIN_ID), "--silent"],
    { stdio: "ignore" },
  );
  await waitForRpc(Date.now() + STARTUP_TIMEOUT_MS);

  const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
  sauce = await startGatedEngine(
    { publicClient, testClient, walletClient },
    DEPLOYER.address,
    creationCode,
  );
  // The harness deploys the engine AT the released address, so a route built with no `engine` —
  // which cooks on `v12EngineAddress()` — cooks on it.
  if (sauce.engine !== getAddress(v12EngineAddress())) {
    throw new Error(`the harness engine ${sauce.engine} is not the released ${v12EngineAddress()}`);
  }

  ({ portal, executor } = await deployPortal());

  // A second Pot, owned by the Executor. `deployPot(owner, salt)` takes the owner as a parameter, so
  // the deployer can mint one for an address that has no key.
  const { kitchen, potInitCodeHash } = gateAnchors();
  const mint = await walletClient.sendTransaction({
    account: DEPLOYER,
    chain: null,
    to: kitchen,
    data: v12Kitchen.encodeDeployPot(executor, EXECUTOR_POT_SALT),
    gas: GAS_LIMIT,
  });
  await publicClient.waitForTransactionReceipt({ hash: mint });
  executorPot = getCreate2Address({
    bytecodeHash: potInitCodeHash,
    from: kitchen,
    salt: keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "bytes32" }],
        [executor, EXECUTOR_POT_SALT],
      ),
    ),
  });
  if (!(await publicClient.getCode({ address: executorPot }))) {
    throw new Error(`no Pot was minted for the Executor at ${executorPot}`);
  }

  markerToken = await deploy(MOCK_ERC20.creationCode);
  rewardToken = await deploy(MOCK_ERC20.creationCode);
  tokenB = await deploy(MOCK_ERC20.creationCode);
  tokenC = await deploy(MOCK_ERC20.creationCode);
  deliveredToken = await deploy(MOCK_ERC20.creationCode);
  liar = await deploy(FALSE_RETURN_ERC20.creationCode);
  usdt = await deploy(
    `${NO_RETURN_ERC20.creationCode}${encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "uint8" }],
      ["Tether USD", "USDT", 6],
    ).slice(2)}` as Hex,
  );

  return anvil;
};

/** A fresh eco-routes Portal, and the Executor it created. A new one has a new Executor, and so a
 *  canonical Pot nobody has deployed yet. */
const deployPortal = async (): Promise<{ portal: Address; executor: Address }> => {
  const deployed = await deploy(
    `${PORTAL_FIXTURE.creationCode}${encodeAbiParameters([{ type: "address" }], ["0x0000000000000000000000000000000000000000"]).slice(2)}` as Hex,
  );
  const its = (await publicClient.readContract({
    abi: portalAbi,
    address: deployed,
    functionName: "executor",
  })) as Address;

  return { portal: deployed, executor: its };
};

const stopEvm = (anvil: ChildProcess): Promise<void> => {
  if (anvil.exitCode !== null) return Promise.resolve();
  const exited = once(anvil, "exit");
  anvil.kill();

  return exited.then(() => undefined);
};

// ---------------------------------------------------------------------------
// The child under test
// ---------------------------------------------------------------------------

const CHILD_PORTAL = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
/** `Pot.cook`'s `onlyOwner` refusal. */
const NOT_OWNER_SELECTOR = "0x30cd7471" as const;
/** The Executor's refusal to call an address with no code — what a missing Pot reverts with. */
const CALL_TO_EOA_SELECTOR = "0x2db59289" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const PROVER = "0x4444444444444444444444444444444444444444" as const;
const CHILD_SALT = `0x${"0c".repeat(32)}` as Hex;
const DELIVERED = "0x00000000000000000000000000000000000000d1" as const;

/** The measured balance the Pot is seeded with, and the 1% spread applied to it. */
const MEASURED = 0x00_00_ab_cd_ef_12_34n;
const SCALE = 990000000000000000n;

function childIntent(inn: bigint, out: bigint): Intent {
  return {
    destination: CHILD_DESTINATION,
    sourceChainId: BigInt(CHAIN_ID),
    route: normalizeRoute({
      salt: CHILD_SALT,
      deadline: 4_000_000_000n,
      portal: CHILD_PORTAL,
      tokens: [{ token: DELIVERED, amount: out }],
      calls: [],
    }),
    reward: normalizeReward({
      deadline: 4_000_000_000n,
      creator: CREATOR,
      prover: PROVER,
      tokens: [{ token: rewardToken, amount: inn }],
    }),
  };
}

const childOptions = (overrides: Partial<DynamicChildOptions> = {}): DynamicChildOptions => ({
  portal,
  measure: { kind: "erc20Balance", token: rewardToken },
  scale: SCALE,
  placeholders: [
    { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 },
    { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut", occurrences: 1 },
  ],
  ...overrides,
});

describeEvm("route nesting, executed", () => {
  let anvil: ChildProcess;

  beforeAll(async () => {
    anvil = await startEvm();
  }, 120_000);

  afterAll(() => (anvil ? stopEvm(anvil) : undefined));

  describe("what a throw mid-cook() does to the parent's route", () => {
    it("reverts the WHOLE fulfilment — no earlier route call survives it", async () => {
      const before = "0x0000000000000000000000000000000000000a01" as Address;
      const after = "0x0000000000000000000000000000000000000a02" as Address;
      // The genuine guard, not a synthetic revert: `minAmountIn` above the Pot's balance is exactly
      // the "the swap produced too little" case the design relies on rejecting.
      const program = dynamicChildProgram([
        {
          child: childIntent(AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER),
          opts: childOptions({ minAmountIn: 10n ** 30n }),
        },
      ]);

      const { status, intentHash } = await fulfil([
        markerCall(before),
        cookCall(program.source),
        markerCall(after),
      ]);

      expect(status).toBe("reverted");
      // Neither side of the throwing cook left a trace. A surviving `before` would mean a
      // partially-executed route and a fund-stranding design; a surviving `after` would mean the
      // throw was swallowed entirely.
      expect(await balanceOf(markerToken, before)).toBe(0n);
      expect(await balanceOf(markerToken, after)).toBe(0n);
      // `_fulfill` writes `claimants[intentHash]` BEFORE calling the Executor, so an unset claimant
      // is direct evidence the revert unwound state the Portal itself had already written.
      expect(
        await publicClient.readContract({
          abi: portalAbi,
          address: portal,
          functionName: "claimants",
          args: [intentHash],
        }),
      ).toBe(`0x${"00".repeat(32)}`);
    }, 120_000);

    it("CONTROL: the same route with the guard satisfied applies both marker calls", async () => {
      const before = "0x0000000000000000000000000000000000000b01" as Address;
      const after = "0x0000000000000000000000000000000000000b02" as Address;
      await mintTo(rewardToken, executorPot, MEASURED);

      const program = dynamicChildProgram([
        {
          child: childIntent(AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER),
          opts: childOptions(),
        },
      ]);

      const { status } = await fulfil([
        markerCall(before),
        cookCall(program.source),
        markerCall(after),
      ]);

      expect(status).toBe("success");
      expect(await balanceOf(markerToken, before)).toBe(1n);
      expect(await balanceOf(markerToken, after)).toBe(1n);
    }, 120_000);
  });

  describe("the child the program published", () => {
    it("is the exact intent the SDK predicted, funded with the measured balance", async () => {
      // A distinct salt so this child is a different intent from the CONTROL's, which already
      // published and funded one.
      const child = (inn: bigint, out: bigint): Intent => ({
        ...childIntent(inn, out),
        route: { ...childIntent(inn, out).route, salt: `0x${"0d".repeat(32)}` as Hex },
      });
      const opts = childOptions();
      // Seeded here, not in `beforeAll`: the CONTROL above published and funded a child from the
      // Pot's balance, so by construction it left nothing behind — which the assertion after the
      // fulfilment relies on being true again at the end.
      await mintTo(rewardToken, executorPot, MEASURED);
      const measured = await balanceOf(rewardToken, executorPot);
      expect(measured).toBe(MEASURED);

      const program = dynamicChildProgram([
        { child: child(AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER), opts },
      ]);
      const { status, logs } = await fulfil([cookCall(program.source)]);
      expect(status).toBe("success");

      const amountIn = measured;
      const amountOut = scaleAmount(amountIn, SCALE);
      expect(amountOut).not.toBe(amountIn); // the scale really is doing something
      const concrete = child(amountIn, amountOut);
      const expectedHash = hashIntent(concrete).intentHash;

      // 1. The Portal's OWN hash of the bytes it received equals the SDK's hash of the concrete
      //    intent. The Portal derived this from `keccak256(route)` of bytes the program assembled.
      const published = publishedIn(logs);
      expect(published).toHaveLength(1);
      const event = published[0]!;
      expect(event.intentHash).toBe(expectedHash);

      // 2. The ROUTE BYTES the program concatenated, read back off the chain, are byte-for-byte what
      //    the SDK encodes for the concrete child. This is the assertion that covers `.toBytesBe(32)`
      //    being zero-padded big-endian, `.concat` inserting nothing, and `evm.call` delivering the
      //    assembled payload unchanged.
      expect(event.route.toLowerCase()).toBe(encodeRouteEvm(concrete.route).toLowerCase());
      expect(event.destination).toBe(CHILD_DESTINATION);

      // 3. The reward leg carries the MEASURED amount — so `ctx.self()` was the Pot whose balance
      //    was seeded, not the engine or the Executor.
      expect(event.rewardTokens).toHaveLength(1);
      expect(event.rewardTokens[0]!.amount).toBe(amountIn);
      expect(event.rewardTokens[0]!.token.toLowerCase()).toBe(rewardToken.toLowerCase());

      // 4. It is FUNDED, and the funds are in the vault the Portal derives for that exact hash — so
      //    the emitted `approve` really did let `_fundToken` pull from the Pot.
      const status_ = await publicClient.readContract({
        abi: portalAbi,
        address: portal,
        functionName: "getRewardStatus",
        args: [expectedHash],
      });
      expect(status_).toBe(1); // IIntentSource.Status.Funded

      const vault = (await publicClient.readContract({
        abi: portalAbi,
        address: portal,
        functionName: "intentVaultAddress",
        args: [
          concrete.destination,
          encodeRouteEvm(concrete.route),
          {
            deadline: concrete.reward.deadline,
            creator: CREATOR,
            prover: PROVER,
            nativeAmount: 0n,
            tokens: [{ token: rewardToken, amount: amountIn }],
          },
        ],
      })) as Address;
      expect(await balanceOf(rewardToken, vault)).toBe(amountIn);
      // And the Pot kept nothing back.
      expect(await balanceOf(rewardToken, executorPot)).toBe(0n);
    }, 120_000);

    it("DEPTH 2: the child it published creates its own dynamic child when fulfilled", async () => {
      // Three levels, and NO amount below the first exists when the parent is signed. The parent
      // measures tokenB and publishes the child; fulfilling the child mints tokenC (standing in for
      // its own swap), measures it, and publishes the GRANDCHILD.
      //
      // Why this composes at all, and it is worth stating because it looks like it should not: the
      // grandchild's sentinels are CUT OUT by `splitByPlaceholders` before its program is compiled,
      // so they do not appear in that program's bytecode. The child's route embeds those bytes
      // verbatim, and when the parent splits the child's calldata it finds only the CHILD's own
      // sentinels. Each level's numbers are spliced by the level above it, at that level's own
      // execution time, and no level needs to know the ones below.
      const PARENT_YIELD = 7_000_000n; // tokenB the parent's "swap" left in the Pot
      const CHILD_YIELD = 3_000_000n; // tokenC the child's own route call produces
      const CHILD_SCALE = 990000000000000000n;
      const GRANDCHILD_SCALE = 980000000000000000n;

      const grandchild = (inn: bigint, out: bigint): Intent => ({
        destination: BigInt(CHAIN_ID),
        sourceChainId: BigInt(CHAIN_ID),
        route: normalizeRoute({
          salt: `0x${"9c".repeat(32)}` as Hex,
          deadline: 4_000_000_000n,
          portal,
          tokens: [{ token: deliveredToken, amount: out }],
          calls: [],
        }),
        reward: normalizeReward({
          deadline: 4_000_000_000n,
          creator: CREATOR,
          prover: PROVER,
          tokens: [{ token: tokenC, amount: inn }],
        }),
      });
      const grandchildOpts: DynamicChildOptions = {
        portal,
        measure: { kind: "erc20Balance", token: tokenC },
        scale: GRANDCHILD_SCALE,
        placeholders: [
          { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 },
          { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut", occurrences: 1 },
        ],
      };
      const grandchildProgram = dynamicChildProgram([
        { child: grandchild(AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER), opts: grandchildOpts },
      ]);

      // The child: its own route mints tokenC (the "swap") and then cooks the grandchild program.
      // Its reward and its route delivery obligation are BOTH sentinels the parent will fill.
      const child = (inn: bigint, out: bigint): Intent => ({
        destination: BigInt(CHAIN_ID),
        sourceChainId: BigInt(CHAIN_ID),
        route: normalizeRoute({
          salt: `0x${"9b".repeat(32)}` as Hex,
          deadline: 4_000_000_000n,
          portal,
          tokens: [{ token: deliveredToken, amount: out }],
          calls: [
            {
              target: tokenC,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "mint",
                args: [executorPot, CHILD_YIELD],
              }),
            },
            cookCall(grandchildProgram.source),
          ],
        }),
        reward: normalizeReward({
          deadline: 4_000_000_000n,
          creator: CREATOR,
          prover: PROVER,
          tokens: [{ token: tokenB, amount: inn }],
        }),
      });
      const childOpts: DynamicChildOptions = {
        portal,
        measure: { kind: "erc20Balance", token: tokenB },
        scale: CHILD_SCALE,
        placeholders: [
          { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 },
          { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut", occurrences: 1 },
        ],
      };
      const childProgram = dynamicChildProgram([
        { child: child(AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER), opts: childOpts },
      ]);

      // ---- level 1: fulfil the parent ------------------------------------------------------
      const parent = await fulfil([
        {
          target: tokenB,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "mint",
            args: [executorPot, PARENT_YIELD],
          }),
          value: 0n,
        },
        cookCall(childProgram.source),
      ]);
      expect(parent.status).toBe("success");

      const childAmountIn = PARENT_YIELD;
      const childAmountOut = scaleAmount(childAmountIn, CHILD_SCALE);
      const concreteChild = child(childAmountIn, childAmountOut);
      const publishedChild = publishedIn(parent.logs);
      expect(publishedChild).toHaveLength(1);
      expect(publishedChild[0]!.intentHash).toBe(hashIntent(concreteChild).intentHash);
      expect(publishedChild[0]!.route.toLowerCase()).toBe(
        encodeRouteEvm(concreteChild.route).toLowerCase(),
      );

      // ---- level 2: fulfil THAT child, from the bytes the chain published -------------------
      // Decoded from the log, not rebuilt from the SDK: whatever the program actually assembled is
      // what gets fulfilled, so a discrepancy surfaces as a failed fulfilment rather than as a
      // passing comparison between two things this suite computed.
      const [publishedRoute] = decodeAbiParameters(
        [EVM_ROUTE_PARAM],
        publishedChild[0]!.route,
      ) as unknown as [EvmRoute];
      expect(publishedRoute.tokens[0]!.amount).toBe(childAmountOut);

      // The child's own delivery obligation is a real solver posting, pulled by `_fulfill`.
      await mintTo(deliveredToken, DEPLOYER.address, childAmountOut);
      const approve = await walletClient.sendTransaction({
        account: DEPLOYER,
        chain: null,
        to: deliveredToken,
        data: encodeFunctionData({
          abi: erc20ApproveAbi,
          functionName: "approve",
          args: [portal, childAmountOut],
        }),
        gas: GAS_LIMIT,
      });
      await publicClient.waitForTransactionReceipt({ hash: approve });

      const childFulfilment = await fulfilRoute(
        publishedRoute,
        rewardOf(publishedChild[0]!).rewardHash,
      );
      expect(childFulfilment.status).toBe("success");

      // ---- the grandchild -------------------------------------------------------------------
      const grandchildAmountIn = CHILD_YIELD;
      const grandchildAmountOut = scaleAmount(grandchildAmountIn, GRANDCHILD_SCALE);
      const concreteGrandchild = grandchild(grandchildAmountIn, grandchildAmountOut);
      const publishedGrandchild = publishedIn(childFulfilment.logs);

      expect(publishedGrandchild).toHaveLength(1);
      expect(publishedGrandchild[0]!.intentHash).toBe(hashIntent(concreteGrandchild).intentHash);
      expect(publishedGrandchild[0]!.route.toLowerCase()).toBe(
        encodeRouteEvm(concreteGrandchild.route).toLowerCase(),
      );
      // Derived from the CHILD's measurement, at the child's execution time -- a number that did
      // not exist anywhere when the parent was signed, and that the parent never touched.
      expect(publishedGrandchild[0]!.rewardTokens[0]!.amount).toBe(grandchildAmountIn);
      expect(
        await publicClient.readContract({
          abi: portalAbi,
          address: portal,
          functionName: "getRewardStatus",
          args: [hashIntent(concreteGrandchild).intentHash],
        }),
      ).toBe(1);

      // Gas, for the depth budget: reported rather than asserted, since it moves with the fixture.
      console.log(
        `depth-2 cascade gas — parent fulfilment ${parent.gasUsed}, child fulfilment ${childFulfilment.gasUsed}`,
      );
    }, 180_000);

    it("the width guard throws rather than truncating an over-wide amount", async () => {
      await mintTo(rewardToken, executorPot, 2n ** 70n);
      // An 8-byte slot cannot hold a value above 2^64 - 1; `emitTemplate` emits
      // IntentTemplate's AmountDoesNotFit guard for exactly this, and it must revert rather than
      // publish a child obliging delivery of a truncated number.
      const narrow = childIntent(AMOUNT_IN_PLACEHOLDER, 0xdeadbeefn);
      const opts = childOptions({
        scale: WAD,
        placeholders: [
          { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 },
          { value: 0xdeadbeefn, source: "amountIn", width: 8, occurrences: 1 },
        ],
      });
      const stmts = dynamicChildStatements(narrow, 0, opts);
      expect(stmts.some((s) => s.includes("does not fit"))).toBe(true);

      const program = dynamicChildProgram([{ child: narrow, opts }]);
      const { status } = await fulfil([cookCall(program.source)]);

      expect(status).toBe("reverted");
    }, 120_000);
  });

  describe("a token whose approve/transfer returns nothing (USDT)", () => {
    // The hazard this exists for: compiler 2.3.0 lowers a declared `bool` output to call-then-DECODE
    // even when nothing reads it, and decoding from empty returndata reverts on this engine. USDT
    // returns nothing. Both nesting paths used to move tokens through `IERC20`, whose `approve` and
    // `transfer` declare `bool`, so a USDT reward reverted the entire parent fulfilment. Established
    // by execution on `fix/settle-no-return-token` for the settle sweep; these are the route-layer
    // cases. A mintable standard ERC20 cannot catch it, which is why the earlier tests did not.
    const USDT_MEASURED = 5_000_000n;

    it("DYNAMIC: publishes and funds a child whose reward token returns nothing", async () => {
      await mintTo(usdt, executorPot, USDT_MEASURED);

      const child = (inn: bigint, out: bigint): Intent => ({
        destination: BigInt(CHAIN_ID),
        sourceChainId: BigInt(CHAIN_ID),
        route: normalizeRoute({
          salt: `0x${"d7".repeat(32)}` as Hex,
          deadline: 4_000_000_000n,
          portal,
          tokens: [{ token: deliveredToken, amount: out }],
          calls: [],
        }),
        reward: normalizeReward({
          deadline: 4_000_000_000n,
          creator: CREATOR,
          prover: PROVER,
          tokens: [{ token: usdt, amount: inn }],
        }),
      });
      const opts: DynamicChildOptions = {
        portal,
        measure: { kind: "erc20Balance", token: usdt },
        scale: WAD,
        placeholders: [
          { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 },
          { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut", occurrences: 1 },
        ],
      };
      const program = dynamicChildProgram([
        { child: child(AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER), opts },
      ]);

      const { status } = await fulfil([cookCall(program.source)]);
      expect(status).toBe("success");

      const concrete = child(USDT_MEASURED, USDT_MEASURED);
      expect(
        await publicClient.readContract({
          abi: portalAbi,
          address: portal,
          functionName: "getRewardStatus",
          args: [hashIntent(concrete).intentHash],
        }),
      ).toBe(1);
      expect(await balanceOf(usdt, executorPot)).toBe(0n);
    }, 120_000);

    it("DYNAMIC: a stale non-zero allowance no longer breaks the next fulfilment", async () => {
      // USDT refuses a non-zero -> non-zero allowance change, and ONE Executor-owned Pot is shared
      // by every intent on the chain -- so an allowance left by an earlier fulfilment used to break
      // the next one outright. `forceApprove` semantics reset it first. Before this change the
      // fulfilment below reverted.
      await mintTo(usdt, executorPot, USDT_MEASURED);
      const child = (inn: bigint): Intent => ({
        destination: BigInt(CHAIN_ID),
        sourceChainId: BigInt(CHAIN_ID),
        route: normalizeRoute({
          salt: `0x${"d8".repeat(32)}` as Hex,
          deadline: 4_000_000_000n,
          portal,
          tokens: [{ token: deliveredToken, amount: AMOUNT_OUT_PLACEHOLDER }],
          calls: [],
        }),
        reward: normalizeReward({
          deadline: 4_000_000_000n,
          creator: CREATOR,
          prover: PROVER,
          tokens: [{ token: usdt, amount: inn }],
        }),
      });
      const opts: DynamicChildOptions = {
        portal,
        measure: { kind: "erc20Balance", token: usdt },
        scale: WAD,
        placeholders: [
          { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 },
          { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut", occurrences: 1 },
        ],
      };
      const program = dynamicChildProgram([{ child: child(AMOUNT_IN_PLACEHOLDER), opts }]);

      const { status } = await fulfil([
        // Leave 1 wei of allowance standing, as a previous fulfilment would.
        cookCall(`evm.call(${BigInt(usdt)}n, 0n, ${approveLiteral(portal, 1n)});`),
        cookCall(program.source),
      ]);

      expect(status).toBe("success");
      // Reset to zero, then set to the measured amount -- and fully consumed by the Portal's pull.
      expect(await balanceOf(usdt, executorPot)).toBe(0n);
    }, 120_000);

    it("DYNAMIC: a token that REVERTS on approve still reverts the whole fulfilment", async () => {
      // Checking the return value must not replace checking the call. A token that refuses outright
      // still takes the fulfilment down with it.
      const marker = "0x0000000000000000000000000000000000000d02" as Address;
      const reverting = await deploy(REVERTING_ERC20_CREATION);
      await mintTo(usdt, executorPot, USDT_MEASURED);

      const child: Intent = {
        destination: BigInt(CHAIN_ID),
        sourceChainId: BigInt(CHAIN_ID),
        route: normalizeRoute({
          salt: `0x${"db".repeat(32)}` as Hex,
          deadline: 4_000_000_000n,
          portal,
          calls: [],
        }),
        reward: normalizeReward({
          deadline: 4_000_000_000n,
          creator: CREATOR,
          prover: PROVER,
          tokens: [{ token: reverting, amount: AMOUNT_IN_PLACEHOLDER }],
        }),
      };
      const program = dynamicChildProgram([
        {
          child,
          opts: {
            portal,
            measure: { kind: "expression", expression: "5n" },
            scale: WAD,
            placeholders: [{ value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 }],
          },
        },
      ]);

      const { status } = await fulfil([markerCall(marker), cookCall(program.source)]);

      expect(status).toBe("reverted");
      expect(await balanceOf(markerToken, marker)).toBe(0n);
    }, 120_000);

    it("TRANSFER MODE: moves a no-return token to the child's vault", async () => {
      // `nest.ts`'s default nesting mode, not the dynamic one -- the same bool-decode hazard reached
      // it through `IERC20.transfer`, so a plain static cascade rewarded in USDT failed too.
      await mintTo(usdt, executorPot, USDT_MEASURED);
      const vault = "0x0000000000000000000000000000000000000e01" as Address;
      // Read rather than assumed: earlier cases in this file leave the Pot with a balance, and
      // `clamp: false` moves whatever is there.
      const held = await balanceOf(usdt, executorPot);
      expect(held).toBeGreaterThanOrEqual(USDT_MEASURED);

      const staticChild: Intent = {
        destination: BigInt(CHAIN_ID),
        sourceChainId: BigInt(CHAIN_ID),
        route: normalizeRoute({
          salt: `0x${"d9".repeat(32)}` as Hex,
          deadline: 4_000_000_000n,
          portal,
          calls: [],
        }),
        reward: normalizeReward({
          deadline: 4_000_000_000n,
          creator: CREATOR,
          prover: PROVER,
          tokens: [{ token: usdt, amount: USDT_MEASURED }],
        }),
      };
      const program = nestedTransferProgram([
        {
          child: staticChild,
          opts: { vaultResolution: { mode: "explicit", vault }, clamp: false },
        },
      ]);

      const { status } = await fulfil([cookCall(program.source)]);

      expect(status).toBe("success");
      expect(await balanceOf(usdt, vault)).toBe(held);
      expect(await balanceOf(usdt, executorPot)).toBe(0n);
    }, 120_000);

    it("TRANSFER MODE: a transfer the token refuses still reverts the whole fulfilment", async () => {
      // Skipping the decode must not turn a real failure into a silent success. Neither clamp mode
      // can ask a token for more than the Pot holds, so the refusal is the RECIPIENT: OpenZeppelin's
      // ERC20 rejects a transfer to the zero address, which is the same control shape
      // `fix/settle-no-return-token` uses for the settle sweep. The lowering is token-agnostic, so
      // this establishes revert propagation for the transfer emitter itself.
      const marker = "0x0000000000000000000000000000000000000e03" as Address;
      await mintTo(rewardToken, executorPot, 1_000n);

      const staticChild: Intent = {
        destination: BigInt(CHAIN_ID),
        sourceChainId: BigInt(CHAIN_ID),
        route: normalizeRoute({
          salt: `0x${"da".repeat(32)}` as Hex,
          deadline: 4_000_000_000n,
          portal,
          calls: [],
        }),
        reward: normalizeReward({
          deadline: 4_000_000_000n,
          creator: CREATOR,
          prover: PROVER,
          tokens: [{ token: rewardToken, amount: 1_000n }],
        }),
      };
      const program = nestedTransferProgram([
        {
          child: staticChild,
          opts: {
            vaultResolution: {
              mode: "explicit",
              vault: "0x0000000000000000000000000000000000000000",
            },
            clamp: false,
          },
        },
      ]);

      const { status } = await fulfil([markerCall(marker), cookCall(program.source)]);

      expect(status).toBe("reverted");
      expect(await balanceOf(markerToken, marker)).toBe(0n);
    }, 120_000);
  });

  describe("a body that opens an intent, as published", () => {
    // A body that forwards what it measured to Arbitrum (the README's example before it took `main`
    // arguments, which a body cannot; the README's own runs in `docs-examples.mainnet`). What only
    // an engine can settle is whether the Portal accepts what its lowering builds -- and whether the
    // amount the program measured is the amount the published intent carries.
    const SEEDED = 12_345_678n;
    const DELIVER_TO = "0x00000000000000000000000000000000000000a5" as Address;

    it("publishes an intent carrying the balance it measured", async () => {
      // The body says `USDC`, and it is compiled with the SDK's own registry: Base's USDC for
      // the program and its reward, Arbitrum's for the body. The mock goes at Base's registry
      // address, and nothing is at Arbitrum's, as on Base itself. This test used to give `USDC` one
      // address on every chain with a `tokens` override, which is how a reward resolved against the
      // destination passed it; `routes-intent-chains.e2e.test.ts` runs both chains.
      const token = numberToHex(registryTokenAddress(requireChain("base"), "USDC")!, { size: 20 });
      const arbitrumUsdc = numberToHex(registryTokenAddress(requireChain("arbitrum"), "USDC")!, {
        size: 20,
      });
      const mock = await deploy(MOCK_ERC20.creationCode);
      await testClient.setCode({
        address: token,
        bytecode: (await publicClient.getCode({ address: mock }))!,
      });
      expect(await publicClient.getCode({ address: arbitrumUsdc })).toBeUndefined();
      const compiled = compileSauceRoute(
        "base",
        BODY_TO_ARBITRUM,
        { pot: executorPot, engine: sauce.engine },
        {
          defines: { RECIPIENT: BigInt(DELIVER_TO), MIN_AMOUNT: 1n },
          intents: {
            deadline: 4_000_000_000n,
            prover: PROVER,
            // This anvil's Portal, not the registry's. On a real chain both come from the registry.
            sourcePortal: portal,
            destinationPortal: portal,
            salt: `0x${"ee".repeat(32)}` as Hex,
          },
        },
      );
      // Nothing in the body mentions the Portal, a selector or an approval.
      expect(BODY_TO_ARBITRUM).not.toMatch(/publishAndFund|evm\.call|hex`/);

      const { status, logs } = await fulfil([
        {
          target: token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "mint",
            args: [executorPot, SEEDED],
          }),
          value: 0n,
        },
        {
          target: denormalizeToEvm(toUniversalAddress(compiled.calls[0]!.target)),
          data: compiled.calls[0]!.data,
          value: 0n,
        },
      ]);
      expect(status).toBe("success");

      const published = publishedIn(logs);
      expect(published).toHaveLength(1);
      expect(published[0]!.destination).toBe(42_161n); // Arbitrum, as the body names
      // Escrowed here, so in this chain's USDC; delivered there, in that chain's.
      expect(published[0]!.rewardTokens.map((t) => [t.token.toLowerCase(), t.amount])).toEqual([
        [token.toLowerCase(), SEEDED],
      ]);
      const [route] = decodeAbiParameters([EVM_ROUTE_PARAM], published[0]!.route) as unknown as [
        EvmRoute,
      ];
      expect(route.tokens.map((t) => t.token.toLowerCase())).toEqual([arbitrumUsdc.toLowerCase()]);
      expect(route.calls.map((c) => c.target.toLowerCase())).toEqual([arbitrumUsdc.toLowerCase()]);
      // Funded the way a solver checks it: the vault the Portal derives holds the reward.
      const view = await portalView(published[0]!);
      expect(view.funded).toBe(true);
      expect(await balanceOf(token, view.vault)).toBe(SEEDED);
    }, 180_000);

    it("refuses to create the intent when the floor is not met, reverting everything", async () => {
      const token = await deploy(MOCK_ERC20.creationCode);
      const marker = "0x0000000000000000000000000000000000000f01" as Address;
      const compiled = compileSauceRoute(
        "base",
        BODY_TO_ARBITRUM,
        { pot: executorPot, engine: sauce.engine },
        {
          tokens: { USDC: token },
          // Nothing was minted, so the balance is below this floor and the program throws.
          defines: { RECIPIENT: BigInt(DELIVER_TO), MIN_AMOUNT: 1n },
          intents: {
            deadline: 4_000_000_000n,
            prover: PROVER,
            sourcePortal: portal,
            destinationPortal: portal,
            salt: `0x${"ef".repeat(32)}` as Hex,
          },
        },
      );

      const { status } = await fulfil([
        markerCall(marker),
        {
          target: denormalizeToEvm(toUniversalAddress(compiled.calls[0]!.target)),
          data: compiled.calls[0]!.data,
          value: 0n,
        },
      ]);

      expect(status).toBe("reverted");
      expect(await balanceOf(markerToken, marker)).toBe(0n);
    }, 180_000);
  });

  describe("SafeERC20 semantics on every token write", () => {
    // `token/safe.ts` issues the write raw -- so nothing decodes a `bool` that a no-return token
    // never sends -- and then CHECKS what came back, which is the half the first version skipped.
    // These run the emitted statements directly through a cook: no intent, so a failure here is the
    // token check and nothing else.
    const cookStatements = (statements: readonly string[]) =>
      cookCall(`function main() {\n${statements.join("\n")}\n}`);

    it("a token that returns FALSE reverts instead of passing", async () => {
      // The case `SafeERC20` exists for. Skipping the decode accepted this as success and the value
      // was quietly gone; before this change the fulfilment below succeeded.
      await mintTo(liar, executorPot, 5_000n);
      const marker = "0x0000000000000000000000000000000000000e10" as Address;

      const { status } = await fulfil([
        markerCall(marker),
        cookStatements(
          safeTransferStatements(
            "s0_",
            `${BigInt(liar)}n`,
            { literal: BigInt(CREATOR) },
            {
              literal: 1_000n,
            },
          ),
        ),
      ]);

      expect(status).toBe("reverted");
      expect(await balanceOf(markerToken, marker)).toBe(0n);
    }, 120_000);

    it("a token that returns NOTHING succeeds", async () => {
      await mintTo(usdt, executorPot, 5_000n);
      const before = await balanceOf(usdt, CREATOR);

      const { status } = await fulfil([
        cookStatements(
          safeTransferStatements(
            "s1_",
            `${BigInt(usdt)}n`,
            { literal: BigInt(CREATOR) },
            {
              literal: 1_000n,
            },
          ),
        ),
      ]);

      expect(status).toBe("success");
      expect(await balanceOf(usdt, CREATOR)).toBe(before + 1_000n);
    }, 120_000);

    it("a target with NO CODE reverts", async () => {
      // A call to an EOA always succeeds and returns nothing, so an unchecked write to a mistyped
      // or undeployed token address looked exactly like a successful transfer.
      const notAToken = "0x000000000000000000000000000000000000ee01" as Address;
      expect(await publicClient.getCode({ address: notAToken })).toBeUndefined();

      const { status } = await fulfil([
        cookStatements(
          safeTransferStatements(
            "s2_",
            `${BigInt(notAToken)}n`,
            { literal: BigInt(CREATOR) },
            {
              literal: 1n,
            },
          ),
        ),
      ]);

      expect(status).toBe("reverted");
    }, 120_000);

    it("approve resets a standing non-zero allowance before setting a new one", async () => {
      // USDT's rule, and the reason it matters here: one Pot, shared by every intent on the chain.
      const spender = "0x000000000000000000000000000000000000ee02" as Address;
      const allowanceOf = (owner: Address) =>
        publicClient.readContract({
          abi: erc20AllowanceAbi,
          address: usdt,
          functionName: "allowance",
          args: [owner, spender],
        }) as Promise<bigint>;

      const first = await fulfil([
        cookStatements(
          safeApproveStatements(
            "s3_",
            `${BigInt(usdt)}n`,
            { literal: BigInt(spender) },
            {
              literal: 7n,
            },
          ),
        ),
      ]);
      expect(first.status).toBe("success");
      expect(await allowanceOf(executorPot)).toBe(7n);

      // A plain approve here is the nonzero -> nonzero change USDT refuses; this one resets first.
      const second = await fulfil([
        cookStatements(
          safeApproveStatements(
            "s4_",
            `${BigInt(usdt)}n`,
            { literal: BigInt(spender) },
            {
              literal: 9n,
            },
          ),
        ),
      ]);

      expect(second.status).toBe("success");
      expect(await allowanceOf(executorPot)).toBe(9n);
    }, 180_000);

    it("FAILING-FIRST CONTROL: the plain approve USDT refuses does revert", async () => {
      // Establishes that the case above is real rather than vacuous: without the reset, the same
      // nonzero -> nonzero change fails.
      const spender = "0x000000000000000000000000000000000000ee03" as Address;
      await fulfil([
        cookStatements(
          safeApproveStatements(
            "s5_",
            `${BigInt(usdt)}n`,
            { literal: BigInt(spender) },
            {
              literal: 3n,
            },
          ),
        ),
      ]);

      const { status } = await fulfil([
        cookCall(`evm.call(${BigInt(usdt)}n, 0n, ${approveLiteral(spender, 4n)});`),
      ]);

      expect(status).toBe("reverted");
    }, 180_000);
  });

  describe("`Chain.Portal.send(...).creator(0x3333333333333333333333333333333333333333).receive(...).then(...)` written inside the program", () => {
    // The syntax the SDK exists to offer: an intent created from a Sauce program with no Portal,
    // no selector, no offset word and no approve written by the author. Everything below the
    // `PROGRAM` constant is the lowering's output, and none of it appears in the source.
    //
    // What only an engine can settle is whether the Portal accepts what that lowering builds, and
    // whether the value captured from the enclosing program arrives where the encoding says it
    // does. Both are read back out of the Portal's own log.
    const SEEDED = 4_242_424n;
    const DELIVER_TO = "0x00000000000000000000000000000000000000b7" as Address;

    const PROGRAM = `function main() {
  const amount = Token(TOKEN).balanceOf(ctx.self());
  Base.Portal.send([{ token: TOKEN, amount }]).creator(0x3333333333333333333333333333333333333333).receive().then(() => {
    Token(TOKEN).transfer(RECIPIENT, amount);
  });
}`;

    it("publishes and funds the intent the SDK encodes, with the captured amount in it", async () => {
      const token = await deploy(MOCK_ERC20.creationCode);
      const compiled = compileSauceRoute(
        "base",
        PROGRAM,
        { pot: executorPot, engine: sauce.engine },
        {
          defines: { TOKEN: BigInt(token), RECIPIENT: BigInt(DELIVER_TO) },
          intents: {
            deadline: 4_000_000_000n,
            prover: PROVER,
            // This anvil's Portal, not the registry's mainnet one. Every OTHER address in the
            // lowered program -- and on a real chain the Portal too -- comes from the registry.
            sourcePortal: portal,
            destinationPortal: portal,
            salt: `0x${"e0".repeat(32)}` as Hex,
          },
        },
      );
      // The author wrote none of this.
      expect(PROGRAM).not.toContain("publishAndFund");
      expect(PROGRAM).not.toContain("evm.call");

      const { status, logs } = await fulfil([
        {
          target: token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "mint",
            args: [executorPot, SEEDED],
          }),
          value: 0n,
        },
        {
          target: denormalizeToEvm(toUniversalAddress(compiled.calls[0]!.target)),
          data: compiled.calls[0]!.data,
          value: 0n,
        },
      ]);
      expect(status).toBe("success");

      const published = publishedIn(logs);
      expect(published).toHaveLength(1);

      // The reward carries the balance the enclosing program measured -- so the capture reached the
      // encoded intent, which is the whole mechanism.
      expect(published[0]!.rewardTokens).toHaveLength(1);
      expect(published[0]!.rewardTokens[0]!.amount).toBe(SEEDED);
      expect(published[0]!.rewardTokens[0]!.token.toLowerCase()).toBe(token.toLowerCase());

      // And the route the solver must run delivers that same amount to the named recipient.
      const [route] = decodeAbiParameters([EVM_ROUTE_PARAM], published[0]!.route) as unknown as [
        EvmRoute,
      ];
      expect(route.tokens[0]!.amount).toBe(SEEDED);
      expect(route.calls).toHaveLength(1);
      const delivered = decodeFunctionData({ abi: erc20Abi, data: route.calls[0]!.data });
      expect(delivered.functionName).toBe("transfer");
      expect((delivered.args![0] as string).toLowerCase()).toBe(DELIVER_TO.toLowerCase());
      expect(delivered.args![1]).toBe(SEEDED);

      // Funded by default the way a solver checks it: the program read the vault from the Portal,
      // paid the reward into it, then published. The vault holds exactly the reward and the Pot is
      // empty -- and no allowance was ever set, so none stands on the shared Pot.
      const view = await portalView(published[0]!);
      expect(view.funded).toBe(true);
      expect(await balanceOf(token, view.vault)).toBe(SEEDED);
      expect(await balanceOf(token, executorPot)).toBe(0n);
      expect(
        await publicClient.readContract({
          address: token,
          abi: erc20AllowanceAbi,
          functionName: "allowance",
          args: [executorPot, portal],
        }),
      ).toBe(0n);
      // `publish` records nothing but the publication: `Initial`, not `Funded`, and no
      // `IntentFunded` -- the vault's balance is the funding.
      expect(view.status).toBe(0);
      const events = portalEventsIn(logs);
      expect(events.map((e) => e.name)).toEqual(["IntentPublished"]);
      // The transfer into the vault landed before the publication announced it.
      const transferAt = logs.findIndex(
        (l) =>
          l.address.toLowerCase() === token.toLowerCase() &&
          l.topics[2]?.toLowerCase() === `0x${"00".repeat(12)}${view.vault.slice(2)}`.toLowerCase(),
      );
      expect(transferAt).toBeGreaterThanOrEqual(0);
      expect(transferAt).toBeLessThan(events[0]!.at);
    }, 180_000);

    /** Compiles `program` for this anvil's Portal, funding via `fundVia`, and fulfils one cook of it. */
    const runIntentProgram = async (
      program: string,
      defines: Record<string, bigint>,
      salt: string,
      fundVia?: "transfer" | "publishAndFund",
    ) => {
      const compiled = compileSauceRoute(
        "base",
        program,
        { pot: executorPot, engine: sauce.engine },
        {
          defines,
          intents: {
            deadline: 4_000_000_000n,
            prover: PROVER,
            sourcePortal: portal,
            destinationPortal: portal,
            salt: `0x${salt.repeat(32)}` as Hex,
            ...(fundVia === undefined ? {} : { fundVia }),
          },
        },
      );

      return fulfil([
        {
          target: denormalizeToEvm(toUniversalAddress(compiled.calls[0]!.target)),
          data: compiled.calls[0]!.data,
          value: 0n,
        },
      ]);
    };

    it("a token whose transfer returns nothing (USDT) funds the vault the same way", async () => {
      await mintTo(usdt, executorPot, SEEDED);
      const held = await balanceOf(usdt, executorPot);
      const { status, logs } = await runIntentProgram(
        PROGRAM,
        { TOKEN: BigInt(usdt), RECIPIENT: BigInt(DELIVER_TO) },
        "e1",
      );

      expect(status).toBe("success");
      const published = publishedIn(logs)[0]!;
      expect(published.rewardTokens[0]!.amount).toBe(held);
      const view = await portalView(published);
      expect(view.funded).toBe(true);
      expect(await balanceOf(usdt, view.vault)).toBe(held);
      expect(await balanceOf(usdt, executorPot)).toBe(0n);
    }, 180_000);

    it("a token that returns false from its transfer reverts the whole fulfilment", async () => {
      // SafeERC20 on the transfer into the vault: `false` is a failure, not a quiet no-op that would
      // publish an intent whose vault is empty.
      const { status } = await runIntentProgram(
        `function main() {
  Base.Portal.send([{ token: TOKEN, amount: 5n }]).creator(0x3333333333333333333333333333333333333333).receive().then(() => {
    Token(TOKEN).transfer(RECIPIENT, 1n);
  });
}`,
        { TOKEN: BigInt(liar), RECIPIENT: BigInt(DELIVER_TO) },
        "e2",
      );

      expect(status).toBe("reverted");
    }, 180_000);

    it("a native reward the program measured is sent to the vault", async () => {
      const NATIVE = 777_000n;
      await testClient.setBalance({ address: executorPot, value: NATIVE });
      const token = await deploy(MOCK_ERC20.creationCode);
      const { status, logs } = await runIntentProgram(
        `function main() {
  const native = ctx.selfBalance();
  Base.Portal.send({ native: native }).creator(0x3333333333333333333333333333333333333333).receive().then(() => {
    Token(TOKEN).transfer(RECIPIENT, 1n);
  });
}`,
        { TOKEN: BigInt(token), RECIPIENT: BigInt(DELIVER_TO) },
        "e3",
      );

      expect(status).toBe("success");
      const published = publishedIn(logs)[0]!;
      expect(published.rewardNativeAmount).toBe(NATIVE);
      const view = await portalView(published);
      expect(view.funded).toBe(true);
      expect(await publicClient.getBalance({ address: view.vault })).toBe(NATIVE);
      expect(await publicClient.getBalance({ address: executorPot })).toBe(0n);
    }, 180_000);

    describe('opted into `fundVia: "publishAndFund"`', () => {
      it("approves the Portal and publishAndFunds: recorded Funded, IntentFunded emitted", async () => {
        const token = await deploy(MOCK_ERC20.creationCode);
        await mintTo(token, executorPot, SEEDED);
        const { status, logs } = await runIntentProgram(
          PROGRAM,
          { TOKEN: BigInt(token), RECIPIENT: BigInt(DELIVER_TO) },
          "e4",
          "publishAndFund",
        );

        expect(status).toBe("success");
        const view = await portalView(publishedIn(logs)[0]!);
        expect(view.funded).toBe(true);
        expect(view.status).toBe(1);
        expect(portalEventsIn(logs).map((e) => e.name)).toEqual([
          "IntentPublished",
          "IntentFunded",
        ]);
        expect(await balanceOf(token, view.vault)).toBe(SEEDED);
        expect(await balanceOf(token, executorPot)).toBe(0n);
      }, 180_000);

      it("a token whose approve returns nothing (USDT) publishes the same way", async () => {
        await mintTo(usdt, executorPot, SEEDED);
        const held = await balanceOf(usdt, executorPot);
        const { status, logs } = await runIntentProgram(
          PROGRAM,
          { TOKEN: BigInt(usdt), RECIPIENT: BigInt(DELIVER_TO) },
          "e5",
          "publishAndFund",
        );

        expect(status).toBe("success");
        expect(publishedIn(logs)[0]!.rewardTokens[0]!.amount).toBe(held);
        expect((await portalView(publishedIn(logs)[0]!)).status).toBe(1);
        expect(await balanceOf(usdt, executorPot)).toBe(0n);
      }, 180_000);

      it("forwards a native reward as publishAndFund's value", async () => {
        const NATIVE = 555_000n;
        await testClient.setBalance({ address: executorPot, value: NATIVE });
        const token = await deploy(MOCK_ERC20.creationCode);
        const { status, logs } = await runIntentProgram(
          `function main() {
  const native = ctx.selfBalance();
  Base.Portal.send({ native: native }).creator(0x3333333333333333333333333333333333333333).receive().then(() => {
    Token(TOKEN).transfer(RECIPIENT, 1n);
  });
}`,
          { TOKEN: BigInt(token), RECIPIENT: BigInt(DELIVER_TO) },
          "e6",
          "publishAndFund",
        );

        expect(status).toBe("success");
        const view = await portalView(publishedIn(logs)[0]!);
        expect(view.status).toBe(1);
        expect(await publicClient.getBalance({ address: view.vault })).toBe(NATIVE);
        expect(await publicClient.getBalance({ address: executorPot })).toBe(0n);
      }, 180_000);
    });
  });

  describe("token-only intent bodies, run by the Portal's Executor", () => {
    // A body of nothing but token transfers and approves is not a Sauce program: it lowers to plain
    // `route.calls`, and the real `Executor.execute` below runs each one raw. It checks that the call
    // did not revert and that the target has code, and nothing else, so these pin what that path does
    // with the two token behaviours SafeERC20 exists for. The intents are published by a real program
    // and fulfilled from the route bytes the Portal logged.
    const AMOUNT = 1_234_567n;
    const STANDING = 7n;
    const RECIPIENT = "0x00000000000000000000000000000000000000e1" as Address;
    const SPENDER = "0x00000000000000000000000000000000000000e2" as Address;
    let saltByte = 0xa0;

    const usdtLike = (): Promise<Address> =>
      deploy(
        `${NO_RETURN_ERC20.creationCode}${encodeAbiParameters(
          [{ type: "string" }, { type: "string" }, { type: "uint8" }],
          ["Tether USD", "USDT", 6],
        ).slice(2)}` as Hex,
      );

    /** Publishes the intent a program opens around `body`, and returns the route and reward hash
     *  the Portal logged — what a solver fulfils. `delivery` is what it `.receive`s: nothing, by
     *  default. */
    const publish = async (
      body: string,
      token: Address,
      delivery = ".receive()",
    ): Promise<{ route: EvmRoute; rewardHash: Hex }> => {
      const reward = await deploy(MOCK_ERC20.creationCode);
      const program = `function main() {
  const amount = Token(REWARD).balanceOf(ctx.self());
  Base.Portal.send([{ token: REWARD, amount }]).creator(${CREATOR})${delivery}.then(() => {
    ${body}
  });
}`;
      const compiled = compileSauceRoute(
        "base",
        program,
        { pot: executorPot, engine: sauce.engine },
        {
          defines: {
            TOKEN: BigInt(token),
            REWARD: BigInt(reward),
            RECIPIENT: BigInt(RECIPIENT),
            SPENDER: BigInt(SPENDER),
            AMOUNT,
          },
          intents: {
            deadline: 4_000_000_000n,
            prover: PROVER,
            sourcePortal: portal,
            destinationPortal: portal,
            salt: `0x${(saltByte++).toString(16).repeat(32)}` as Hex,
          },
        },
      );
      const parent = await fulfil([
        {
          target: reward,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "mint",
            args: [executorPot, 1n],
          }),
          value: 0n,
        },
        {
          target: denormalizeToEvm(toUniversalAddress(compiled.calls[0]!.target)),
          data: compiled.calls[0]!.data,
          value: 0n,
        },
      ]);
      expect(parent.status).toBe("success");
      const [published] = publishedIn(parent.logs);
      const [route] = decodeAbiParameters([EVM_ROUTE_PARAM], published!.route) as unknown as [
        EvmRoute,
      ];

      return { route, rewardHash: rewardOf(published!).rewardHash };
    };

    /** What a solver does first: hold the route's tokens and let the Portal pull them. */
    const provide = async (route: EvmRoute): Promise<void> => {
      for (const { token, amount } of route.tokens) {
        await mintTo(token, DEPLOYER.address, amount);
        const hash = await walletClient.sendTransaction({
          account: DEPLOYER,
          chain: null,
          to: token,
          data: encodeFunctionData({
            abi: erc20ApproveAbi,
            functionName: "approve",
            args: [portal, amount],
          }),
          gas: GAS_LIMIT,
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }
    };

    /** An allowance the Executor already has, as an earlier intent's approve would leave it. */
    const leaveAllowance = async (token: Address): Promise<void> => {
      const earlier = await fulfil([
        {
          target: token,
          data: encodeFunctionData({
            abi: erc20ApproveAbi,
            functionName: "approve",
            args: [SPENDER, STANDING],
          }),
          value: 0n,
        },
      ]);
      expect(earlier.status).toBe("success");
      expect(await executorAllowance(token)).toBe(STANDING);
    };

    const executorAllowance = (token: Address): Promise<bigint> =>
      publicClient.readContract({
        address: token,
        abi: erc20AllowanceAbi,
        functionName: "allowance",
        args: [executor, SPENDER],
      }) as Promise<bigint>;

    const approveCalls = (route: EvmRoute) =>
      route.calls.map((call) => {
        const { functionName, args } = decodeFunctionData({
          abi: erc20ApproveAbi,
          data: call.data,
        });
        return [functionName, (args[0] as string).toLowerCase(), args[1]];
      });

    it("(a) a USDT-style transfer fulfils, and the recipient is paid", async () => {
      const usdtToken = await usdtLike();
      const { route, rewardHash } = await publish(
        "Token(TOKEN).transfer(RECIPIENT, AMOUNT);",
        usdtToken,
      );
      expect(route.calls).toHaveLength(1);
      await provide(route);

      expect((await fulfilRoute(route, rewardHash)).status).toBe("success");
      expect(await balanceOf(usdtToken, RECIPIENT)).toBe(AMOUNT);
      expect(await balanceOf(usdtToken, executor)).toBe(0n);
    }, 180_000);

    it("(b) a USDT-style approve over a standing allowance fulfils, through the reset", async () => {
      const usdtToken = await usdtLike();
      await leaveAllowance(usdtToken);
      const { route, rewardHash } = await publish(
        "Token(TOKEN).approve(SPENDER, AMOUNT);",
        usdtToken,
      );
      expect(approveCalls(route)).toEqual([
        ["approve", SPENDER.toLowerCase(), 0n],
        ["approve", SPENDER.toLowerCase(), AMOUNT],
      ]);

      // CONTROL: the same route without the reset — what this lowering emitted before — is the
      // non-zero-to-non-zero change USDT refuses, and it reverts the whole fulfilment.
      const unreset = await fulfilRoute({ ...route, calls: route.calls.slice(1) }, rewardHash);
      expect(unreset.status).toBe("reverted");
      expect(await executorAllowance(usdtToken)).toBe(STANDING);

      expect((await fulfilRoute(route, rewardHash)).status).toBe("success");
      expect(await executorAllowance(usdtToken)).toBe(AMOUNT);
    }, 180_000);

    it("(c) a standard token still transfers and approves", async () => {
      const standard = await deploy(MOCK_ERC20.creationCode);
      const transfer = await publish("Token(TOKEN).transfer(RECIPIENT, AMOUNT);", standard);
      await provide(transfer.route);
      expect((await fulfilRoute(transfer.route, transfer.rewardHash)).status).toBe("success");
      expect(await balanceOf(standard, RECIPIENT)).toBe(AMOUNT);

      await leaveAllowance(standard);
      const approve = await publish("Token(TOKEN).approve(SPENDER, AMOUNT);", standard);
      expect((await fulfilRoute(approve.route, approve.rewardHash)).status).toBe("success");
      expect(await executorAllowance(standard)).toBe(AMOUNT);
    }, 180_000);

    it("(gas) the reset costs one extra approve call", async () => {
      // Two fresh standard tokens from the same state, fulfilled with and without the reset: the
      // difference is the reset call alone. Measured with nothing to reset and with a standing one.
      const measure = async (standing: boolean, reset: boolean): Promise<bigint> => {
        const token = await deploy(MOCK_ERC20.creationCode);
        if (standing) await leaveAllowance(token);
        const { route, rewardHash } = await publish(
          "Token(TOKEN).approve(SPENDER, AMOUNT);",
          token,
        );
        const run = await fulfilRoute(
          reset ? route : { ...route, calls: route.calls.slice(1) },
          rewardHash,
        );
        expect(run.status).toBe("success");
        expect(await executorAllowance(token)).toBe(AMOUNT);

        return run.gasUsed;
      };
      const fromZero = (await measure(false, true)) - (await measure(false, false));
      const fromStanding = (await measure(true, true)) - (await measure(true, false));
      expect(fromZero).toBeGreaterThan(0n);
      expect(fromStanding).toBeGreaterThan(0n);
      console.log(
        `token-only approve reset — +${fromZero} gas with no allowance standing, ` +
          `+${fromStanding} gas resetting a standing one`,
      );
    }, 300_000);

    // THE RESIDUAL GAP, pinned rather than hidden. The Executor never decodes what a call returned,
    // so a token that returns `false` instead of reverting is not caught on this path. A body that
    // needs that check has to be a program, whose writes are `@sauce/token`'s SafeERC20 ones.
    describe("a token that returns false", () => {
      it("is refused at DELIVERY when the route pulls it: the Portal's safeTransferFrom", async () => {
        const liarToken = await deploy(FALSE_RETURN_ERC20.creationCode);
        const { route, rewardHash } = await publish(
          "Token(TOKEN).transfer(RECIPIENT, AMOUNT);",
          liarToken,
        );
        expect(route.tokens.map((t) => t.token.toLowerCase())).toEqual([liarToken.toLowerCase()]);
        await mintTo(liarToken, DEPLOYER.address, AMOUNT);

        expect((await fulfilRoute(route, rewardHash)).status).toBe("reverted");
      }, 180_000);

      it("but its transfer by the Executor 'succeeds', and the recipient is NOT paid", async () => {
        // The route pulls a different token, so the liar is only ever touched by the Executor's own
        // call — as when the Executor already holds it.
        const liarToken = await deploy(FALSE_RETURN_ERC20.creationCode);
        const delivered = await deploy(MOCK_ERC20.creationCode);
        await mintTo(liarToken, executor, AMOUNT);
        const { route, rewardHash } = await publish(
          "Token(TOKEN).transfer(RECIPIENT, AMOUNT);",
          liarToken,
          `.receive([{ token: ${BigInt(delivered)}n, amount: 1n }])`,
        );
        await provide(route);

        expect((await fulfilRoute(route, rewardHash)).status).toBe("success");
        expect(await balanceOf(liarToken, RECIPIENT)).toBe(0n);
        expect(await balanceOf(liarToken, executor)).toBe(AMOUNT);
      }, 180_000);

      it("and its approve 'succeeds' while setting nothing", async () => {
        const liarToken = await deploy(FALSE_RETURN_ERC20.creationCode);
        const { route, rewardHash } = await publish(
          "Token(TOKEN).approve(SPENDER, AMOUNT);",
          liarToken,
        );

        expect((await fulfilRoute(route, rewardHash)).status).toBe("success");
        expect(await executorAllowance(liarToken)).toBe(0n);
      }, 180_000);
    });
  });

  describe("a three-hop chain, written entirely in the native syntax", () => {
    // The headline case: every hop's amount is only known when that hop runs. The parent measures a
    // balance and offers an intent; fulfilling THAT intent delivers the amount to a Pot, where a
    // program measures it again and offers a third. Nothing below is written by hand -- the program
    // text is the three `Chain.Portal.send(...).creator(0x3333333333333333333333333333333333333333).receive(...).then(...)` expressions and nothing else.
    const SEEDED = 7_000_000n;
    const FINAL_RECIPIENT = "0x00000000000000000000000000000000000000c3" as Address;

    const THREE_HOP = `function main() {
  const amount = Token(TOKEN).balanceOf(ctx.self());
  Base.Portal.send([{ token: TOKEN, amount }]).creator(0x3333333333333333333333333333333333333333).receive([{ token: TOKEN, amount }]).then(() => {
    const got = Token(TOKEN).balanceOf(ctx.self());
    Base.Portal.send([{ token: TOKEN, amount: got }]).creator(0x3333333333333333333333333333333333333333).receive().then(() => {
      Token(TOKEN).transfer(RECIPIENT, got);
    });
  });
}`;

    it("publishes hop 2, and fulfilling it publishes hop 3 with its own measured amount", async () => {
      const token = await deploy(MOCK_ERC20.creationCode);
      const intents = {
        deadline: 4_000_000_000n,
        creator: CREATOR,
        prover: PROVER,
        sourcePortal: portal,
        destinationPortal: portal,
        pot: executorPot,
        engine: sauce.engine,
        executionFee: 0n,
        salt: `0x${"c3".repeat(32)}` as Hex,
      };
      const compiled = compileSauceRoute(
        "base",
        THREE_HOP,
        { pot: executorPot, engine: sauce.engine },
        { defines: { TOKEN: BigInt(token), RECIPIENT: BigInt(FINAL_RECIPIENT) }, intents },
      );
      // The author wrote no Portal, no cook, no selector, and no argument encoding.
      expect(THREE_HOP).not.toMatch(/publishAndFund|cook|evm\.call|hex`|abi\./);

      // ---- hop 1: fulfil the parent ---------------------------------------------------------
      const parent = await fulfil([
        {
          target: token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "mint",
            args: [executorPot, SEEDED],
          }),
          value: 0n,
        },
        {
          target: denormalizeToEvm(toUniversalAddress(compiled.calls[0]!.target)),
          data: compiled.calls[0]!.data,
          value: 0n,
        },
      ]);
      expect(parent.status).toBe("success");

      const hop2 = publishedIn(parent.logs);
      expect(hop2).toHaveLength(1);
      // Hop 2's reward is the amount hop 1 measured, and its route asks the solver to deliver the
      // same amount so the program inside it has something to measure.
      expect(hop2[0]!.rewardTokens[0]!.amount).toBe(SEEDED);
      const [hop2Route] = decodeAbiParameters([EVM_ROUTE_PARAM], hop2[0]!.route) as unknown as [
        EvmRoute,
      ];
      expect(hop2Route.tokens[0]!.amount).toBe(SEEDED);
      // Executor -> Pot, then the cook. Both emitted, neither written.
      expect(hop2Route.calls).toHaveLength(2);

      // ---- hop 2: fulfil it, from the bytes the chain published ------------------------------
      await mintTo(token, DEPLOYER.address, SEEDED);
      const approve = await walletClient.sendTransaction({
        account: DEPLOYER,
        chain: null,
        to: token,
        data: encodeFunctionData({
          abi: erc20ApproveAbi,
          functionName: "approve",
          args: [portal, SEEDED],
        }),
        gas: GAS_LIMIT,
      });
      await publicClient.waitForTransactionReceipt({ hash: approve });

      const child = await fulfilRoute(hop2Route, rewardOf(hop2[0]!).rewardHash);
      expect(child.status).toBe("success");

      // ---- hop 3 ------------------------------------------------------------------------------
      const hop3 = publishedIn(child.logs);
      expect(hop3).toHaveLength(1);
      // Measured by hop 2's own program, at hop 2's execution time -- a number that did not exist
      // when hop 1 was signed and that hop 1 never touched.
      expect(hop3[0]!.rewardTokens[0]!.amount).toBe(SEEDED);
      const [hop3Route] = decodeAbiParameters([EVM_ROUTE_PARAM], hop3[0]!.route) as unknown as [
        EvmRoute,
      ];
      const delivery = decodeFunctionData({ abi: erc20Abi, data: hop3Route.calls[0]!.data });
      expect(delivery.functionName).toBe("transfer");
      expect((delivery.args![0] as string).toLowerCase()).toBe(FINAL_RECIPIENT.toLowerCase());
      expect(delivery.args![1]).toBe(SEEDED);

      console.log(`three-hop gas — hop 1 ${parent.gasUsed}, hop 2 ${child.gasUsed}`);
    }, 300_000);

    it("a single hop whose body is a program, not just token writes", async () => {
      const token = await deploy(MOCK_ERC20.creationCode);
      await mintTo(token, executorPot, SEEDED);
      const held = await balanceOf(token, executorPot);

      // Control flow in the body, so this takes the program path rather than the direct-call one.
      const WITH_LOGIC = `function main() {
  const amount = Token(TOKEN).balanceOf(ctx.self());
  Base.Portal.send([{ token: TOKEN, amount }]).creator(0x3333333333333333333333333333333333333333).receive([{ token: TOKEN, amount }]).then(() => {
    const here = Token(TOKEN).balanceOf(ctx.self());
    if (here > 0n) {
      Token(TOKEN).transfer(RECIPIENT, here);
    }
  });
}`;
      const compiled = compileSauceRoute(
        "base",
        WITH_LOGIC,
        { pot: executorPot, engine: sauce.engine },
        {
          defines: { TOKEN: BigInt(token), RECIPIENT: BigInt(FINAL_RECIPIENT) },
          intents: {
            deadline: 4_000_000_000n,
            prover: PROVER,
            sourcePortal: portal,
            destinationPortal: portal,
            pot: executorPot,
            engine: sauce.engine,
            executionFee: 0n,
            salt: `0x${"c4".repeat(32)}` as Hex,
          },
        },
      );

      const { status, logs } = await fulfil([
        {
          target: denormalizeToEvm(toUniversalAddress(compiled.calls[0]!.target)),
          data: compiled.calls[0]!.data,
          value: 0n,
        },
      ]);

      expect(status).toBe("success");
      expect(publishedIn(logs)[0]!.rewardTokens[0]!.amount).toBe(held);
    }, 300_000);

    describe("`.catch(...)` handles an intent's body on the destination", () => {
      // The body runs in a frame of its own; when it reverts everything it did is undone, the
      // handler runs in its place, and the fill still succeeds.
      const FALLBACK = "0x0000000000000000000000000000000000000fa1" as Address;
      const FORWARD = `() => {
      const here = Token(TOKEN).balanceOf(ctx.self());
      Token(TOKEN).transfer(FALLBACK, here);
    }`;
      const handled = (body: string, handler: string) => `function main() {
  const amount = Token(TOKEN).balanceOf(ctx.self());
  Base.Portal.send({ token: TOKEN, amount }).creator(0x3333333333333333333333333333333333333333)
    .receive({ token: TOKEN, amount })
    .then(() => {
      Token(TOKEN).transfer(RECIPIENT, 1n);
      ${body}
    })
    .catch(${handler});
}`;

      for (const [name, body, handler, toRecipient, toFallback] of [
        [
          "a reverting body is undone, and the handler forwards the delivery",
          'require(false, "no");',
          FORWARD,
          0n,
          SEEDED,
        ],
        [
          "a body that succeeds keeps what it did, and the handler does not run",
          "",
          FORWARD,
          1n,
          0n,
        ],
        // `require(false, "no")` reverts with its message's bytes, "no", which the handler reads
        // as a number: 0x6e6f.
        [
          "the handler reads what the body reverted with",
          'require(false, "no");',
          "(e) => { Token(TOKEN).transfer(FALLBACK, e.toBe()); }",
          0n,
          0x6e6fn,
        ],
      ] as const) {
        it(
          name,
          async () => {
            const token = await deploy(MOCK_ERC20.creationCode);
            const recipient = await balanceOf(token, FINAL_RECIPIENT);
            // One intent per case.
            const salt = toFallback === 0n ? "c6" : toFallback === SEEDED ? "c5" : "c7";
            const compiled = compileSauceRoute(
              "base",
              handled(body, handler),
              { pot: executorPot, engine: sauce.engine },
              {
                defines: {
                  TOKEN: BigInt(token),
                  RECIPIENT: BigInt(FINAL_RECIPIENT),
                  FALLBACK: BigInt(FALLBACK),
                },
                intents: {
                  deadline: 4_000_000_000n,
                  prover: PROVER,
                  sourcePortal: portal,
                  destinationPortal: portal,
                  pot: executorPot,
                  engine: sauce.engine,
                  executionFee: 0n,
                  salt: `0x${salt.repeat(32)}` as Hex,
                },
              },
            );

            // ---- publish it from the Pot, then fill it from the bytes the chain published ---------
            const parent = await fulfil([
              {
                target: token,
                data: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: "mint",
                  args: [executorPot, SEEDED],
                }),
                value: 0n,
              },
              {
                target: denormalizeToEvm(toUniversalAddress(compiled.calls[0]!.target)),
                data: compiled.calls[0]!.data,
                value: 0n,
              },
            ]);
            expect(parent.status).toBe("success");
            const [published] = publishedIn(parent.logs);
            const [route] = decodeAbiParameters([EVM_ROUTE_PARAM], published!.route) as unknown as [
              EvmRoute,
            ];
            await mintTo(token, DEPLOYER.address, SEEDED);
            const approve = await walletClient.sendTransaction({
              account: DEPLOYER,
              chain: null,
              to: token,
              data: encodeFunctionData({
                abi: erc20ApproveAbi,
                functionName: "approve",
                args: [portal, SEEDED],
              }),
              gas: GAS_LIMIT,
            });
            await publicClient.waitForTransactionReceipt({ hash: approve });

            const fill = await fulfilRoute(route, rewardOf(published!).rewardHash);
            expect(fill.status).toBe("success");
            // As strings: a failed bigint comparison cannot cross jest's worker boundary.
            expect(String((await balanceOf(token, FINAL_RECIPIENT)) - recipient)).toBe(
              String(toRecipient),
            );
            expect(String(await balanceOf(token, FALLBACK))).toBe(String(toFallback));
          },
          300_000,
        );
      }
    });
  });

  describe("the destination Pot is derived, not asked for", () => {
    // The user's requirement is that every address the SDK can know, it knows. A Pot is CREATE2 from
    // the Kitchen over its owner and a salt, and the owner a route call must cook as is the
    // destination `Portal.executor()` -- itself the Portal's SECOND `CREATE`, because `Inbox`'s
    // constructor does `executor = new Executor()` after `Portal`'s inheritance has created a
    // `Vault`. Both ends are arithmetic. These check the arithmetic against the real contracts.

    it("the Executor is the Portal's second CREATE", async () => {
      const derived = getContractAddress({
        from: portal,
        nonce: ECO_ROUTES_EXECUTOR_NONCE,
        opcode: "CREATE",
      });

      expect(derived.toLowerCase()).toBe(executor.toLowerCase());
    }, 120_000);

    it("an intent's vault, derived offline, is the one this Portal reports", async () => {
      // The vault implementation is the Portal's FIRST create, and the clone's creation code is the
      // one `vault.ts` records: a funder pays the vault before the Portal has ever seen the intent,
      // so the address must be right without asking it. `eco-routes-vault.test.ts` holds the same
      // derivation to every deployed registry Portal; this, to the build vendored here.
      const intent = childIntent(5n, 7n);
      const reported = await publicClient.readContract({
        abi: portalAbi,
        address: portal,
        functionName: "intentVaultAddress",
        args: [
          intent.destination,
          encodeRouteEvm(intent.route),
          {
            deadline: intent.reward.deadline,
            creator: denormalizeToEvm(intent.reward.creator),
            prover: denormalizeToEvm(intent.reward.prover),
            nativeAmount: intent.reward.nativeAmount,
            tokens: intent.reward.tokens.map((t) => ({
              token: denormalizeToEvm(t.token),
              amount: t.amount,
            })),
          },
        ],
      });

      expect(predictIntentVault(intent, { portal })).toBe(getAddress(reported));
    }, 120_000);

    it("a Pot derived for that Executor is the one the Kitchen mints", async () => {
      const derived = v12PredictPot(executor as Hex, SAUCE_INTENT_POT_SALT, gateAnchors().kitchen);
      // Nothing has deployed it yet: the address is arithmetic, the contract is not.
      expect(await publicClient.getCode({ address: derived })).toBeUndefined();

      const mint = await walletClient.sendTransaction({
        account: DEPLOYER,
        chain: null,
        to: gateAnchors().kitchen,
        data: v12Kitchen.encodeDeployPot(executor, SAUCE_INTENT_POT_SALT),
        gas: GAS_LIMIT,
      });
      await publicClient.waitForTransactionReceipt({ hash: mint });

      expect(await publicClient.getCode({ address: derived })).toBeDefined();
    }, 120_000);

    it("a program cooks on the derived Pot with no `intents.pot` supplied", async () => {
      // The Pot above is now deployed, so this is the whole flow a caller gets for free: derive,
      // deploy once, and every intent on that chain cooks there.
      const token = await deploy(MOCK_ERC20.creationCode);
      const derived = v12PredictPot(executor as Hex, SAUCE_INTENT_POT_SALT, gateAnchors().kitchen);
      await mintTo(token, derived, 3_000n);

      const compiled = compileSauceRoute(
        "base",
        `function main() {
  const amount = Token(TOKEN).balanceOf(ctx.self());
  Base.Portal.send([{ token: TOKEN, amount }]).creator(0x3333333333333333333333333333333333333333).receive([{ token: TOKEN, amount }]).then(() => {
    const here = Token(TOKEN).balanceOf(ctx.self());
    if (here > 0n) {
      Token(TOKEN).transfer(RECIPIENT, here);
    }
  });
}`,
        { pot: derived, engine: sauce.engine },
        {
          defines: { TOKEN: BigInt(token), RECIPIENT: BigInt(CREATOR) },
          intents: {
            deadline: 4_000_000_000n,
            prover: PROVER,
            sourcePortal: portal,
            destinationPortal: portal,
            // No `pot`. No `engine`. Both derived.
            executionFee: 0n,
            salt: `0x${"d0".repeat(32)}` as Hex,
          },
        },
      );
      // The child's cook targets the derived Pot, chosen by the SDK.

      const { status, logs } = await fulfil([
        {
          target: denormalizeToEvm(toUniversalAddress(compiled.calls[0]!.target)),
          data: compiled.calls[0]!.data,
          value: 0n,
        },
      ]);

      expect(status).toBe("success");
      expect(publishedIn(logs)[0]!.rewardTokens[0]!.amount).toBe(3_000n);
    }, 180_000);
  });

  describe("the Pot the route cooks on must exist beforehand", () => {
    // The SDK derives the destination Pot -- the Executor of the Portal the route records, salt
    // zero, the one shared Pot the solver deploys per Portal -- and deploys nothing. A route cooking
    // on it works once it exists, and reverts the whole fulfilment when it does not: the Executor
    // refuses a call with calldata to an address with no code.
    //
    // Each case deploys its OWN Portal. A new Portal has a new Executor, so whether its shared Pot
    // exists is decided by the case alone -- and the Portal is never the registry's, which is the
    // override case: the Pot has to be owned by THAT Portal's Executor or the cook reverts.
    const AMOUNT = 2_500_000n;
    const DEADLINE = 4_000_000_000n;
    const potOwnerAbi = parseAbi(["function owner() view returns (address)"]);

    /** What a solver does before `fulfill`: hold the route's tokens and let the Portal pull them. */
    const provision = async (via: Address, token: Address, amount: bigint): Promise<void> => {
      await mintTo(token, DEPLOYER.address, amount);
      const hash = await walletClient.sendTransaction({
        account: DEPLOYER,
        chain: null,
        to: token,
        data: encodeFunctionData({
          abi: erc20ApproveAbi,
          functionName: "approve",
          args: [via, amount],
        }),
        gas: GAS_LIMIT,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    };

    /** What the solver does once per Portal: deploy the Executor's Pot through the released Kitchen. */
    const deployPotFor = async (owner: Address, salt: Hex = SAUCE_INTENT_POT_SALT) => {
      const call = sauceEvmDeployPotCall({ kitchen: gateAnchors().kitchen, owner, salt });
      const hash = await walletClient.sendTransaction({
        account: DEPLOYER,
        chain: null,
        to: denormalizeToEvm(toUniversalAddress(call.target)) as Address,
        data: call.data,
        gas: GAS_LIMIT,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const pot = v12PredictPot(owner as Hex, salt);
      expect(await publicClient.getCode({ address: pot })).toBeDefined();

      return pot;
    };

    const evmRouteOf = (intent: Intent): EvmRoute =>
      decodeAbiParameters(
        [EVM_ROUTE_PARAM],
        encodeRouteEvm(intent.route),
      )[0] as unknown as EvmRoute;

    /** The Executor's `CallToEOA(pot)`: the Pot the route cooks on is not there. */
    const expectCallToEoa = (reverted: string, pot: Address): void => {
      expect(reverted).toContain(CALL_TO_EOA_SELECTOR.slice(2));
      expect(reverted).toContain(pot.slice(2).toLowerCase().padStart(64, "0"));
    };

    const ownerOf = (pot: Address): Promise<Address> =>
      publicClient.readContract({ abi: potOwnerAbi, address: pot, functionName: "owner" });

    /** The revert data a `fulfill` would produce, as text, or "" if it would succeed. */
    const revertOf = async (via: Address, route: EvmRoute, rewardHash: Hex): Promise<string> => {
      const claimant = `0x${"00".repeat(12)}${DEPLOYER.address.slice(2)}` as Hex;
      const intentHash = keccak256(
        encodePacked(
          ["uint64", "bytes32", "bytes32"],
          [
            BigInt(CHAIN_ID),
            keccak256(encodeAbiParameters([EVM_ROUTE_PARAM], [route])),
            rewardHash,
          ],
        ),
      );

      return publicClient
        .call({
          account: DEPLOYER.address,
          to: via,
          data: encodeFunctionData({
            abi: portalAbi,
            functionName: "fulfill",
            args: [intentHash, route, rewardHash, claimant],
          }),
          gas: GAS_LIMIT,
        })
        .then(
          () => "",
          (err: unknown) =>
            JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? `${v}` : v)).toLowerCase(),
        );
    };

    describe("inside a program: `Chain.Portal.send(...).creator(0x3333333333333333333333333333333333333333).receive(...).then(...)`", () => {
      // Control flow, so the child is a PROGRAM cooked on its destination Pot, not a list of
      // token calls. Base -> Base so this one anvil can fulfil the child too.
      const PROGRAM = `function main() {
  const amount = Token(TOKEN).balanceOf(ctx.self());
  Base.Portal.send([{ token: TOKEN, amount }]).creator(0x3333333333333333333333333333333333333333).receive([{ token: TOKEN, amount }]).then(() => {
    const here = Token(TOKEN).balanceOf(ctx.self());
    if (here > 0n) {
      Token(TOKEN).transfer(RECIPIENT, here);
    }
  });
}`;

      /** Fulfils a parent that publishes one child routed through `theirs`. */
      const publishChild = async (
        theirs: Address,
        recipient: Address,
        extra: { pot?: Address } = {},
      ) => {
        const token = await deploy(MOCK_ERC20.creationCode);
        await mintTo(token, executorPot, AMOUNT);
        const compiled = compileSauceRoute(
          "base",
          PROGRAM,
          // The ENCLOSING program's own execution, which is not what is under test.
          { pot: executorPot, engine: sauce.engine },
          {
            defines: { TOKEN: BigInt(token), RECIPIENT: BigInt(recipient) },
            intents: {
              deadline: DEADLINE,
              prover: PROVER,
              sourcePortal: portal,
              // Not the registry's Portal. No `engine`, and no `pot` unless the case names one.
              destinationPortal: theirs,
              executionFee: 0n,
              salt: nextSalt(),
              ...extra,
            },
          },
        );
        const parent = await fulfil([
          {
            target: denormalizeToEvm(toUniversalAddress(compiled.calls[0]!.target)),
            data: compiled.calls[0]!.data,
            value: 0n,
          },
        ]);
        expect(parent.status).toBe("success");
        const [published] = publishedIn(parent.logs);
        const [route] = decodeAbiParameters([EVM_ROUTE_PARAM], published!.route) as unknown as [
          EvmRoute,
        ];
        await provision(theirs, token, AMOUNT);

        return { token, route, rewardHash: rewardOf(published!).rewardHash };
      };

      it("(a) cooks on the shared Pot once it has been deployed", async () => {
        const { portal: theirs, executor: theirExecutor } = await deployPortal();
        const pot = await deployPotFor(theirExecutor);
        const recipient = "0x00000000000000000000000000000000000000e1" as Address;

        const { token, route, rewardHash } = await publishChild(theirs, recipient);

        // The Executor -> Pot delivery, then the cook on the derived Pot. Nothing deploys.
        expect(route.calls.map((c) => c.target.toLowerCase())).toEqual([
          token.toLowerCase(),
          pot.toLowerCase(),
        ]);
        const child = await fulfilRoute(route, rewardHash, theirs);
        expect(child.status).toBe("success");
        // Owned by the OVERRIDING Portal's Executor, which is the one that just cooked on it.
        expect(getAddress(await ownerOf(pot))).toBe(getAddress(theirExecutor));
        expect(getAddress(theirExecutor)).not.toBe(getAddress(ecoRoutesExecutor("base")));
        expect(await balanceOf(token, recipient)).toBe(AMOUNT);
      }, 300_000);

      it("(b) reverts the fulfilment when the Pot has not been deployed", async () => {
        const { portal: theirs, executor: theirExecutor } = await deployPortal();
        const pot = v12PredictPot(theirExecutor as Hex);
        const recipient = "0x00000000000000000000000000000000000000e2" as Address;

        const { token, route, rewardHash } = await publishChild(theirs, recipient);

        expectCallToEoa(await revertOf(theirs, route, rewardHash), pot);
        const child = await fulfilRoute(route, rewardHash, theirs);
        expect(child.status).toBe("reverted");
        expect(await publicClient.getCode({ address: pot })).toBeUndefined();
        expect(await balanceOf(token, recipient)).toBe(0n);
      }, 300_000);

      it("(c) cooks on a Pot the caller names", async () => {
        const { portal: theirs, executor: theirExecutor } = await deployPortal();
        // Owned by the right Executor but at another salt, so it is not the derived Pot.
        const named = await deployPotFor(theirExecutor, `0x${"00".repeat(31)}c0`);
        const recipient = "0x00000000000000000000000000000000000000e3" as Address;

        const { token, route, rewardHash } = await publishChild(theirs, recipient, { pot: named });

        expect(route.calls[1]!.target.toLowerCase()).toBe(named.toLowerCase());
        const child = await fulfilRoute(route, rewardHash, theirs);
        expect(child.status).toBe("success");
        expect(await balanceOf(token, recipient)).toBe(AMOUNT);
      }, 300_000);
      it("(d) the registry Executor's Pot rejects an overriding Portal's cook with NotOwner", async () => {
        // What deriving from the registry Portal would have built: the child's route records
        // `theirs`, so `theirs`'s Executor calls the Pot, and one owned by another Executor refuses.
        const { portal: theirs } = await deployPortal();
        const wrongPot = await deployPotFor(ecoRoutesExecutor("base"));
        const recipient = "0x00000000000000000000000000000000000000e4" as Address;

        const { token, route, rewardHash } = await publishChild(theirs, recipient, {
          pot: wrongPot,
        });

        expect(await revertOf(theirs, route, rewardHash)).toContain(NOT_OWNER_SELECTOR.slice(2));
        expect((await fulfilRoute(route, rewardHash, theirs)).status).toBe("reverted");
        expect(await balanceOf(token, recipient)).toBe(0n);
      }, 300_000);
    });

    describe("from TypeScript: `Base(body, options).reward(...)`", () => {
      /** The guide's USDC transfer, with no `pot` or `engine` unless `execution` names one. */
      const buildTransfer = (
        theirs: Address,
        token: Address,
        recipient: Address,
        execution?: { pot: Address },
      ) => {
        const pot = execution?.pot ?? destinationPot("base", { portal: theirs });

        return openRoute("base", "Token(TOKEN).transfer(RECIPIENT, AMOUNT);", {
          ...(execution === undefined ? {} : { execution }),
          portal: theirs,
          deadline: DEADLINE,
          salt: nextSalt(),
          defines: { TOKEN: BigInt(token), RECIPIENT: BigInt(recipient), AMOUNT },
          tokens: [{ token, amount: AMOUNT }],
          // Route assets arrive at the Executor; the program spends from the Pot.
          precalls: [TokenCalls.transfer({ token, to: pot, amount: AMOUNT }).toCall()],
        }).reward({
          source: "base",
          creator: CREATOR,
          prover: PROVER,
          deadline: DEADLINE,
          nativeAmount: 0n,
        }).intent;
      };

      const run = async (theirs: Address, token: Address, intent: Intent) => {
        await provision(theirs, token, AMOUNT);

        return fulfilRoute(evmRouteOf(intent), hashIntent(intent).rewardHash, theirs);
      };

      it("(a) cooks on the shared Pot once it has been deployed, with no pot or engine", async () => {
        const { portal: theirs, executor: theirExecutor } = await deployPortal();
        const pot = await deployPotFor(theirExecutor);
        expect(destinationPot("base", { portal: theirs })).toBe(pot);
        const token = await deploy(MOCK_ERC20.creationCode);
        const recipient = "0x00000000000000000000000000000000000000f1" as Address;

        const intent = buildTransfer(theirs, token, recipient);
        // The delivery into the Pot, then the cook on it. Nothing deploys.
        expect(intent.route.calls).toHaveLength(2);
        expect(getAddress(denormalizeToEvm(intent.route.calls[1]!.target))).toBe(pot);

        const done = await run(theirs, token, intent);
        expect(done.status).toBe("success");
        expect(getAddress(await ownerOf(pot))).toBe(getAddress(theirExecutor));
        expect(await balanceOf(token, recipient)).toBe(AMOUNT);
      }, 300_000);

      it("(b) reverts the fulfilment when the Pot has not been deployed", async () => {
        const { portal: theirs, executor: theirExecutor } = await deployPortal();
        const pot = destinationPot("base", { portal: theirs });
        expect(pot).toBe(v12PredictPot(theirExecutor as Hex));
        const token = await deploy(MOCK_ERC20.creationCode);
        const recipient = "0x00000000000000000000000000000000000000f2" as Address;

        const intent = buildTransfer(theirs, token, recipient);
        await provision(theirs, token, AMOUNT);
        expectCallToEoa(
          await revertOf(theirs, evmRouteOf(intent), hashIntent(intent).rewardHash),
          pot,
        );

        const done = await fulfilRoute(evmRouteOf(intent), hashIntent(intent).rewardHash, theirs);
        expect(done.status).toBe("reverted");
        expect(await publicClient.getCode({ address: pot })).toBeUndefined();
        expect(await balanceOf(token, recipient)).toBe(0n);
      }, 300_000);

      it("(c) cooks on a Pot the caller names", async () => {
        const { portal: theirs, executor: theirExecutor } = await deployPortal();
        const named = await deployPotFor(theirExecutor, `0x${"00".repeat(31)}c1`);
        const token = await deploy(MOCK_ERC20.creationCode);
        const recipient = "0x00000000000000000000000000000000000000f3" as Address;

        const intent = buildTransfer(theirs, token, recipient, { pot: named });
        expect(getAddress(denormalizeToEvm(intent.route.calls[1]!.target))).toBe(named);

        const done = await run(theirs, token, intent);
        expect(done.status).toBe("success");
        expect(await balanceOf(token, recipient)).toBe(AMOUNT);
      }, 300_000);

      it("(d) the registry Executor's Pot rejects an overriding Portal's cook with NotOwner", async () => {
        // The case that deriving from the registry Portal would build: the route records `theirs`,
        // so `theirs`'s Executor makes the call, and a Pot owned by any other Executor refuses it.
        const { portal: theirs, executor: theirExecutor } = await deployPortal();
        const wrongPot = await deployPotFor(ecoRoutesExecutor("base"));

        const onWrongPot = openRoute("base", "function main() { return 1n; }", {
          portal: theirs,
          execution: { pot: wrongPot },
          deadline: DEADLINE,
          salt: nextSalt(),
        }).reward({ source: "base", creator: CREATOR, prover: PROVER, deadline: DEADLINE });
        // `NotOwner()`, carried out through the Executor's `CallFailed(call, result)`.
        expect(
          await revertOf(
            theirs,
            evmRouteOf(onWrongPot.intent),
            hashIntent(onWrongPot.intent).rewardHash,
          ),
        ).toContain(NOT_OWNER_SELECTOR.slice(2));

        // The SDK's own derivation for the same Portal is owned by the right Executor, and runs.
        const derived = await deployPotFor(theirExecutor);
        expect(derived).not.toBe(wrongPot);
        const right = openRoute("base", "function main() { return 1n; }", {
          portal: theirs,
          deadline: DEADLINE,
          salt: nextSalt(),
        }).reward({ source: "base", creator: CREATOR, prover: PROVER, deadline: DEADLINE });
        expect(getAddress(denormalizeToEvm(right.intent.route.calls[0]!.target))).toBe(derived);
        const ok = await fulfilRoute(
          evmRouteOf(right.intent),
          hashIntent(right.intent).rewardHash,
          theirs,
        );
        expect(ok.status).toBe("success");
        expect(getAddress(await ownerOf(derived))).toBe(getAddress(theirExecutor));
      }, 300_000);
    });
  });
});
