/**
 * The native accessor tree: `chainContracts(chainRef)` builds the lazy `Chain -> Protocol -> Contract
 * -> method` object a chain export (`Base`) or `contracts.on(ref)` carries. A walk over
 * `describeContract`/`requireContract` (query.ts) and `DESCRIPTORS` (registry.ts) — not a
 * reimplementation of either.
 *
 * Every namespace and leaf is a memoising GETTER (`Object.defineProperty`, never eager
 * construction/spread) so nothing is built until touched: 41 chains times every registry contract,
 * built eagerly on the SDK's import path, would be real cost.
 *
 * The TYPE of the tree, `ChainContracts`, is generated with the table (`contracts.generated.ts`):
 * every contract typed from its ABI, so `Base.UniswapV3.QuoterV2.quoteExactInputSingle(...)` takes
 * the ABI's arguments and its `read(client)` resolves to the ABI's outputs.
 */
import type {
  Abi,
  AbiStateMutability,
  Address,
  ContractFunctionArgs,
  ContractFunctionName,
} from "viem";
import {
  requireChain,
  type CanonicalChain,
  type ChainRef,
  type ChainSlug,
} from "../chains/canonical.js";
import { pascalOfSlug } from "../routes/pascal.js";
import { makeContractCall, type ContractCall } from "./call.js";
import type { ChainContracts } from "./contracts.generated.js";
import { addressOn, methodOf, requireContract } from "./query.js";
import { DESCRIPTORS } from "./registry.js";
import type { ContractCoverage, ContractDescriptor, DescriptorMethod } from "./types.js";

export type { ChainContracts };

/**
 * One leaf's own properties: a (protocol, contract) on a specific chain. Its methods are separate
 * (`ContractMethods`): {@link Contract} is the two together. A type rather than an interface, so a
 * contract typed from its ABI is assignable to the untyped {@link Contract}.
 */
export type ContractAccessor<TAbi extends Abi = Abi> = {
  readonly descriptor: ContractDescriptor;
  readonly chain: CanonicalChain;
  /** `undefined` when this contract has no address on `chain` (a hole), or for an unbound `kind:"interface"`. */
  readonly address: Address | undefined;
  readonly available: boolean;
  readonly chains: readonly ChainSlug[];
  readonly coverage: ContractCoverage;
  readonly abi: TAbi;
  readonly methods: readonly DescriptorMethod[];
  /** Rebinds this accessor to a specific instance address — REQUIRED for `kind:"interface"`, an optional override otherwise. */
  at(address: Address): Contract<TAbi>;
};

/** The names of `TAbi`'s functions with one of the mutabilities `M`. */
export type FunctionNameOf<
  TAbi extends Abi,
  M extends AbiStateMutability = AbiStateMutability,
> = Extract<TAbi[number], { readonly type: "function"; readonly stateMutability: M }>["name"];

/** One ABI method: takes the ABI's arguments and returns the call, typed from the ABI. */
export type ContractMethod<TAbi extends Abi, TName extends ContractFunctionName<TAbi>> = <
  const TArgs extends ContractFunctionArgs<TAbi, AbiStateMutability, TName> & readonly unknown[],
>(
  ...args: TArgs
) => ContractCall<TAbi, TName, TArgs>;

/** Every function of `TAbi`, by its ABI name. An untyped ABI has an index of `unknown` instead. */
export type ContractMethods<TAbi extends Abi> = Abi extends TAbi
  ? { readonly [method: string]: unknown }
  : { readonly [N in FunctionNameOf<TAbi> & ContractFunctionName<TAbi>]: ContractMethod<TAbi, N> };

/** A contract with an ABI: its accessor properties and its methods. */
export type Contract<TAbi extends Abi = Abi> = ContractAccessor<TAbi> & ContractMethods<TAbi>;

/** A contract the registry has an address for and no ABI: `.address` and `.available`, no methods. */
export type AddressOnlyContract = ContractAccessor<readonly []>;

