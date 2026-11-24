/**
 * Stands up the released v12 EVM stack — engine, Router, Kitchen implementation and
 * Kitchen proxy — for suites that execute compiler-emitted bytecode.
 *
 * NOT a `.test.ts`, so jest never collects it.
 *
 * **The engine cannot be called directly.** It checks that its caller is a Pot its Kitchen placed —
 * CREATE3 under the release's Pot profile since v12-evm 1.4.0, CREATE2 under the Pot init-code hash
 * before — and reverts with empty returndata otherwise: no reason string, nothing to match on. Both
 * identities are baked into the released artifact, so the caller has to be a REAL Pot, minted by
 * the one Kitchen address the engine was built against.
 *
 * **Everything is deployed from its creation code, at its release address**, by
 * `src/evm/release-stack.ts#deployReleaseStack` — CreateX's CREATE3 proxy child installed at each
 * release salt's address and sent the creation code — which `@eco-incorp/sauce/testing` deploys
 * with too. This reads the synced artifacts for it, checks the Kitchen landed where the engine gates
 * and predicts the Pot the SDK derives, and mints the harness Pot. The Kitchen is left with its
 * owner (the harness account) and a zero execution fee, so no cook needs `value`.
 *
 * **Arms** (`../release-arm.ts`): by default the stack is the release the SDK pins. With
 * `SAUCE_TEST_EVM_ARM=<version>` it is the earlier engine release of that version the installed
 * row's `alsoRunsOn` lists, from the artifacts the sync wrote to `src/artifacts/legacy`: `1.3.0`
 * (engine v12-evm 1.3.0, kitchen-evm 1.3.0 Pots, CREATE2) or `1.4.0` (engine 1.4.0 on its Router,
 * kitchen-evm 1.4.0 CREATE3 Pots): every suite then runs the installed compiler's programs on that
 * engine.
 *
 * `startUpgradedChain` is the chain as the live ones are after a rollout: the earlier release's stack
 * with Pots minted on it, upgraded to this one, which mints another. From kitchen-evm 1.4.0 the
 * rollout is a Router switch: the 1.4.0 stack with a dynamic, a fixed-Router and a Shared Pot on its
 * Router, the new engine and Router deployed, and the Kitchen switched by `setRouter` alone.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, getAddress, zeroAddress } from "viem";
import type { Abi, Address, Hex, PublicClient, TestClient, WalletClient } from "viem";

import { v12PredictPot } from "../../src/deployments/pot.js";
import {
  deployReleaseStack,
  upgradeReleaseStack,
  type ReleaseStackArtifacts,
} from "../../src/evm/release-stack.js";
import {
  hasLegacyArtifacts,
  legacyArtifactsDir,
  legacyRow,
  releaseArm,
  type ReleaseArm,
} from "../release-arm.js";

export { hasLegacyArtifacts, legacyArtifactsDir } from "../release-arm.js";

const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/artifacts");

type Clients = { publicClient: PublicClient; walletClient: WalletClient; testClient: TestClient };

const read = <T>(dir: string, name: string): T =>
  JSON.parse(readFileSync(resolve(dir, `${name}.json`), "utf8")) as T;

const artifact = (name: string, dir = ARTIFACTS): { abi: Abi; bytecode: Hex } =>
  read<{ abi: Abi; bytecode: Hex }>(dir, name);

/**
 * `kitchen` and `potInitCodeHash`, written by `sync-engine-artifacts` from the engine release's own
 * manifest: the anchors the released engine gates every cook on. From v12-evm 1.4.0 the gate is the
 * CREATE3 Pot profile: `scheme`, `fixedRouter`, `potProxyInitCodeHash` and `potProfileHash` come
 * with it, and `potInitCodeHash` is what the Kitchen's `potInitCodeHash()` reports (keccak256 of the
 * Pot's creation code).
 */
