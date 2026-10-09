/**
 * The names a program compiled for one chain can use, written as a SauceScript module the compiler
 * is handed as an AMBIENT module: its exports are globals of the program, used with no `import`.
 *
 * ```js
 * export const chainId = 8453;
 * export const USDC = new TokenOf("USDC", 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913, 6);
 * export const UniswapV3 = new NsUniswapV3({ Factory: ABI_3.at(0x33128a8f…), Pool: ABI_4 });
 * export const Arbitrum = new OnArbitrum(); // its chain id, its `hop(…)`, its contracts
 * ```
 *
 * Everything comes from the SDK's registries — tokens (`token-registry.ts`), protocol contracts
 * (`descriptors/`), chains and eco-routes' deployments — and nothing is enumerated by the program:
 * the compiler makes a module constant only when a program reads it, so Ethereum's two thousand
 * names cost a program its parsing and nothing else. The classes are `@sauce/names`' (`Token`) and
 * `@sauce/hop`'s (`Intent`, `Level`), and the ones written here: `self`'s, a class per protocol
 * namespace and per chain.
 *
 * WHAT A CHAIN'S MODULE EXPORTS:
 *  - `chainId`/`CHAIN_ID`, and each protocol contract's address key (`UniswapV3_Factory`);
 *  - `self`, the contract running the program (`self.USDC` its balance of a token), and on an EVM
 *    chain `Token(address)`;
 *  - every token symbol: a `Token` on an EVM chain, whose methods are `@sauce/token`'s SafeERC20
 *    functions, and a mint's key on Solana;
 *  - every protocol namespace (`UniswapV3`, a family's `Uniswap`), its contracts bound at their
 *    addresses on this chain, an interface as its contract import, which a program binds by calling
 *    it with an address (`UniswapV3.Pool(pool)`, the compiler's `.at(pool)`) or with `.at`,
 *    and a protocol's one callable contract standing for the protocol (`Lido.submit(…)`);
 *  - every chain's name: its chain id where it is compared (`chainId == Ethereum`), its `hop(…)`,
 *    which opens an intent whose body runs there, and its contracts (`Base.UniswapV3.Factory`, and
 *    its eco-routes Portal as `Base.Portal`), whose addresses a program passes across chains.
 * A module exports only what its chain has. A dotted name the chain lacks (`PancakeswapV3.Factory`,
 * `Base.AaveV3.Pool`) is the compiler's to fold: it compares as zero, so `if (X != 0)` is decided
 * while compiling, and the compile reports each such path (`absentPaths`), which the SDK holds to the
 * registry so a typo is refused (`unknown-global.ts`). Any other use of a name the chain lacks is a
 * compile error, which the SDK words for the chain.
 *
 * WHAT DEPENDS ON THE COMPILE. A `tokens` override and a chain value chosen by the caller change
 * this chain's names; the intent defaults (`intents`) and each destination's Kitchen fee change its
 * hops. The registry part is written once per chain and kept, with each other chain's contracts and
 * each destination's facts as it binds them; the salt, in `HERE`, is written per call.
 */
import type { Abi } from "viem";

import { CANONICAL_CHAINS, requireChain, type CanonicalChain } from "../chains/canonical.js";
import { nativeErc20 } from "../chains/index.js";
import { addressOn } from "../descriptors/query.js";
import type { ContractDescriptor } from "../descriptors/types.js";
import { loadPluginData } from "../plugin/index.js";
import {
  ecoRoutesPortal,
  ecoRoutesProver,
  type EcoRoutesSelector,
} from "../protocols/eco-routes/lookup.js";
import {
  CHAIN_KEY_SET,
  NAMESPACE_KEYS,
  resolveNamespace,
  type Namespace,
} from "./accessor-index.js";
import { pascalOfSlug } from "./pascal.js";
import { denormalizeToEvm } from "./encode.js";
import { rewardAssetsConflict } from "./intent.js";
import type { IntentDefaults } from "./intent-defaults.js";
import { resolveIntentPot } from "./intent-pot.js";
import { toUniversalAddress } from "./normalize.js";
import type { ProtocolNameOptions } from "./protocol-names.js";
import { registryTokens, resolveTokenMap } from "./token-registry.js";
import type { AddressInput } from "./types.js";
import { notDeployedAround } from "./unknown-global.js";

