/**
 * The extensions manifest: what the SDK knows about every chain, handed to the compiler as data.
 *
 * The compiler reads it through `resolve` (`compile({ extensions })`) and gives a program the names
 * it declares with no import and no rewrite:
 *
 *   - every chain is a name: `Arbitrum.USDC`, `Base.UniswapV3.Factory`;
 *   - the chain being compiled for (`current`) supplies the unqualified names: its token symbols
 *     (`USDC`, typed `Token`, so `USDC.transfer(to, amount)` is `@sauce/token`'s SafeERC20 write and
 *     `pool.USDC` the pool's balance), its protocol namespaces (`UniswapV3.Factory.getPool(…)`,
 *     an ABI-bound contract at its address there), the underscore spellings and `chainId` the
 *     ambient defines carried, `Token(address)`, `self` and `available(…)`;
 *   - a name this chain lacks but another has is `unavailable`, with the message the SDK's rewrites
 *     gave, so it is a compile error where it is read and `false` to `available(…)`.
 *
 * Nothing here parses or rewrites a program. It replaces, one at a time, the source passes
 * (`token-rewrite.ts`, `protocol-rewrite.ts`, `available.ts`, `closure.ts`) that did the same work
 * as text. The document is large, so it is split the way the compiler caches it: the document names
 * each chain's body and the ABI table by path, and each is served — and cached by the compiler — on
 * its own bytes. Only the small document changes with the chain being compiled for.
 */
import { CANONICAL_CHAINS, type CanonicalChain } from "../chains/canonical.js";
import { DESCRIPTORS } from "../descriptors/registry.js";
import type { ContractDescriptor } from "../descriptors/types.js";
import { resolveSdkModule } from "../embedded/resolve.js";
import { resolveTokenMap, SVM_TOKEN_REGISTRY, TOKEN_REGISTRY } from "./token-registry.js";
import type { AddressInput } from "./types.js";

/** The path a compile names the manifest by; `serveExtensions` answers it and everything it names. */
export const EXTENSIONS_PATH = "/@eco-incorp/sauce/extensions/manifest.json";
const ROOT = "/@eco-incorp/sauce/extensions";
const ABIS_PATH = `${ROOT}/abis.json`;

/** The id the document's `abis` table and its token type name the ERC-20 ABI by. */
const ERC20_ABI = "IERC20";
/** The extension type a token symbol and `Token(address)` carry on an EVM chain. */
const TOKEN_TYPE = "Token";
/** The type a token symbol carries on an SVM chain, whose ERC-20 syntax is refused by name. */
const SPL_TOKEN_TYPE = "SplToken";

type Entry =
  | { kind: "const"; value: string; type?: string }
  | { kind: "constructor"; type: string }
  | { kind: "context"; read: "self" }
  | { kind: "namespace"; members: Record<string, Entry>; default?: string }
  | { kind: "contract"; address?: string; abi?: string; refuse?: string }
  | { kind: "intrinsic"; name: "available" }
  | { kind: "unavailable"; message: string }
  | { kind: "ambiguous"; message: string };

type Method =
  | { kind: "fn"; fn: string }
  | { kind: "abi"; abi: string; method?: string }
  | { kind: "unavailable"; message: string };

interface Body {
  readonly globals: Record<string, Entry>;
  /** Compile-time parameters a program on this chain compiles with; a caller's `defines` win. */
  readonly defines?: Record<string, string>;
}

export interface ExtensionsOptions {
  /** Give the program the chain's protocol namespaces (`UniswapV3.Factory`). `accessors: false`
   *  leaves them out. Default `true`. */
  readonly protocols?: boolean;
  /** Give the program a bare `self` (`accessors.selfSugar`). Default `true`. */
  readonly self?: boolean;
  /** Token symbol overrides, merged per key over the registry for the chain being compiled for —
   *  `SauceCompileOptions.tokens`. */
  readonly tokens?: Readonly<Record<string, AddressInput>>;
  /** Compile a `typeFidelity: "widened"` descriptor's calls anyway (`accessors.allowWidenedSelectors`). */
  readonly allowWidenedSelectors?: boolean;
  /**
   * Hand each chain's scalar spellings — `chainId`, `CHAIN_ID` and the `<Protocol>_<Contract>`
   * addresses — to its programs as defines as well, so a program's own `const` of the name gives
   * way to the chain's value, as it did to `openRoute`'s chain-scoped values
   * (`ambient.ts#chainDefines`). A program literal compiles with its own chain's. Off, they are only
   * names, which lose to any declaration. Default `false`.
   */
  readonly chainDefines?: boolean;
}

