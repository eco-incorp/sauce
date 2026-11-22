/**
 * Which Pot a cook, a signed cook or `sauce pot` names, and the engine its cooks run on: the address
 * the user gave, or the owner's Pot at a salt — the installed release's (CREATE3) unless the owner
 * already has a deployed Pot of an earlier release whose engine runs this SDK's programs there —
 * read off the chain when there is an endpoint.
 *
 * Every Kitchen release mints its own family of Pots, and a Pot cooks on the engine of the release
 * that minted it: an earlier engine refuses a later release's Pots and the other way round. So the
 * engine a cook names is the Pot's, never the installed release's by default. Where several earlier
 * Pots of the owner are deployed at a salt, the oldest release's wins: anyone may deploy an owner's
 * Pot (`Kitchen.deployPot(owner, salt)`), so a newer Pot another account deployed must never
 * displace a funded older one.
 *
 * Without an endpoint the chain cannot say, and the Pot store is no stand-in for it: it keeps what
 * landed on a fork or another network with the chain's id beside what landed on the chain
 * (`pot-store.ts`), and nothing offline tells them apart. So offline an owner's Pot is the installed
 * release's — the one mistake that can be undone, since a Kitchen of that release can still deploy
 * it — and where the store records an earlier release's Pot for the owner and salt, nothing is built
 * for either until the user names one (`--pot`) or gives an endpoint: `CookPot.stored`, and
 * {@link refuseUnchosen}. A Pot named by address takes its engine from the store only from a record
 * that is its own: the record's chain and Pot are the ones named, and it was read from the file its
 * Pot's name gives. Any other record is ignored, with a note naming its file, and a record that
 * cannot be read is a note, never an error.
 */
import { getAddress, type Address, type Hex, type PublicClient } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { sdkCompilerVersion, V12_RELEASE_SETS, v12EngineAddress } from "../deployments/index.js";
import {
  potAddressIn,
  potFamilyEngine,
  potFamilyRunsCompiler,
  v12DefaultPotFamily,
  v12PotFamilies,
  v12PredictPot,
  type PotFamily,
} from "../deployments/pot.js";
import { CliError } from "./args.js";
import { potState, requireReleasePot } from "./chain.js";
import type { PotInput } from "./commands.js"; // type-only: commands.ts imports this module
import { keptPots } from "./keep.js";
import type { PotStore, StoredPot } from "./pot-store.js";
import { familyRelease, recordFamily, releaseText } from "./pots.js";

/**
 * An earlier release's Pot that the Pot store records for an owner and salt, and nothing offline
 * can place on the chain: where its record landed, the chain's own block or a fork's, is not
 * something a command that reads no chain can tell.
 */
export interface StoredPotChoice {
  readonly pot: Address;
  readonly family: PotFamily;
  /** Its release's engine, which a cook on it names. */
  readonly engine: Address;
  /** The record's file. */
  readonly path: string;
  /** What the record names of the deployment it was made from; absent for an imported Pot. */
  readonly deployment?: {
    readonly tx: string;
    readonly block: string;
    readonly blockHash?: string;
  };
  /** The version of the package that recorded it, and when (ISO 8601). */
  readonly sdk: string;
  readonly recordedAt: string;
}

export interface CookPot {
  readonly pot: Address;
  /** The engine every cook on it names. */
  readonly engine: Address;
  /** Its Kitchen release; unknown only for an offline `--pot` the store does not record. */
  readonly family?: PotFamily;
  /** Read from the chain: whether it has code. Absent offline. */
  readonly deployed?: boolean;
  /** Read from the chain: a deployed Pot's owner. */
  readonly owner?: Address;
  /**
   * Offline only: an earlier release's Pot the Pot store records for this owner and salt. `pot` is
   * then the installed release's, and no command builds a transaction for either until one is
   * chosen ({@link refuseUnchosen}).
   */
  readonly stored?: StoredPotChoice;
  /** What the reader is told: an earlier release's Pot taken, or what an offline choice rests on. */
  readonly notes: readonly string[];
}