/** What a chain's module is written with beyond the chain itself. */
export interface ChainModuleOptions {
  /** Token symbol -> address overrides, merged per key over the chain's registry. */
  readonly tokens?: Readonly<Record<string, AddressInput>>;
  /** This chain's own values for its scalar names (`chainId`, `UniswapV3_Factory`), chosen by the
   *  caller over the registry's. */
  readonly values?: Readonly<Record<string, bigint>>;
  /** The protocol-name policy: `false` exports no namespace; an object widens or scopes them. */
  readonly accessors?: boolean | ProtocolNameOptions;
  /** The defaults every intent a program on this chain opens takes. */
  readonly intents?: IntentDefaults;
}

/** The directory every generated module and the ABIs it imports are served under. */
export const CHAIN_MODULE_ROOT = "/@eco-incorp/sauce/chain";

const NAMES = "@sauce/names";
const HOP = "@sauce/hop";

/** The names a module exports that no registry name may take. */
const RESERVED: ReadonlySet<string> = new Set([
  "chainId",
  "CHAIN_ID",
  "self",
  "Token",
  "available",
]);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A SauceScript string literal of `text`. */
const str = (text: string): string => JSON.stringify(text);

/** An address word as SauceScript writes it. */
const word = (value: bigint | string): string =>
  typeof value === "bigint" ? `0x${value.toString(16)}` : value.toLowerCase();

/** The ABI each contract binding imports, by the path the module imports it at: one file per
 *  distinct ABI, shared by every chain. */
const ABI_TEXT = new Map<string, string>();
const ABI_PATHS = new WeakMap<Abi, string>();

/** The text of an ABI a generated module imports, by its path under {@link CHAIN_MODULE_ROOT}:
 *  `abi/<protocol>/<export>.json`. */
export function chainModuleAbi(path: string): string | undefined {
  return ABI_TEXT.get(path);
}

/** One generated module's imports: each distinct ABI once, named in import order. */
class Imports {
  private readonly names = new Map<string, string>();

  abiOf(descriptor: ContractDescriptor): string {
    let path = ABI_PATHS.get(descriptor.abi);
    if (path === undefined) {
      path = `abi/${descriptor.protocol}/${descriptor.abiExport ?? descriptor.contract}.json`;
      // Two descriptors of one export share its ABI; another ABI under the same path is kept apart
      // by the contract's name.
      if (ABI_TEXT.has(path) && ABI_TEXT.get(path) !== JSON.stringify(descriptor.abi)) {
        path = `abi/${descriptor.protocol}/${descriptor.contract}.json`;
      }
      ABI_TEXT.set(path, JSON.stringify(descriptor.abi));
      ABI_PATHS.set(descriptor.abi, path);
    }
    let name = this.names.get(path);
    if (name === undefined) {
      name = `ABI_${this.names.size}`;
      this.names.set(path, name);
    }

    return name;
  }

  lines(): string[] {
    return [...this.names].map(([path, name]) => `import ${name} from "./${path}";`);
  }
}

const widened = (descriptor: ContractDescriptor): string =>
  `${descriptor.protocol}.${descriptor.contract}'s vendored ABI is "widened" (computed selectors ` +
  `do NOT match the deployed contract) — ${descriptor.coverage.caveats.join("; ")} — pass ` +
  "accessors: { allowWidenedSelectors: true } to use it anyway";

