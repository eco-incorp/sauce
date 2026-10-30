/**
 * The Pots the `sauce` command deploys, read from the chain: which a landed transaction deployed,
 * which release minted each, the Pots `sauce pot import` finds, and what `sauce pot list` prints.
 *
 * A record comes from the chain's own evidence, never from what the command meant to send: on an
 * EVM chain the `PotDeployed(owner, salt, pot)` the released Kitchen emits in a receipt that
 * succeeded, on Solana the Kitchen's `create_pot` in a transaction that succeeded (`create_pot` is
 * not idempotent, so one that succeeded created the Pot). So the two places every send lands —
 * `chain.ts#landed` and `solana.ts#svmLanded` — find them, whatever sent the transaction: `sauce
 * pot --deploy`, a run that deploys its Pot first, `sauce send`, a cook whose program calls the
 * Kitchen.
 *
 * Historical CREATE2 address commitments identify possible releases of deployed Pots only.
 * Imports and execution also verify code, protected identity and explicit engine/Router bindings.
 * New candidates use CREATE3 and require an operator-selected authenticated release descriptor.
 * Solana discovery and engine-owned account behavior remain unchanged.
 *
 * Every landed transaction carries its records (`Sent.pots`, `SvmSent.pots`), which every JSON that
 * reports it includes. Where a scope keeps the Pot store (`keep.ts`: the command, and the local MCP
 * server), {@link keepPots} writes them as they land.
 */
import { readFileSync } from "node:fs";

import {
  getBase58Encoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Address as SvmAddress,
} from "@solana/kit";
import {
  BaseError,
  bytesToHex,
  decodeEventLog,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  hexToBytes,
  keccak256,
  toEventSelector,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { requireChain, resolveChain, type CanonicalChain } from "../chains/canonical.js";
import {
  sdkCompilerVersion,
  V12_RELEASE_SETS,
  v12SvmKitchenProgramId,
  type V12ReleaseSet,
} from "../deployments/index.js";
import { v12PredictPot, v12PredictSharedPot } from "../deployments/pot.js";
import { SDK_RELEASES } from "../embedded/sdk-releases.generated.js";
import { v12KitchenAbi, v12PotAbi, verifyPotBinding, type EvmPotBinding } from "../evm/engine.js";
import {
  getVerifiedPotBinding,
  observedCodeHash,
  potCandidate,
  requestedPotBinding,
  selectedKitchen,
  storedPot,
  verifyRecordedPot,
} from "./pot-binding.js";
import { svmClusterOf } from "../routes/token-registry.js";
import { derivePotPda, KITCHEN_DISCRIMINATORS } from "../svm/kitchen.js";
import { CliError } from "./args.js";
import { keptPots, type Landed } from "./keep.js";
import {
  MAINNET_CLUSTER,
  POT_SCHEMA,
  type PotKind,
  type PotRecord,
  type PotStore,
} from "./pot-store.js";

let version: string | undefined;

/** The package's version, from the manifest three levels above `sdk/{src,dist}/cli`: read once. */
const sdkVersion = (): string =>
  (version ??= (
    JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
      version: string;
    }
  ).version);

/**
 * The SDK releases that pinned `release` (a record's: its compiler and each component's version), as
 * the changelog's "Which versions work together" table lists them (`SDK_RELEASES`, which the build
 * generates from it): `0.99.9 to 0.99.15` for consecutive releases, runs apart joined by commas.
 * `undefined` when none did.
 */
export function pairedSdkReleases(release: Readonly<Record<string, string>>): string | undefined {
  const ordered = SDK_RELEASES.map((row) => ({
    sdk: row.sdk!,
    row,
    parts: row.sdk!.split(".").map(Number),
  })).sort(
    (a, b) => a.parts[0]! - b.parts[0]! || a.parts[1]! - b.parts[1]! || a.parts[2]! - b.parts[2]!,
  );
  const runs: string[][] = [];
  let run: string[] | undefined;
  for (const { sdk, row } of ordered) {
    if (Object.entries(release).every(([component, version]) => row[component] === version)) {
      if (run === undefined) runs.push((run = []));
      run.push(sdk);
    } else {
      run = undefined;
    }
  }

  return runs.length === 0
    ? undefined
    : runs.map((one) => (one.length === 1 ? one[0] : `${one[0]} to ${one.at(-1)}`)).join(", ");
}

