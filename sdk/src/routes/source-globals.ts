/**
 * The names a SauceScript program compiled for one chain may use without declaring them — its
 * token symbols, protocol namespaces, chain names, defines and ambient-module functions — listed
 * from the same registries and resolvers the compile path reads, so a name listed here is one the
 * compile accepts on that chain, and its address is the one the program gets.
 *
 * - **tokens**: `token-registry.ts`'s rows for the chain, the symbols `<Sym>.transfer(...)` and a
 *   bare `USDC` resolve. On Solana they are the cluster's mints: a bare `USDC` is the mint's 32-byte
 *   key, and the token syntax is EVM-only.
 * - **protocols**: every `<Protocol>[.<Contract>]` reference the protocol-accessor rewrite resolves
 *   on the chain — through `resolveProtocolContract`, the rewrite's own resolver, not a copy of its
 *   rules — with each contract's address and vendored methods. A family alias (`Uniswap` for
 *   `UniswapV4`) lists the contracts it names unambiguously.
 * - **chains**: the chain names a program opens an intent with (`Arbitrum(() => { … })`) or
 *   qualifies an accessor by (`Base.Uniswap.UniversalRouter`).
 * - **defines**: `chainDefines(chain)`, verbatim — the scalars every program on the chain reads.
 * - **modules**: `chainAmbient(chain)`'s modules and the functions each exports for the chain's
 *   target, read from the SDK's embedded copy of their source.
 *
 * `source-globals.generated.ts` declares the same names as TYPES, across every chain at once;
 * this is the per-chain, runtime view. Reads nothing but in-memory registries, so it runs in a
 * browser.
 */
import {
  CANONICAL_CHAINS,
  requireChain,
  type CanonicalChain,
  type ChainRef,
} from "../chains/canonical.js";
import type { DescriptorMethod, StateMutability } from "../descriptors/types.js";
import { resolveSdkPackage, SDK_STD_ROOT } from "../embedded/resolve.js";
import { STD_SOURCES } from "../embedded/sources.generated.js";
import { NAMESPACE_KEYS, resolveNamespace } from "./accessor-index.js";
import { chainAmbient, chainDefines } from "./ambient.js";
import { pascalOfSlug } from "./builder.js";
import { resolveProtocolContract } from "./protocol-resolve.js";
import { svmTokenRows, TOKEN_REGISTRY } from "./token-registry.js";

export interface SourceToken {
  readonly symbol: string;
  /** The value the symbol is in a program: an EVM token's address, a Solana mint's 32-byte key. */
  readonly address: `0x${string}`;
  readonly decimals: number;
  /** On Solana, the mint's base58 address. */
  readonly mint?: string;
}

export interface SourceMethod {
  readonly name: string;
  /** Canonical signature, e.g. `exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))`. */
  readonly signature: string;
  /** The call as a program writes it, every parameter and struct field named:
   *  `exactInputSingle(params: { tokenIn: address, … }): (amountOut: uint256)`. */
  readonly declaration: string;
  readonly stateMutability: StateMutability;
}

type Param = {
  readonly name?: string;
  readonly type: string;
  readonly components?: readonly Param[];
};

/** An ABI parameter's type, a tuple spelled as the object literal a program passes for it. */
function typeOf(param: Param): string {
  const array = /^tuple((?:\[\d*\])+)$/.exec(param.type);
  if (param.type === "tuple" || array !== null) {
    const fields = (param.components ?? []).map(
      (field) => `${field.name || "_"}: ${typeOf(field)}`,
    );

    return `{ ${fields.join(", ")} }${array?.[1] ?? ""}`;
  }

  return param.type;
}

const listed = (params: readonly Param[]): string =>
  params.map((param, index) => `${param.name || `arg${index}`}: ${typeOf(param)}`).join(", ");

function declarationOf(method: DescriptorMethod): string {
  const outputs = method.outputs as readonly Param[];

  return `${method.name}(${listed(method.inputs as readonly Param[])})${
    outputs.length === 0 ? "" : `: (${listed(outputs)})`
  }`;
}

export interface SourceContract {
  readonly name: string;
  readonly address: `0x${string}`;
  /** The protocol slug the contract belongs to — another protocol's, under a family alias. */
  readonly protocol: string;
  /** True for the one contract a bare `<Protocol>.<method>(...)` calls. */
  readonly default: boolean;
  readonly methods: readonly SourceMethod[];
}

export interface SourceNamespace {
  /** The name a program writes: `UniswapV4`, or a family alias such as `Uniswap`. */
  readonly namespace: string;
  readonly kind: "protocol" | "family";
  /** The protocol slug (`uniswap-v4`); for a family, its members' slugs. */
  readonly protocols: readonly string[];
  /** The protocol's display name; for a family, its members' names joined. */
  readonly name: string;
  readonly contracts: readonly SourceContract[];
}