/** The protocol-address keys (`UniswapV3_Factory`) the registry has on some chain, and where. */
let addressKeys: ReadonlyMap<string, Readonly<Record<number, string>>> | undefined;
function protocolAddressKeys(): ReadonlyMap<string, Readonly<Record<number, string>>> {
  addressKeys ??= new Map(
    loadPluginData().protocolAddresses.map((d) => [
      `${pascalOfSlug(d.protocol)}_${d.contract}`,
      d.perChainAddress as Readonly<Record<number, string>>,
    ]),
  );
  return addressKeys;
}

/** Whether `name` is a scalar some chain gives its programs: `chainId`, or a protocol contract's
 *  address key (`UniswapV3_Factory`). */
export function isChainScalar(name: string): boolean {
  return name === "chainId" || name === "CHAIN_ID" || protocolAddressKeys().has(name);
}

/** The contracts a namespace names, by name, each with its descriptor or why it has none. */
function namespaceContracts(
  namespace: Namespace,
): [string, ContractDescriptor | { readonly ambiguous: string }][] {
  const contracts: [string, ContractDescriptor | { readonly ambiguous: string }][] =
    namespace.kind === "protocol"
      ? [...namespace.contracts]
      : [...namespace.contractOwners].map(([contract, owners]) => {
          if (owners.length > 1) {
            const candidates = owners
              .map((slug) => `${pascalOfSlug(slug)}.${contract}`)
              .join(" or ");
            return [
              contract,
              {
                ambiguous: `"${contract}" is ambiguous under ${namespace.familyKey} (${owners.join(", ")}) — use ${candidates}`,
              },
            ];
          }
          const member = resolveNamespace(pascalOfSlug(owners[0]!));
          const descriptor =
            member?.kind === "protocol" ? member.contracts.get(contract) : undefined;

          return [contract, descriptor ?? { ambiguous: `"${contract}" names no contract` }];
        });

  return contracts.filter(([name]) => IDENTIFIER.test(name));
}

/** The methods of a token (`@sauce/names`' `Token`), which no registry symbol may share. */
export const TOKEN_METHODS: ReadonlySet<string> = new Set([
  "transfer",
  "approve",
  "transferFrom",
  "balanceOf",
]);

/**
 * The address a program compiled for `chain` reads `<namespace>.<contract>` as, where the chain's
 * module gives it one: a deployed contract or an address-only one, its ABI not widened. `undefined`
 * where it is absent there, ambiguous, or an interface, which has no address of its own.
 */
export function contractAddressOn(
  chain: CanonicalChain,
  namespace: string,
  contract: string,
): string | undefined {
  const found = resolveNamespace(namespace);
  if (found === undefined || chain.kind !== "evm") return undefined;
  const descriptor = namespaceContracts(found).find(([name]) => name === contract)?.[1];
  if (descriptor === undefined || "ambiguous" in descriptor) return undefined;
  if (descriptor.kind === "interface" || descriptor.coverage.typeFidelity === "widened") {
    return undefined;
  }

  return addressOn(descriptor, chain);
}

/** What a namespace that names no single contract says when it is used as one. */
function namesNoSingle(key: string, namespace: Namespace): string {
  const known = namespaceContracts(namespace).map(([name]) => name);

  return `'${key}' names no single contract — it has ${known.join(", ")}: use '${key}.<Contract>'`;
}

/** The contract that stands for a protocol, where one does. */
function standing(namespace: Namespace): ContractDescriptor {
  const protocol = namespace as Namespace & { kind: "protocol" };

  return protocol.contracts.get(protocol.defaultContract!)!;
}

/**
 * What a protocol whose one callable contract stands for it says, as its class's constructor
 * composes it from `address` and `missingOn`: what it stands for, where its contract is; why its
 * contract is missing, on the chain `missingOn` names (`unknown-global.ts#notDeployed`, the slug
 * joined in while compiling); and, where its ABI is widened, that.
 */
