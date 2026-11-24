/**
 * Where a Sauce Pot lives, and which Kitchen release placed one, without asking a chain.
 *
 * Every Kitchen release is a FAMILY of Pots: a Kitchen and the hash each Pot address is CREATE2
 * under — the Pot's init-code hash up to kitchen-evm 1.3.0, or, from 1.4.0, the hash of the proxy
 * the Kitchen CREATE2s and that CREATEs the Pot (CREATE3). New Pots are the installed compiler's
 * row's family; a Pot of an earlier family keeps its address and its engine. Nothing here checks
 * code on a chain.
 */
import {
  encodeAbiParameters,
  getAddress,
  getContractAddress,
  getCreate2Address,
  keccak256,
  stringToBytes,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import {
  engineRunsCompiler,
  sdkCompilerVersion,
  V12_RELEASE_SETS,
  v12ReleaseSet,
  type V12KitchenEvmPin,
  type V12ReleaseSet,
} from "./releases.js";
import { v12PotDerivation } from "./v12-addresses.js";

/**
 * The salt of an owner's default Pot: zero.
 *
 * For the default Kitchen, anyone calling `Kitchen.deployPot(owner, 0)` creates this same Pot,
 * owned by `owner`.
 */
export const DEFAULT_POT_SALT: Hex = `0x${"00".repeat(32)}`;

/**
 * The salt of the Pot an owner names `label`: `keccak256(utf8(label))`.
 *
 * Zero is the convention for an owner's default Pot; a label names another:
 * `v12PredictPot(owner, potSalt("treasury"))`. Hashing gives any label a full 32-byte salt, the
 * same everywhere: the `sauce` command's `--salt treasury` is this. An exact salt needs no helper;
 * pass the 32 bytes to `v12PredictPot` as they are.
 */
export function potSalt(label: string): Hex {
  if (label === "") {
    throw new Error(
      "potSalt: a label names a Pot, so it cannot be empty — the default Pot's salt is " +
        "DEFAULT_POT_SALT",
    );
  }

  return keccak256(stringToBytes(label));
}

/**
 * How the Kitchen minted a Pot: a Private Pot its owner cooks (`deployPot(owner, salt)`), one whose
 * Router is fixed at mint (`deployPot(owner, salt, true)`), or a Shared Pot anyone cooks
 * (`deploySharedPot(salt)`, no owner). A Solana Pot is always its owner's.
 */
export type PotKind = "private" | "private-fixed-router" | "shared";

/** One Kitchen release's Pots. */
export interface PotFamily {
  readonly kitchen: Address;
  /** `"create2"` up to kitchen-evm 1.3.0; `"create3"` from 1.4.0. */
  readonly scheme: "create2" | "create3";
  /** What each Pot address is CREATE2 under: the Pot's init-code hash, or its proxy's. Lowercase. */
  readonly hash: Hex;
  /**
   * What the Kitchen's `potInitCodeHash()` reports while it runs this release: the CREATE2 hash, or
   * for the installed CREATE3 release keccak256 of its Pot creation code
   * (`v12PotDerivation().initCodeHash`). Unknown for an earlier CREATE3 release. Lowercase.
   */
  readonly reportedHash?: Hex;
  /** Every release set whose Kitchen mints these Pots: the installed compiler's first, then newest. */
  readonly sets: readonly V12ReleaseSet[];
}

let preferred: readonly V12ReleaseSet[] | undefined;
/** The release sets, the installed compiler's first and then the newest. */
export const preferredReleaseSets = (): readonly V12ReleaseSet[] =>
  (preferred ??= [
    v12ReleaseSet(),
    ...[...V12_RELEASE_SETS].reverse().filter((row) => row !== v12ReleaseSet()),
  ]);

/** The salt a Pot of (owner, salt) is CREATE2'd under (`Kitchen._salt`, `Pot.gateSalt`). */
export function potGateSalt(owner: Address, salt: Hex, routerFixed: boolean): Hex {
  return keccak256(
    routerFixed
      ? encodeAbiParameters(
          [{ type: "address" }, { type: "bytes32" }, { type: "bool" }],
          [owner, salt, true],
        )
      : encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [owner, salt]),
  );
}

