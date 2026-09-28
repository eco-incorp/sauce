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
  getCreate2Address,
  http,
  keccak256,
  parseAbi,
  encodePacked,
} from "viem";
import type { Address, Hex, Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { compileProgram } from "./helpers";
import { startGatedEngine, gateAnchors, type GatedEngine } from "./evm/gated-engine.js";
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
import { normalizeReward, normalizeRoute, toUniversalAddress } from "../src/routes/normalize.js";
import { scaleAmount, WAD } from "../src/routes/template.js";
import type { Intent } from "../src/routes/types.js";

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
const cookCall = (source: string, baseDirs: readonly string[] = []) => ({
  target: executorPot,
  data: v12Pot.encodeCook(
    sauce.engine,
    toHex(compileProgram(source, { baseDirs: [...baseDirs] }).bytecode[0]!),
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

/** Hashes `route` exactly as `Inbox._fulfill` does and submits `Portal.fulfill`. */
const fulfilRoute = async (route: EvmRoute, rewardHash: Hex): Promise<Fulfilment> => {
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
    to: portal,
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

  portal = await deploy(
    `${PORTAL_FIXTURE.creationCode}${encodeAbiParameters([{ type: "address" }], ["0x0000000000000000000000000000000000000000"]).slice(2)}` as Hex,
  );
  executor = (await publicClient.readContract({
    abi: portalAbi,
    address: portal,
    functionName: "executor",
  })) as Address;

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
        cookCall(program.source, program.baseDirs),
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
        cookCall(program.source, program.baseDirs),
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
      const { status, logs } = await fulfil([cookCall(program.source, program.baseDirs)]);
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
            cookCall(grandchildProgram.source, grandchildProgram.baseDirs),
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
        cookCall(childProgram.source, childProgram.baseDirs),
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
      const { status } = await fulfil([cookCall(program.source, program.baseDirs)]);

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

      const { status } = await fulfil([cookCall(program.source, program.baseDirs)]);
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
        cookCall(program.source, program.baseDirs),
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

      const { status } = await fulfil([
        markerCall(marker),
        cookCall(program.source, program.baseDirs),
      ]);

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

      const { status } = await fulfil([cookCall(program.source, program.baseDirs)]);

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

      const { status } = await fulfil([
        markerCall(marker),
        cookCall(program.source, program.baseDirs),
      ]);

      expect(status).toBe("reverted");
      expect(await balanceOf(markerToken, marker)).toBe(0n);
    }, 120_000);
  });

  describe("the README's example, as published", () => {
    // `docs/examples/cross-chain-intent.sauce.ts` is compiled on every `docs:check` run and quoted
    // verbatim by the README. What only an engine can settle is whether the Portal accepts what its
    // lowering builds -- and whether the amount the program measured is the amount the published
    // intent carries, which is the claim the README makes.
    const README_EXAMPLE = readFileSync(
      join(HERE, "../../docs/examples/cross-chain-intent.sauce.ts"),
      "utf8",
    );
    const SEEDED = 12_345_678n;
    const DELIVER_TO = "0x00000000000000000000000000000000000000a5" as Address;

    it("publishes an intent carrying the balance it measured", async () => {
      const token = await deploy(MOCK_ERC20.creationCode);
      const compiled = compileSauceRoute(
        "base",
        README_EXAMPLE,
        { pot: executorPot, engine: sauce.engine },
        {
          // The example says `USDC`; on this anvil that symbol is the mock deployed above.
          tokens: { USDC: token },
          defines: { RECIPIENT: BigInt(DELIVER_TO), MIN_AMOUNT: 1n },
          intents: {
            deadline: 4_000_000_000n,
            creator: CREATOR,
            prover: PROVER,
            // This anvil's Portal, not the registry's. On a real chain both come from the registry.
            sourcePortal: portal,
            destinationPortal: portal,
            salt: `0x${"ee".repeat(32)}` as Hex,
          },
        },
      );
      // Nothing in the example mentions the Portal, a selector or an approval.
      expect(README_EXAMPLE).not.toMatch(/publishAndFund|evm\.call|hex`/);

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
      expect(published[0]!.destination).toBe(42_161n); // Arbitrum, as the example names
      expect(published[0]!.rewardTokens[0]!.amount).toBe(SEEDED);
      expect(
        await publicClient.readContract({
          abi: portalAbi,
          address: portal,
          functionName: "getRewardStatus",
          args: [published[0]!.intentHash],
        }),
      ).toBe(1);
    }, 180_000);

    it("refuses to create the intent when the floor is not met, reverting everything", async () => {
      const token = await deploy(MOCK_ERC20.creationCode);
      const marker = "0x0000000000000000000000000000000000000f01" as Address;
      const compiled = compileSauceRoute(
        "base",
        README_EXAMPLE,
        { pot: executorPot, engine: sauce.engine },
        {
          tokens: { USDC: token },
          // Nothing was minted, so the balance is below this floor and the program throws.
          defines: { RECIPIENT: BigInt(DELIVER_TO), MIN_AMOUNT: 1n },
          intents: {
            deadline: 4_000_000_000n,
            creator: CREATOR,
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
    const cookStatements = (statements: readonly string[], baseDirs: readonly string[] = []) =>
      cookCall(`function main() {\n${statements.join("\n")}\n}`, baseDirs);

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

  describe("`Chain(() => ...).reward(...)` written inside the program", () => {
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
  Base(() => {
    Token(TOKEN).transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: TOKEN, amount }] });
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
            creator: CREATOR,
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
      expect(compiled.source).toContain("evm.call(");

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

      // Funded, from the emitted approve, into the vault the Portal derives for that hash.
      expect(
        await publicClient.readContract({
          abi: portalAbi,
          address: portal,
          functionName: "getRewardStatus",
          args: [published[0]!.intentHash],
        }),
      ).toBe(1);
      expect(await balanceOf(token, executorPot)).toBe(0n);
    }, 180_000);

    it("a token whose approve returns nothing (USDT) publishes the same way", async () => {
      await mintTo(usdt, executorPot, SEEDED);
      const held = await balanceOf(usdt, executorPot);
      const compiled = compileSauceRoute(
        "base",
        PROGRAM,
        { pot: executorPot, engine: sauce.engine },
        {
          defines: { TOKEN: BigInt(usdt), RECIPIENT: BigInt(DELIVER_TO) },
          intents: {
            deadline: 4_000_000_000n,
            creator: CREATOR,
            prover: PROVER,
            sourcePortal: portal,
            destinationPortal: portal,
            salt: `0x${"e1".repeat(32)}` as Hex,
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
      expect(await balanceOf(usdt, executorPot)).toBe(0n);
    }, 180_000);
  });
});
