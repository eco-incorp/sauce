/**
 * Which Pot a cook, a signed cook or `sauce pot` names, and the engine its cooks run on: the address
 * the user gave, or the owner's Pot at a salt — the installed release's (CREATE3) unless the owner
 * already has a deployed Pot of an earlier release whose engine runs this SDK's programs there —
 * read off the chain when there is an endpoint, else off the Pot store.
 *
 * Every Kitchen release mints its own family of Pots, and a Pot cooks on the engine of the release
 * that minted it: an earlier engine refuses a later release's Pots and the other way round. So the
 * engine a cook names is the Pot's, never the installed release's by default. Where several earlier
 * Pots of the owner are deployed at a salt, the oldest release's wins: anyone may deploy an owner's
 * Pot (`Kitchen.deployPot(owner, salt)`), so a newer Pot another account deployed must never
 * displace a funded older one.
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
import type { PotRecord, PotStore } from "./pot-store.js";
import { familyRelease, recordFamily, releaseText } from "./pots.js";

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
  /** What the reader is told: an earlier release's Pot taken, or what an offline choice rests on. */
  readonly notes: readonly string[];
}

/** The Pot store's records, or none and the reason they could not be read. */
function storedPots(
  store: PotStore | undefined,
  read: (store: PotStore) => PotRecord[],
): { readonly records: PotRecord[]; readonly notes: string[] } {
  if (store === undefined) return { records: [], notes: [] };
  try {
    return { records: read(store), notes: [] };
  } catch (error) {
    return {
      records: [],
      notes: [
        `The Pot store ${store.dir} could not be read: ` +
          (error instanceof Error ? error.message : String(error)),
      ],
    };
  }
}

/**
 * The Pot `target` names on `chain`, with the engine its cooks run on. With a `client` the chain
 * decides: a Pot named by address is told its release from its owner, salt and Kitchen; one named
 * by owner and salt is the owner's deployed Pot of an earlier release, the oldest, or else the
 * installed release's. Without one, the Pot store's record does, and an owner's Pot is the
 * installed release's unless the store records an earlier one.
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

  // Offline: nothing says which release minted a Pot but the Pot store's record of it.
  if ("pot" in target) {
    const pot = getAddress(target.pot);
    const { records, notes: unread } = storedPots(keptPots(), (store) =>
      store.recordsOf(chain.id, pot),
    );
    const family = records[0] === undefined ? undefined : recordFamily(records[0]);
    if (family === undefined) {
      return {
        pot,
        engine: defaultEngine,
        notes: [
          `The cook names the current release's engine, ${defaultEngine}: offline, nothing says ` +
            `which release minted ${pot}, and the Pot store holds no record of it. A Pot of an ` +
            "earlier release runs only on its own engine, and a cook naming another reverts " +
            "whole. Pass an RPC endpoint to check.",
          ...unread,
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
        `The engine is the one the Pot store records for ${pot} (${releaseText(familyRelease(family))}).`,
        ...unread,
      ],
    };
  }

  const owner = getAddress(target.owner);
  const salt = target.salt;
  const { records, notes: unread } = storedPots(keptPots(), (store) => store.list().pots);
  let oldest: { readonly record: PotRecord; readonly family: PotFamily } | undefined;
  for (const record of records) {
    if (
      record.chainId !== chain.id ||
      record.owner.toLowerCase() !== owner.toLowerCase() ||
      record.salt !== salt.toLowerCase() ||
      record.kind !== "private"
    ) {
      continue;
    }
    const family = recordFamily(record);
    const rank = family === undefined ? -1 : earlier.indexOf(family);
    if (rank < 0) continue;
    if (oldest === undefined || rank < earlier.indexOf(oldest.family)) {
      oldest = { record, family: family! };
    }
  }
  if (oldest !== undefined) {
    const pot = getAddress(oldest.record.pot);

    return {
      pot,
      engine: potFamilyEngine(oldest.family),
      family: oldest.family,
      notes: [`${olderNote(pot, oldest.family, salt, owner)} (from the Pot store)`, ...unread],
    };
  }

  return {
    pot: getAddress(v12PredictPot(owner, salt)),
    engine: defaultEngine,
    family: fresh,
    notes: [
      `Offline, this is the current release's Pot for this owner and salt (${fresh.scheme.toUpperCase()}, ` +
        `kitchen-evm ${familyRelease(fresh)["kitchen-evm"]}). A Pot an earlier SDK deployed at this ` +
        "salt is at another address, which cannot be seen offline: pass an RPC endpoint to find " +
        "it, or name it with --pot <address>.",
      ...unread,
    ],
  };
}