/** An ABI with no fixed address: bind a deployment with `.at(address)` to call it. */
export type InterfaceContract<TAbi extends Abi> = ContractAccessor<TAbi>;

/** The accessor's own properties: a method of the same name would shadow one, which the generator
 *  refuses and `buildAccessor` re-checks. */
const ACCESSOR_PROPERTIES: ReadonlySet<string> = new Set([
  "descriptor",
  "chain",
  "address",
  "available",
  "chains",
  "coverage",
  "abi",
  "methods",
  "at",
]);

function buildAccessor(
  descriptor: ContractDescriptor,
  chain: CanonicalChain,
  addressOverride?: Address,
): Contract {
  const isInterface = descriptor.kind === "interface";
  const resolvedAddress: Address | undefined =
    addressOverride ?? (isInterface ? undefined : addressOn(descriptor, chain));
  const available = isInterface ? addressOverride !== undefined : resolvedAddress !== undefined;

  const base: Record<string, unknown> = {
    descriptor,
    chain,
    address: resolvedAddress,
    available,
    chains: descriptor.chains,
    coverage: descriptor.coverage,
    abi: descriptor.abi,
    methods: descriptor.methods,
    at(newAddress: Address): Contract {
      return buildAccessor(descriptor, chain, newAddress);
    },
  };

  // An overloaded name dispatches on argument count, so the call reports the overload it encodes.
  // `descriptors-linkage.test.ts` holds every descriptor's overloads to distinct counts.
  const byName = new Map<string, DescriptorMethod[]>();
  for (const method of descriptor.methods) {
    byName.set(method.name, [...(byName.get(method.name) ?? []), method]);
  }
  for (const [name, overloads] of byName) {
    if (ACCESSOR_PROPERTIES.has(name)) {
      throw new Error(
        `${descriptor.protocol}.${descriptor.contract}.${name} would shadow the accessor's own '${name}'`,
      );
    }
    base[name] = (...args: unknown[]): ContractCall => {
      const method =
        overloads.length === 1 ? overloads[0]! : methodOf(descriptor, name, args.length);
      if (method === undefined) {
        throw new Error(
          `${descriptor.protocol}.${descriptor.contract}.${name} takes ` +
            `${overloads.map((candidate) => candidate.inputs.length).join(" or ")} arguments, got ${args.length}`,
        );
      }
      let address = resolvedAddress;
      if (address === undefined) {
        if (isInterface) {
          throw new Error(
            `${descriptor.protocol}.${descriptor.contract} is an interface descriptor (no fixed address) — bind an instance first: .at('0x…').${method.name}(...)`,
          );
        }
        // Reuses requireContract's exact, established hole-error message
        // rather than re-deriving it here.
        const resolved = requireContract(chain, descriptor.protocol, descriptor.contract);
        address = resolved.address;
      }
      if (address === undefined) {
        throw new Error(
          `${descriptor.protocol}.${descriptor.contract}: no address resolved on '${chain.slug}'`,
        );
      }
      return makeContractCall(descriptor, chain, address, method, args);
    };
  }

  return base as Contract;
}

/** protocol slug (exact, as declared in CONTRACT_LINKS) -> its descriptors, insertion order. */
const protocolGroups: ReadonlyMap<string, readonly ContractDescriptor[]> = (() => {
  const map = new Map<string, ContractDescriptor[]>();
  for (const d of DESCRIPTORS) {
    const list = map.get(d.protocol);
    if (list) list.push(d);
    else map.set(d.protocol, [d]);
  }
  return map;
})();

const protocolSlugs: readonly string[] = [...protocolGroups.keys()];

/** `"uniswap-v4"` -> `"uniswap"`; a slug with no trailing `-v<N>` yields `undefined` (no family alias). */
function familyStem(slug: string): string | undefined {
  const m = /^(.+)-v\d+$/.exec(slug);
  return m ? m[1] : undefined;
}