function missingReason(key: string, namespace: Namespace): string {
  const main = standing(namespace);
  const stands = str(`'${key}' is ${main.protocol}.${main.contract}`);
  const [before, after] = notDeployedAround(main);
  const missing = `${str(before)} + missingOn + ${str(after)}`;
  if (main.coverage.typeFidelity !== "widened") {
    return `address !== undefined || missingOn === undefined ? ${stands} : ${missing}`;
  }

  return `address !== undefined ? ${stands} : missingOn === undefined ? ${str(widened(main))} : ${missing}`;
}

/** The method names a namespace class keeps for itself. */
const CLASS_MEMBERS: ReadonlySet<string> = new Set([
  "address",
  "reason",
  "toString",
  "valueOf",
  "constructor",
]);

/**
 * The class of a protocol namespace, written once per module: each chain's namespace is an instance
 * holding that chain's contracts by name. A protocol whose one callable contract stands for it
 * (`Lido.submit(…)`, `Lido` as its address) forwards that contract's methods to it; any other
 * namespace, used as a contract, says it names none.
 */
function namespaceClass(key: string, namespace: Namespace): string {
  const fields = namespaceContracts(namespace).map(([name]) => name);
  const main = namespace.kind === "protocol" ? namespace.defaultContract : undefined;
  const methods: string[] = [];
  if (main !== undefined) {
    const descriptor = (namespace as Namespace & { kind: "protocol" }).contracts.get(main)!;
    const arities = new Map<string, number[]>();
    for (const entry of descriptor.abi) {
      if (
        entry.type !== "function" ||
        !IDENTIFIER.test(entry.name) ||
        fields.includes(entry.name) ||
        CLASS_MEMBERS.has(entry.name)
      ) {
        continue;
      }
      arities.set(entry.name, [...(arities.get(entry.name) ?? []), entry.inputs.length]);
    }
    for (const [name, counts] of arities) {
      const most = Math.max(...counts);
      const params = Array.from({ length: most }, (_, i) => `a${i}`);
      const call = (arity: number) =>
        `return this.${main}.${name}(${params.slice(0, arity).join(", ")});`;
      const body = [...new Set(counts)]
        .sort((x, y) => x - y)
        .slice(0, -1)
        .map((arity) => `if (a${arity} === undefined) ${call(arity)}`)
        .concat(call(most));
      methods.push(`  ${name}(${params.join(", ")}) { ${body.join(" ")} }`);
    }
  }
  const conversion =
    main === undefined
      ? "  [Symbol.toPrimitive](hint) { throw new Error(this.reason); }"
      : '  [Symbol.toPrimitive](hint) { if (this.address === undefined) { if (hint === "default") return 0; throw new Error(this.reason); } return this.address; }';
  // A contract the chain lacks is left unset, so a comparison with it is the compiler's to decide.
  const contracts = fields.map((name) => `if (c.${name} !== undefined) this.${name} = c.${name};`);
  // What the namespace says used as a contract is the same on every chain but where its contract is
  // missing there (the one sentence naming the chain), so the class holds it once, not each chain's
  // instance.
  const constructor =
    main === undefined
      ? `  constructor(c) { ${contracts.join(" ")} this.address = undefined; this.reason = ${str(namesNoSingle(key, namespace))}; }`
      : `  constructor(c, address, missingOn) { ${contracts.join(" ")} this.address = address; this.reason = ${missingReason(key, namespace)}; }`;

  return [
    `class Ns${key} {`,
    constructor,
    conversion,
    "  toString() { return this.reason; }",
    ...methods,
    "}",
  ].join("\n");
}

/** One module's namespaces: what each chain's holds of each. */
class Namespaces {
  constructor(
    private readonly imports: Imports,
    private readonly allowWidened: boolean,
  ) {}

  /** One contract on `chain`, as a namespace holds it — bound at its address, an interface as its
   *  contract import (called with an address, the compiler binds it there, as `.at` does), an
   *  address-only contract as its address — or `undefined` where the chain has none to give: not
   *  deployed there, or its ABI widened. */
  contract(descriptor: ContractDescriptor, chain: CanonicalChain): string | undefined {
    if (descriptor.kind === "interface") return this.imports.abiOf(descriptor);
    const address = addressOn(descriptor, chain);
    if (address === undefined) return undefined;
    if (descriptor.kind === "address-only") return word(address);
    if (descriptor.coverage.typeFidelity === "widened" && !this.allowWidened) return undefined;

    return `${this.imports.abiOf(descriptor)}.at(${word(address)})`;
  }