/** The Pot store's files, or none and the reason they could not be read; a damaged file is a note. */
function storedFiles(
  store: PotStore | undefined,
  read: (store: PotStore) => { readonly files: StoredPot[]; readonly warnings: string[] },
): { readonly files: StoredPot[]; readonly notes: string[] } {
  if (store === undefined) return { files: [], notes: [] };
  try {
    const { files, warnings } = read(store);

    return { files, notes: warnings };
  } catch (error) {
    return {
      files: [],
      notes: [
        `The Pot store ${store.dir} could not be read: ` +
          (error instanceof Error ? error.message : String(error)),
      ],
    };
  }
}

/** A record the store holds that decides nothing about `about`, and where it is. */
const ignoredNote = (file: StoredPot, about: string): string =>
  `The Pot store's ${file.path} is ignored: it holds a record of ${file.record.pot} on chain ` +
  `${file.record.chainId}, but it is not filed under that Pot's name and chain, so it says ` +
  `nothing of ${about}.`;

/** A record that cannot be read as the record of a Pot, and where it is. */
const damagedNote = (file: StoredPot, error: unknown): string =>
  `The Pot store's ${file.path} is ignored: it cannot be read as a record of a Pot: ` +
  (error instanceof Error ? error.message : String(error));

/** Where a stored Pot's record came from, as the user reads it. */
function provenance(stored: StoredPotChoice): string {
  const { deployment } = stored;
  const landed =
    deployment === undefined
      ? "no transaction recorded"
      : `tx ${deployment.tx}, block ${deployment.block}, ` +
        (deployment.blockHash === undefined
          ? "no block hash recorded"
          : `block hash ${deployment.blockHash}`);

  return `${stored.path} (${landed}; recorded by @eco-incorp/sauce ${stored.sdk} on ${stored.recordedAt})`;
}

/**
 * What an owner whose earlier release's Pot only the Pot store records is told, in one line: the
 * record and the Pot it names, this SDK's Pot, and that nothing offline says which is the owner's.
 * Never that the earlier Pot is deployed: nothing here checked it. `ending` says what follows.
 */
function unchosenText(
  chain: CanonicalChain,
  fresh: CookPot,
  stored: StoredPotChoice,
  ending: string,
): string {
  const release = (family: PotFamily): string =>
    `kitchen-evm ${familyRelease(family)["kitchen-evm"]}`;

  return (
    `the Pot store records an earlier release's Pot for this owner and salt: ${provenance(stored)} ` +
    `names ${stored.pot} (${release(stored.family)}, engine ${stored.engine}), and this SDK's Pot ` +
    `for them is ${fresh.pot} (${release(fresh.family!)}, engine ${fresh.engine}). Nothing offline ` +
    `can tell whether that record landed on ${chain.slug} itself or on a fork or another network ` +
    `with its chain id, ${ending}`
  );
}

/**
 * Refuses, before anything is built or signed, an owner whose earlier release's Pot only the Pot
 * store records (`CookPot.stored`): a cook, a transfer or a signature for the wrong one of its two
 * Pots is value or a signature at an address no Kitchen can deploy for them, and nothing offline
 * says which is the right one. `--pot <address>` names one; an endpoint lets the chain say.
 */
export function refuseUnchosen(chain: CanonicalChain, at: CookPot): void {
  if (at.stored === undefined) return;
  throw new CliError(
    unchosenText(
      chain,
      at,
      at.stored,
      "so nothing is built for either Pot: pass --pot <address> to name one, or an RPC endpoint " +
        "to read the chain.",
    ),
  );
}