export const gateAnchors = (): {
  kitchen: Address;
  potInitCodeHash: Hex;
  scheme?: "create3";
  fixedRouter?: Address;
  potProxyInitCodeHash?: Hex;
  potProfileHash?: Hex;
} => read(ARTIFACTS, "V12EngineGate");

/** The release's CREATE3 inputs, from `V12Deployments.json`. */
const deployments = (dir = ARTIFACTS): ReleaseStackArtifacts["deployments"] =>
  read<{ evm: ReleaseStackArtifacts["deployments"] }>(dir, "V12Deployments").evm;

/** The Pot salt every harness mints under. One Pot is enough: suites name their own accounts. */
export const POT_SALT = `0x${"00".repeat(31)}07` as Hex;

/** The salt of the second Pot an upgraded chain mints, under the release this SDK pins. */
export const NEW_POT_SALT = `0x${"00".repeat(31)}08` as Hex;

export interface GatedEngine {
  /** Which release this stack is: the installed row's (`"default"`) or the earlier engine version
   *  the arm runs (`"1.4.0"`, `"1.3.0"`). */
  arm: ReleaseArm;
  /** The engine, at its release address (`v12EngineAddress()` on the default arm), deployed from
   *  creation code: its constructor bound that identity for the Pot's `EVAL` relay. */
  engine: Address;
  /** The Router the Kitchen hands every new Pot, at its release address. */
  router: Address;
  /** The Kitchen proxy, at the address the engine's gate hashes. Owned by the harness account. */
  kitchen: Address;
  /** The Pot every program runs as. `ctx.self()` is this, not the engine. */
  pot: Address;
  /** Wraps a program in the `cook` the Pot expects. */
  cookData: (program: Hex) => Hex;
  /** What a cook must pay. Zero here: the harness sets the Kitchen's fee to zero. */
  fee: bigint;
  /** Where this stack's Kitchen places `owner`'s Pot at `salt` (`POT_SALT` when left out). */
  predictPot: (owner: Address, salt?: Hex) => Address;
}

/** The artifacts of the release this SDK pins: the stack `startGatedEngine` deploys. */
const defaultArtifacts = (runtimeCreationCode: Hex): ReleaseStackArtifacts => ({
  deployments: deployments(),
  runtimeCreationCode,
  routerBytecode: artifact("Router").bytecode,
  kitchen: artifact("V12Kitchen"),
  kitchenProxyBytecode: artifact("V12KitchenProxy").bytecode,
});

/** Wraps a program in the `cook` of `engine` that a Pot of `potAbi` expects. */
const cookDataFor =
  (engine: Address, potAbi: Abi = artifact("V12Pot").abi): GatedEngine["cookData"] =>
  (program) =>
    encodeFunctionData({ abi: potAbi, args: [engine, program], functionName: "cook" });

/** Where the installed release's Kitchen places `owner`'s Pot at `salt`. */
const defaultPredict = (owner: Address, salt: Hex = POT_SALT): Address =>
  getAddress(v12PredictPot(owner, salt));

/**
 * Checks the Kitchen at `kitchen` is the one the release is built against: it reports the pinned
 * Pot hash, and predicts for `owner` the Pot the SDK derives. This is what makes a mismatched
 * Kitchen fail HERE, naming the cause, rather than as an unexplained empty revert from the gate in
 * whichever test runs first.
 */
const requireReleaseKitchen = async (
  publicClient: PublicClient,
  kitchen: Address,
  owner: Address,
): Promise<void> => {
  const kitchenAbi = artifact("V12Kitchen").abi;
  const { potInitCodeHash } = gateAnchors();
  const live = (await publicClient.readContract({
    abi: kitchenAbi,
    address: kitchen,
    functionName: "potInitCodeHash",
  })) as Hex;
  if (live.toLowerCase() !== potInitCodeHash.toLowerCase()) {
    throw new Error(
      `the Kitchen at ${kitchen} reports potInitCodeHash ${live}, but the engine was built ` +
        `against ${potInitCodeHash}: every Pot it mints would land at an address the gate rejects.`,
    );
  }
  const predicted = (await publicClient.readContract({
    abi: kitchenAbi,
    address: kitchen,
    args: [owner, POT_SALT],
    functionName: "predictPot",
  })) as Address;
  const derived = defaultPredict(owner);
  if (getAddress(predicted) !== derived) {
    throw new Error(
      `the Kitchen at ${kitchen} predicts the Pot ${predicted} for ${owner}, but the SDK derives ` +
        `${derived}: v12PredictPot does not follow this release's Kitchen.`,
    );
  }
};