  /** The namespace `key` on `chain`, or `undefined` where the chain has none of it: its contracts
   *  there, and for a protocol whose one contract stands for it, that contract's address or why it
   *  has none. */
  value(key: string, namespace: Namespace, chain: CanonicalChain): string | undefined {
    const fields = namespaceContracts(namespace).flatMap(([name, found]) => {
      if ("ambiguous" in found) return [];
      const value = this.contract(found, chain);
      return value === undefined ? [] : [`${name}: ${value}`];
    });
    if (fields.length === 0) return undefined;
    const main =
      namespace.kind === "protocol" && namespace.defaultContract !== undefined
        ? namespace.contracts.get(namespace.defaultContract)
        : undefined;
    const contracts = `{ ${fields.join(", ")} }`;
    // The class says what the namespace says; an instance gives only its contract's address, or
    // the chain it is missing on.
    if (main === undefined) return `new Ns${key}(${contracts})`;
    const there = addressOn(main, chain);
    if (there !== undefined && (main.coverage.typeFidelity !== "widened" || this.allowWidened)) {
      return `new Ns${key}(${contracts}, ${word(there)}, undefined)`;
    }

    return there === undefined
      ? `new Ns${key}(${contracts}, undefined, ${str(chain.slug)})`
      : `new Ns${key}(${contracts}, undefined, undefined)`;
  }
}

/** The registry part of a chain's module: its tokens, namespaces and scalar names. */
interface RegistryPart {
  readonly imports: Imports;
  readonly namespaces: Namespaces | undefined;
  readonly lines: readonly string[];
  readonly exported: ReadonlySet<string>;
  /** The token symbols this chain's module exports, which a hop's `receive` can name. */
  readonly tokenSymbols: ReadonlySet<string>;
  /** Another chain's contracts as this module binds them (its imports name their ABIs), by its id. */
  readonly contractsOf: Map<number, string>;
  /** A destination's facts from here, by its id and the intent defaults that shape them. */
  readonly destinations: Map<string, string | { readonly absent: string }>;
}

const registryParts = new Map<number, RegistryPart>();

/** Forgets every chain's module written so far: for a caller that changed the registry the modules
 *  are written from, as a test that marks a descriptor does. */
export function forgetChainModules(): void {
  registryParts.clear();
}