/** A record's release, as a reader reads it: `compiler 2.5.0 (v12-evm 1.2.0, kitchen-evm 1.2.0)`. */
export const releaseText = (release: PotRecord["release"]): string => {
  if (release === undefined) return "release unknown";
  const { compiler, ...components } = release;

  return `compiler ${compiler} (${Object.entries(components)
    .map(([component, version]) => `${component} ${version}`)
    .join(", ")})`;
};

// ---------------------------------------------------------------------------------------------
// Which release minted a Pot
// ---------------------------------------------------------------------------------------------

/** One Kitchen and the init-code hash its Pots are minted under, with every release set that
 *  minted them: the SDK's own first, then the newest. */
export interface PotFamily {
  readonly kitchen: Address;
  readonly potInitCodeHash: Hex;
  readonly sets: readonly V12ReleaseSet[];
}

let preferredSets: readonly V12ReleaseSet[] | undefined;

/** The release sets, the SDK's own first and then the newest: the one a Pot is recorded under
 *  when several share its Kitchen and hash. The table is the SDK's own, so it is ordered once. */
const preferred = (): readonly V12ReleaseSet[] => {
  const own = sdkCompilerVersion();

  return (preferredSets ??= [...V12_RELEASE_SETS]
    .reverse()
    .sort((a, b) => +(b.compiler === own) - +(a.compiler === own)));
};

let families: readonly PotFamily[] | undefined;

/** Every Kitchen and Pot init-code hash a known release mints under: gathered once. */
const potFamilies = (): readonly PotFamily[] => (families ??= gatherFamilies());

function gatherFamilies(): PotFamily[] {
  const families = new Map<
    string,
    { kitchen: Address; potInitCodeHash: Hex; sets: V12ReleaseSet[] }
  >();
  for (const set of preferred()) {
    const { kitchen, potInitCodeHash, scheme } = set["kitchen-evm"];
    if (scheme === "create3" || typeof kitchen !== "string" || typeof potInitCodeHash !== "string")
      continue;
    const key = `${kitchen.toLowerCase()}:${potInitCodeHash.toLowerCase()}`;
    const family = families.get(key) ?? {
      kitchen: getAddress(kitchen),
      potInitCodeHash: potInitCodeHash.toLowerCase() as Hex,
      sets: [],
    };
    family.sets.push(set);
    families.set(key, family);
  }

  return [...families.values()];
}

/** The salt a Pot of `kind` is CREATE2 under (`Kitchen._salt`, which `Pot.gateSalt` mirrors). */
const gateSalt = (owner: Address, salt: Hex, routerFixed: boolean): Hex =>
  keccak256(
    routerFixed
      ? encodeAbiParameters(
          [{ type: "address" }, { type: "bytes32" }, { type: "bool" }],
          [owner, salt, true],
        )
      : encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [owner, salt]),
  );

const kindOf = (owner: Address, routerFixed: boolean): PotKind =>
  !routerFixed ? "private" : owner === zeroAddress ? "shared" : "private-fixed-router";

/** Every Pot the Kitchen of `family` could mint for (owner, salt): one of each kind. */
function candidates(
  family: Pick<PotFamily, "kitchen" | "potInitCodeHash">,
  owner: Address,
  salt: Hex,
): Array<{ readonly pot: Address; readonly kind: PotKind }> {
  // A Private Pot has an owner, a Shared one none; either may have its Router fixed.
  const fixed = owner === zeroAddress ? [true] : [false, true];

  return fixed.map((routerFixed) => ({
    pot: getCreate2Address({
      from: family.kitchen,
      salt: gateSalt(owner, salt, routerFixed),
      bytecodeHash: family.potInitCodeHash,
    }),
    kind: kindOf(owner, routerFixed),
  }));
}

/**
 * The release that minted `pot`, Kitchen `kitchen`'s for (`owner`, `salt`), and its kind: the
 * family whose CREATE2 lands on it. `undefined` when no release the SDK knows does.
 */
export function evmPotRelease(input: {
  readonly kitchen: Address;
  readonly owner: Address;
  readonly salt: Hex;
  readonly pot: Address;
}): { readonly family: PotFamily; readonly kind: PotKind } | undefined {
  const owner = getAddress(input.owner);
  const pot = getAddress(input.pot);
  for (const family of potFamilies()) {
    if (family.kitchen !== getAddress(input.kitchen)) continue;
    const found = candidates(family, owner, input.salt).find((one) => one.pot === pot);
    if (found !== undefined) return { family, kind: found.kind };
  }

  return undefined;
}

