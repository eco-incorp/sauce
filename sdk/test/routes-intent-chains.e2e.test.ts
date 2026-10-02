/**
 * An intent written inside a program, EXECUTED on chains whose tokens live at DIFFERENT addresses.
 *
 * `Chain.Portal.send({ ... }).receive({ ... }).then(() => { ... })` names tokens on two chains at once: the body's run on the
 * destination, and the reward's are escrowed — paid into the vault — on the chain the program runs on. The
 * only way to show that a lowering named the right chain's token is to give each chain a different
 * one, and to have every other chain's address be empty there, as it is on a real chain.
 *
 * So: one anvil per chain, with its real chain id — Base (8453), Arbitrum (42161), Optimism (10) —
 * each running the real eco-routes Portal and the released engine behind a Kitchen-minted Pot, and
 * each holding a mock ERC-20 at ITS OWN registry USDC address and nowhere else. The programs are the
 * docs examples verbatim, compiled with the SDK's real registry. An intent published on one anvil
 * is fulfilled on the next from the bytes that anvil's Portal logged.
 *
 * WHY `routes-nest-dynamic.e2e.test.ts` MISSED THIS. It runs ONE anvil, as Base, and named every
 * token through a define or — in its README test, until this suite was written — a
 * `tokens: { USDC }` override. Both give a symbol one address on every chain, so a reward resolved
 * against the destination was the same address as one resolved against the source, and no intent it
 * published was ever fulfilled on a chain with another id. Nothing it did could tell two chains
 * apart.
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
  decodeAbiParameters,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../src/chains/canonical.js";
import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import { v12Kitchen } from "../src/evm/engine.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import {
  EVM_REWARD_PARAM,
  EVM_ROUTE_PARAM,
  denormalizeToEvm,
  encodeRouteEvm,
} from "../src/routes/encode.js";
import { chainDefines } from "../src/routes/ambient.js";
import { openRoute } from "../src/routes/intent-dsl.js";
import { toUniversalAddress } from "../src/routes/normalize.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import type { Intent } from "../src/routes/types.js";
import { gateAnchors, startGatedEngine, type GatedEngine } from "./evm/gated-engine.js";

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
const fixture = (path: string) =>
  JSON.parse(readFileSync(join(HERE, path), "utf8")) as { creationCode: Hex };
const PORTAL_FIXTURE = fixture("evm/fixtures/Portal.json");
const MOCK_ERC20 = fixture("std/token/fixtures/MockERC20.json");
const example = (name: string) =>
  readFileSync(join(HERE, "../../docs/examples", `${name}.sauce.ts`), "utf8");

const DEPLOYER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const PROVER = "0x4444444444444444444444444444444444444444" as const;
const RECIPIENT = "0x00000000000000000000000000000000000000a5" as const;
const DEADLINE = 4_000_000_000n;
const SEEDED = 12_345_678n;
const GAS_LIMIT = 30_000_000n;

const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 value) returns (bool)",
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
    name: "getRewardStatus",
    stateMutability: "view",
    inputs: [{ name: "intentHash", type: "bytes32" }],
    outputs: [{ type: "uint8" }],
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

interface EvmRoute {
  salt: Hex;
  deadline: bigint;
  portal: Address;
  nativeAmount: bigint;
  tokens: readonly { token: Address; amount: bigint }[];
  calls: readonly { target: Address; data: Hex; value: bigint }[];
}

interface Published {
  intentHash: Hex;
  destination: bigint;
  route: Hex;
  creator: Address;
  prover: Address;
  rewardDeadline: bigint;
  rewardNativeAmount: bigint;
  rewardTokens: readonly { token: Address; amount: bigint }[];
}

type Slug = "base" | "arbitrum" | "optimism";

/** The registry's USDC for `slug` — a different address on each of the three. */
const usdcOf = (slug: Slug): Address =>
  toHex(registryTokenAddress(requireChain(slug), "USDC")!, { size: 20 });

/** One anvil standing in for one chain. */
class Chain {
  readonly id: number;
  readonly usdc: Address;
  readonly publicClient;
  readonly testClient;
  readonly walletClient;
  private process: ChildProcess | undefined;
  engine!: GatedEngine;
  portal!: Address;
  executor!: Address;
  /** The Pot a route recording `portal` cooks on: the Executor's shared one, salt zero. */
  pot!: Address;