function registryPart(chain: CanonicalChain, options: ChainModuleOptions): RegistryPart {
  const plain =
    options.tokens === undefined &&
    Object.keys(options.values ?? {}).length === 0 &&
    (options.accessors === undefined || options.accessors === true);
  if (plain) {
    const cached = registryParts.get(chain.id);
    if (cached !== undefined) return cached;
  }
  const evm = chain.kind === "evm";
  const imports = new Imports();
  const policy = typeof options.accessors === "object" ? options.accessors : {};
  // No EVM contract is on a Solana chain: its module names none.
  const namespaces =
    options.accessors === false || !evm
      ? undefined
      : new Namespaces(imports, policy.allowWidenedSelectors === true);
  const lines: string[] = [];
  const exported = new Set<string>(RESERVED);
  const add = (name: string, value: string): void => {
    if (!IDENTIFIER.test(name) || exported.has(name)) return;
    exported.add(name);
    lines.push(`export const ${name} = ${value};`);
  };
  const values = options.values ?? {};
  const id = values.chainId ?? BigInt(chain.id);
  lines.push(`export const chainId = ${id};`, `export const CHAIN_ID = ${values.CHAIN_ID ?? id};`);
  if (evm) {
    lines.push("export const Token = (address) => new TokenOf(undefined, address, undefined);");
  }
  lines.push(
    'export const available = (name) => { throw new Error("`available(X)` is removed: compare the name with zero, `X != 0`"); };',
  );

  // The chain's tokens.
  const tokens = resolveTokenMap(chain, options.tokens);
  const registered = registryTokens(chain);
  const held: string[] = [];
  const tokenSymbols = new Set<string>();
  for (const [symbol, address] of tokens) {
    if (!IDENTIFIER.test(symbol) || exported.has(symbol)) continue;
    tokenSymbols.add(symbol);
    if (evm) {
      const decimals = registered[symbol]?.decimals;
      add(
        symbol,
        `new TokenOf(${str(symbol)}, ${word(address)}, ${decimals === undefined ? "undefined" : decimals})`,
      );
      held.push(`  get ${symbol}() { return ${symbol}.balanceOf(this); }`);
    } else {
      add(symbol, `0x${address.toString(16).padStart(64, "0")}`);
    }
  }
  // `self`: the contract running the program; on an EVM chain `self.USDC` is its balance, a getter,
  // so the balance is read where `self.USDC` is written and a `const` holding it keeps that value.
  lines.push(
    [
      "class Self {",
      ...held,
      "  valueOf() { return ctx.self(); }",
      "}",
      "export const self = new Self();",
    ].join("\n"),
  );

  // The protocol-address keys: values a program reads as plain addresses.
  if (evm) {
    for (const [key, perChain] of protocolAddressKeys()) {
      const chosen = values[key];
      const address = perChain[chain.id];
      if (chosen !== undefined || address !== undefined) add(key, word(chosen ?? address!));
    }
  }

  // The protocol namespaces.
  const classes: string[] = [];
  if (namespaces !== undefined) {
    for (const key of NAMESPACE_KEYS) {
      const namespace = resolveNamespace(key)!;
      classes.push(namespaceClass(key, namespace));
      const value = namespaces.value(key, namespace, chain);
      if (value !== undefined) add(key, value);
    }
  }

  const part: RegistryPart = {
    imports,
    namespaces,
    lines: [...classes, ...lines],
    exported,
    tokenSymbols,
    contractsOf: new Map(),
    destinations: new Map(),
  };
  if (plain) registryParts.set(chain.id, part);

  return part;
}

/** A destination's tokens by symbol, as `@sauce/hop` looks a delivered token up: those of the
 *  symbols the source chain has, since a hop's `receive` names a token as the source writes it. */
function destinationTokenTable(source: ReadonlySet<string>, chain: CanonicalChain): string {
  return `{ ${[...resolveTokenMap(chain)]
    .filter(([symbol]) => IDENTIFIER.test(symbol) && source.has(symbol))
    .map(([symbol, address]) => `${symbol}: ${word(address)}`)
    .join(", ")} }`;
}

/** A destination's facts, as seen from `source`, for a hop there: or why it has none. They are the
 *  same text for every compile whose defaults agree on what shapes them, so each source's module
 *  part keeps them; an execution fee given as a function is read again each time. */
function destinationOf(
  source: CanonicalChain,
  registry: RegistryPart,
  destination: CanonicalChain,
  defaults: IntentDefaults,
): string | { readonly absent: string } {
  const key =
    typeof defaults.executionFee === "function"
      ? undefined
      : JSON.stringify([
          destination.id,
          defaults.generation,
          defaults.environment,
          defaults.destinationPortal,
          defaults.pot,
          defaults.engine,
          defaults.prover,
          defaults.executionFee?.toString(),
        ]);
  const kept = key === undefined ? undefined : registry.destinations.get(key);
  if (kept !== undefined) return kept;
  const facts = destinationFacts(source, registry, destination, defaults);
  if (key !== undefined) registry.destinations.set(key, facts);

  return facts;
}