/**
 * Historical CREATE2 release family indexed by its recorded Kitchen and creation commitment.
 * This does not discover or authenticate the current CREATE3 factory profile.
 */
export const evmKitchenRelease = (
  kitchen: string,
  potInitCodeHash: string,
): PotFamily | undefined =>
  potFamilies().find(
    (family) =>
      family.kitchen === getAddress(kitchen) &&
      family.potInitCodeHash === potInitCodeHash.toLowerCase(),
  );

/** New candidates use CREATE3 only; historical CREATE2 addresses remain discovery evidence. */
export function ownReleasePot(owner: Address, salt: Hex, kind: PotKind): Address {
  return kind === "shared"
    ? v12PredictSharedPot(salt, selectedKitchen())
    : v12PredictPot(owner, salt, selectedKitchen(), kind === "private-fixed-router");
}

/** The EVM part of a release set, as a record names it. */
export const evmRelease = (set: V12ReleaseSet): Record<string, string> => ({
  compiler: set.compiler,
  "v12-evm": set["v12-evm"].version,
  "kitchen-evm": set["kitchen-evm"].version,
});

/** The Solana part of a release set, as a record names it. */
const svmRelease = (set: V12ReleaseSet): Record<string, string> => ({
  compiler: set.compiler,
  "v12-svm": set["v12-svm"].version,
  "kitchen-svm": set["kitchen-svm"].version,
});

/** The release set whose Solana engine is `engine`, the SDK's own first. */
const svmSetOf = (engine: string): V12ReleaseSet | undefined =>
  preferred().find((set) => set["v12-svm"].engine === engine);

/** What every record shares. */
const base = (chain: CanonicalChain, origin: PotRecord["origin"]) => ({
  schema: POT_SCHEMA,
  chain: chain.slug,
  chainId: chain.id,
  origin,
});

/**
 * The chain a Solana Pot is recorded under, whichever SVM chain made or found it: Solana's, with its
 * cluster beside it (`PotRecord.cluster`). The Kitchen's id, and so a Pot's address, is the same on
 * every cluster, and devnet and testnet Pots were recorded so before `solana-devnet` and
 * `solana-testnet` named those clusters: one Pot is one record, in one directory of the store
 * (`1399811149-devnet`, `1399811149-testnet`), however its chain is spelled.
 */
const svmRecordChain = (): CanonicalChain => requireChain("solana");