/**
 * Where `family`'s Kitchen places the Pot of `owner` and `salt`: a fixed-Router Pot when
 * `routerFixed` (a Shared Pot, the zero owner, always is one).
 */
export function potAddressIn(
  family: Pick<PotFamily, "kitchen" | "scheme" | "hash">,
  owner: Address,
  salt: Hex,
  routerFixed: boolean,
): Address {
  const first = getCreate2Address({
    from: family.kitchen,
    salt: potGateSalt(getAddress(owner), salt, routerFixed),
    bytecodeHash: family.hash,
  });

  return family.scheme === "create3" ? getContractAddress({ from: first, nonce: 1n }) : first;
}

/** A kitchen-evm pin's family identity; throws for a release not out yet. */
function identityOf(
  pin: V12KitchenEvmPin,
  version: string,
): Pick<PotFamily, "kitchen" | "scheme" | "hash"> {
  const create3 = pin.potProxyInitCodeHash !== undefined;
  const hash = create3 ? pin.potProxyInitCodeHash : pin.potInitCodeHash;
  if (pin.kitchen === null || hash === null || hash === undefined) {
    throw new Error(
      `kitchen-evm ${version} is not released yet: no Kitchen or Pot identity is pinned`,
    );
  }

  return {
    kitchen: getAddress(pin.kitchen),
    scheme: create3 ? "create3" : "create2",
    hash: hash.toLowerCase() as Hex,
  };
}

let families: readonly PotFamily[] | undefined;
/** Every Pot family the release table records, gathered once. */
export const v12PotFamilies = (): readonly PotFamily[] => (families ??= gatherFamilies());

function gatherFamilies(): PotFamily[] {
  const installed = v12ReleaseSet();
  const byKey = new Map<
    string,
    {
      kitchen: Address;
      scheme: "create2" | "create3";
      hash: Hex;
      reportedHash?: Hex;
      sets: V12ReleaseSet[];
    }
  >();
  for (const set of preferredReleaseSets()) {
    const pin = set["kitchen-evm"];
    let identity: Pick<PotFamily, "kitchen" | "scheme" | "hash">;
    try {
      identity = identityOf(pin, pin.version);
    } catch {
      continue;
    }
    const key = `${identity.scheme}:${identity.kitchen}:${identity.hash}`;
    const reported =
      identity.scheme === "create2"
        ? identity.hash
        : set === installed
          ? (v12PotDerivation().initCodeHash.toLowerCase() as Hex)
          : undefined;
    const family = byKey.get(key) ?? {
      ...identity,
      ...(reported === undefined ? {} : { reportedHash: reported }),
      sets: [],
    };
    family.sets.push(set);
    byKey.set(key, family);
  }

  return [...byKey.values()];
}

/** The family every new Pot belongs to: the installed compiler's row's. */
export const v12DefaultPotFamily = (): PotFamily =>
  v12PotFamilies().find((family) => family.sets[0] === v12ReleaseSet())!;

/**
 * The engine of the family's first set: every Pot of a CREATE2 family, and a dynamic Pot of a CREATE3
 * family. A fixed-Router or Shared Pot of a CREATE3 family runs on `potEngineOf`'s.
 */
export function potFamilyEngine(family: PotFamily): Address {
  const engine = family.sets[0]!["v12-evm"].engine;
  if (engine === null) {
    throw new Error(
      `internal: kitchen-evm ${family.sets[0]!["kitchen-evm"].version} has no released engine`,
    );
  }

  return getAddress(engine);
}

/**
 * The release set a Pot of `family` and `kind` runs on. A fixed-Router or Shared Pot of a CREATE3
 * family runs only on the engine built for its Router (the engine compiles in one fixed Router), so
 * its set is the newest of the family whose Kitchen release fixes `router`, its `router()` read on
 * chain; `undefined` when no set fixes that Router, or when `router` is not given. Any other Pot's
 * set is the family's first: the installed one for the default family.
 */