/** `"uniswap-v3"` -> `"UniswapV3"`: how a slug is spelled as a name — `builder.ts#pascalOfSlug`'s
 *  rule, restated rather than imported, since that module reaches the whole route pipeline and this
 *  one sits underneath it. */
const pascalOfSlug = (slug: string): string =>
  slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

/** The chain key a program names a chain by: `PascalOf(slug)`, as `import { Base }` spells it. */
export const chainKey = (chain: CanonicalChain): string => pascalOfSlug(chain.slug);

const word = (value: bigint | string): string => BigInt(value).toString();

/** Whether a source file can spell `name` — the manifest refuses a global nothing could read. A
 *  registry symbol like `USDC.e` is not one, and never had token syntax. */
const spellable = (name: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);

/** The ABI table every chain's contracts name: one entry per descriptor that has an ABI, plus the
 *  ERC-20 ABI the token type reads through. */
let abiTable: string | undefined;
function abis(): string {
  if (abiTable !== undefined) return abiTable;
  const table: Record<string, unknown> = {
    [ERC20_ABI]: JSON.parse(new TextDecoder().decode(resolveSdkModule("./artifacts/IERC20.json"))),
  };
  for (const descriptor of DESCRIPTORS) {
    if (descriptor.kind !== "address-only") table[abiId(descriptor)] = descriptor.abi;
  }
  abiTable = JSON.stringify(table);
  return abiTable;
}

/** A descriptor's ABI id — the binding name `protocol-rewrite.ts` gave it. */
const abiId = (descriptor: ContractDescriptor): string =>
  `I${pascalOfSlug(descriptor.protocol)}_${descriptor.contract}`;

/** The document's types: what a token's methods are on each VM. */
function types(): Record<string, { methods: Record<string, Method>; holder?: string }> {
  const refused =
    "the ERC20 token syntax is EVM-only. On svm a token symbol is the mint, a value for the " +
    "@sauce/token functions with the accounts as Account parameters: `transfer(USDC, tokenProgram, " +
    "source, dest, authority, amount)`, `balanceOf(USDC, account)`";
  return {
    [TOKEN_TYPE]: {
      methods: {
        transfer: { kind: "fn", fn: "@sauce/token#transfer" },
        approve: { kind: "fn", fn: "@sauce/token#approve" },
        transferFrom: { kind: "fn", fn: "@sauce/token#transferFrom" },
        balanceOf: { kind: "abi", abi: ERC20_ABI, method: "balanceOf" },
      },
      holder: "balanceOf",
    },
    [SPL_TOKEN_TYPE]: {
      methods: {
        transfer: { kind: "unavailable", message: refused },
        approve: { kind: "unavailable", message: refused },
        transferFrom: { kind: "unavailable", message: refused },
        balanceOf: { kind: "unavailable", message: refused },
      },
      // `pool.USDC` reaches the same refusal.
      holder: "balanceOf",
    },
  };
}

/** Every token symbol any chain registers, with the chains that register it. */
let symbolChains: ReadonlyMap<string, readonly string[]> | undefined;
function registeredSymbols(): ReadonlyMap<string, readonly string[]> {
  if (symbolChains !== undefined) return symbolChains;
  const map = new Map<string, string[]>();
  for (const chain of CANONICAL_CHAINS) {
    for (const symbol of resolveTokenMap(chain).keys()) {
      const list = map.get(symbol) ?? [];
      list.push(chain.slug);
      map.set(symbol, list);
    }
  }
  // A symbol the registries carry that no canonical chain resolves (a cluster without a chain) is
  // still a known name, never a typo.
  for (const rows of [...Object.values(TOKEN_REGISTRY), ...Object.values(SVM_TOKEN_REGISTRY)]) {
    for (const row of rows) if (!map.has(row.symbol)) map.set(row.symbol, []);
  }
  symbolChains = map;
  return map;
}

/** Whether `name` is a token symbol some chain registers — a name the manifest types as a token. */
export function isTokenSymbol(name: string): boolean {
  return spellable(name) && registeredSymbols().has(name);
}

