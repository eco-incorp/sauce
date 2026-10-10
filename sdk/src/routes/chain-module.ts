/**
 * The names a program can use, written as ONE SauceScript module per target that the compiler is
 * handed as an AMBIENT module: its exports are globals of the program, used with no `import`.
 *
 * ```js
 * export const chainId = __sauce_chain;
 * export const USDC = __sauce_chain == 1 ? new TokenOf("USDC", 0xa0b8…, 6) : __sauce_chain == 8453 ? … : undefined;
 * class NsUniswapV3 { constructor(id) { this.Factory = id == 1 ? ABI_3.at(0x1f98…) : … : undefined; this.Pool = ABI_4; } }
 * export const UniswapV3 = new NsUniswapV3(__sauce_chain);
 * export const Arbitrum = new OnChain(42161); // its chain id, its contracts (`Arbitrum.UniswapV3.Factory`)
 * ```
 *
 * DECLARED ONCE, VALUED PER CHAIN. Every name of the registry — every token symbol of every chain,
 * every protocol namespace with every contract it has on any chain, every chain's name — is declared
 * in the same text for every chain of a target, so a name no chain has (`Uniswapp`,
 * `UniswapV3.Factroy`) is the compiler's error on every chain. Each value is the one of the chain the
 * program is compiled for: `__sauce_chain` ({@link CHAIN_DEFINE}), a define every compile sets for
 * its program and each `program()` body for its own. A name the chain lacks is `undefined`, so
 * `if (UniswapV3.Factory) { … }` is decided while compiling, and any other use of it is the
 * compiler's located error.
 *
 * Everything comes from the SDK's registries — tokens (`token-registry.ts`), protocol contracts
 * (`descriptors/`) and chains — and nothing is enumerated by the program: the compiler makes a module
 * constant only when a program reads it. The text is written once per target and kept: one module
 * the compiler parses once per process. A compile that chooses its own values (a `tokens` override,
 * a chain value, an accessor policy) gets a text of its own, where the chosen values are its chain's.
 *
 * WHAT THE MODULE EXPORTS:
 *  - `chainId`/`CHAIN_ID`, and each protocol contract's address key (`UniswapV3_Factory`);
 *  - `self`, the contract running the program (`self.USDC` its balance of a token), and on the EVM
 *    `Token(address)`;
 *  - every token symbol: a `Token` on the EVM, whose methods are `@sauce/token`'s SafeERC20
 *    functions, and a mint's key on Solana;
 *  - every protocol namespace (`UniswapV3`, a family's `Uniswap`), its contracts bound at their
 *    addresses on the chain, an interface as its contract import, which a program binds by calling
 *    it with an address (`UniswapV3.Pool(pool)`, the compiler's `.at(pool)`) or with `.at`, and a
 *    protocol's one callable contract standing for the protocol (`Lido.submit(…)`);
 *  - every chain's name: its chain id where it is compared (`chainId == Ethereum`), its `hop(…)`,
 *    which opens an intent whose body runs there (through the compile's level module,
 *    {@link levelModuleSource}), its `remote(…)`, which sends a message its body runs on there
 *    (`@sauce/remote`, through the same module), and its contracts (`Base.UniswapV3.Factory`, and
 *    its eco-routes Portal as `Base.Portal`), whose addresses a program passes across chains.
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
import { remoteLink, remoteLinkSource } from "./remote-link.js";
import { registryTokens, resolveTokenMap } from "./token-registry.js";
import type { AddressInput } from "./types.js";

/** What a compile's module is written with beyond the registry. */
export interface ChainModuleOptions {
  /** Token symbol -> address overrides, merged per key over the compiled chain's registry. */
  readonly tokens?: Readonly<Record<string, AddressInput>>;
  /** The compiled chain's own values for its scalar names (`chainId`, `UniswapV3_Factory`), chosen
   *  by the caller over the registry's. */
  readonly values?: Readonly<Record<string, bigint>>;
  /** The protocol-name policy: `false` exports no namespace; an object widens or scopes them. */
  readonly accessors?: boolean | ProtocolNameOptions;
}

/** The directory every generated module and the ABIs it imports are served under. */
export const CHAIN_MODULE_ROOT = "/@eco-incorp/sauce/chain";

/** The define each program is compiled with: the id of the chain it runs on. */
export const CHAIN_DEFINE = "__sauce_chain";