function destinationFacts(
  source: CanonicalChain,
  registry: RegistryPart,
  destination: CanonicalChain,
  defaults: IntentDefaults,
): string | { readonly absent: string } {
  if (destination.kind !== "evm") {
    return {
      absent:
        `an intent a program opens runs its body on an EVM chain: ${destination.slug} runs ` +
        "programs for its Kitchen, which a route call does not issue from here yet",
    };
  }
  const selector: EcoRoutesSelector = defaults;
  let portal: `0x${string}`;
  try {
    portal = denormalizeToEvm(
      toUniversalAddress(defaults.destinationPortal ?? ecoRoutesPortal(destination, selector)),
    );
  } catch (error) {
    return { absent: (error as Error).message };
  }
  const { pot, engine } = resolveIntentPot(portal, defaults);
  let prover = "undefined";
  let unproven = "undefined";
  try {
    prover = word(
      denormalizeToEvm(
        toUniversalAddress(defaults.prover ?? ecoRoutesProver(source, destination, selector)),
      ),
    );
  } catch (error) {
    unproven = str((error as Error).message);
  }
  const fee =
    typeof defaults.executionFee === "function"
      ? defaults.executionFee(destination)
      : defaults.executionFee;
  const missing =
    `a token a hop's \`receive\` names is ${destination.slug}'s of the same symbol, and ` +
    `${destination.slug} registers no token of that symbol: name one it has, or give its address ` +
    "with `Token(address)`";

  return (
    `{ chainId: ${destination.id}, portal: ${word(portal)}, ` +
    `pot: ${word(denormalizeToEvm(toUniversalAddress(pot)))}, ` +
    `engine: ${word(denormalizeToEvm(toUniversalAddress(engine)))}, ` +
    `prover: ${prover}, unproven: ${unproven}, fee: ${fee === undefined ? "undefined" : fee}, ` +
    `missing: ${str(missing)}, tokens: ${destinationTokenTable(registry.tokenSymbols, destination)} }`
  );
}

/** The level every intent a program on `chain` opens is built in: its Portal and its defaults. */
function levelSource(
  chain: CanonicalChain,
  defaults: IntentDefaults,
  salt: string,
): string | undefined {
  let portal: `0x${string}`;
  try {
    portal = denormalizeToEvm(
      toUniversalAddress(defaults.sourcePortal ?? ecoRoutesPortal(chain, defaults)),
    );
  } catch {
    return undefined;
  }
  const native = nativeErc20(chain.id);
  const conflict =
    native === undefined ? undefined : rewardAssetsConflict(chain.id, true, [native.address]);
  const optional = (value: bigint | undefined): string =>
    value === undefined ? "undefined" : `${value}`;

  return (
    `new Level({ chainId: ${chain.id}, portal: ${word(portal)}, salt: ${salt}, ` +
    `deadline: ${optional(defaults.deadline)}, rewardDeadline: ${optional(defaults.rewardDeadline)}, ` +
    `openedAt: ${optional(defaults.openedAt)}, fund: ${defaults.fund !== false}, ` +
    `fundVia: ${str(defaults.fundVia ?? "transfer")}, allowPartial: ${defaults.allowPartial === true}, ` +
    `nativeToken: ${native === undefined ? "undefined" : word(native.address)}, ` +
    `nativeConflict: ${conflict === undefined ? "undefined" : str(conflict)} })`
  );
}

/** The eco-routes Portal's descriptor, which every chain's name binds as its `Portal`. */
function ecoRoutesPortalContract(): ContractDescriptor | undefined {
  const namespace = resolveNamespace("EcoRoutes");

  return namespace?.kind === "protocol" ? namespace.contracts.get("Portal") : undefined;
}