/** The descriptors of each protocol, keyed by its namespace. */
const protocols = new Map<string, ContractDescriptor[]>();
for (const descriptor of DESCRIPTORS) {
  const list = protocols.get(descriptor.protocol) ?? [];
  list.push(descriptor);
  protocols.set(descriptor.protocol, list);
}

/** `"uniswap-v4"` -> `"uniswap"`; a slug with no trailing `-v<N>` yields `undefined`. */
const familyStem = (slug: string): string | undefined => /^(.+)-v\d+$/.exec(slug)?.[1];

/** One contract of a protocol on `chain`, as the protocol rewrite would have resolved it. */
function contractEntry(
  descriptor: ContractDescriptor,
  chain: CanonicalChain,
  options: ExtensionsOptions,
): Entry {
  const { protocol, contract } = descriptor;
  if (descriptor.kind === "interface") return { kind: "contract", abi: abiId(descriptor) };
  const address = descriptor.perChainAddress[chain.id];
  if (address === undefined) {
    const known = descriptor.chains.length > 0 ? descriptor.chains.join(", ") : "(none)";
    return {
      kind: "unavailable",
      message: `Contract '${contract}' (${protocol}) is not deployed on '${chain.slug}' (available: ${known})`,
    };
  }
  if (descriptor.kind === "address-only") return { kind: "contract", address: word(address) };
  const widened = descriptor.coverage.typeFidelity === "widened" && !options.allowWidenedSelectors;

  return {
    kind: "contract",
    address: word(address),
    abi: abiId(descriptor),
    ...(widened
      ? {
          refuse:
            `${protocol}.${contract}'s vendored ABI is "widened" (computed selectors do NOT match ` +
            `the deployed contract) — ${descriptor.coverage.caveats.join("; ")} — pass accessors: ` +
            "{ allowWidenedSelectors: true } to call it anyway",
        }
      : {}),
  };
}

/** One chain's body: its token symbols, protocol namespaces and the SDK's global spellings. */
function body(
  chain: CanonicalChain,
  tokens: ReadonlyMap<string, bigint>,
  options: ExtensionsOptions,
): Body {
  const globals: Record<string, Entry> = {};
  const evm = chain.kind === "evm";

  // The scalar spellings `ambient.ts#chainDefines` gives a chain beside its token symbols.
  const scalars: Record<string, string> = {
    chainId: word(BigInt(chain.id)),
    CHAIN_ID: word(BigInt(chain.id)),
  };
  globals.available = { kind: "intrinsic", name: "available" };
  if (options.self !== false) globals.self = { kind: "context", read: "self" };
  // On an SVM chain `Token(x)` still constructs — a token whose every method is refused by name.
  globals.Token = { kind: "constructor", type: evm ? TOKEN_TYPE : SPL_TOKEN_TYPE };

  for (const [symbol, chains] of registeredSymbols()) {
    if (!spellable(symbol)) continue;
    const address = tokens.get(symbol);
    globals[symbol] =
      address !== undefined
        ? { kind: "const", value: word(address), type: evm ? TOKEN_TYPE : SPL_TOKEN_TYPE }
        : {
            kind: "unavailable",
            message:
              `\`${symbol}\` is not a token ${chain.slug} registers` +
              (chains.length > 0 ? `; it is registered on: ${chains.join(", ")}` : "") +
              ". A token the registry does not carry is `Token(address)`, or a `tokens` entry in " +
              "the compile options.",
          };
  }
  // A caller's own symbol that no registry carries.
  for (const [symbol, address] of tokens) {
    if (spellable(symbol) && globals[symbol] === undefined) {
      globals[symbol] = {
        kind: "const",
        value: word(address),
        type: evm ? TOKEN_TYPE : SPL_TOKEN_TYPE,
      };
    }
  }

  // Protocol namespaces, and the `<Protocol>_<Contract>` spellings `ambient.ts#chainDefines` gave.
  const families = new Map<string, string[]>();
  for (const [slug, descriptors] of protocols) {
    const members: Record<string, Entry> = {};
    for (const descriptor of descriptors) {
      members[descriptor.contract] = contractEntry(descriptor, chain, options);
      const address = descriptor.perChainAddress[chain.id];
      if (evm && address !== undefined) {
        scalars[`${pascalOfSlug(slug)}_${descriptor.contract}`] = word(address);
      }
    }
    if (options.protocols === false) continue;
    const callable = descriptors.filter((d) => d.kind === "singleton");
    globals[pascalOfSlug(slug)] = {
      kind: "namespace",
      members,
      ...(callable.length === 1 && members[callable[0]!.contract]?.kind === "contract"
        ? { default: callable[0]!.contract }
        : {}),
    };
    const stem = familyStem(slug);
    if (stem !== undefined) {
      const key = pascalOfSlug(stem);
      families.set(key, [...(families.get(key) ?? []), slug]);
    }
  }
  for (const [key, slugs] of options.protocols === false ? [] : families) {
    const owners = new Map<string, string[]>();
    for (const slug of slugs) {
      for (const descriptor of protocols.get(slug) ?? []) {
        owners.set(descriptor.contract, [...(owners.get(descriptor.contract) ?? []), slug]);
      }
    }
    const members: Record<string, Entry> = {};
    for (const [contract, slugsOwning] of owners) {
      if (slugsOwning.length > 1) {
        const candidates = slugsOwning
          .map((slug) => `${pascalOfSlug(slug)}.${contract}`)
          .join(" or ");
        members[contract] = {
          kind: "ambiguous",
          message: `"${contract}" is ambiguous under ${key} (${slugsOwning.join(", ")}) — use ${candidates}`,
        };
        continue;
      }
      const owner = (
        globals[pascalOfSlug(slugsOwning[0]!)] as Extract<Entry, { kind: "namespace" }>
      ).members[contract]!;
      members[contract] = owner;
    }
    globals[key] = { kind: "namespace", members };
  }
  for (const [name, value] of Object.entries(scalars)) globals[name] = { kind: "const", value };

  return options.chainDefines ? { globals, defines: scalars } : { globals };
}

