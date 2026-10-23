/**
 * A chain's names, written as the SauceScript module the compiler is handed with every program
 * compiled for the chain: `@sauce/chain`, an AMBIENT module, so its exports are globals of the
 * program with no `import`.
 *
 * ```js
 * // Base
 * import ABI_0 from "./abi/uniswap-v3/IUniswapV3Factory.json";
 * export const UniswapV3 = { Factory: ABI_0.at(0x33128a8f…), QuoterV2: ABI_1.at(0x3d4e44eb…), … };
 * export const PancakeswapV3 = { Factory: ABI_2.at(0x0bfbcf9f…), … };
 * export const Lido = { Lido: 0, … };   // no deployment on Base
 * export const USDT = 0;                // a token some chain has, and Base does not
 * ```
 *
 * DECLARED ON EVERY CHAIN, VALUED ON THIS ONE. Every protocol namespace (a protocol's PascalCase key
 * and each family alias) is an object literal holding every contract the namespace has on ANY chain:
 * bound at its address where this chain has it (`ABI.at(address)`, which compiles to the same bytes
 * as the binding written by hand), its address where the registry has an address and no ABI, and
 * zero where this chain has none. Every token symbol some chain registers and this one does not is
 * zero too; the chain's own tokens are defines (`ambient.ts`), as they always were. So a name no
 * chain has is the compiler's error on every chain, and a name this chain lacks is a zero the
 * compiler decides while compiling: `if (UniswapV3.Factory)`, `if (!USDT)`, `X != 0`, `X == 0`,
 * `?:`, `&&`, `||`. The branch a test rules out is not compiled, so a call on a contract the chain
 * lacks compiles there as long as a test of it rules the call out.
 *
 * A ZERO IS NEVER A CONTRACT AT RUN TIME. The compiler takes a zero anywhere a value goes, so a use
 * of a name the chain lacks outside a branch its test rules out would compile to a call to, or a
 * transfer to, address zero. `absent-names.ts` refuses that use before the compiler runs, at the
 * use, naming the chain. A value the compiler holds that no run-time use accepts — and that still
 * compares equal to zero, as `X == 0` needs — is not a value of this compiler, which is why the
 * check is the SDK's.
 *
 * A CHAIN BY NAME. `Base.UniswapV3.Factory` names Base's deployment from a program for any EVM
 * chain: the chain key is a module of its own (`@sauce/chain-<slug>`, exporting `Base`), the same
 * namespaces one level down, handed to the compile only when the program names that chain.
 *
 * What a module cannot hold stays a rewrite (`protocol-rewrite.ts`): an interface called with an
 * address (`UniswapV3.Pool(pool)`), a contract's ABI at another address (`.at(address)`) and a
 * protocol's default contract (`Lido.submit(…)`), all of which need a function as a value.
 */
import type { ContractDescriptor } from "../descriptors/types.js";

import { CANONICAL_CHAINS, type CanonicalChain } from "../chains/canonical.js";
import { addressOn } from "../descriptors/query.js";
import {
  CHAIN_KEY_SET,
  chainSlugForKey,
  NAMESPACE_KEYS,
  resolveNamespace,
} from "./accessor-index.js";
import { pascalOfSlug } from "./builder.js";
import { resolveTokenMap } from "./token-registry.js";

/** The ambient module of the chain a program is compiled for. */
export const CHAIN_MODULE = "@sauce/chain";
/** The ambient module of a chain a program names (`Base.UniswapV3.Factory`): `@sauce/chain-base`. */
export const chainKeyModule = (chain: CanonicalChain): string => `${CHAIN_MODULE}-${chain.slug}`;