/**
 * The Pot `target` names on `chain`, with the engine its cooks run on. With a `client` the chain
 * decides: a Pot named by address is told its release from its owner, salt and Kitchen; one named
 * by owner and salt is the owner's deployed Pot of an earlier release, the oldest, or else the
 * installed release's. Without one, a Pot named by address takes its engine from the Pot store's
 * record of it, and an owner's Pot is the installed release's, unless the store records an earlier
 * one for them: then it is `stored`, and not chosen (see the header).
 */
export async function cookPotOf(
  chain: CanonicalChain,
  target: PotInput,
  client?: PublicClient,
): Promise<CookPot> {
  const fresh = v12DefaultPotFamily();
  const defaultEngine = getAddress(v12EngineAddress());
  // Earlier releases whose engine runs this SDK's programs, the oldest first: a family's sets are
  // newest first, so the last is its oldest row.
  const earlier = v12PotFamilies()
    .filter((family) => family !== fresh && potFamilyRunsCompiler(family))
    .sort(
      (a, b) => V12_RELEASE_SETS.indexOf(a.sets.at(-1)!) - V12_RELEASE_SETS.indexOf(b.sets.at(-1)!),
    );
  const olderNote = (pot: Address, family: PotFamily, salt: Hex, owner: Address): string =>
    `Pot ${pot} is ${owner}'s ${releaseText(familyRelease(family))} Pot at salt ${salt}, deployed ` +
    `before this SDK's release: it runs on its own engine, ${potFamilyEngine(family)}, and this ` +
    `cook does too. A Pot of the current release (${releaseText(familyRelease(fresh))}) for this ` +
    "owner needs another salt (--salt <label>).";
  const familyNote = (pot: Address, family: PotFamily): string =>
    `Pot ${pot} is a ${releaseText(familyRelease(family))} Pot: the cook names its own engine, ` +
    `${potFamilyEngine(family)}.`;

  if (client !== undefined && "pot" in target) {
    const pot = getAddress(target.pot);
    const state = await potState(client, pot);
    if (!state.deployed) {
      return { pot, engine: defaultEngine, family: fresh, deployed: false, notes: [] };
    }
    const found = await requireReleasePot(client, chain, pot);

    return {
      pot,
      engine: potFamilyEngine(found.family),
      family: found.family,
      deployed: true,
      ...(state.owner === undefined ? {} : { owner: state.owner }),
      notes: found.family === fresh ? [] : [familyNote(pot, found.family)],
    };
  }

  if (client !== undefined) {
    const owner = getAddress((target as { readonly owner: Address }).owner);
    const salt = (target as { readonly salt: Hex }).salt;
    for (const family of earlier) {
      const older = potAddressIn(family, owner, salt, false);
      const state = await potState(client, older);
      if (!state.deployed) continue;
      const found = await requireReleasePot(client, chain, older);

      return {
        pot: older,
        engine: potFamilyEngine(found.family),
        family: found.family,
        deployed: true,
        ...(state.owner === undefined ? {} : { owner: state.owner }),
        notes: [olderNote(older, found.family, salt, owner)],
      };
    }
    const pot = getAddress(v12PredictPot(owner, salt));
    const state = await potState(client, pot);

    return {
      pot,
      engine: defaultEngine,
      family: fresh,
      deployed: state.deployed,
      ...(state.owner === undefined ? {} : { owner: state.owner }),
      notes: [],
    };
  }

  // Offline: nothing says which release minted a Pot but the Pot store's record of it, and that
  // only where the record is the Pot's own.
  if ("pot" in target) {
    const pot = getAddress(target.pot);
    const { files, notes } = storedFiles(keptPots(), (store) => store.filesOf(chain.id, pot));
    let found: { readonly file: StoredPot; readonly family: PotFamily | undefined } | undefined;
    for (const file of files) {
      try {
        const { record } = file;
        if (
          !file.bound ||
          record.chainId !== chain.id ||
          record.pot.toLowerCase() !== pot.toLowerCase()
        ) {
          notes.push(ignoredNote(file, `the Pot ${pot} on ${chain.slug}`));
          continue;
        }
        found ??= { file, family: recordFamily(record) };
      } catch (error) {
        notes.push(damagedNote(file, error));
      }
    }
    const family = found?.family;
    if (family === undefined) {
      return {
        pot,
        engine: defaultEngine,
        notes: [
          `The cook names the current release's engine, ${defaultEngine}: offline, nothing says ` +
            `which release minted ${pot}, and the Pot store holds no record of it. A Pot of an ` +
            "earlier release runs only on its own engine, and a cook naming another reverts " +
            "whole. Pass an RPC endpoint to check.",
          ...notes,
        ],
      };
    }
    if (!potFamilyRunsCompiler(family)) {
      throw new CliError(
        `${pot} on ${chain.slug} is a Pot of ${releaseText(familyRelease(family))}, as the Pot ` +
          `store records it: this SDK compiles with compiler ${sdkCompilerVersion()}, whose ` +
          "programs that Pot's engine does not run.",
      );
    }

    return {
      pot,
      engine: potFamilyEngine(family),
      family,
      notes: [
        `The engine is the one the Pot store records for ${pot} in ${found!.file.path} ` +
          `(${releaseText(familyRelease(family))}).`,
        ...notes,
      ],
    };
  }

  const owner = getAddress(target.owner);
  const salt = target.salt;
  const { files, notes } = storedFiles(keptPots(), (store) => store.listFiles());
  let oldest: { readonly file: StoredPot; readonly family: PotFamily } | undefined;
  for (const file of files) {
    try {
      const { record } = file;
      if (
        record.chainId !== chain.id ||
        record.owner.toLowerCase() !== owner.toLowerCase() ||
        record.salt.toLowerCase() !== salt.toLowerCase() ||
        record.kind !== "private"
      ) {
        continue;
      }
      if (!file.bound) {
        notes.push(ignoredNote(file, "this owner's Pot at this salt"));
        continue;
      }
      const family = recordFamily(record);
      const rank = family === undefined ? -1 : earlier.indexOf(family);
      if (rank < 0) continue;
      if (oldest === undefined || rank < earlier.indexOf(oldest.family)) {
        oldest = { file, family: family! };
      }
    } catch (error) {
      notes.push(damagedNote(file, error));
    }
  }
  const pot = getAddress(v12PredictPot(owner, salt));
  if (oldest !== undefined) {
    const { record } = oldest.file;
    const { deployment } = record;
    const stored: StoredPotChoice = {
      pot: getAddress(record.pot),
      family: oldest.family,
      engine: potFamilyEngine(oldest.family),
      path: oldest.file.path,
      ...(deployment === undefined
        ? {}
        : {
            deployment: {
              tx: deployment.tx,
              block: deployment.block,
              ...(deployment.blockHash === undefined ? {} : { blockHash: deployment.blockHash }),
            },
          }),
      sdk: record.sdk,
      recordedAt: record.recordedAt,
    };
    const at: CookPot = { pot, engine: defaultEngine, family: fresh, stored, notes: [] };

    return {
      ...at,
      notes: [
        unchosenText(
          chain,
          at,
          stored,
          "so neither is named as the owner's Pot and no deployment is printed: an RPC endpoint " +
            "reads the chain, and --pot <address> names the Pot a cook is for.",
        ),
        ...notes,
      ],
    };
  }

  return {
    pot,
    engine: defaultEngine,
    family: fresh,
    notes: [
      `Offline, this is the current release's Pot for this owner and salt (${fresh.scheme.toUpperCase()}, ` +
        `kitchen-evm ${familyRelease(fresh)["kitchen-evm"]}). A Pot an earlier SDK deployed at this ` +
        "salt is at another address, which cannot be seen offline: pass an RPC endpoint to find " +
        "it, or name it with --pot <address>.",
      ...notes,
    ],
  };
}
