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
 * Which release minted an EVM Pot is told from its address under each Kitchen release
 * `deployments/releases.json` records — CREATE2 under the Pot's init-code hash up to kitchen-evm
 * 1.3.0, CREATE3 under its proxy's from 1.4.0 (`deployments/pot.ts`) — with the gate salt of each
 * kind of Pot (`keccak256(abi.encode(owner, salt))`, and `…, true)` for a fixed Router or a Shared
 * Pot). Offline: the release the SDK pins today does not decide it. A Solana Pot is the Kitchen's
 * PDA under every release; its engine is the program its creation named.
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
  getAddress,
  hexToBytes,
  isAddress,
  isHex,
  size,
  toEventSelector,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { requireChain, resolveChain, type CanonicalChain } from "../chains/canonical.js";
import {
  V12_RELEASE_SETS,
  engineRunsCompiler,
  sdkCompilerVersion,
  v12SvmKitchenProgramId,
  type V12ReleaseSet,
} from "../deployments/index.js";
import {
  potAddressIn,
  potGateSalt,
  potReleaseSet,
  preferredReleaseSets,
  v12DefaultPotFamily,
  v12PotFamilies,
  v12PotRelease,
  type PotFamily,
  type PotKind,
  type PotRelease,
} from "../deployments/pot.js";
import { SDK_RELEASES } from "../embedded/sdk-releases.generated.js";
import { v12KitchenAbi, v12PotAbi } from "../evm/engine.js";
import { svmClusterOf } from "../routes/token-registry.js";
import { derivePotPda, KITCHEN_DISCRIMINATORS } from "../svm/kitchen.js";
import { CliError } from "./args.js";
import type { Landed } from "./keep.js";
import {
  MAINNET_CLUSTER,
  POT_SCHEMA,
  pathText,
  recordText,
  type PotRecord,
  type PotStore,
  type StoredPot,
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

/** `paired` SDK releases (`pairedSdkReleases`) pair with a release: one, or several. */
export const pairWith = (paired: string): string =>
  `@eco-incorp/sauce ${paired} ${/[ ,]/.test(paired) ? "pair" : "pairs"} with`;

/** A record's release, as a reader reads it: `compiler 2.5.0 (v12-evm 1.2.0, kitchen-evm 1.2.0)`. */
export const releaseText = (release: PotRecord["release"]): string => {
  if (release === undefined) return "release unknown";
  const { compiler, ...components } = release;

  return `compiler ${recordText(compiler)} (${Object.entries(components)
    .map(([component, version]) => `${recordText(component)} ${recordText(version)}`)
    .join(", ")})`;
};

// ---------------------------------------------------------------------------------------------
// Which release minted a Pot
// ---------------------------------------------------------------------------------------------

const kindOf = (owner: Address, routerFixed: boolean): PotKind =>
  !routerFixed ? "private" : owner === zeroAddress ? "shared" : "private-fixed-router";

/** Every Pot the Kitchen of `family` could mint for (owner, salt): one of each kind. */
function candidates(
  family: Pick<PotFamily, "kitchen" | "scheme" | "hash">,
  owner: Address,
  salt: Hex,
): Array<{ readonly pot: Address; readonly kind: PotKind }> {
  // A Private Pot has an owner, a Shared one none; either may have its Router fixed.
  return (owner === zeroAddress ? [true] : [false, true]).map((routerFixed) => ({
    pot: potAddressIn(family, owner, salt, routerFixed),
    kind: kindOf(owner, routerFixed),
  }));
}

/**
 * The release Kitchen `kitchen` mints under when it reports `reportedHash` from its
 * `potInitCodeHash()` — for a CREATE3 release, keccak256 of the Pot's creation code: the family a
 * known release records. `undefined` for a hash no release the SDK knows records — a Kitchen
 * upgraded past this SDK.
 */
export const evmKitchenRelease = (kitchen: string, reportedHash: string): PotFamily | undefined =>
  v12PotFamilies().find(
    (family) =>
      family.kitchen === getAddress(kitchen) && family.reportedHash === reportedHash.toLowerCase(),
  );

/**
 * The Pot of kind `kind` the release this SDK pins mints for (`owner`, `salt`): its Kitchen's
 * address for it under the installed release (CREATE3 since kitchen-evm 1.4.0), where this SDK
 * deploys that Pot.
 */
export const ownReleasePot = (owner: Address, salt: Hex, kind: PotKind): Address =>
  potAddressIn(v12DefaultPotFamily(), getAddress(owner), salt, kind !== "private");

/** The EVM part of a release set, as a record names it. */
export const evmRelease = (set: V12ReleaseSet): Record<string, string> => ({
  compiler: set.compiler,
  "v12-evm": set["v12-evm"].version,
  "kitchen-evm": set["kitchen-evm"].version,
});

/**
 * The release a record names for a Pot of `set`: the installed compiler with the set's engine and
 * Kitchen where that engine runs this SDK's programs, else the set as it is.
 */
const releaseOf = (set: V12ReleaseSet): Record<string, string> =>
  evmRelease(
    engineRunsCompiler("evm", set["v12-evm"].engine!) === true
      ? { ...set, compiler: sdkCompilerVersion() }
      : set,
  );

/** The release a record names for a Pot of `family`'s first set: the installed one for the default family. */
export const familyRelease = (family: PotFamily): Record<string, string> =>
  releaseOf(family.sets[0]!);

/**
 * A record whose `kitchen`, `owner`, `pot` or `salt` is not what it should be. Its message names the
 * field and says its value through {@link recordText}, so a note says it as it is.
 */
export class UnreadableRecord extends Error {}

/**
 * An error met reading a record or the store, as a note says it: an {@link UnreadableRecord}'s message
 * as it is, any other error's quoted (an operating system's error names a path, and a parser's quotes
 * the file it read).
 */
export const errorText = (error: unknown): string =>
  error instanceof UnreadableRecord
    ? error.message
    : recordText(error instanceof Error ? error.message : error, 400);

/**
 * What an EVM record's Pot is, told again from its address (`v12PotRelease`): the family its Kitchen
 * belongs to, and its kind. A record written before its release was known is identified now, and
 * its `kind` field is not what decides: SDK 1.1.0 wrote a CREATE3 Pot with no release, and the kind
 * `private` for any owner but the zero address where the Kitchen's `gateSalt()` could not be read,
 * a fixed-Router Pot's included. `undefined` for a Pot no known release derives, of which a record
 * says only what it says itself. Throws, naming the field, for a record whose `kitchen`, `owner` or
 * `pot` is no address or whose `salt` is not 32 bytes of hex: the store checks that a field is a
 * string, not what it holds.
 */
export function recordPotRelease(record: PotRecord): PotRelease | undefined {
  if (!record.pot.startsWith("0x")) return undefined;
  for (const field of ["kitchen", "owner", "pot"] as const) {
    if (!isAddress(record[field], { strict: false })) {
      throw new UnreadableRecord(`its ${field} is not an address: ${recordText(record[field])}`);
    }
  }
  if (!isHex(record.salt, { strict: true }) || size(record.salt) !== 32) {
    throw new UnreadableRecord(`its salt is not 32 bytes of hex: ${recordText(record.salt)}`);
  }

  return v12PotRelease({
    kitchen: getAddress(record.kitchen),
    owner: getAddress(record.owner),
    salt: record.salt,
    pot: getAddress(record.pot),
  });
}

/**
 * A record's kind as its address says it ({@link recordPotRelease}), and the stored `kind` only
 * where no release this SDK knows derives the Pot (a Pot of a release it does not know, or a Solana
 * Pot). The stored field is not what decides: an earlier SDK wrote it wrongly where it could not read
 * the Kitchen, and a record is a file anyone can edit.
 */
export const recordKind = (record: PotRecord): PotKind =>
  recordPotRelease(record)?.kind ?? record.kind;

/** A record's release as a reader reads it: the one it names, else the one its address tells. */
export function recordRelease(record: PotRecord): PotRecord["release"] {
  if (record.release !== undefined) return record.release;
  const found = recordPotRelease(record);
  if (found === undefined) return undefined;
  // An unread Router names no release for a fixed-Router or Shared Pot of a CREATE3 family.
  if (found.family.scheme === "create3" && found.kind !== "private") return undefined;

  return familyRelease(found.family);
}

/** What a listing says of one record: see {@link recordFacts}. */
export interface RecordFacts {
  /** The kind its address says, or the one the record stores where that cannot be told. */
  readonly kind: PotKind;
  /** The release the record names, else the one its address tells; none where neither does. */
  readonly release: PotRecord["release"];
  /** Why its address cannot be read, where a field of the record is no address. */
  readonly unreadable?: string;
}

/**
 * What a listing says of `record`: its kind and release as {@link recordKind} and
 * {@link recordRelease} tell them. The store checks that a record's fields are strings, not that
 * they are addresses, so a record with a field that is none cannot be told from its address: it is
 * listed with the kind it stores and the release it names, `unreadable` saying why, where it would
 * otherwise stop every listing of the store.
 */
export function recordFacts(record: PotRecord): RecordFacts {
  try {
    return { kind: recordKind(record), release: recordRelease(record) };
  } catch (error) {
    return {
      kind: record.kind,
      release: record.release,
      unreadable: errorText(error),
    };
  }
}

/** The warning for a record `recordFacts` found unreadable, naming its file. */
export const unreadableNote = (path: string, facts: RecordFacts): string =>
  `warning: ${pathText(path)} cannot be told from its address (${facts.unreadable}): it is listed with the ` +
  `kind it stores and ${releaseText(facts.release)}`;

/** Every EVM engine a release set names, each once, newest first. */
export const releaseEngines = (): readonly Address[] => [
  ...new Set(
    [...V12_RELEASE_SETS].reverse().flatMap((set) => {
      const engine = set["v12-evm"].engine;

      return engine === null ? [] : [getAddress(engine)];
    }),
  ),
];

/** The Solana part of a release set, as a record names it. */
export const svmRelease = (set: V12ReleaseSet): Record<string, string> => ({
  compiler: set.compiler,
  "v12-svm": set["v12-svm"].version,
  "kitchen-svm": set["kitchen-svm"].version,
});

/** The release set whose Solana engine is `engine`, the SDK's own first. */
const svmSetOf = (engine: string): V12ReleaseSet | undefined =>
  preferredReleaseSets().find((set) => set["v12-svm"].engine === engine);

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

/** An EVM Pot's record, its release told from its address; `unknown` reads, from the chain, the
 *  init-code hash and kind of one no known release minted. */
async function evmRecord(input: {
  readonly chain: CanonicalChain;
  readonly kitchen: Address;
  readonly owner: Address;
  readonly salt: Hex;
  readonly pot: Address;
  readonly origin: PotRecord["origin"];
  readonly deployment?: PotRecord["deployment"];
  readonly unknown?: () => Promise<{ readonly hash?: Hex; readonly kind?: PotKind }>;
  /** A fixed-Router or Shared Pot's `router()`: the Router it runs, which names the engine built for it. */
  readonly router?: () => Promise<Address | undefined>;
}): Promise<PotRecord> {
  const known = v12PotRelease(input);
  const read = known === undefined ? await input.unknown?.() : undefined;
  const family = known?.family;
  // A fixed-Router or Shared Pot of a CREATE3 family runs only on the engine built for the Router it
  // was minted with, which the Pot says; any other Pot is its family's first set.
  const fixed = family?.scheme === "create3" && known?.kind !== "private";
  const router = fixed ? await input.router?.() : undefined;
  const set =
    family === undefined
      ? undefined
      : fixed
        ? potReleaseSet(family, known!.kind, router)
        : family.sets[0];
  const identity =
    family === undefined
      ? read?.hash === undefined
        ? {}
        : { potInitCodeHash: read.hash }
      : family.scheme === "create3"
        ? {
            potProxyInitCodeHash: family.hash,
            potProfileHash: family.sets[0]!["kitchen-evm"].potProfileHash!,
          }
        : { potInitCodeHash: family.hash };
  // Told by neither: a Pot with no owner is a Shared one, and any other its owner's.
  const kind =
    known?.kind ?? read?.kind ?? kindOf(getAddress(input.owner), input.owner === zeroAddress);

  return {
    ...base(input.chain, input.origin),
    pot: getAddress(input.pot),
    owner: getAddress(input.owner),
    salt: input.salt.toLowerCase(),
    kind,
    kitchen: getAddress(input.kitchen),
    ...identity,
    ...(set === undefined
      ? {}
      : { engine: getAddress(set["v12-evm"].engine!), release: releaseOf(set) }),
    sdk: sdkVersion(),
    ...(input.deployment === undefined ? {} : { deployment: input.deployment }),
    recordedAt: new Date().toISOString(),
  };
}

/** The Router `pot` runs, as the Pot says; `undefined` where it cannot be read. */
const potRouter = (client: PublicClient, pot: Address): Promise<Address | undefined> =>
  client
    .readContract({ address: pot, abi: v12PotAbi, functionName: "router" })
    .catch(() => undefined);

/**
 * The init-code hash and kind of `pot`, which Kitchen `kitchen` minted at `blockNumber` for
 * (`owner`, `salt`) under a hash no known release records: the hash the Kitchen reported then, and
 * the kind its CREATE2 or, failing that, the Pot's own `gateSalt()` gives. What cannot be read is
 * left out.
 */
async function unknownRelease(
  client: PublicClient,
  at: {
    readonly kitchen: Address;
    readonly owner: Address;
    readonly salt: Hex;
    readonly pot: Address;
  },
  blockNumber: bigint,
): Promise<{ readonly hash?: Hex; readonly kind?: PotKind }> {
  const hash = await client
    .readContract({
      address: at.kitchen,
      abi: v12KitchenAbi,
      functionName: "potInitCodeHash",
      blockNumber,
    })
    .then(
      (read) => read.toLowerCase() as Hex,
      () => undefined,
    );
  const under =
    hash === undefined
      ? undefined
      : candidates({ kitchen: at.kitchen, scheme: "create2", hash }, at.owner, at.salt).find(
          (one) => one.pot === at.pot,
        )?.kind;
  if (under !== undefined) return { hash, kind: under };
  const gate = await client
    .readContract({ address: at.pot, abi: v12PotAbi, functionName: "gateSalt", blockNumber })
    .catch(() => undefined);
  const fixed = [false, true].find(
    (routerFixed) => potGateSalt(at.owner, at.salt, routerFixed) === gate,
  );

  return {
    ...(hash === undefined ? {} : { hash }),
    ...(fixed === undefined ? {} : { kind: kindOf(at.owner, fixed) }),
  };
}

// ---------------------------------------------------------------------------------------------
// What a landed transaction deployed
// ---------------------------------------------------------------------------------------------

const POT_DEPLOYED = toEventSelector("PotDeployed(address,bytes32,address)");

let knownKitchens: ReadonlySet<Address> | undefined;

/** Every Kitchen a known release mints from. */
const kitchens = (): ReadonlySet<Address> =>
  (knownKitchens ??= new Set(v12PotFamilies().map((family) => family.kitchen)));

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
  const known = kitchens();
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
        // A Kitchen upgraded past the releases the SDK knows: as the chain says it was then.
        unknown: () => unknownRelease(client, { kitchen, owner, salt, pot }, sent.blockNumber),
        router: () => potRouter(client, pot),
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
            : [recordText(one.deployment.tx)],
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
        errorText(error)
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
  let files: StoredPot[];
  let warnings: string[];
  try {
    ({ files, warnings } = store.listFiles());
  } catch (error) {
    return `The Pot store ${store.dir} could not be read: ${errorText(error)}`;
  }
  const listed = new Set<string>([except.toLowerCase()]);
  const pots = files.filter(({ record }) => {
    const pot = record.pot.toLowerCase();
    if (record.chainId !== chain.id || record.owner.toLowerCase() !== owner.toLowerCase()) {
      return false;
    }
    if (listed.has(pot)) return false;
    listed.add(pot);

    return true;
  });
  const whose = `of ${owner} on ${chain.slug}`;
  // A file the store left out is said too: it may be the Pot.
  const left = warnings.map((warning) => `  ${warning}`);
  if (pots.length === 0)
    return [`The Pot store ${store.dir} holds no other Pot ${whose}.`, ...left].join("\n");

  return [
    `The Pot store ${store.dir} holds ${pots.length} other Pot${pots.length === 1 ? "" : "s"} ${whose}:`,
    ...pots.flatMap(({ record, path }) => {
      const facts = recordFacts(record);
      const paired = facts.release === undefined ? undefined : pairedSdkReleases(facts.release);

      return [
        `  ${recordText(record.pot)}  ${recordText(facts.kind)}, salt ${recordText(record.salt)}: ` +
          releaseText(facts.release) +
          (paired === undefined ? "" : `, @eco-incorp/sauce ${paired}`),
        ...(facts.unreadable === undefined ? [] : [`  ${unreadableNote(path, facts)}`]),
      ];
    }),
    ...left,
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Pots deployed elsewhere: `sauce pot import`
// ---------------------------------------------------------------------------------------------

/** What every release says of where Pots come from, for a refusal. */
const knownReleases = (): string =>
  v12PotFamilies()
    .map(
      (family) =>
        `kitchen-evm ${[...new Set(family.sets.map((set) => set["kitchen-evm"].version))].join(", ")}`,
    )
    .join("; ");

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
    throw new Error(`${pot} has no code on ${chain.slug}: no Pot is deployed there`);
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
  if (v12PotRelease({ kitchen, owner, salt, pot }) === undefined) {
    throw new Error(
      `${pot} on ${chain.slug} says it is Kitchen ${kitchen}'s, for owner ${owner} and salt ` +
        `${salt}, but no release this sauce knows minted it there (${knownReleases()}): it is not ` +
        "recorded. A newer sauce may know its release",
    );
  }

  return evmRecord({
    chain,
    kitchen,
    owner,
    salt,
    pot,
    origin: "imported",
    router: () => potRouter(client, pot),
  });
}

/**
 * Whether `pot` is `wallet`'s own Pot, as the chain shows it: its owner is the wallet, and its
 * address is the one its Kitchen's release gives for that owner and salt (`v12PotRelease`: CREATE2
 * up to kitchen-evm 1.3.0, CREATE3 from 1.4.0), which no other contract can sit at. `"not"` where
 * the contract answers otherwise (it has no such getters, or another owner), `"unreadable"` where
 * a read failed for any reason but the contract's own answer: the wallet's claim to it is then
 * neither shown nor refuted.
 */
export async function authenticatePot(
  client: PublicClient,
  wallet: Address,
  pot: Address,
): Promise<"own" | "not" | "unreadable"> {
  type Read<T> = { readonly value: T } | { readonly answer: "not" | "unreadable" };
  const read = async <T>(functionName: "owner" | "userSalt" | "kitchen"): Promise<Read<T>> => {
    try {
      return {
        value: (await client.readContract({ address: pot, abi: v12PotAbi, functionName })) as T,
      };
    } catch (error) {
      return { answer: answered(error) ? "not" : "unreadable" };
    }
  };
  // The owner first: a contract that is no Pot, or another owner's, ends it with one read.
  const owner = await read<Address>("owner");
  if ("answer" in owner) return owner.answer;
  if (getAddress(owner.value) !== getAddress(wallet)) return "not";
  const [salt, kitchen] = await Promise.all([read<Hex>("userSalt"), read<Address>("kitchen")]);
  if ("answer" in salt) return salt.answer;
  if ("answer" in kitchen) return kitchen.answer;

  return v12PotRelease({ kitchen: kitchen.value, owner: owner.value, salt: salt.value, pot }) ===
    undefined
    ? "not"
    : "own";
}

/** The Pots `owner` has at `salt` on `chain`, one per release and kind whose address has code. */
export async function importEvmOwnerPots(
  client: PublicClient,
  chain: CanonicalChain,
  owner: Address,
  salt: Hex,
): Promise<PotRecord[]> {
  const found = await Promise.all(
    v12PotFamilies().flatMap((family) =>
      candidates(family, getAddress(owner), salt).map(async ({ pot }) =>
        (await hasCode(client, pot)) ? importEvmPot(client, chain, pot) : undefined,
      ),
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

/** The System Program: the owner of an address that holds only lamports. */
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

/**
 * `owner`'s Pot at `salt` on Solana: the Kitchen's PDA, which must exist and be an engine's —
 * `create_pot` hands the account to the engine it names, so a Pot is owned by one a release
 * records. An account there held by the System Program (lamports sent to the address before any
 * Pot) is no Pot, and one owned by a program this SDK does not know may be the Pot of a later
 * release's engine, which a newer SDK imports. Both are refused: a record is never rewritten, so it
 * would stand for the Pot for good. On a chain held to a cluster (`solana-devnet`), the endpoint is
 * held to it first.
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
    const where = `${pot}, ${owner}'s Pot address at salt ${salt} on ${chain.slug}, is owned by ${engine}`;
    throw new Error(
      engine === SYSTEM_PROGRAM
        ? `${where}, which no release this sauce knows names as its engine: it is not a Pot, and ` +
            "is not recorded"
        : `${where}, which is not an engine this SDK knows: it is not recorded. Where a later ` +
            "release's engine owns it, a newer SDK imports it.",
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