/** Every chain's name, on `chain`: its id, its `hop` from here, its contracts and its Portal. */
function chainsPart(
  chain: CanonicalChain,
  options: ChainModuleOptions,
  registry: RegistryPart,
  salt: string,
): string[] {
  const { exported, namespaces } = registry;
  const defaults = options.intents ?? {};
  const policy = typeof options.accessors === "object" ? options.accessors : {};
  const scope =
    policy.chainScope === undefined
      ? undefined
      : new Set(policy.chainScope.map((ref) => requireChain(ref).id));
  const level = chain.kind === "evm" ? levelSource(chain, defaults, salt) : undefined;
  const lines: string[] = [];
  if (level !== undefined) lines.push(`const HERE = ${level};`);
  for (const other of CANONICAL_CHAINS) {
    const key = pascalOfSlug(other.slug);
    if (!CHAIN_KEY_SET.has(key) || exported.has(key)) continue;
    const className = `On${key}`;
    const fields: string[] = [];
    let explain =
      "a chain's name is its chain id, its `hop({ … })` and its contracts; a token is never " +
      "qualified by a chain: a symbol alone is the chain's own, compiled for it, and another " +
      "chain's is an address";
    // Why a hop there cannot be opened from here, where it cannot.
    let unhopped: string | undefined;
    let hop: string | undefined;
    if (scope !== undefined && !scope.has(other.id)) {
      explain = `chain '${other.slug}' (referenced as '${key}....') is outside the allowed chainScope`;
    } else {
      // A hop there, from here: or, where there is none, why — what calling it says.
      if (chain.kind !== "evm") {
        unhopped = `a program on ${chain.slug} opens no intent: the Portals a program publishes through are EVM contracts`;
      } else if (level === undefined) {
        unhopped = `eco-routes has no Portal on ${chain.slug}, so a program there opens no intent`;
      } else {
        const destination = destinationOf(chain, registry, other, defaults);
        if (typeof destination === "string") {
          hop = `  hop(config) { return new Intent(${destination}, HERE, config); }`;
        } else {
          unhopped = destination.absent;
        }
      }
      // Another chain's contracts, as that chain deploys them: addresses to pass across chains.
      if (namespaces !== undefined && chain.kind === "evm" && other.kind === "evm") {
        let contracts = registry.contractsOf.get(other.id);
        if (contracts === undefined) {
          const held: string[] = [];
          for (const namespaceKey of NAMESPACE_KEYS) {
            const value = namespaces.value(namespaceKey, resolveNamespace(namespaceKey)!, other);
            if (value !== undefined) held.push(`this.${namespaceKey} = ${value};`);
          }
          // Its eco-routes Portal, the contract: for a low-level call or a check, never to open an
          // intent, which is `hop`.
          const portal = ecoRoutesPortalContract();
          const binding = portal === undefined ? undefined : namespaces.contract(portal, other);
          if (binding !== undefined) held.push(`this.Portal = ${binding};`);
          contracts = held.join(" ");
          // The part's imports name the ABIs this binds, so it is kept with them.
          registry.contractsOf.set(other.id, contracts);
        }
        if (contracts !== "") fields.push(contracts);
      }
    }
    lines.push(
      [
        `class ${className} {`,
        `  constructor() { ${fields.join(" ")} }`,
        `  valueOf() { return ${other.id}; }`,
        `  toString() { return ${str(explain)}; }`,
        hop ?? `  hop(config) { throw new Error(${str(unhopped ?? explain)}); }`,
        "}",
        `export const ${key} = new ${className}();`,
      ].join("\n"),
    );
  }

  return lines;
}

/**
 * The SauceScript module of `chain`'s names, for a compile with `options`. `salt` is the route salt
 * of every intent that names none, written as a word.
 */
export function chainModuleSource(
  chain: CanonicalChain,
  options: ChainModuleOptions,
  salt: string,
): string {
  const registry = registryPart(chain, options);
  const chains = chainsPart(chain, options, registry, salt);
  const evm = chain.kind === "evm";
  const header = [
    "// GENERATED by the SDK for one compile (routes/chain-module.ts) from its registries.",
    ...(evm
      ? [`import { Token as TokenOf } from "${NAMES}";`, `import { Intent, Level } from "${HOP}";`]
      : []),
    ...registry.imports.lines(),
  ];

  return [...header, ...registry.lines, ...chains, ""].join("\n");
}
