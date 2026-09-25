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
import { normalizeReward, normalizeRoute } from "../src/routes/normalize.js";
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

/** A `route.calls` entry that mints 1 wei of the marker token — an unmistakable, readable state
 *  change, used to tell "this call ran" from "this call was rolled back". */
const markerCall = (to: Address) => ({
  target: markerToken,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "mint", args: [to, 1n] }),
  value: 0n,
});

let saltCounter = 0;
const nextSalt = (): Hex => `0x${(++saltCounter).toString(16).padStart(64, "0")}` as Hex;

/** Builds the route, hashes it exactly as `Inbox._fulfill` does, and submits `Portal.fulfill`. */
const fulfil = async (
  calls: readonly { target: Address; data: Hex; value: bigint }[],
): Promise<{ status: "success" | "reverted"; intentHash: Hex; logs: readonly Log[] }> => {
  const route: EvmRoute = {
    salt: nextSalt(),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    portal,
    nativeAmount: 0n,
    tokens: [],
    calls,
  };
  const rewardHash = keccak256("0xbeef");
  const routeHash = keccak256(encodeAbiParameters([EVM_ROUTE_PARAM], [route]));
  const intentHash = keccak256(
    encodePacked(["uint64", "bytes32", "bytes32"], [BigInt(CHAIN_ID), routeHash, rewardHash]),
  );
  const claimant = `0x${"00".repeat(12)}${DEPLOYER.address.slice(2)}` as Hex;

  const data = encodeFunctionData({
    abi: portalAbi,
    functionName: "fulfill",
    args: [intentHash, route, rewardHash, claimant],
  });

  // Sent as a TRANSACTION even when it is expected to revert: a revert has to be observed as a
  // receipt status plus the on-chain state it left behind, which an `eth_call` cannot show.
  const hash = await walletClient.sendTransaction({
    account: DEPLOYER,
    chain: null,
    to: portal,
    data,
    gas: GAS_LIMIT,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return { status: receipt.status, intentHash, logs: receipt.logs };
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

describeEvm("a dynamic child intent, executed", () => {
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
      const published = logs
        .filter((l) => l.address.toLowerCase() === portal.toLowerCase())
        .flatMap((l) => {
          try {
            const decoded = decodeEventLog({ abi: portalAbi, data: l.data, topics: l.topics });
            return decoded.eventName === "IntentPublished" ? [decoded.args] : [];
          } catch {
            return [];
          }
        });
      expect(published).toHaveLength(1);
      const event = published[0] as unknown as {
        intentHash: Hex;
        destination: bigint;
        route: Hex;
        rewardTokens: readonly { token: Address; amount: bigint }[];
      };
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
});