/** family alias key (PascalCase) -> member protocol slugs, insertion order. */
const familyMembers: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const slug of protocolSlugs) {
    const stem = familyStem(slug);
    if (stem === undefined) continue;
    const key = pascalOfSlug(stem);
    const list = map.get(key);
    if (list) list.push(slug);
    else map.set(key, [slug]);
  }
  return map;
})();

/**
 * Builds the whole lazy tree for one resolved chain. Every canonical
 * protocol namespace is memoised once per `chainContracts` call, so a family
 * alias resolving a non-ambiguous name (`Base.Uniswap.UniversalRouter`)
 * forwards to the EXACT SAME accessor object as the canonical path
 * (`Base.UniswapV4.UniversalRouter`) — verified by identity in
 * `test/descriptors-accessors.test.ts`.
 */
export function chainContracts(chainRef: ChainRef): ChainContracts {
  const chain = requireChain(chainRef);
  const protocolNamespaceCache = new Map<string, Record<string, Contract>>();

  function protocolNamespace(slug: string): Record<string, Contract> {
    const cached = protocolNamespaceCache.get(slug);
    if (cached !== undefined) return cached;
    const ns: Record<string, Contract> = {};
    for (const d of protocolGroups.get(slug) ?? []) {
      let memo: Contract | undefined;
      Object.defineProperty(ns, d.contract, {
        enumerable: true,
        configurable: true,
        get(): Contract {
          if (memo === undefined) memo = buildAccessor(d, chain);
          return memo;
        },
      });
    }
    protocolNamespaceCache.set(slug, ns);
    return ns;
  }

  function buildFamilyNamespace(
    familyKey: string,
    members: readonly string[],
  ): Record<string, unknown> {
    const ownersByContract = new Map<string, string[]>();
    for (const slug of members) {
      for (const d of protocolGroups.get(slug) ?? []) {
        const owners = ownersByContract.get(d.contract);
        if (owners) owners.push(slug);
        else ownersByContract.set(d.contract, [slug]);
      }
    }
    const out: Record<string, unknown> = {};
    for (const [contractName, owners] of ownersByContract) {
      if (owners.length === 1) {
        const owner = owners[0]!;
        Object.defineProperty(out, contractName, {
          enumerable: true,
          configurable: true,
          get: () => protocolNamespace(owner)[contractName],
        });
      } else {
        Object.defineProperty(out, contractName, {
          enumerable: true,
          configurable: true,
          get(): never {
            const candidates = owners.map((s) => `${pascalOfSlug(s)}.${contractName}`).join(" or ");
            throw new Error(
              `"${contractName}" is ambiguous under ${familyKey} (${owners.join(", ")}) — use ${candidates}`,
            );
          },
        });
      }
    }
    return out;
  }

  const out: Record<string, unknown> = {};

  for (const slug of protocolSlugs) {
    const key = pascalOfSlug(slug);
    if (key in out) {
      throw new Error(`descriptors: duplicate protocol namespace '${key}' (from slug '${slug}')`);
    }
    Object.defineProperty(out, key, {
      enumerable: true,
      configurable: true,
      get: () => protocolNamespace(slug),
    });
  }

  for (const [familyKey, members] of familyMembers) {
    if (familyKey in out) {
      throw new Error(
        `descriptors: family alias '${familyKey}' collides with a canonical protocol namespace`,
      );
    }
    let memo: Record<string, unknown> | undefined;
    Object.defineProperty(out, familyKey, {
      enumerable: true,
      configurable: true,
      get: () => {
        if (memo === undefined) memo = buildFamilyNamespace(familyKey, members);
        return memo;
      },
    });
  }

  return out as unknown as ChainContracts;
}

/** Chain-ref front door: `contracts.on('base').Uniswap.UniversalRouter.execute(...)` — for a
 *  caller resolving the chain at run time rather than importing the `Base` accessor. */
export function on(chainRef: ChainRef): ChainContracts {
  return chainContracts(chainRef);
}