/** Authenticated deployed identity, retaining historical release provenance when it is known. */
async function evmRecord(input: {
  readonly client: PublicClient;
  readonly chain: CanonicalChain;
  readonly kitchen: Address;
  readonly owner: Address;
  readonly salt: Hex;
  readonly pot: Address;
  readonly origin: PotRecord["origin"];
  readonly deployment?: PotRecord["deployment"];
}): Promise<PotRecord> {
  const known = evmPotRelease(input);
  const stored = storedPot(input.chain.id, input.pot);
  const candidate = potCandidate();
  const requested = requestedPotBinding();
  if (stored?.binding === undefined && known === undefined) {
    const expectedKitchen = requested?.kitchen ?? candidate?.kitchen;
    if (
      expectedKitchen !== undefined &&
      getAddress(expectedKitchen) !== getAddress(input.kitchen)
    ) {
      throw new CliError(
        `Pot ${input.pot} reports a foreign Kitchen; it does not match the explicit binding Kitchen`,
      );
    }
  }
  const choices =
    known?.family.sets.filter(
      (set) => stored?.release?.compiler === undefined || set.compiler === stored.release.compiler,
    ) ?? [];
  const compilers = new Set(choices.map((set) => set.compiler));
  const set = compilers.size === 1 ? choices[0] : undefined;
  const hash = known?.family.potInitCodeHash;
  const router =
    stored?.binding?.router ??
    (known === undefined ? candidate?.router : undefined) ??
    (await input.client.readContract({
      address: input.pot,
      abi: v12PotAbi,
      functionName: "router",
    }));
  const kind =
    stored?.kind ??
    known?.kind ??
    (input.owner === zeroAddress
      ? "shared"
      : v12PredictPot(input.owner, input.salt, input.kitchen, true) === getAddress(input.pot)
        ? "private-fixed-router"
        : "private");
  const trusted =
    stored?.binding ??
    requested ??
    (set === undefined
      ? undefined
      : {
          pot: input.pot,
          kitchen: input.kitchen,
          owner: input.owner,
          userSalt: input.salt,
          kind,
          chainId: input.chain.id,
          compiler: set.compiler,
          engine: getAddress(set["v12-evm"].engine!),
          engineCodeHash: await observedCodeHash(input.client, getAddress(set["v12-evm"].engine!)),
          router,
          routerCodeHash: await observedCodeHash(input.client, router),
          release: evmRelease(set),
          wireProfile: `compiler:${set.compiler}`,
          storageProfile: "sauce.storage.Pot",
        }) ??
    (candidate === undefined
      ? undefined
      : {
          ...candidate,
          pot: input.pot,
          owner: input.owner,
          userSalt: input.salt,
          kind,
          chainId: input.chain.id,
        });
  if (trusted === undefined) {
    throw new CliError(
      `Pot ${input.pot} has unknown profile or ambiguous compiler identity; supply an authenticated release descriptor`,
    );
  }
  const binding = await verifyRecordedPot(input.client, input.chain.id, input.pot, trusted);
  const engine = binding.engine;
  return {
    ...base(input.chain, input.origin),
    pot: getAddress(input.pot),
    owner: getAddress(input.owner),
    salt: input.salt.toLowerCase(),
    kind: binding.kind,
    kitchen: binding.kitchen,
    binding,
    ...(hash === undefined ? {} : { potInitCodeHash: hash }),
    ...(engine === undefined || engine === null ? {} : { engine: getAddress(engine) }),
    release: binding.release,
    sdk: sdkVersion(),
    ...(input.deployment === undefined ? {} : { deployment: input.deployment }),
    recordedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// What a landed transaction deployed
// ---------------------------------------------------------------------------------------------

const POT_DEPLOYED = toEventSelector("PotDeployed(address,bytes32,address)");

let knownKitchens: ReadonlySet<Address> | undefined;

/** Every Kitchen a known release mints from. */
const kitchens = (): ReadonlySet<Address> =>
  (knownKitchens ??= new Set(potFamilies().map((family) => family.kitchen)));

/**
 * The Pots a landed EVM transaction deployed: one record per `PotDeployed` a known Kitchen emitted
 * in it. None for one that reverted. `client` is the endpoint that served its receipt.
 */
export async function evmPotsDeployed(
  client: PublicClient,
  sent: {
    readonly hash: Hex;
    readonly status: "success" | "reverted";
    readonly blockNumber: bigint;
    /** The block's hash, from the receipt: what tells a fork's block from the chain's. */
    readonly blockHash?: Hex;
    readonly logs: ReadonlyArray<{
      readonly address: Address;
      readonly topics: readonly Hex[];
      readonly data: Hex;
    }>;
  },
  from: Address,
): Promise<PotRecord[]> {
  if (sent.status !== "success") return [];
  const candidate = potCandidate();
  const known =
    candidate === undefined ? kitchens() : new Set([...kitchens(), getAddress(candidate.kitchen)]);
  const deployed = sent.logs.filter(
    (log) => log.topics[0]?.toLowerCase() === POT_DEPLOYED && known.has(getAddress(log.address)),
  );
  if (deployed.length === 0) return [];
  const chainId = await client.getChainId();
  const chain = resolveChain(chainId);
  if (chain === undefined) throw new Error(`chain ${chainId} is not one the SDK knows`);

  return Promise.all(
    deployed.map((log) => {
      const kitchen = getAddress(log.address);
      // Decoded by the Kitchen's own ABI, strictly: a log that is not the event it names, its
      // topics or its data the wrong shape, is refused, never read at guessed offsets.
      const { owner, salt, pot } = decodeEventLog({
        abi: v12KitchenAbi,
        eventName: "PotDeployed",
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
        strict: true,
      }).args;

      return evmRecord({
        client,
        chain,
        kitchen,
        owner,
        salt,
        pot,
        origin: "deployed",
        deployment: {
          tx: sent.hash,
          block: sent.blockNumber.toString(),
          ...(sent.blockHash === undefined ? {} : { blockHash: sent.blockHash }),
          from: getAddress(from),
        },
      });
    }),
  );
}

/** One instruction of a compiled Solana message. */
interface CompiledInstruction {
  readonly programAddressIndex: number;
  readonly accountIndices?: readonly number[];
  readonly data?: Uint8Array;
}

/** The instructions a transaction's programs invoked, as `getTransaction` reports them: account
 *  indexes into the transaction's accounts, the data in base58. */
export type InnerInstructions = ReadonlyArray<{
  readonly instructions: ReadonlyArray<{
    readonly programIdIndex: number;
    readonly accounts: readonly number[];
    readonly data: string;
  }>;
}>;

/** Each Solana cluster by its genesis hash, as a record names it; any other is named by the hash. */
const CLUSTERS: Readonly<Record<string, string>> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": MAINNET_CLUSTER,
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "devnet",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY": "testnet",
};

/** The cluster a genesis hash is: `mainnet-beta`, `devnet`, `testnet`, or the hash itself. */
export const clusterOf = (genesisHash: string): string => CLUSTERS[genesisHash] ?? genesisHash;

/**
 * The Solana cluster an SVM chain is held to: its own, where it names one other than mainnet's
 * (`solana-devnet`, devnet; `solana-testnet`, testnet). `solana` is held to none: it takes an
 * endpoint of any cluster, as it always has, its Pots recorded under the cluster the endpoint serves.
 */
export function clusterNamed(chain: CanonicalChain): string | undefined {
  const cluster = svmClusterOf(chain);

  return cluster === undefined || cluster === MAINNET_CLUSTER ? undefined : cluster;
}

/** Refuses an endpoint for `chain` whose genesis hash is not that of the cluster the chain names. */
export function requireChainCluster(chain: CanonicalChain, genesisHash: string): void {
  const named = clusterNamed(chain);
  const served = clusterOf(genesisHash);
  if (named === undefined || served === named) return;
  throw new CliError(
    `${chain.slug} is Solana's ${named} cluster, and the endpoint serves ` +
      (CLUSTERS[genesisHash] === undefined
        ? `another cluster, whose genesis hash is ${genesisHash}`
        : served) +
      `: give a ${named} endpoint`,
  );
}

/**
 * Whether `record` is a Pot on `chain`, as `sauce pot list --chain` filters: the chain's id, and for
 * an SVM chain held to a cluster (`solana-devnet`, `solana-testnet`) Solana's records of that
 * cluster. `solana` lists every cluster's, as it always has.
 */
export function recordOn(record: PotRecord, chain: CanonicalChain): boolean {
  const cluster = clusterNamed(chain);

  return cluster === undefined
    ? record.chainId === chain.id
    : record.chainId === svmRecordChain().id && record.cluster === cluster;
}

/**
 * The Pots a landed Solana transaction created: one record per `create_pot` of the Kitchen in it —
 * an instruction of its own, or one a program invoked (`inner`, as the node reports them) — its
 * accounts (owner, engine program, Pot) read
 * through the message's static accounts and those its lookup tables loaded (`loaded`). None for
 * one that failed. `genesis` is asked for the cluster's genesis hash only when there is one, so a
 * devnet Pot is recorded as devnet's: the Kitchen's id, and so the Pot's address, is the same on
 * every cluster. Whichever SVM chain sent it, a Pot is recorded under Solana's (`svmRecordChain`).
 */
export async function svmPotsCreated(input: {
  /** The transaction, base64, as `getTransaction` returns it. */
  readonly transaction: string;
  readonly loaded?: { readonly writable: readonly string[]; readonly readonly: readonly string[] };
  readonly inner?: InnerInstructions;
  readonly signature: string;
  readonly slot: bigint;
  readonly ok: boolean;
  readonly genesis: () => Promise<string>;
}): Promise<PotRecord[]> {
  if (!input.ok) return [];
  const decoded = getTransactionDecoder().decode(
    new Uint8Array(getBase64Encoder().encode(input.transaction)),
  );
  const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes) as {
    readonly staticAccounts: readonly string[];
    readonly instructions: readonly CompiledInstruction[];
  };
  const accounts = [
    ...message.staticAccounts,
    ...(input.loaded?.writable ?? []),
    ...(input.loaded?.readonly ?? []),
  ];
  const invoked: CompiledInstruction[] = [
    ...message.instructions,
    ...(input.inner ?? []).flatMap((group) =>
      group.instructions.map((instruction) => ({
        programAddressIndex: instruction.programIdIndex,
        accountIndices: instruction.accounts,
        data: new Uint8Array(getBase58Encoder().encode(instruction.data)),
      })),
    ),
  ];
  const kitchen = v12SvmKitchenProgramId();
  const head = KITCHEN_DISCRIMINATORS.createPot;
  const created = invoked.flatMap((instruction) => {
    const data = instruction.data ?? new Uint8Array();
    const at = (index: number) => accounts[instruction.accountIndices?.[index] ?? -1];
    const [owner, engine, pot] = [at(0), at(1), at(2)];
    if (
      accounts[instruction.programAddressIndex] !== kitchen ||
      data.length < 40 ||
      !head.every((byte, index) => data[index] === byte) ||
      owner === undefined ||
      engine === undefined ||
      pot === undefined
    ) {
      return [];
    }

    return [{ owner, engine, pot, salt: bytesToHex(data.slice(8, 40)) }];
  });
  if (created.length === 0) return [];
  const cluster = clusterOf(await input.genesis());

  return created.map((one) =>
    svmRecord({
      cluster,
      ...one,
      origin: "deployed",
      deployment: {
        tx: input.signature,
        block: input.slot.toString(),
        from: message.staticAccounts[0]!,
      },
    }),
  );
}

