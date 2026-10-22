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
 * Which release minted an EVM Pot is told from its address: `CREATE2(kitchen, gate salt, hash)`
 * under each Kitchen and Pot init-code hash `deployments/releases.json` records, with the gate salt
 * of each kind of Pot (`keccak256(abi.encode(owner, salt))`, and `…, true)` for a fixed Router or a
 * Shared Pot). Offline: the release the SDK pins today does not decide it. A Solana Pot is the
 * Kitchen's PDA under every release; its engine is the program its creation named.
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

import { resolveChain, type CanonicalChain } from "../chains/canonical.js";
import {
  sdkCompilerVersion,
  V12_RELEASE_SETS,
  v12SvmKitchenProgramId,
  type V12ReleaseSet,
} from "../deployments/index.js";
import { v12KitchenAbi, v12PotAbi } from "../evm/engine.js";
import { derivePotPda, KITCHEN_DISCRIMINATORS } from "../svm/kitchen.js";
import type { Landed } from "./keep.js";
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

// ---------------------------------------------------------------------------------------------
// Which release minted a Pot
// ---------------------------------------------------------------------------------------------

/** One Kitchen and the init-code hash its Pots are minted under, with every release set that
 *  minted them: the SDK's own first, then the newest. */
interface PotFamily {
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
    const { kitchen, potInitCodeHash } = set["kitchen-evm"];
    if (kitchen === null || potInitCodeHash === null) continue;
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

/** The EVM part of a release set, as a record names it. */
const evmRelease = (set: V12ReleaseSet): Record<string, string> => ({
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
}): Promise<PotRecord> {
  const known = evmPotRelease(input);
  const read = known === undefined ? await input.unknown?.() : undefined;
  const set = known?.family.sets[0];
  const hash = known?.family.potInitCodeHash ?? read?.hash;
  // Told by neither: a Pot with no owner is a Shared one, and any other its owner's.
  const kind =
    known?.kind ?? read?.kind ?? kindOf(getAddress(input.owner), input.owner === zeroAddress);
  const engine = set?.["v12-evm"].engine;

  return {
    ...base(input.chain, input.origin),
    pot: getAddress(input.pot),
    owner: getAddress(input.owner),
    salt: input.salt.toLowerCase(),
    kind,
    kitchen: getAddress(input.kitchen),
    ...(hash === undefined ? {} : { potInitCodeHash: hash }),
    ...(engine === undefined || engine === null ? {} : { engine: getAddress(engine) }),
    ...(set === undefined ? {} : { release: evmRelease(set) }),
    sdk: sdkVersion(),
    ...(input.deployment === undefined ? {} : { deployment: input.deployment }),
    recordedAt: new Date().toISOString(),
  };
}

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
      : candidates({ kitchen: at.kitchen, potInitCodeHash: hash }, at.owner, at.salt).find(
          (one) => one.pot === at.pot,
        )?.kind;
  if (under !== undefined) return { hash, kind: under };
  const gate = await client
    .readContract({ address: at.pot, abi: v12PotAbi, functionName: "gateSalt", blockNumber })
    .catch(() => undefined);
  const fixed = [false, true].find(
    (routerFixed) => gateSalt(at.owner, at.salt, routerFixed) === gate,
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
 * The Pots a landed Solana transaction created: one record per `create_pot` of the Kitchen in it —
 * an instruction of its own, or one a program invoked (`inner`, as the node reports them) — its
 * accounts (owner, engine program, Pot) read
 * through the message's static accounts and those its lookup tables loaded (`loaded`). None for
 * one that failed. `genesis` is asked for the cluster's genesis hash only when there is one, so a
 * devnet Pot is recorded as devnet's: the Kitchen's id, and so the Pot's address, is the same on
 * every cluster.
 */
export async function svmPotsCreated(input: {
  readonly chain: CanonicalChain;
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
      chain: input.chain,
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

/** A Solana Pot's record: the release of the engine it was created for, when one is known. */
function svmRecord(input: {
  readonly chain: CanonicalChain;
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
    ...base(input.chain, input.origin),
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

// ---------------------------------------------------------------------------------------------
// Pots deployed elsewhere: `sauce pot import`
// ---------------------------------------------------------------------------------------------

/** What every release says of where Pots come from, for a refusal. */
const knownReleases = (): string =>
  potFamilies()
    .map(
      (family) =>
        `kitchen-evm ${[...new Set(family.sets.map((set) => set["kitchen-evm"].version))].join(", ")}`,
    )
    .join("; ");

const hasCode = async (client: PublicClient, address: Address): Promise<boolean> => {
  const code = await client.getCode({ address });

  return code !== undefined && code !== "0x";
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
        const answered =
          error instanceof BaseError &&
          error.walk(
            (cause) =>
              cause instanceof ContractFunctionZeroDataError ||
              cause instanceof ContractFunctionRevertedError,
          ) !== null;
        throw new Error(
          answered
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
  if (evmPotRelease({ kitchen, owner, salt, pot }) === undefined) {
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
  });
}

/** The Pots `owner` has at `salt` on `chain`, one per release and kind whose address has code. */
export async function importEvmOwnerPots(
  client: PublicClient,
  chain: CanonicalChain,
  owner: Address,
  salt: Hex,
): Promise<PotRecord[]> {
  const found = await Promise.all(
    potFamilies().flatMap((family) =>
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

/**
 * `owner`'s Pot at `salt` on Solana: the Kitchen's PDA, which must exist and be an engine's —
 * `create_pot` hands the account to the engine it names, so a Pot is owned by one a release
 * records. An account there owned by anything else (lamports sent to the address before any Pot,
 * held by the System Program) is no Pot, and is refused: a record is never rewritten, so it would
 * stand for the Pot for good.
 */
export async function importSvmPot(
  reader: SvmAccountReader,
  chain: CanonicalChain,
  owner: SvmAddress,
  salt: Hex,
): Promise<PotRecord> {
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
    chain,
    cluster: clusterOf(await reader.genesis()),
    owner,
    salt,
    pot,
    engine,
    origin: "imported",
  });
}