  constructor(
    readonly slug: Slug,
    private readonly port: number,
  ) {
    this.id = requireChain(slug).id;
    this.usdc = usdcOf(slug);
    const transport = http(`http://127.0.0.1:${port}`, {
      fetchOptions: { headers: { connection: "close" } },
    });
    this.publicClient = createPublicClient({ transport });
    this.testClient = createTestClient({ mode: "anvil", transport });
    this.walletClient = createWalletClient({ account: DEPLOYER, transport });
  }

  async start(runtimeCreationCode: Hex): Promise<void> {
    this.process = spawn(
      "anvil",
      ["--port", String(this.port), "--chain-id", String(this.id), "--silent"],
      { stdio: "ignore" },
    );
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        await this.publicClient.getChainId();
        break;
      } catch {
        if (Date.now() > deadline) throw new Error(`anvil for ${this.slug} did not come up`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const clients = {
      publicClient: this.publicClient,
      testClient: this.testClient,
      walletClient: this.walletClient,
    };
    // The harness deploys the engine at its release address, which a route built with no `engine`
    // cooks on.
    this.engine = await startGatedEngine(clients, DEPLOYER.address, runtimeCreationCode);
    if (getAddress(this.engine.engine) !== getAddress(v12EngineAddress())) {
      throw new Error(`the harness put the engine at ${this.engine.engine}`);
    }

    this.portal = await this.deploy(
      `${PORTAL_FIXTURE.creationCode}${encodeAbiParameters([{ type: "address" }], ["0x0000000000000000000000000000000000000000"]).slice(2)}` as Hex,
    );
    this.executor = (await this.publicClient.readContract({
      abi: portalAbi,
      address: this.portal,
      functionName: "executor",
    })) as Address;
    // The solver's shared Pot for this Portal, which the SDK derives rather than being told.
    await this.send(
      gateAnchors().kitchen,
      v12Kitchen.encodeDeployPot(this.executor, SAUCE_INTENT_POT_SALT),
    );
    this.pot = v12PredictPot(this.executor as Hex) as Address;
    if (!(await this.publicClient.getCode({ address: this.pot }))) {
      throw new Error(`no Pot was minted for ${this.slug}'s Executor`);
    }

    // This chain's USDC, at this chain's registry address. Nothing is at the other two.
    const mock = await this.deploy(MOCK_ERC20.creationCode);
    const code = await this.publicClient.getCode({ address: mock });
    await this.testClient.setCode({ address: this.usdc, bytecode: code! });
  }

  async stop(): Promise<void> {
    const anvil = this.process;
    if (anvil === undefined || anvil.exitCode !== null) return;
    const exited = once(anvil, "exit");
    anvil.kill();
    await exited;
  }

  async deploy(data: Hex): Promise<Address> {
    const hash = await this.walletClient.sendTransaction({
      account: DEPLOYER,
      chain: null,
      data,
      gas: GAS_LIMIT,
    });
    const { contractAddress } = await this.publicClient.waitForTransactionReceipt({ hash });
    if (!contractAddress) throw new Error("a deployment produced no contract address");
    return contractAddress;
  }

  async send(to: Address, data: Hex): Promise<"success" | "reverted"> {
    const hash = await this.walletClient.sendTransaction({
      account: DEPLOYER,
      chain: null,
      to,
      data,
      gas: GAS_LIMIT,
    });
    return (await this.publicClient.waitForTransactionReceipt({ hash })).status;
  }

  mint(token: Address, to: Address, amount: bigint) {
    return this.send(
      token,
      encodeFunctionData({ abi: erc20Abi, functionName: "mint", args: [to, amount] }),
    );
  }

  balanceOf(token: Address, holder: Address): Promise<bigint> {
    return this.publicClient.readContract({
      abi: erc20Abi,
      address: token,
      functionName: "balanceOf",
      args: [holder],
    }) as Promise<bigint>;
  }

  /**
   * `Portal.fulfill`, hashed as `Inbox._fulfill` hashes it — with THIS chain's id, so a route meant
   * for another chain does not verify. Sent as a transaction, so a revert is observed as a status.
   */
  async fulfil(
    route: EvmRoute,
    rewardHash: Hex,
  ): Promise<{ status: "success" | "reverted"; published: Published[] }> {
    const routeHash = keccak256(encodeAbiParameters([EVM_ROUTE_PARAM], [route]));
    const intentHash = keccak256(
      encodePacked(["uint64", "bytes32", "bytes32"], [BigInt(this.id), routeHash, rewardHash]),
    );
    const claimant = `0x${"00".repeat(12)}${DEPLOYER.address.slice(2)}` as Hex;
    const hash = await this.walletClient.sendTransaction({
      account: DEPLOYER,
      chain: null,
      to: this.portal,
      data: encodeFunctionData({
        abi: portalAbi,
        functionName: "fulfill",
        args: [intentHash, route, rewardHash, claimant],
      }),
      gas: GAS_LIMIT,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    return { status: receipt.status, published: this.publishedIn(receipt.logs) };
  }

  /** What a solver does first: hold the route's tokens and let the Portal pull them. */
  async provide(route: EvmRoute): Promise<void> {
    for (const { token, amount } of route.tokens) {
      await this.mint(token, DEPLOYER.address, amount);
      await this.send(
        token,
        encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [this.portal, amount] }),
      );
    }
  }

  /** Whether the Portal counts a published intent funded — `isIntentFunded` over the bytes it
   *  logged, what a solver checks: its vault holds the reward. */
  isFunded(published: Published): Promise<boolean> {
    return this.publicClient.readContract({
      abi: PortalABI,
      address: this.portal,
      functionName: "isIntentFunded",
      args: [
        published.destination,
        published.route,
        {
          deadline: published.rewardDeadline,
          creator: published.creator,
          prover: published.prover,
          nativeAmount: published.rewardNativeAmount,
          tokens: published.rewardTokens.map((t) => ({ token: t.token, amount: t.amount })),
        },
      ],
    }) as Promise<boolean>;
  }

  private publishedIn(logs: readonly Log[]): Published[] {
    return logs
      .filter((log) => log.address.toLowerCase() === this.portal.toLowerCase())
      .flatMap((log) => {
        try {
          const decoded = decodeEventLog({ abi: portalAbi, data: log.data, topics: log.topics });
          return decoded.eventName === "IntentPublished" ? [decoded.args] : [];
        } catch {
          return [];
        }
      }) as unknown as Published[];
  }
}

/** The route the Portal logged, and the hash of the reward it logged — what a solver fulfils. */
const fulfilmentOf = (published: Published) => {
  const [route] = decodeAbiParameters([EVM_ROUTE_PARAM], published.route) as unknown as [EvmRoute];
  const reward = {
    deadline: published.rewardDeadline,
    creator: published.creator,
    prover: published.prover,
    nativeAmount: published.rewardNativeAmount,
    tokens: published.rewardTokens.map((t) => ({ token: t.token, amount: t.amount })),
  };

  return { route, rewardHash: keccak256(encodeAbiParameters([EVM_REWARD_PARAM], [reward])) };
};

/** An SDK route in the tuple shape `Portal.fulfill` takes. */
const evmRoute = (intent: Intent): EvmRoute => {
  const [route] = decodeAbiParameters(
    [EVM_ROUTE_PARAM],
    encodeRouteEvm(intent.route),
  ) as unknown as [EvmRoute];
  return route;
};

const lower = (address: string) => address.toLowerCase();

const worker = Number(process.env.JEST_WORKER_ID ?? "1") % 100;
const base = new Chain("base", 8800 + worker);
const arbitrum = new Chain("arbitrum", 8900 + worker);
const optimism = new Chain("optimism", 9000 + worker);

describeEvm("an intent created inside a program, across chains with different tokens", () => {
  beforeAll(async () => {
    const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
    await Promise.all([base, arbitrum, optimism].map((chain) => chain.start(creationCode)));
  }, 180_000);

  afterAll(() => Promise.all([base, arbitrum, optimism].map((chain) => chain.stop())));

  it("each chain has its own USDC and none of the others'", async () => {
    for (const chain of [base, arbitrum, optimism]) {
      for (const other of [base, arbitrum, optimism]) {
        const code = await chain.publicClient.getCode({ address: other.usdc });
        expect(code !== undefined).toBe(other === chain);
      }
    }
    // One deployment script ran on each, so the Portal is at one address on all three. The
    // `sourcePortal`/`destinationPortal` overrides below apply at every level of a cascade, and this
    // is what makes one value right for all of them.
    expect(new Set([base, arbitrum, optimism].map((c) => lower(c.portal))).size).toBe(1);
    expect(new Set([base, arbitrum, optimism].map((c) => lower(c.pot))).size).toBe(1);
  }, 60_000);

  let saltByte = 0x10;
  const intents = () => ({
    deadline: DEADLINE,
    creator: CREATOR,
    prover: PROVER,
    // Each anvil's Portal, not the registry's mainnet one. Every other address, the tokens
    // included, comes from the SDK's own tables.
    sourcePortal: base.portal,
    destinationPortal: base.portal,
    executionFee: 0n,
    salt: `0x${(saltByte++).toString(16).repeat(32)}` as Hex,
  });

  /** The two ways to build the program's own intent: straight through the route compiler, and from
   *  TypeScript with the builder the docs examples use. Each returns the Base route to fulfil. */
  /** `compileSauceRoute` on Base, with `defines` on top of the program's own two. */
  const direct = (program: string, defines: Record<string, bigint | boolean | number>) => {
    const options = intents();
    const compiled = compileSauceRoute(
      "base",
      program,
      { pot: base.pot, engine: v12EngineAddress() as Hex },
      { defines: { ...defines, RECIPIENT: BigInt(RECIPIENT), MIN_AMOUNT: 1n }, intents: options },
    );
    const call = compiled.calls[0]!;
    return {
      route: {
        salt: options.salt,
        deadline: DEADLINE,
        portal: base.portal,
        nativeAmount: 0n,
        tokens: [],
        calls: [
          {
            target: denormalizeToEvm(toUniversalAddress(call.target)) as Address,
            data: call.data,
            value: 0n,
          },
        ],
      } satisfies EvmRoute,
      rewardHash: keccak256("0xbeef"),
    };
  };

  const BUILDS = [
    ["compileSauceRoute", (program: string) => direct(program, {})],
    [
      // Base's token symbols, `chainId` and protocol addresses, as the caller's own defines. They
      // are Base's names for the program on Base and nothing else: a nested body gets its own
      // chain's.
      "compileSauceRoute, handed chainDefines(base) as its defines",
      (program: string) => direct(program, chainDefines(requireChain("base"))),
    ],
    [
      "Base(program, options).reward(...)",
      (program: string) => {
        // The enclosing intent's deadline and creator reach the program's intents on their own;
        // the rest are this anvil's, as above.
        const { deadline, creator, ...compileIntents } = intents();
        const built = openRoute("base", program, {
          portal: base.portal,
          deadline,
          creator,
          prover: PROVER,
          source: "ethereum",
          salt: compileIntents.salt,
          defines: { RECIPIENT: BigInt(RECIPIENT), MIN_AMOUNT: 1n },
          compile: { intents: compileIntents },
        }).reward({ deadline: DEADLINE, nativeAmount: 0n });
        return { route: evmRoute(built.intent), rewardHash: built.hash().rewardHash };
      },
    ],
  ] as const;

  describe.each(BUILDS)("built with %s", (_name, build) => {
    it("the README example: funded on Base in Base's USDC, fulfilled on Arbitrum in Arbitrum's", async () => {
      const { route, rewardHash } = build(example("cross-chain-intent"));
      // What the Pot holds when the program measures it; an earlier test's reverted fulfilment can
      // leave its own mint behind.
      await base.mint(base.usdc, base.pot, SEEDED);
      const held = await base.balanceOf(base.usdc, base.pot);

      // ---- Base: the program measures its USDC, pays it into the intent's vault, publishes -----
      // The reward's transfer into the vault runs HERE. Named on Arbitrum, it would hit an
      // address with no code and SafeERC20's check would revert this whole fulfilment.
      const onBase = await base.fulfil(route, rewardHash);
      expect(onBase.status).toBe("success");
      expect(onBase.published).toHaveLength(1);
      const [published] = onBase.published;
      expect(published!.destination).toBe(42_161n);
      expect(published!.rewardTokens.map((t) => [lower(t.token), t.amount])).toEqual([
        [lower(base.usdc), held],
      ]);
      expect(await base.isFunded(published!)).toBe(true);
      expect(await base.balanceOf(base.usdc, base.pot)).toBe(0n);

      // ---- Arbitrum: a solver fulfils it from the route bytes Base logged -----------------------
      // Named on Base, the body's USDC would be an address with no code here, and the Portal's pull
      // of the route's tokens would revert.
      const child = fulfilmentOf(published!);
      const paid = await arbitrum.balanceOf(arbitrum.usdc, RECIPIENT);
      await arbitrum.provide(child.route);
      const onArbitrum = await arbitrum.fulfil(child.route, child.rewardHash);
      expect(onArbitrum.status).toBe("success");
      // Paid by the body's own `USDC.transfer(RECIPIENT, amount)`, in Arbitrum's USDC.
      expect(await arbitrum.balanceOf(arbitrum.usdc, RECIPIENT)).toBe(paid + held);
      expect(child.route.tokens.map((t) => [lower(t.token), t.amount])).toEqual([
        [lower(arbitrum.usdc), held],
      ]);
    }, 300_000);

    it("the cascade: each hop funded on its own source chain, down to Optimism", async () => {
      const { route, rewardHash } = build(example("cross-chain-cascade"));
      await base.mint(base.usdc, base.pot, SEEDED);
      const held = await base.balanceOf(base.usdc, base.pot);

      // ---- hop 1, on Base: publishes the Arbitrum intent, funded in Base's USDC -----------------
      const onBase = await base.fulfil(route, rewardHash);
      expect(onBase.status).toBe("success");
      const [toArbitrum] = onBase.published;
      expect(toArbitrum!.destination).toBe(42_161n);
      expect(toArbitrum!.rewardTokens.map((t) => [lower(t.token), t.amount])).toEqual([
        [lower(base.usdc), held],
      ]);

      // ---- hop 2, on Arbitrum: its program publishes the Optimism intent, funded in ARBITRUM's --
      // USDC — the chain that program runs on — from what the solver just delivered to its Pot.
      const second = fulfilmentOf(toArbitrum!);
      await arbitrum.provide(second.route);
      const onArbitrum = await arbitrum.fulfil(second.route, second.rewardHash);
      expect(onArbitrum.status).toBe("success");
      const [toOptimism] = onArbitrum.published;
      expect(toOptimism!.destination).toBe(10n);
      expect(toOptimism!.rewardTokens.map((t) => [lower(t.token), t.amount])).toEqual([
        [lower(arbitrum.usdc), held],
      ]);
      expect(await arbitrum.isFunded(toOptimism!)).toBe(true);
      expect(await arbitrum.balanceOf(arbitrum.usdc, arbitrum.pot)).toBe(0n);

      // ---- hop 3, on Optimism: the body pays out in Optimism's USDC -----------------------------
      const third = fulfilmentOf(toOptimism!);
      const paid = await optimism.balanceOf(optimism.usdc, RECIPIENT);
      await optimism.provide(third.route);
      const onOptimism = await optimism.fulfil(third.route, third.rewardHash);
      expect(onOptimism.status).toBe("success");
      expect(await optimism.balanceOf(optimism.usdc, RECIPIENT)).toBe(paid + held);
    }, 300_000);
  });

  it("a body that calls the file's typed helpers and an import runs on Arbitrum", async () => {
    // The body compiles as a program of its own: it carries `fee`, the typed array helper `sum`
    // and the `balanceOf` import it reaches, and binds `held` by destructuring. Each of those
    // failed to compile before: a helper or an import was "called but never declared", an
    // annotation was "Unexpected token", and `[held]` was mistaken for a capture.
    const program = `import { balanceOf } from "@sauce/token";

function fee(amount: Uint256): Uint256 {
  return amount / 100n;
}

function sum(parts: Uint256[]): Uint256 {
  let total = 0n;
  for (const part of parts) {
    total += part;
  }
  return total;
}

function main() {
  const amount = USDC.balanceOf(ctx.self());
  require(amount >= MIN_AMOUNT);
  Arbitrum.Portal.send([{ token: USDC, amount }]).receive([{ token: USDC, amount }]).then(() => {
    const [held] = abi.decode(abi.encode(balanceOf(USDC, ctx.self())), ["Uint256"]);
    const parts: Uint256[] = [held - fee(held), fee(held)];
    USDC.transfer(RECIPIENT, sum(parts) - fee(held));
  });
}`;
    const { route, rewardHash } = direct(program, {});
    await base.mint(base.usdc, base.pot, SEEDED);
    const held = await base.balanceOf(base.usdc, base.pot);

    const onBase = await base.fulfil(route, rewardHash);
    expect(onBase.status).toBe("success");
    const [published] = onBase.published;
    expect(published!.destination).toBe(42_161n);

    const child = fulfilmentOf(published!);
    const paid = await arbitrum.balanceOf(arbitrum.usdc, RECIPIENT);
    await arbitrum.provide(child.route);
    const onArbitrum = await arbitrum.fulfil(child.route, child.rewardHash);
    expect(onArbitrum.status).toBe("success");
    // `sum([held - fee, fee]) - fee`: everything the solver delivered, less the one percent.
    expect(await arbitrum.balanceOf(arbitrum.usdc, RECIPIENT)).toBe(paid + held - held / 100n);
  }, 300_000);

  it("a module `let` reaches the body's program with the value it has where the intent opens", async () => {
    // `total` starts at 0n and is set before the intent. The reward escrows it at run time; the
    // body's program, through `half()`, must pay out from the same value, not from the 0n its
    // declaration starts with.
    const program = `let total = 0n;

function half(): Uint256 {
  return total / 2n;
}

function main() {
  total = USDC.balanceOf(ctx.self());
  require(total >= MIN_AMOUNT);
  Arbitrum.Portal.send([{ token: USDC, amount: total }]).receive([{ token: USDC, amount: total }]).then(() => {
    USDC.transfer(RECIPIENT, half());
  });
}`;
    const { route, rewardHash } = direct(program, {});
    await base.mint(base.usdc, base.pot, SEEDED);
    const held = await base.balanceOf(base.usdc, base.pot);

    const onBase = await base.fulfil(route, rewardHash);
    expect(onBase.status).toBe("success");
    const child = fulfilmentOf(onBase.published[0]!);
    const paid = await arbitrum.balanceOf(arbitrum.usdc, RECIPIENT);
    await arbitrum.provide(child.route);
    const onArbitrum = await arbitrum.fulfil(child.route, child.rewardHash);
    expect(onArbitrum.status).toBe("success");
    expect(await arbitrum.balanceOf(arbitrum.usdc, RECIPIENT)).toBe(paid + held / 2n);
  }, 300_000);

  it("CONTROL: a reward naming the DESTINATION's token reverts the fulfilment where it is funded", async () => {
    // What the lowering used to build for `{ token: USDC }`, written out by hand: the transfer into
    // the vault hits an address with no code on Base, and the whole fulfilment reverts. This is
    // the failure the suite above exists to rule out, shown to be real rather than assumed.
    const program = `function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum.Portal.send([{ token: ARBITRUM_USDC, amount }]).receive().then(() => {
    USDC.transfer(RECIPIENT, amount);
  });
}`;
    const compiled = compileSauceRoute(
      "base",
      program,
      { pot: base.pot, engine: v12EngineAddress() as Hex },
      {
        defines: { RECIPIENT: BigInt(RECIPIENT), ARBITRUM_USDC: BigInt(arbitrum.usdc) },
        intents: intents(),
      },
    );
    await base.mint(base.usdc, base.pot, SEEDED);
    const call = compiled.calls[0]!;
    const { status, published } = await base.fulfil(
      {
        salt: `0x${"c0".repeat(32)}`,
        deadline: DEADLINE,
        portal: base.portal,
        nativeAmount: 0n,
        tokens: [],
        calls: [
          {
            target: denormalizeToEvm(toUniversalAddress(call.target)) as Address,
            data: call.data,
            value: 0n,
          },
        ],
      },
      keccak256("0xbeef"),
    );

    expect(status).toBe("reverted");
    expect(published).toHaveLength(0);
    // Reverted whole: the seeded balance is still in the Pot, not escrowed anywhere.
    expect(await base.balanceOf(base.usdc, base.pot)).toBeGreaterThanOrEqual(SEEDED);
  }, 300_000);

  it("CONTROL: an Arbitrum route naming Base's USDC reverts on Arbitrum", async () => {
    // What the TypeScript builder used to put in the body: Base's address, on Arbitrum. The Portal
    // pulls the route's tokens with SafeERC20, and there is no contract there to pull from.
    const route: EvmRoute = {
      salt: `0x${"c1".repeat(32)}`,
      deadline: DEADLINE,
      portal: arbitrum.portal,
      nativeAmount: 0n,
      tokens: [{ token: base.usdc, amount: SEEDED }],
      calls: [
        {
          target: base.usdc,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [RECIPIENT, SEEDED],
          }),
          value: 0n,
        },
      ],
    };
    await arbitrum.provide(route);
    const paid = await arbitrum.balanceOf(arbitrum.usdc, RECIPIENT);

    const { status } = await arbitrum.fulfil(route, keccak256("0xbeef"));
    expect(status).toBe("reverted");
    expect(await arbitrum.balanceOf(arbitrum.usdc, RECIPIENT)).toBe(paid);
  }, 300_000);
});