const TOKEN = "@sauce/token";
const HOP = "@sauce/hop";
const REMOTE = "@sauce/remote";

/** What the names module calls to open an intent or send a remote message: the level module's,
 *  written per compile. */
const HOPS = "__sauce_hops";

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

/** `id == a ? x : id == b ? y : undefined`: a value on each chain that has one, by its id. */
const byChain = (id: string, cases: readonly (readonly [number, string])[]): string =>
  cases.map(([chainId, value]) => `${id} == ${chainId} ? ${value} : `).join("") + "undefined";

/** The ABI each contract binding imports, by the path the module imports it at: one file per
 *  distinct ABI, shared by every module. */
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

/** The contracts a namespace names, by name, each with its descriptor: a family's contract only
 *  where one member has it, since a name two members share names neither. */
function namespaceContracts(namespace: Namespace): [string, ContractDescriptor][] {
  const contracts: [string, ContractDescriptor][] =
    namespace.kind === "protocol"
      ? [...namespace.contracts]
      : [...namespace.contractOwners].flatMap(([contract, owners]) => {
          if (owners.length > 1) return [];
          const member = resolveNamespace(pascalOfSlug(owners[0]!));
          const descriptor =
            member?.kind === "protocol" ? member.contracts.get(contract) : undefined;

          return descriptor === undefined ? [] : [[contract, descriptor]];
        });

  return contracts.filter(([name]) => IDENTIFIER.test(name));
}

/** The methods of a token (`@sauce/token`'s `TokenOf`), which no registry symbol may share. */
export const TOKEN_METHODS: ReadonlySet<string> = new Set([
  "transfer",
  "approve",
  "transferFrom",
  "balanceOf",
]);

/**
 * The address a program compiled for `chain` reads `<namespace>.<contract>` as, where the chain
 * gives it one: a deployed contract or an address-only one, its ABI not widened. `undefined` where
 * it is absent there, ambiguous, or an interface, which has no address of its own.
 */
export function contractAddressOn(
  chain: CanonicalChain,
  namespace: string,
  contract: string,
): string | undefined {
  const found = resolveNamespace(namespace);
  if (found === undefined || chain.kind !== "evm") return undefined;
  const descriptor = namespaceContracts(found).find(([name]) => name === contract)?.[1];
  if (descriptor === undefined) return undefined;
  if (descriptor.kind === "interface" || descriptor.coverage.typeFidelity === "widened") {
    return undefined;
  }

  return addressOn(descriptor, chain);
}

const widened = (descriptor: ContractDescriptor): string =>
  `${descriptor.protocol}.${descriptor.contract}'s vendored ABI is "widened" (computed selectors ` +
  `do NOT match the deployed contract) — ${descriptor.coverage.caveats.join("; ")} — pass ` +
  "accessors: { allowWidenedSelectors: true } to use it anyway";

/** A deployed contract no use of which compiles, and why: one whose ABI is widened. */
const REFUSED = [
  "class Refused {",
  "  constructor(why) { this.why = why; }",
  "  [Symbol.toPrimitive](hint) { throw new Error(this.why); }",
  "  toString() { return this.why; }",
  "}",
].join("\n");

/** The method names a namespace class keeps for itself. */
const CLASS_MEMBERS: ReadonlySet<string> = new Set([
  "address",
  "reason",
  "toString",
  "valueOf",
  "constructor",
]);

/** The contract that stands for a protocol, where one does. */
function standing(namespace: Namespace): ContractDescriptor | undefined {
  return namespace.kind === "protocol" && namespace.defaultContract !== undefined
    ? namespace.contracts.get(namespace.defaultContract)
    : undefined;
}

/** What one module writes: its imports, and whether it binds widened ABIs. */
class Writer {
  readonly imports = new Imports();
  readonly lines: string[] = [];
  readonly exported = new Set<string>(RESERVED);

  constructor(
    readonly evm: boolean,
    readonly allowWidened: boolean,
  ) {}

  /** `export const name = value`, unless the name is taken or no identifier. */
  add(name: string, value: string): void {
    if (!IDENTIFIER.test(name) || this.exported.has(name)) return;
    this.exported.add(name);
    this.lines.push(`export const ${name} = ${value};`);
  }