/** A Solana Pot's record, under Solana's chain and its cluster: the release of the engine it was
 *  created for, when one is known. */
function svmRecord(input: {
  readonly cluster: string;
  readonly owner: string;
  readonly salt: Hex;
  readonly pot: string;
  readonly engine: string;
  readonly origin: PotRecord["origin"];
  readonly deployment?: PotRecord["deployment"];
}): PotRecord {
  const set = svmSetOf(input.engine);

  return {
    ...base(svmRecordChain(), input.origin),
    cluster: input.cluster,
    pot: input.pot,
    owner: input.owner,
    salt: input.salt.toLowerCase(),
    kind: "private",
    kitchen: v12SvmKitchenProgramId(),
    engine: input.engine,
    ...(set === undefined ? {} : { release: svmRelease(set) }),
    sdk: sdkVersion(),
    ...(input.deployment === undefined ? {} : { deployment: input.deployment }),
    recordedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Keeping them
// ---------------------------------------------------------------------------------------------

/**
 * The Pot store's part of what a scope keeps (`keep.ts`): every Pot `landed` deployed, written to
 * `store` the moment its transaction lands — so a command that fails after deploying a Pot still
 * keeps it — with a line for each.
 */
export function keepPots(store: PotStore, landed: Landed): string[] {
  return (landed.sent.pots ?? []).map((pot) => {
    const on = `${pot.chain}${pot.cluster === undefined || pot.cluster === MAINNET_CLUSTER ? "" : ` (${pot.cluster})`}`;
    try {
      const saved = store.save(pot);
      if (saved === "created") return `recorded Pot ${pot.pot} on ${on} in ${store.dir}`;
      if (saved === "exists") return `Pot ${pot.pot} on ${on} was already recorded in ${store.dir}`;
      const earlier = store
        .recordsOf(pot.chainId, pot.pot, pot.cluster)
        .flatMap((one) =>
          one.deployment === undefined || one.deployment.tx === pot.deployment?.tx
            ? []
            : [one.deployment.tx],
        );

      return (
        `warning: Pot ${pot.pot} on ${on} was recorded already, deployed by ` +
        `${earlier.join(" and ") || "another transaction"}; this deployment, ` +
        `${pot.deployment?.tx}, is another, recorded beside it in ${store.dir}. One of them landed ` +
        "on a fork or another network with the same chain id, or the Pot was closed and created " +
        "again"
      );
    } catch (error) {
      return (
        `warning: Pot ${pot.pot} on ${pot.chain} was deployed, but not recorded in ${store.dir}: ` +
        (error instanceof Error ? error.message : String(error))
      );
    }
  });
}

/**
 * What `store` holds of `owner`'s other Pots on `chain` (every one but `except`), for a refusal of a
 * Pot: a line saying how many, then each with its kind, salt and release, and the SDK releases that
 * pinned that release. A Pot recorded twice (another deployment kept beside its first) is listed
 * once. A store that cannot be read says so.
 */
export function ownerPotsText(
  store: PotStore,
  chain: CanonicalChain,
  owner: Address,
  except: Address,
): string {
  let records: PotRecord[];
  try {
    records = store.list().pots;
  } catch (error) {
    return (
      `The Pot store ${store.dir} could not be read: ` +
      (error instanceof Error ? error.message : String(error))
    );
  }
  const listed = new Set<string>([except.toLowerCase()]);
  const pots = records.filter((record) => {
    const pot = record.pot.toLowerCase();
    if (record.chainId !== chain.id || record.owner.toLowerCase() !== owner.toLowerCase()) {
      return false;
    }
    if (listed.has(pot)) return false;
    listed.add(pot);

    return true;
  });
  const whose = `of ${owner} on ${chain.slug}`;
  if (pots.length === 0) return `The Pot store ${store.dir} holds no other Pot ${whose}.`;

  return [
    `The Pot store ${store.dir} holds ${pots.length} other Pot${pots.length === 1 ? "" : "s"} ${whose}:`,
    ...pots.map((record) => {
      const paired = record.release === undefined ? undefined : pairedSdkReleases(record.release);

      return (
        `  ${record.pot}  ${record.kind}, salt ${record.salt}: ${releaseText(record.release)}` +
        (paired === undefined ? "" : `, @eco-incorp/sauce ${paired}`)
      );
    }),
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Pots deployed elsewhere: `sauce pot import`
// ---------------------------------------------------------------------------------------------

const hasCode = async (client: PublicClient, address: Address): Promise<boolean> => {
  const code = await client.getCode({ address });

  return code !== undefined && code !== "0x";
};

/** JSON-RPC's "execution reverted": the one error code a contract's own revert comes back with. */
const EXECUTION_REVERTED = 3;

/**
 * Whether `error`, from reading a contract, is the contract's own answer, not a failure of the
 * request: the call returned no data (it has no such function, or no code is there), or it reverted
 * as the endpoint says an execution reverts (JSON-RPC code 3). viem reports an endpoint's internal
 * error (-32603) as a revert too, with no contract behind it; that, and every other failure of the
 * request, is not the contract's answer, and neither is anything this cannot tell apart.
 */
export const answered = (error: unknown): boolean => {
  if (!(error instanceof BaseError)) return false;
  if (error.walk((cause) => cause instanceof ContractFunctionZeroDataError) !== null) return true;
  if (error.walk((cause) => cause instanceof ContractFunctionRevertedError) === null) return false;
  // Every JSON-RPC error code the error carries, along its whole chain.
  const codes: unknown[] = [];
  error.walk((cause) => {
    if (cause !== null && typeof cause === "object" && "code" in cause) {
      codes.push((cause as { code: unknown }).code);
    }

    return false;
  });

  return codes.length > 0 && codes.every((code) => code === EXECUTION_REVERTED);
};

/** The Pot at `pot` on `chain`, read off the Pot itself (its owner, salt and Kitchen) and told its
 *  release from its address. Refused when nothing is there, or no known release minted it. */
export async function importEvmPot(
  client: PublicClient,
  chain: CanonicalChain,
  pot: Address,
): Promise<PotRecord> {
  if (!(await hasCode(client, pot))) {
    throw new CliError(`${pot} has no code on ${chain.slug}: no Pot is deployed there`);
  }
  const read = <T>(functionName: "owner" | "userSalt" | "kitchen") =>
    client
      .readContract({ address: pot, abi: v12PotAbi, functionName })
      .then((value) => value as T)
      .catch((error: unknown) => {
        // A contract with no such function answers nothing or reverts; any other failure is the
        // endpoint's, and says so.
        const answer = answered(error);
        throw new Error(
          answer
            ? `${pot} on ${chain.slug} is not a Pot: it has no ${functionName}()`
            : `reading ${pot}'s ${functionName}() on ${chain.slug} failed: ` +
                ((error as { shortMessage?: string }).shortMessage ?? "the request failed"),
          { cause: error },
        );
      });
  const [owner, salt, kitchen] = await Promise.all([
    read<Address>("owner"),
    read<Hex>("userSalt"),
    read<Address>("kitchen"),
  ]);
  // Getters supply identity to the verifier; they never authenticate code themselves.

  return evmRecord({
    client,
    chain,
    kitchen,
    owner,
    salt,
    pot,
    origin: "imported",
  });
}

/**
 * Explicit `pot import --pot-binding` reauthenticates an owner's already-updated Router.
 * The descriptor may change only Router address/code hash; no default release repinning.
 */
export async function reauthorizeEvmPotRouter(
  client: PublicClient,
  chain: CanonicalChain,
  pot: Address,
  store: PotStore,
): Promise<PotRecord | undefined> {
  const previous = storedPot(chain.id, pot);
  const candidate = potCandidate();
  if (
    previous?.binding === undefined ||
    candidate === undefined ||
    (getAddress(previous.binding.router) === getAddress(candidate.router) &&
      previous.binding.routerCodeHash.toLowerCase() === candidate.routerCodeHash.toLowerCase())
  )
    return undefined;
  const binding: EvmPotBinding = await verifyPotBinding(client, {
    ...previous.binding,
    ...candidate,
    pot: previous.binding.pot,
    owner: previous.binding.owner,
    userSalt: previous.binding.userSalt,
    kind: previous.binding.kind,
    chainId: previous.binding.chainId,
  });
  const updated = { ...previous, binding, recordedAt: new Date().toISOString() };
  store.saveRouterUpdate(updated, previous.binding);

  return updated;
}

/** Authenticates deployed code, retaining disk pins or an explicit request-local proof before funding. */
export async function authenticatePot(
  client: PublicClient,
  wallet: Address,
  pot: Address,
): Promise<"own" | "not" | "unreadable"> {
  try {
    const chainId = await client.getChainId();
    const chain = resolveChain(chainId);
    if (chain === undefined) return "not";
    const record = await importEvmPot(client, chain, pot);
    const store = keptPots();
    if (store === undefined) {
      const requested = requestedPotBinding();
      const verified = getVerifiedPotBinding();
      if (
        requested === undefined ||
        verified === undefined ||
        requested.chainId !== chainId ||
        getAddress(requested.pot) !== getAddress(pot) ||
        verified.chainId !== chainId ||
        getAddress(verified.pot) !== getAddress(pot)
      )
        return "not";
    } else {
      store.save(record);
    }

    return getAddress(record.owner) === getAddress(wallet) ? "own" : "not";
  } catch (error) {
    return answered(error) ||
      answered((error as Error | undefined)?.cause) ||
      error instanceof CliError
      ? "not"
      : "unreadable";
  }
}

/** The Pots `owner` has at `salt` on `chain`, one per release and kind whose address has code. */
export async function importEvmOwnerPots(
  client: PublicClient,
  chain: CanonicalChain,
  owner: Address,
  salt: Hex,
): Promise<PotRecord[]> {
  const addresses = new Set<Address>([
    ...potFamilies().flatMap((family) =>
      candidates(family, getAddress(owner), salt).map(({ pot }) => pot),
    ),
    ownReleasePot(owner, salt, "private"),
    ownReleasePot(owner, salt, "private-fixed-router"),
  ]);
  const found = await Promise.all(
    [...addresses].map(async (pot) =>
      (await hasCode(client, pot)) ? importEvmPot(client, chain, pot) : undefined,
    ),
  );

  return found.filter((record): record is PotRecord => record !== undefined);
}

/** The minimal Solana reads an import makes. */
export interface SvmAccountReader {
  /** The account's owning program, or `undefined` when it does not exist. */
  readonly ownerOf: (address: SvmAddress) => Promise<string | undefined>;
  /** The cluster's genesis hash. */
  readonly genesis: () => Promise<string>;
}

/**
 * `owner`'s Pot at `salt` on Solana: the Kitchen's PDA, which must exist and be an engine's —
 * `create_pot` hands the account to the engine it names, so a Pot is owned by one a release
 * records. An account there owned by anything else (lamports sent to the address before any Pot,
 * held by the System Program) is no Pot, and is refused: a record is never rewritten, so it would
 * stand for the Pot for good. On a chain held to a cluster (`solana-devnet`), the endpoint is held
 * to it first.
 */
export async function importSvmPot(
  reader: SvmAccountReader,
  chain: CanonicalChain,
  owner: SvmAddress,
  salt: Hex,
): Promise<PotRecord> {
  const held = clusterNamed(chain) === undefined ? undefined : await reader.genesis();
  if (held !== undefined) requireChainCluster(chain, held);
  const { address: pot } = await derivePotPda(
    v12SvmKitchenProgramId() as SvmAddress,
    owner,
    hexToBytes(salt),
  );
  const engine = await reader.ownerOf(pot);
  if (engine === undefined) {
    throw new Error(`${owner} has no Pot at salt ${salt} on ${chain.slug}: ${pot} does not exist`);
  }
  if (svmSetOf(engine) === undefined) {
    throw new Error(
      `${pot}, ${owner}'s Pot address at salt ${salt} on ${chain.slug}, is owned by ${engine}, ` +
        "which no release this sauce knows names as its engine: it is not a Pot, and is not " +
        "recorded",
    );
  }

  return svmRecord({
    cluster: clusterOf(held ?? (await reader.genesis())),
    owner,
    salt,
    pot,
    engine,
    origin: "imported",
  });
}