/** Where every module and the ABIs they import are served: a name, never read from a disk. */
export const CHAIN_MODULE_ROOT = "/@eco-incorp/sauce/chain";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** What a namespace's member is on one chain. */
export type NameEntry =
  /** Deployed with an ABI: the module binds it, `ABI.at(address)`. */
  | {
      readonly kind: "deployed";
      readonly descriptor: ContractDescriptor;
      readonly address: `0x${string}`;
    }
  /** An address the registry records with no ABI: the module holds the address. */
  | {
      readonly kind: "address";
      readonly descriptor: ContractDescriptor;
      readonly address: `0x${string}`;
    }
  /** Deployed on some chain and not this one: zero. */
  | { readonly kind: "absent"; readonly descriptor: ContractDescriptor }
  /** Deployed here, with an ABI whose selectors do not match the deployment: zero, and refused. */
  | { readonly kind: "refused"; readonly descriptor: ContractDescriptor; readonly reason: string }
  /** An ABI with no address of its own: not a member, bound by the program (`UniswapV3.Pool(x)`). */
  | { readonly kind: "interface"; readonly descriptor: ContractDescriptor }
  /** A family alias's contract more than one member has: not a member. */
  | { readonly kind: "ambiguous"; readonly owners: readonly string[] };

/** A protocol namespace on one chain. */
export interface NamespaceEntry {
  readonly key: string;
  /** The protocol slug, or the family alias's members. */
  readonly protocols: readonly string[];
  readonly members: ReadonlyMap<string, NameEntry>;
  /** The contract `<Namespace>.<method>(…)` calls: a protocol's one contract with an ABI. */
  readonly defaultContract?: string;
}

/** What a compile is written with beyond the registry. */
export interface ChainNamesOptions {
  /** Token symbol overrides, merged over the chain's registry (`resolveTokenMap`). */
  readonly tokens?: ReadonlyMap<string, bigint>;
  /** Names the caller defines: a define replaces a module's `const` of its name, so none is
   *  declared here, and none is taken for absent. */
  readonly defined?: ReadonlySet<string>;
  /** Binds a contract whose ABI is widened (its selectors do not match the deployment). */
  readonly allowWidenedSelectors?: boolean;
  /** Declares the protocol namespaces: `false` for a compile whose accessors are off, which names
   *  only its tokens. Default `true`. */
  readonly namespaces?: boolean;
}

/** A chain's names: the module's text and what it holds, for the compile and its check. */
export interface ChainNames {
  readonly chain: CanonicalChain;
  /** The module's path under {@link CHAIN_MODULE_ROOT}, and its text. */
  readonly path: string;
  readonly text: string;
  /** Every namespace, by key. */
  readonly namespaces: ReadonlyMap<string, NamespaceEntry>;
  /** The token symbols declared zero: some chain registers them, this chain does not. */
  readonly absentTokens: ReadonlySet<string>;
  /** The chain's own tokens, by symbol: its defines. */
  readonly tokens: ReadonlyMap<string, bigint>;
}

/** The ABI each module imports, by its path under the root: one file per distinct ABI. */
const ABI_TEXT = new Map<string, string>();
const ABI_PATHS = new WeakMap<object, string>();

function abiPath(descriptor: ContractDescriptor): string {
  let path = ABI_PATHS.get(descriptor.abi);
  if (path !== undefined) return path;
  path = `abi/${descriptor.protocol}/${descriptor.abiExport ?? descriptor.contract}.json`;
  const text = JSON.stringify(descriptor.abi);
  // Two ABIs exported under one name are kept apart by the contract's name.
  if (ABI_TEXT.has(path) && ABI_TEXT.get(path) !== text) {
    path = `abi/${descriptor.protocol}/${descriptor.contract}.json`;
  }
  ABI_TEXT.set(path, text);
  ABI_PATHS.set(descriptor.abi, path);

  return path;
}

/** The text a module path names: a chain's module or an ABI one imports. */
const MODULE_TEXT = new Map<string, string>();

/**
 * The bytes of `path` when it names a chain module or an ABI one imports, as the compiler asks for
 * them: the absolute path a specifier resolved to, or a relative import joined to its importer's
 * directory and prefixed with `.` (`./@eco-incorp/sauce/chain/abi/…`).
 */