/** The serialized body of every chain, by chain id, for one set of caller token overrides. */
const bodies = new Map<string, string>();
function bodyText(chain: CanonicalChain, options: ExtensionsOptions, current: boolean): string {
  // Overrides apply to the chain being compiled for only: a caller's `USDC` is that chain's USDC.
  const overrides = current ? options.tokens : undefined;
  const key = JSON.stringify([
    chain.id,
    overrides ?? null,
    options.allowWidenedSelectors ?? false,
    options.protocols ?? true,
    options.self ?? true,
    options.chainDefines ?? false,
  ]);
  let text = bodies.get(key);
  if (text === undefined) {
    text = JSON.stringify(body(chain, resolveTokenMap(chain, overrides), options));
    bodies.set(key, text);
  }
  return text;
}

/** The path a chain's body is served at, for the given options. */
const bodyPath = (chain: CanonicalChain, current: boolean, options: ExtensionsOptions): string => {
  const variant = [
    current && options.tokens !== undefined ? "tokens" : "",
    options.allowWidenedSelectors ? "widened" : "",
    options.protocols === false ? "noprotocols" : "",
    options.self === false ? "noself" : "",
    options.chainDefines ? "defines" : "",
  ]
    .filter((part) => part !== "")
    .join(".");
  return `${ROOT}/chains/${chain.slug}${variant === "" ? "" : `.${variant}`}.json`;
};

/**
 * A `resolve` for the manifest of a compile for `current`: the document at {@link EXTENSIONS_PATH},
 * the ABI table and each chain's body. `undefined` for any other path.
 */
export function serveExtensions(
  current: CanonicalChain,
  options: ExtensionsOptions = {},
): (path: string) => Uint8Array | undefined {
  const utf8 = new TextEncoder();
  const document = JSON.stringify({
    version: 1,
    current: chainKey(current),
    abis: ABIS_PATH,
    types: types(),
    chains: Object.fromEntries(
      CANONICAL_CHAINS.map((chain) => [
        chainKey(chain),
        { id: chain.id, vm: chain.kind, $ref: bodyPath(chain, chain.id === current.id, options) },
      ]),
    ),
  });
  const served = new Map<string, () => string>([
    [EXTENSIONS_PATH, () => document],
    [ABIS_PATH, abis],
    ...CANONICAL_CHAINS.map(
      (chain) =>
        [
          bodyPath(chain, chain.id === current.id, options),
          () => bodyText(chain, options, chain.id === current.id),
        ] as const,
    ),
  ]);
  return (path) => {
    const text = served.get(path);
    return text === undefined ? undefined : utf8.encode(text());
  };
}