  /** `export const name`, its value the compiled chain's of `cases`, and `undefined` on a chain
   *  with none: a module-scope `?:` the compiler decides by the chain's id. */
  addByChain(name: string, cases: readonly (readonly [number, string])[]): void {
    this.add(name, byChain(CHAIN_DEFINE, cases));
  }

  /** One contract on `chain`, as a namespace holds it — bound at its address, an address-only
   *  contract as its address, one whose ABI is widened as the refusal any use of it is — or
   *  `undefined` where the chain has none to give. An interface has no address:
   *  {@link interfaceValue}. */
  contract(descriptor: ContractDescriptor, chain: CanonicalChain): string | undefined {
    const address = addressOn(descriptor, chain);
    if (address === undefined) return undefined;
    if (descriptor.kind === "address-only") return word(address);
    if (descriptor.coverage.typeFidelity === "widened" && !this.allowWidened) {
      return `new Refused(${str(widened(descriptor))})`;
    }

    return `${this.imports.abiOf(descriptor)}.at(${word(address)})`;
  }

  /** An interface as its contract import: called with an address, the compiler binds it there, as
   *  `.at` does. */
  interfaceValue(descriptor: ContractDescriptor): string {
    return this.imports.abiOf(descriptor);
  }

  /** `<value> on each EVM chain that has one`, as `byChain` cases. */
  contractCases(descriptor: ContractDescriptor): [number, string][] {
    return CANONICAL_CHAINS.flatMap((chain): [number, string][] => {
      if (chain.kind !== "evm") return [];
      const value = this.contract(descriptor, chain);
      return value === undefined ? [] : [[chain.id, value]];
    });
  }
}

/**
 * The class of a protocol namespace: an instance is the namespace on the chain whose id it is made
 * with, every contract the namespace has on any chain declared, `undefined` where that chain has
 * none. A protocol whose one callable contract stands for it (`Lido.submit(…)`, `Lido` as its
 * address) forwards that contract's methods to it; any other namespace, used as a contract, says it
 * names none.
 */