export interface SourceChainName {
  /** What a program writes: `Base`, `Arbitrum`. */
  readonly key: string;
  readonly slug: string;
  readonly id: number;
  readonly kind: CanonicalChain["kind"];
}

export interface SourceModule {
  /** The import specifier, e.g. `@sauce/token`, though none is needed: it is ambient. */
  readonly specifier: string;
  /** Each exported function's signature as the module declares it for the chain's target. */
  readonly functions: readonly string[];
}

export interface SourceGlobals {
  readonly chain: SourceChainName;
  readonly tokens: readonly SourceToken[];
  readonly protocols: readonly SourceNamespace[];
  readonly chains: readonly SourceChainName[];
  readonly defines: Readonly<Record<string, bigint | boolean | number>>;
  readonly modules: readonly SourceModule[];
}

const chainName = (chain: CanonicalChain): SourceChainName => ({
  key: pascalOfSlug(chain.slug),
  slug: chain.slug,
  id: chain.id,
  kind: chain.kind,
});

/** `<namespace>[.<contract>]` on `chain`, or `undefined` where the rewrite would refuse it. */
function contractOn(
  namespace: string,
  contract: string,
  chain: CanonicalChain,
  isDefault: boolean,
): SourceContract | undefined {
  let target;
  try {
    target = resolveProtocolContract(namespace, contract, chain);
  } catch {
    return undefined;
  }

  return {
    name: contract,
    address: target.address,
    protocol: target.protocol,
    default: isDefault,
    methods: target.descriptor.methods.map((method) => ({
      name: method.name,
      signature: method.signature,
      declaration: declarationOf(method),
      stateMutability: method.stateMutability,
    })),
  };
}

function namespacesOn(chain: CanonicalChain): SourceNamespace[] {
  if (chain.kind !== "evm") return [];
  const namespaces: SourceNamespace[] = [];
  for (const key of [...NAMESPACE_KEYS].sort()) {
    const ns = resolveNamespace(key)!;
    const names = ns.kind === "protocol" ? [...ns.contracts.keys()] : [...ns.contractOwners.keys()];
    const contracts = names
      .sort()
      .map((name) =>
        contractOn(key, name, chain, ns.kind === "protocol" && ns.defaultContract === name),
      )
      .filter((contract) => contract !== undefined);
    if (contracts.length === 0) continue;
    const protocols = ns.kind === "protocol" ? [ns.protocol] : [...ns.members];
    const descriptors =
      ns.kind === "protocol"
        ? [...ns.contracts.values()]
        : ns.members.flatMap((slug) => {
            const member = resolveNamespace(pascalOfSlug(slug));

            return member?.kind === "protocol" ? [...member.contracts.values()] : [];
          });
    const name = [...new Set(descriptors.map((descriptor) => descriptor.protocolName))].join(", ");
    namespaces.push({ namespace: key, kind: ns.kind, protocols, name, contracts });
  }

  return namespaces;
}

/** The functions `specifier` exports for `target`, from the SDK's embedded copy of its source. */
function moduleFunctions(specifier: string, target: CanonicalChain["kind"]): string[] {
  const entry = resolveSdkPackage(specifier);
  if (entry === undefined) return [];
  // The entry names the neutral base the compiler suffixes per target: `token.js` -> `token.evm.js`.
  const base = entry.slice(SDK_STD_ROOT.length + 1).replace(/\.js$/, "");
  const text = STD_SOURCES[`${base}.${target}.js`] ?? STD_SOURCES[`${base}.js`] ?? "";
  const signatures: string[] = [];
  for (const match of text.matchAll(/^export function (\w+)\(([^)]*)\)(?:\s*:\s*([\w[\]]+))?/gm)) {
    const params = match[2]!
      .split(",")
      .map((param) => param.trim())
      .filter((param) => param !== "")
      .join(", ");
    signatures.push(`${match[1]}(${params})${match[3] === undefined ? "" : `: ${match[3]}`}`);
  }

  return signatures;
}

/** Every name a program compiled for `chain` may use without declaring it. */
export function sourceGlobals(chain: ChainRef): SourceGlobals {
  const resolved = requireChain(chain);

  return {
    chain: chainName(resolved),
    tokens: [
      ...(resolved.kind === "evm" ? (TOKEN_REGISTRY[resolved.id] ?? []) : []).map(
        ({ symbol, address, decimals }): SourceToken => ({ symbol, address, decimals }),
      ),
      ...svmTokenRows(resolved).map(({ symbol, address, decimals, mint }): SourceToken => ({
        symbol,
        address,
        decimals,
        mint,
      })),
    ].sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0)),
    protocols: namespacesOn(resolved),
    chains: CANONICAL_CHAINS.map((other) => chainName(other as CanonicalChain)),
    defines: chainDefines(resolved),
    modules: chainAmbient(resolved).map((specifier) => ({
      specifier,
      functions: moduleFunctions(specifier, resolved.kind),
    })),
  };
}