export function potReleaseSet(
  family: PotFamily,
  kind: PotKind,
  router?: Address,
): V12ReleaseSet | undefined {
  if (family.scheme === "create2" || kind === "private") return family.sets[0];
  if (router === undefined) return undefined;

  return family.sets.find((set) => {
    const fixed = set["kitchen-evm"].fixedRouter;

    return fixed !== undefined && getAddress(fixed) === getAddress(router);
  });
}

/**
 * The engine of `potReleaseSet`'s set. Throws, naming the Router, for a fixed-Router or Shared Pot
 * of a CREATE3 family whose Router no set fixes (or that was not read): a dynamic Pot and a CREATE2
 * Pot have no Router to refuse.
 */
export function potEngineOf(family: PotFamily, kind: PotKind, router?: Address): Address {
  const set = potReleaseSet(family, kind, router);
  if (set === undefined) {
    throw new Error(
      `the ${kind} Pot's Router ${router ?? "(unread)"} is fixed at mint, and no release this SDK ` +
        "knows built an engine for it: no engine this SDK names can cook it",
    );
  }
  const engine = set["v12-evm"].engine;
  if (engine === null) {
    throw new Error(`internal: kitchen-evm ${set["kitchen-evm"].version} has no released engine`);
  }

  return getAddress(engine);
}

/** Whether a family's engine runs `compiler`'s output (default: this SDK's). */
export const potFamilyRunsCompiler = (
  family: PotFamily,
  compiler: string = sdkCompilerVersion(),
): boolean => engineRunsCompiler("evm", potFamilyEngine(family), compiler) === true;

/**
 * The family and kind whose Kitchen `kitchen` places `pot` for (`owner`, `salt`); `undefined` when
 * no release the SDK knows does. Reads no chain.
 */
export function v12PotRelease(input: {
  readonly kitchen: Address;
  readonly owner: Address;
  readonly salt: Hex;
  readonly pot: Address;
}): { readonly family: PotFamily; readonly kind: PotKind } | undefined {
  const owner = getAddress(input.owner);
  const pot = getAddress(input.pot);
  const shared = owner === zeroAddress;
  for (const family of v12PotFamilies()) {
    if (family.kitchen !== getAddress(input.kitchen)) continue;
    for (const routerFixed of shared ? [true] : [false, true]) {
      if (potAddressIn(family, owner, input.salt, routerFixed) === pot) {
        return {
          family,
          kind: !routerFixed ? "private" : shared ? "shared" : "private-fixed-router",
        };
      }
    }
  }

  return undefined;
}

/**
 * Predict an EVM Pot without reading a chain. With no third argument: the installed release's Pot —
 * CREATE3 since kitchen-evm 1.4.0 — the private Pot of `owner` with a mutable Router, or the
 * Shared Pot for the zero owner. `{ compiler, routerFixed }` selects another row's Kitchen (CREATE2
 * for a row up to kitchen-evm 1.3.0) and a fixed-Router Pot; a Shared Pot always has a fixed
 * Router. A Kitchen address predicts the installed release's Pot at that Kitchen (a local
 * deployment). Prediction does not attest to the Kitchen or Pot on a chain.
 */
export function v12PredictPot(
  owner: Hex,
  salt: Hex = DEFAULT_POT_SALT,
  kitchen?: Hex | { compiler?: string; routerFixed?: boolean },
): Hex {
  const account = getAddress(owner);
  const shared = account === zeroAddress;
  const options: { compiler?: string; routerFixed?: boolean } =
    typeof kitchen === "string" ? {} : (kitchen ?? {});
  if (shared && options.routerFixed === false) {
    throw new Error("v12PredictPot: shared Pots always have a fixed Router");
  }
  const set = v12ReleaseSet(options.compiler);
  const identity = identityOf(set["kitchen-evm"], set["kitchen-evm"].version);

  return potAddressIn(
    typeof kitchen === "string" ? { ...identity, kitchen: getAddress(kitchen) } : identity,
    account,
    salt,
    shared || options.routerFixed === true,
  );
}