function namespaceClass(key: string, namespace: Namespace, writer: Writer): string {
  const contracts = namespaceContracts(namespace);
  const fields = contracts.map(([name]) => name);
  const assigns = writer.evm
    ? contracts.map(([name, descriptor]) =>
        descriptor.kind === "interface"
          ? `this.${name} = ${writer.interfaceValue(descriptor)};`
          : `this.${name} = ${byChain("id", writer.contractCases(descriptor))};`,
      )
    : // No EVM contract is on a Solana chain: each is declared, and `undefined`.
      fields.map((name) => `this.${name} = undefined;`);
  const main = writer.evm ? standing(namespace) : undefined;
  const methods: string[] = [];
  let address = "this.address = undefined;";
  let reason: string;
  if (main === undefined) {
    reason = `'${key}' names no single contract — it has ${fields.join(", ")}: use '${key}.<Contract>'`;
  } else {
    const usable = main.coverage.typeFidelity !== "widened" || writer.allowWidened;
    const at = CANONICAL_CHAINS.flatMap((chain): [number, string][] =>
      chain.kind === "evm" && writer.contract(main, chain) !== undefined
        ? [[chain.id, word(addressOn(main, chain)!)]]
        : [],
    );
    address = `this.address = ${usable ? byChain("id", at) : "undefined"};`;
    reason = usable
      ? `'${key}' is ${main.protocol}.${main.contract}, which this chain has no deployment of`
      : widened(main);
    const arities = new Map<string, number[]>();
    for (const entry of main.abi) {
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
        `return this.${main.contract}.${name}(${params.slice(0, arity).join(", ")});`;
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

  const ambiguous =
    namespace.kind === "family"
      ? [...namespace.contractOwners]
          .filter(([name, owners]) => owners.length > 1 && IDENTIFIER.test(name))
          .map(
            ([name, owners]) =>
              `'${name}' is ambiguous under ${key} (${owners.join(", ")}): use ` +
              owners.map((slug) => `${pascalOfSlug(slug)}.${name}`).join(" or "),
          )
      : [];
  const describe = [`'${key}' has ${fields.join(", ")}`, ...ambiguous].join("; ");

  return [
    `class Ns${key} {`,
    `  constructor(id) { ${assigns.join(" ")} ${address} this.reason = ${str(reason)}; }`,
    conversion,
    `  toString() { return ${str(describe)}; }`,
    ...methods,
    "}",
  ].join("\n");
}

/** Every token symbol of every chain, with each chain of the target's value of it: a `Token` on the
 *  EVM, a mint's key on Solana. A chain whose tokens the caller chose is given them. */
function tokenCases(
  evm: boolean,
  chosen:
    { readonly chain: CanonicalChain; readonly tokens: ReadonlyMap<string, bigint> } | undefined,
): Map<string, [number, string][]> {
  const tokens = new Map<string, [number, string][]>();
  for (const chain of CANONICAL_CHAINS) {
    const own = chain.kind === "evm";
    const symbols = chosen?.chain.id === chain.id ? chosen.tokens : resolveTokenMap(chain);
    const registered = own === evm ? registryTokens(chain) : {};
    for (const [symbol, address] of symbols) {
      if (!IDENTIFIER.test(symbol)) continue;
      let cases = tokens.get(symbol);
      if (cases === undefined) tokens.set(symbol, (cases = []));
      // A token of the other target's chains is declared here, and `undefined`.
      if (own !== evm) continue;
      const decimals = registered[symbol]?.decimals;
      cases.push([
        chain.id,
        evm
          ? `new TokenOf(${str(symbol)}, ${word(address)}, ${decimals === undefined ? "undefined" : decimals})`
          : `0x${address.toString(16).padStart(64, "0")}`,
      ]);
    }
  }

  return tokens;
}

/** The module every compile for a chain of `kind` with no values of its own is handed. */
const plainModules = new Map<"evm" | "svm", string>();

/** Forgets every module written so far: for a caller that changed the registry the modules are
 *  written from, as a test that marks a descriptor does. */
export function forgetChainModules(): void {
  plainModules.clear();
  REMOTE_BRANCHES.clear();
}

/** Whether a compile with `options` chooses no values of its own, so the target's one module serves
 *  it. */
export function isPlainModule(options: ChainModuleOptions): boolean {
  return (
    options.tokens === undefined &&
    Object.keys(options.values ?? {}).length === 0 &&
    (options.accessors === undefined || options.accessors === true)
  );
}

/**
 * The SauceScript module of every name for a compile for `chain`: the one module of its target, or,
 * where `options` chooses values of its own, a module where they are `chain`'s.
 */
export function chainModuleSource(chain: CanonicalChain, options: ChainModuleOptions): string {
  const kind = chain.kind === "evm" ? "evm" : "svm";
  const plain = isPlainModule(options);
  if (plain) {
    const kept = plainModules.get(kind);
    if (kept !== undefined) return kept;
  }
  const text = writeModule(kind, plain ? undefined : { chain, options });
  if (plain) plainModules.set(kind, text);

  return text;
}

/** The eco-routes Portal's descriptor, which every chain's name binds as its `Portal`. */
function ecoRoutesPortalContract(): ContractDescriptor | undefined {
  const namespace = resolveNamespace("EcoRoutes");

  return namespace?.kind === "protocol" ? namespace.contracts.get("Portal") : undefined;
}

/** A destination's facts, as seen from `source`, for a hop there: or why it has none. */
function destinationFacts(
  source: CanonicalChain,
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
    `missing: ${str(missing)} }`
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

/** What a compile's level module is written with. */
export interface LevelModuleOptions {
  /** The defaults every intent the program opens takes. */
  readonly intents?: IntentDefaults;
}

/**
 * The SauceScript module of one program's level: where the intents a program on `chain` opens are
 * built. The names module's chains call it (`Base.hop({ … })`): it holds the level the program's
 * intents open in, its Portal and defaults, and each destination's facts from here, or why a hop
 * there cannot be opened. `salt` is the route salt of every intent that names none, as a word.
 *
 * A remote message (`Base.remote(…)`) is sent from the same module: each other EVM chain's bridges
 * beside `chain`'s own, or why a message there cannot be sent.
 */
export function levelModuleSource(
  chain: CanonicalChain,
  options: LevelModuleOptions,
  salt: string,
): string {
  const defaults = options.intents ?? {};
  const why = (message: string): string => `throw new Error(${str(message)});`;
  if (chain.kind !== "evm") {
    return [
      "// GENERATED by the SDK for one compile (routes/chain-module.ts): where its intents open.",
      `class Hops { to(id, config) { ${why(`a program on ${chain.slug} opens no intent: the Portals a program publishes through are EVM contracts`)} } ` +
        `remote(id, body, options) { ${why(unreachable(chain))} } }`,
      `export const ${HOPS} = new Hops();`,
      "",
    ].join("\n");
  }
  const level = levelSource(chain, defaults, salt);
  const branches: string[] = [];
  if (level === undefined) {
    branches.push(
      why(`eco-routes has no Portal on ${chain.slug}, so a program there opens no intent`),
    );
  } else {
    for (const destination of CANONICAL_CHAINS) {
      const facts = destinationFacts(chain, destination, defaults);
      branches.push(
        `if (id == ${destination.id}) { ${typeof facts === "string" ? `return new Intent(${facts}, HERE, config);` : why(facts.absent)} }`,
      );
    }
    branches.push(why("a chain's id names no chain"));
  }

  return [
    "// GENERATED by the SDK for one compile (routes/chain-module.ts): where its intents open.",
    `import { Intent, Level } from "${HOP}";`,
    `import { Link, Remote } from "${REMOTE}";`,
    ...(level === undefined ? [] : [`const HERE = ${level};`]),
    `const HERE_LINK = ${remoteLinkSource(remoteLink(chain))};`,
    `class Hops { to(id, config) { ${branches.join(" ")} } remote(id, body, options) { ${remoteBranches(chain)} } }`,
    `export const ${HOPS} = new Hops();`,
    "",
  ].join("\n");
}

/** Why no remote message leaves or reaches `chain`, which is not an EVM chain. */
const unreachable = (chain: CanonicalChain): string =>
  "a remote message runs between EVM chains: its bridges and the handler a Pot runs it with are " +
  `EVM contracts, and ${chain.slug} is not one`;

/** Each chain's `remote` branch from an EVM `chain`, by its id: kept, since only the chain decides it. */
const REMOTE_BRANCHES = new Map<number, string>();

/** The body of `Hops.remote(id, body, options)` on the EVM `chain`: a `Remote` to each other EVM
 *  chain, from `HERE_LINK`, or why a message there cannot be sent. */
function remoteBranches(chain: CanonicalChain): string {
  const kept = REMOTE_BRANCHES.get(chain.id);
  if (kept !== undefined) return kept;
  const why = (message: string): string => `throw new Error(${str(message)});`;
  const branches = CANONICAL_CHAINS.map((destination) => {
    const sent =
      destination.kind !== "evm"
        ? why(unreachable(destination))
        : destination.id === chain.id
          ? why(`a remote message runs on another chain: this program already runs on ${chain.slug}`)
          : `return new Remote(${remoteLinkSource(remoteLink(destination))}, HERE_LINK, body, options);`;
    return `if (id == ${destination.id}) { ${sent} }`;
  });
  branches.push(why("a chain's id names no chain"));
  const text = branches.join(" ");
  REMOTE_BRANCHES.set(chain.id, text);

  return text;
}

function writeModule(
  kind: "evm" | "svm",
  chosen: { readonly chain: CanonicalChain; readonly options: ChainModuleOptions } | undefined,
): string {
  const evm = kind === "evm";
  const options = chosen?.options ?? {};
  const policy = typeof options.accessors === "object" ? options.accessors : {};
  const writer = new Writer(evm, policy.allowWidenedSelectors === true);
  const values = options.values ?? {};
  /** `value` on the chain whose values were chosen, `otherwise` elsewhere. */
  const chosenOr = (value: bigint | undefined, otherwise: string): string =>
    chosen === undefined || value === undefined
      ? otherwise
      : `${CHAIN_DEFINE} == ${chosen.chain.id} ? ${value} : ${otherwise}`;

  writer.lines.push(
    `export const chainId = ${chosenOr(values.chainId, CHAIN_DEFINE)};`,
    `export const CHAIN_ID = ${chosenOr(values.CHAIN_ID ?? values.chainId, CHAIN_DEFINE)};`,
  );
  if (evm) {
    writer.lines.push(
      "export const Token = (address) => new TokenOf(undefined, address, undefined);",
    );
  }
  writer.lines.push(
    'export const available = (name) => { throw new Error("`available(X)` is removed: test the name itself, `if (X)`"); };',
  );

  // Every token symbol.
  const tokens = tokenCases(
    evm,
    chosen === undefined
      ? undefined
      : { chain: chosen.chain, tokens: resolveTokenMap(chosen.chain, chosen.options.tokens) },
  );
  const held: string[] = [];
  for (const [symbol, cases] of tokens) {
    if (writer.exported.has(symbol)) continue;
    writer.addByChain(symbol, cases);
    if (evm) {
      held.push(
        `  get ${symbol}() { return ${symbol} === undefined ? undefined : ${symbol}.balanceOf(this); }`,
      );
    }
  }
  // `self`: the contract running the program; on the EVM `self.USDC` is its balance, a getter, so
  // the balance is read where `self.USDC` is written and a `const` holding it keeps that value.
  writer.lines.push(
    [
      "class Self {",
      ...held,
      "  valueOf() { return ctx.self(); }",
      "}",
      "export const self = new Self();",
    ].join("\n"),
  );

  // The protocol-address keys: values a program reads as plain addresses.
  for (const [key, perChain] of protocolAddressKeys()) {
    const cases = evm
      ? CANONICAL_CHAINS.flatMap((chain): [number, string][] => {
          const value =
            chosen?.chain.id === chain.id && values[key] !== undefined
              ? word(values[key]!)
              : perChain[chain.id];
          return chain.kind === "evm" && value !== undefined ? [[chain.id, word(value)]] : [];
        })
      : [];
    writer.addByChain(key, cases);
  }

  // The protocol namespaces.
  const namespaces: string[] = [];
  if (options.accessors !== false) {
    if (evm) writer.lines.push(REFUSED);
    for (const key of NAMESPACE_KEYS) {
      if (writer.exported.has(key)) continue;
      writer.lines.push(namespaceClass(key, resolveNamespace(key)!, writer));
      writer.add(key, `new Ns${key}(${CHAIN_DEFINE})`);
      namespaces.push(key);
    }
  }

  // Every chain's name: its id, and its contracts.
  const scope =
    policy.chainScope === undefined
      ? undefined
      : new Set(policy.chainScope.map((ref) => requireChain(ref).id));
  const explain =
    "a chain's name is its chain id, its `hop({ … })` and its contracts; a token is never qualified " +
    "by a chain: a symbol alone is the chain's own, compiled for it, and another chain's is an address";
  // Each chain's eco-routes Portal, the contract: for a low-level call or a check, never to open an
  // intent, which is `hop`.
  const portal = evm ? ecoRoutesPortalContract() : undefined;
  const portals = portal === undefined ? [] : writer.contractCases(portal);
  writer.lines.push(
    [
      "class OnChain {",
      "  constructor(id, why, closed) { this.id = id; this.why = why; this.closed = closed; }",
      "  valueOf() { return this.id; }",
      "  toString() { return this.why; }",
      `  hop(config${evm ? ": HopConfig" : ""}) { if (this.closed) throw new Error(this.why); return ${HOPS}.to(this.id, config); }`,
      `  remote(body, options) { if (this.closed) throw new Error(this.why); return ${HOPS}.remote(this.id, body, options); }`,
      `  get Portal() { return ${byChain("this.id", portals)}; }`,
      ...namespaces.map((key) =>
        scope === undefined
          ? `  get ${key}() { return new Ns${key}(this.id); }`
          : `  get ${key}() { if (this.closed) throw new Error(this.why); return new Ns${key}(this.id); }`,
      ),
      "}",
    ].join("\n"),
  );
  for (const other of CANONICAL_CHAINS) {
    const key = pascalOfSlug(other.slug);
    if (!CHAIN_KEY_SET.has(key) || writer.exported.has(key)) continue;
    if (scope !== undefined && !scope.has(other.id)) {
      const why = `chain '${other.slug}' (referenced as '${key}....') is outside the allowed chainScope`;
      writer.add(key, `new OnChain(${other.id}, ${str(why)}, true)`);
    } else {
      writer.add(key, `new OnChain(${other.id}, ${str(explain)}, false)`);
    }
  }

  const header = [
    "// GENERATED by the SDK (routes/chain-module.ts) from its registries: every name, each the value",
    `// of the chain \`${CHAIN_DEFINE}\` is, and \`undefined\` where that chain has none.`,
    ...(evm ? [`import { TokenOf } from "${TOKEN}";`, `import { HopConfig } from "${HOP}";`] : []),
    ...writer.imports.lines(),
  ];

  return [...header, ...writer.lines, ""].join("\n");
}