export function chainModuleText(path: string): string | undefined {
  const absolute = path.startsWith(`.${CHAIN_MODULE_ROOT}/`) ? path.slice(1) : path;
  if (!absolute.startsWith(`${CHAIN_MODULE_ROOT}/`)) return undefined;
  const parts: string[] = [];
  for (const part of absolute.slice(CHAIN_MODULE_ROOT.length + 1).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  const key = parts.join("/");

  return ABI_TEXT.get(key) ?? MODULE_TEXT.get(key);
}

const widened = (descriptor: ContractDescriptor): string =>
  `${descriptor.protocol}.${descriptor.contract}'s vendored ABI is "widened" (computed selectors ` +
  `do NOT match the deployed contract) — ${descriptor.coverage.caveats.join("; ")} — pass ` +
  "accessors: { allowWidenedSelectors: true } to use it anyway";

/** What `descriptor` is on `chain`. */
function entryOn(
  descriptor: ContractDescriptor,
  chain: CanonicalChain,
  allowWidened: boolean,
): NameEntry {
  if (descriptor.kind === "interface") return { kind: "interface", descriptor };
  const address = chain.kind === "evm" ? addressOn(descriptor, chain) : undefined;
  if (address === undefined) return { kind: "absent", descriptor };
  const at = address.toLowerCase() as `0x${string}`;
  if (descriptor.kind === "address-only") return { kind: "address", descriptor, address: at };
  if (descriptor.coverage.typeFidelity === "widened" && !allowWidened) {
    return { kind: "refused", descriptor, reason: widened(descriptor) };
  }

  return { kind: "deployed", descriptor, address: at };
}

/** Every namespace on `chain`. */
function namespacesOn(
  chain: CanonicalChain,
  allowWidened: boolean,
): ReadonlyMap<string, NamespaceEntry> {
  const out = new Map<string, NamespaceEntry>();
  for (const key of NAMESPACE_KEYS) {
    const namespace = resolveNamespace(key)!;
    const members = new Map<string, NameEntry>();
    if (namespace.kind === "protocol") {
      for (const [name, descriptor] of namespace.contracts) {
        if (IDENTIFIER.test(name)) members.set(name, entryOn(descriptor, chain, allowWidened));
      }
    } else {
      for (const [name, owners] of namespace.contractOwners) {
        if (!IDENTIFIER.test(name)) continue;
        if (owners.length > 1) {
          members.set(name, { kind: "ambiguous", owners });
          continue;
        }
        const member = resolveNamespace(pascalOfSlug(owners[0]!));
        const descriptor = member?.kind === "protocol" ? member.contracts.get(name) : undefined;
        if (descriptor !== undefined) members.set(name, entryOn(descriptor, chain, allowWidened));
      }
    }
    out.set(key, {
      key,
      protocols: namespace.kind === "protocol" ? [namespace.protocol] : namespace.members,
      members,
      ...(namespace.kind === "protocol" && namespace.defaultContract !== undefined
        ? { defaultContract: namespace.defaultContract }
        : {}),
    });
  }

  return out;
}

/** A namespace's object literal, its ABIs added to `imports`. */
function namespaceLiteral(
  namespace: NamespaceEntry,
  imports: Map<string, string>,
  root: string,
): string {
  const fields: string[] = [];
  for (const [name, entry] of namespace.members) {
    if (entry.kind === "deployed") {
      const path = `${root}${abiPath(entry.descriptor)}`;
      let binding = imports.get(path);
      if (binding === undefined) {
        binding = `ABI_${imports.size}`;
        imports.set(path, binding);
      }
      fields.push(`${name}: ${binding}.at(${entry.address})`);
    } else if (entry.kind === "address") {
      fields.push(`${name}: ${entry.address}`);
    } else if (entry.kind === "absent" || entry.kind === "refused") {
      fields.push(`${name}: 0`);
    }
  }

  return `{ ${fields.join(", ")} }`;
}

/** Every token symbol some chain registers: what a chain without one declares zero. */
let registrySymbols: ReadonlySet<string> | undefined;
function everySymbol(): ReadonlySet<string> {
  registrySymbols ??= new Set(
    CANONICAL_CHAINS.flatMap((chain) => [...resolveTokenMap(chain).keys()]).filter((symbol) =>
      IDENTIFIER.test(symbol),
    ),
  );
  return registrySymbols;
}

const HEADER =
  "// GENERATED by the SDK (routes/chain-module.ts) from its registries: every name, valued on";

/** Each chain's names with no option of the compile's own, written once. */
const plain = new Map<number, ChainNames>();
const plainNamespaces = new Map<number, ReadonlyMap<string, NamespaceEntry>>();

/** `chain`'s namespaces, with no option of a compile's own. */
export function chainNamespaces(chain: CanonicalChain): ReadonlyMap<string, NamespaceEntry> {
  let namespaces = plainNamespaces.get(chain.id);
  if (namespaces === undefined) {
    namespaces = namespacesOn(chain, false);
    plainNamespaces.set(chain.id, namespaces);
  }

  return namespaces;
}

/** The names a program compiled for `chain` reads: the module of `@sauce/chain`. */
export function chainNames(chain: CanonicalChain, options: ChainNamesOptions = {}): ChainNames {
  const isPlain =
    options.tokens === undefined &&
    (options.defined === undefined || options.defined.size === 0) &&
    options.allowWidenedSelectors !== true &&
    options.namespaces !== false;
  if (isPlain) {
    const kept = plain.get(chain.id);
    if (kept !== undefined) return kept;
  }
  const namespaces =
    options.namespaces === false
      ? new Map<string, NamespaceEntry>()
      : options.allowWidenedSelectors === true
        ? namespacesOn(chain, true)
        : chainNamespaces(chain);
  const tokens = options.tokens ?? resolveTokenMap(chain);
  const defined = options.defined ?? new Set<string>();
  const absentTokens = new Set(
    [...everySymbol()].filter((symbol) => !tokens.has(symbol) && !defined.has(symbol)),
  );

  const imports = new Map<string, string>();
  const lines: string[] = [];
  for (const namespace of namespaces.values()) {
    if (defined.has(namespace.key)) continue;
    lines.push(`export const ${namespace.key} = ${namespaceLiteral(namespace, imports, "./")};`);
  }
  for (const symbol of absentTokens) lines.push(`export const ${symbol} = 0;`);
  const text = [
    `${HEADER} ${chain.slug}.`,
    ...[...imports].map(([path, binding]) => `import ${binding} from "${path}";`),
    ...lines,
    "",
  ].join("\n");
  // A compile with options of its own is served under a path of its own, so a module the compiler
  // keeps for the chain is never read for it; beside the plain one, so its ABIs are `./abi/…` too.
  const path = isPlain ? `${chain.slug}.js` : `${chain.slug}-${hash(text)}.js`;
  MODULE_TEXT.set(path, text);
  const names: ChainNames = { chain, path, text, namespaces, absentTokens, tokens };
  if (isPlain) plain.set(chain.id, names);

  return names;
}

/** The module `@sauce/chain-<slug>` serves: `<ChainKey>`, the chain's namespaces one level down. */
const keyModules = new Map<number, string>();
export function chainKeyModulePath(chain: CanonicalChain): string {
  const path = `on/${chain.slug}.js`;
  if (!keyModules.has(chain.id)) {
    const imports = new Map<string, string>();
    const fields = [...chainNamespaces(chain).values()].map(
      (namespace) => `${namespace.key}: ${namespaceLiteral(namespace, imports, "../")}`,
    );
    const text = [
      `${HEADER} ${chain.slug}, by its name.`,
      ...[...imports].map(([abi, binding]) => `import ${binding} from "${abi}";`),
      `export const ${pascalOfSlug(chain.slug)} = { ${fields.join(", ")} };`,
      "",
    ].join("\n");
    MODULE_TEXT.set(path, text);
    keyModules.set(chain.id, text);
  }

  return path;
}

/** The chain a chain key names (`Base`), when it is one. */
export function chainOfKey(key: string): CanonicalChain | undefined {
  if (!CHAIN_KEY_SET.has(key)) return undefined;
  const slug = chainSlugForKey(key);

  return CANONICAL_CHAINS.find((chain) => chain.slug === slug);
}

/** A short, stable digest of `text`: FNV-1a, for a path of its own. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }

  return (h >>> 0).toString(16).padStart(8, "0");
}
