/**
 * The E2.3 native accessor tree: `chainContracts(chainRef)` builds the lazy
 * `Chain -> Protocol -> Contract -> method` object a chain global (`Base`)
 * or `contracts.on(ref)` exposes. A walk over `describeContract`/
 * `requireContract` (query.ts) and `DESCRIPTORS` (registry.ts) — not a
 * reimplementation of either.
 *
 * Every namespace and leaf is a memoising GETTER (`Object.defineProperty`,
 * never eager construction/spread) so nothing is built until touched — see
 * the design doc's laziness note for why that matters (39 chains x ~29
 * contracts eagerly built on the SDK's import path would be real cost).
 */
import type { Address, Abi } from "viem";
import {
  requireChain,
  type CanonicalChain,
  type ChainRef,
  type ChainSlug,
} from "../chains/canonical.js";
import { pascalOfSlug } from "../routes/builder.js";
import { makeContractCall, type ContractCall } from "./call.js";
import { addressOn, requireContract } from "./query.js";
import { DESCRIPTORS } from "./registry.js";
import type { ContractCoverage, ContractDescriptor, DescriptorMethod } from "./types.js";
import type {
  FamilyContracts,
  FamilyKey,
  ContractNameOf,
  PascalOf,
  ProtocolSlug,
} from "./names.js";

/**
 * One leaf: a bound (protocol, contract) on a specific chain, plus every
 * real ABI method as a callable producing a `ContractCall`. Method names are
 * NOT part of the static type (kept loose as `unknown` via the index
 * signature below) — they are derived from the descriptor's real ABI at
 * BUILD time, so `Base.UniswapV4.UniversalRouter.execute(...)` resolves a
 * real method and `.exactIn` is `undefined`, matching E2.2's "surface what
 * exists, invent nothing" stance.
 */
export interface ContractAccessor {
  readonly descriptor: ContractDescriptor;
  readonly chain: CanonicalChain;
  /** `undefined` when this contract has no address on `chain` (a hole), or for an unbound `kind:"interface"`. */
  readonly address: Address | undefined;
  readonly available: boolean;
  readonly chains: readonly ChainSlug[];
  readonly coverage: ContractCoverage;
  readonly abi: Abi;
  readonly methods: readonly DescriptorMethod[];
  /** Rebinds this accessor to a specific instance address — REQUIRED for `kind:"interface"`, an optional override otherwise. */
  at(address: Address): ContractAccessor;
  readonly [method: string]: unknown;
}

/**
 * The whole typed tree `chainContracts(...)` returns — chain-INDEPENDENT by
 * design (per-chain address presence is runtime data, not literally typed;
 * see the design doc's `ChainContracts` note), so it instantiates once
 * regardless of how many chain globals intersect it.
 */
export type ChainContracts = {
  readonly [P in ProtocolSlug as PascalOf<P>]: {
    readonly [C in ContractNameOf<P>]: ContractAccessor;
  };
} & {
  readonly [F in FamilyKey]: { readonly [C in FamilyContracts<F>]: ContractAccessor };
};

function buildAccessor(
  descriptor: ContractDescriptor,
  chain: CanonicalChain,
  addressOverride?: Address,
): ContractAccessor {
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
    at(newAddress: Address): ContractAccessor {
      return buildAccessor(descriptor, chain, newAddress);
    },
  };

  for (const method of descriptor.methods) {
    base[method.name] = (...args: unknown[]): ContractCall => {
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

  return base as ContractAccessor;
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
  const protocolNamespaceCache = new Map<string, Record<string, ContractAccessor>>();

  function protocolNamespace(slug: string): Record<string, ContractAccessor> {
    const cached = protocolNamespaceCache.get(slug);
    if (cached !== undefined) return cached;
    const ns: Record<string, ContractAccessor> = {};
    for (const d of protocolGroups.get(slug) ?? []) {
      let memo: ContractAccessor | undefined;
      Object.defineProperty(ns, d.contract, {
        enumerable: true,
        configurable: true,
        get(): ContractAccessor {
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