/** How a Pot is minted: `deployPot(owner, salt)`, `deployPot(owner, salt, true)` or `deploySharedPot(salt)`. */
type PotKindMinted = "private" | "fixed" | "shared";

/**
 * Mints a Pot through the Kitchen and returns it: it must land at `mint.expected` (the address the
 * SDK predicts) and start on `router`, the Router the Kitchen handed it.
 */
const mintPot = async (
  clients: Clients,
  owner: Address,
  kitchen: Address,
  kitchenAbi: Abi,
  potAbi: Abi,
  mint: {
    readonly kind?: PotKindMinted;
    readonly for: Address;
    readonly salt: Hex;
    readonly expected: Address;
  },
  router: Address,
): Promise<Address> => {
  const { publicClient, walletClient } = clients;
  const kind = mint.kind ?? "private";
  const data =
    kind === "shared"
      ? encodeFunctionData({ abi: kitchenAbi, functionName: "deploySharedPot", args: [mint.salt] })
      : encodeFunctionData({
          abi: kitchenAbi,
          functionName: "deployPot",
          args: kind === "fixed" ? [mint.for, mint.salt, true] : [mint.for, mint.salt],
        });
  const hash = await walletClient.sendTransaction({
    account: owner,
    chain: null,
    data,
    gas: 30_000_000n,
    to: kitchen,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`a harness transaction to ${kitchen} reverted`);
  if (!(await publicClient.getCode({ address: mint.expected }))) {
    throw new Error(`no Pot was minted at the derived address ${mint.expected}`);
  }
  const potRouter = await publicClient.readContract({
    abi: potAbi,
    address: mint.expected,
    functionName: "router",
  });
  if (String(potRouter).toLowerCase() !== router.toLowerCase()) {
    throw new Error("the Pot did not inherit the Kitchen's configured Router");
  }

  return mint.expected;
};

/** The earlier release's stack, as `deployLegacyStack` stands it up. */
interface LegacyStack {
  readonly engine: Address;
  readonly router: Address;
  readonly kitchen: Address;
  readonly kitchenAbi: Abi;
  readonly potAbi: Abi;
  /** Each owner's Pot at the salt, minted by the earlier release's Kitchen. */
  readonly pots: Readonly<Record<Address, Address>>;
  /** The row whose release this is: what `v12PredictPot` names it by. */
  readonly compiler: string;
  /** Whether its Pots are CREATE3 (kitchen-evm 1.4.0 on) and so may be fixed-Router or Shared. */
  readonly create3: boolean;
}

/**
 * The earlier release's stack — an engine version the installed row's `alsoRunsOn` lists — deployed
 * at its release addresses from its own artifacts (`legacyArtifactsDir("evm", version)`), with that
 * release's dynamic Pot minted for each of `owners` at `salt`, all sent by `owner` (`deployPot`
 * takes any owner). The Kitchen must land where that release's engine gates and report its Pot hash,
 * and each Pot must land where `v12PredictPot` derives it for that release and start on that
 * release's Router.
 */
const deployLegacyStack = async (
  clients: Clients,
  owner: Address,
  owners: readonly Address[],
  salt: Hex,
  version: string,
): Promise<LegacyStack> => {
  const { publicClient } = clients;
  const dir = legacyArtifactsDir("evm", version);
  if (!hasLegacyArtifacts("evm", version)) {
    throw new Error(
      `the ${version} release's artifacts are missing (${dir}): run sync-engine-artifacts, which ` +
        "writes them from the public package its release table names",
    );
  }
  const gate = read<{ kitchen: Address; potInitCodeHash: Hex; scheme?: "create3" }>(
    dir,
    "V12EngineGate",
  );
  const kitchenArtifact = artifact("V12Kitchen", dir);
  const potAbi = artifact("V12Pot", dir).abi;
  const stack = await deployReleaseStack(clients, owner, {
    deployments: deployments(dir),
    runtimeCreationCode: read<{ runtimeCreationCode: Hex }>(dir, "V12RuntimeBytecode")
      .runtimeCreationCode,
    routerBytecode: artifact("Router", dir).bytecode,
    kitchen: kitchenArtifact,
    kitchenProxyBytecode: artifact("V12KitchenProxy", dir).bytecode,
  });
  if (stack.kitchen !== getAddress(gate.kitchen)) {
    throw new Error(
      `the earlier Kitchen landed at ${stack.kitchen}, but its engine gates on ${gate.kitchen}`,
    );
  }
  const live = (await publicClient.readContract({
    abi: kitchenArtifact.abi,
    address: stack.kitchen,
    functionName: "potInitCodeHash",
  })) as Hex;
  if (live.toLowerCase() !== gate.potInitCodeHash.toLowerCase()) {
    throw new Error(
      `the earlier Kitchen at ${stack.kitchen} reports potInitCodeHash ${live}, but its engine was ` +
        `built against ${gate.potInitCodeHash}: every Pot it mints would land at an address the ` +
        "gate rejects.",
    );
  }
  const { compiler } = legacyRow("evm", version);
  const pots: Record<Address, Address> = {};
  for (const minted of new Set(owners.map((one) => getAddress(one)))) {
    pots[minted] = await mintPot(
      clients,
      owner,
      stack.kitchen,
      kitchenArtifact.abi,
      potAbi,
      {
        for: minted,
        salt,
        expected: getAddress(v12PredictPot(minted, salt, { compiler })),
      },
      stack.router,
    );
  }

  return {
    engine: stack.engine,
    router: stack.router,
    kitchen: stack.kitchen,
    kitchenAbi: kitchenArtifact.abi,
    potAbi,
    pots,
    compiler,
    create3: gate.scheme === "create3",
  };
};

/**
 * Deploys the stack at its release addresses and mints the harness Pot.
 *
 * `owner` must be an account the caller can send from AND set as the `from` of an `eth_call`:
 * `Pot.cook` is `onlyOwner`, and viem's `publicClient.call` sends no `from` by default, so a read
 * that omits it reverts with `NotOwner()` rather than running anything. It also owns the Kitchen.
 *
 * On a legacy arm (`SAUCE_TEST_EVM_ARM=<version>`) the stack is that earlier release's, deployed
 * from its own artifacts, and `runtimeCreationCode` is not read: that engine's creation code is
 * among them. Every Pot the suite mints through `kitchen` is then that release's, and every cook
 * names its engine.
 */
export const startGatedEngine = async (
  clients: Clients,
  owner: Address,
  runtimeCreationCode: Hex,
): Promise<GatedEngine> => {
  const { publicClient } = clients;
  const arm = releaseArm("evm");
  if (arm !== "default") {
    const stack = await deployLegacyStack(clients, owner, [owner], POT_SALT, arm);
    const fee = (await publicClient.readContract({
      abi: stack.kitchenAbi,
      address: stack.kitchen,
      functionName: "executionFee",
    })) as bigint;

    return {
      arm,
      cookData: cookDataFor(stack.engine, stack.potAbi),
      engine: stack.engine,
      fee,
      kitchen: stack.kitchen,
      pot: stack.pots[getAddress(owner)]!,
      predictPot: (who, salt = POT_SALT) =>
        getAddress(v12PredictPot(who, salt, { compiler: stack.compiler })),
      router: stack.router,
    };
  }
  const { kitchen: gateKitchen } = gateAnchors();
  const kitchenAbi = artifact("V12Kitchen").abi;

  const { engine, router, kitchen } = await deployReleaseStack(
    clients,
    owner,
    defaultArtifacts(runtimeCreationCode),
  );
  if (kitchen !== getAddress(gateKitchen)) {
    throw new Error(`the Kitchen landed at ${kitchen}, but the engine gates on ${gateKitchen}`);
  }
  await requireReleaseKitchen(publicClient, kitchen, owner);

  const pot = await mintPot(
    clients,
    owner,
    kitchen,
    kitchenAbi,
    artifact("V12Pot").abi,
    { for: owner, salt: POT_SALT, expected: defaultPredict(owner) },
    router,
  );
  const fee = (await publicClient.readContract({
    abi: kitchenAbi,
    address: kitchen,
    functionName: "executionFee",
  })) as bigint;

  return {
    arm: "default",
    cookData: cookDataFor(engine),
    engine,
    fee,
    kitchen,
    pot,
    predictPot: defaultPredict,
    router,
  };
};

export interface UpgradedChain extends GatedEngine {
  /**
   * The earlier release, as the chain ran it before the upgrade: its engine and Router at their
   * release addresses; `owner`'s Pot at the legacy salt (`POT_SALT`), minted by that release's
   * Kitchen; and the Pot of each of `options.legacyOwners` at that salt, minted the same way, by
   * owner. From a CREATE3 release (`from: "1.4.0"`) also `owner`'s fixed-Router Pot and the Shared
   * Pot at that salt: on the earlier Router for good.
   */
  readonly legacy: {
    readonly engine: Address;
    readonly router: Address;
    readonly pot: Address;
    readonly pots: Readonly<Record<Address, Address>>;
    readonly fixedPot?: Address;
    readonly sharedPot?: Address;
  };
  /** From a CREATE3 release: `owner`'s fixed-Router Pot and the Shared Pot minted after the switch
   *  (at `NEW_POT_SALT`), on the new Router. */
  readonly fixedPot?: Address;
  readonly sharedPot?: Address;
}

/**
 * A chain as the live ones are after a rollout: the earlier release's stack deployed and `owner`'s
 * Pot — and each `legacyOwners` Pot — minted on it at `legacySalt` (`POT_SALT`), then the stack
 * upgraded to the release this SDK pins and `owner`'s new Pot minted at `NEW_POT_SALT`. Every Pot
 * cooks, each on its own engine. `from` is the earlier engine version (`"1.3.0"` when left out).
 * From `"1.4.0"` the Kitchen's implementation does not change and the upgrade is `setRouter` alone;
 * the chain also holds a fixed-Router and a Shared Pot minted before it and another pair after it.
 */
export const startUpgradedChain = async (
  clients: Clients,
  owner: Address,
  runtimeCreationCode: Hex,
  options?: {
    readonly legacyOwners?: readonly Address[];
    readonly legacySalt?: Hex;
    readonly from?: string;
  },
): Promise<UpgradedChain> => {
  const { publicClient } = clients;
  const kitchenAbi = artifact("V12Kitchen").abi;
  const legacySalt = options?.legacySalt ?? POT_SALT;

  // The earlier release, as the chain ran it: its stack, and each owner's Pot minted by its Kitchen.
  const earlier = await deployLegacyStack(
    clients,
    owner,
    [owner, ...(options?.legacyOwners ?? [])],
    legacySalt,
    options?.from ?? "1.3.0",
  );
  // From a CREATE3 release, a fixed-Router and a Shared Pot minted on it keep its Router for good.
  let legacyFixed: Address | undefined;
  let legacyShared: Address | undefined;
  if (earlier.create3) {
    const mintEarlier = (kind: "fixed" | "shared"): Promise<Address> => {
      const holder = kind === "shared" ? zeroAddress : owner;

      return mintPot(
        clients,
        owner,
        earlier.kitchen,
        earlier.kitchenAbi,
        earlier.potAbi,
        {
          kind,
          for: holder,
          salt: legacySalt,
          expected: getAddress(
            v12PredictPot(holder, legacySalt, {
              compiler: earlier.compiler,
              ...(kind === "fixed" ? { routerFixed: true } : {}),
            }),
          ),
        },
        earlier.router,
      );
    };
    legacyFixed = await mintEarlier("fixed");
    legacyShared = await mintEarlier("shared");
  }

  // The rollout: the new engine, Router and implementation at their addresses, the proxy upgraded.
  const stack = await upgradeReleaseStack(clients, owner, defaultArtifacts(runtimeCreationCode));
  const { kitchen: gateKitchen } = gateAnchors();
  if (stack.kitchen !== getAddress(gateKitchen) || stack.kitchen !== earlier.kitchen) {
    throw new Error(
      `the Kitchen landed at ${stack.kitchen}, but the engine gates on ${gateKitchen}`,
    );
  }
  const hash = await clients.walletClient.sendTransaction({
    account: owner,
    chain: null,
    data: encodeFunctionData({ abi: kitchenAbi, functionName: "setExecutionFee", args: [0n] }),
    gas: 30_000_000n,
    to: stack.kitchen,
  });
  if ((await publicClient.waitForTransactionReceipt({ hash })).status !== "success") {
    throw new Error("setting the upgraded Kitchen's execution fee reverted");
  }
  await requireReleaseKitchen(publicClient, stack.kitchen, owner);

  const predicted = (await publicClient.readContract({
    abi: kitchenAbi,
    address: stack.kitchen,
    args: [owner, NEW_POT_SALT],
    functionName: "predictPot",
  })) as Address;
  const derived = defaultPredict(owner, NEW_POT_SALT);
  if (getAddress(predicted) !== derived) {
    throw new Error(
      `the upgraded Kitchen predicts the Pot ${predicted} for ${owner} at ${NEW_POT_SALT}, but ` +
        `the SDK derives ${derived}`,
    );
  }
  const potAbi = artifact("V12Pot").abi;
  const pot = await mintPot(
    clients,
    owner,
    stack.kitchen,
    kitchenAbi,
    potAbi,
    { for: owner, salt: NEW_POT_SALT, expected: derived },
    stack.router,
  );
  // After the switch a fixed-Router and a Shared Pot start on the new Router, for good.
  let fixedPot: Address | undefined;
  let sharedPot: Address | undefined;
  if (earlier.create3) {
    const mintNew = (kind: "fixed" | "shared"): Promise<Address> => {
      const holder = kind === "shared" ? zeroAddress : owner;

      return mintPot(
        clients,
        owner,
        stack.kitchen,
        kitchenAbi,
        potAbi,
        {
          kind,
          for: holder,
          salt: NEW_POT_SALT,
          expected: getAddress(
            v12PredictPot(holder, NEW_POT_SALT, kind === "fixed" ? { routerFixed: true } : {}),
          ),
        },
        stack.router,
      );
    };
    fixedPot = await mintNew("fixed");
    sharedPot = await mintNew("shared");
  }
  const fee = (await publicClient.readContract({
    abi: kitchenAbi,
    address: stack.kitchen,
    functionName: "executionFee",
  })) as bigint;

  return {
    arm: "default",
    cookData: cookDataFor(stack.engine),
    engine: stack.engine,
    fee,
    kitchen: stack.kitchen,
    legacy: {
      engine: earlier.engine,
      pot: earlier.pots[getAddress(owner)]!,
      pots: earlier.pots,
      router: earlier.router,
      ...(legacyFixed === undefined ? {} : { fixedPot: legacyFixed, sharedPot: legacyShared! }),
    },
    pot,
    predictPot: defaultPredict,
    router: stack.router,
    ...(fixedPot === undefined ? {} : { fixedPot, sharedPot: sharedPot! }),
  };
};
