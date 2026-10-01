/**
 * How a protocol reference — `UniswapV3.Factory`, a family's `Uniswap.UniversalRouter`, a
 * chain-qualified `Arbitrum.UniswapV3.Factory` — resolves against the descriptor registry, and the
 * named error each wrong one gets. The compiler resolves a program's references itself, from the
 * extensions manifest (`extensions.ts`); this is the same resolution for the SDK's own listings
 * (`source-globals.ts`), so a listing and a compile cannot disagree.
 */
import type { Address } from "viem";

import { requireChain, type CanonicalChain } from "../chains/canonical.js";
import { addressOn } from "../descriptors/query.js";
import type { ContractDescriptor } from "../descriptors/types.js";
import { pascalOfSlug } from "./accessors.js";
import { chainSlugForKey, isChainKey, resolveNamespace, type Namespace } from "./accessor-index.js";

/** What `SauceCompileOptions.accessors` configures. */
export interface AccessorOptions {
  /** Allows a `typeFidelity: "widened"` descriptor (vendored ABI, real selector mismatch) to be
   *  called anyway. Default `false` — a widened descriptor is refused with a named error quoting
   *  `descriptor.coverage.caveats`, since rewriting it would compile cleanly and then revert on
   *  chain inside a value-carrying intent. */
  allowWidenedSelectors?: boolean;
  /** Gives the program a bare `self`, the account it runs as. Default `true`. */
  selfSugar?: boolean;
  /**
   * Told each contract reference a compile resolved, with what it resolved to. NOT CALLED YET: the
   * compiler resolves the references itself, from the extensions manifest, and does not report them
   * — the `sauce compile` report's `contracts` waits on it.
   */
  onContract?: (reference: string, target: AccessorTarget) => void;
}

function fail(message: string): never {
  throw new Error(`${message}`);
}

/** Resolves a (protocol slug, contract name) pair against `resolveNamespace`'s namespace -- for a
 *  `"protocol"` namespace the contract must be named directly (shape A) or defaulted (shape B, only
 *  when the protocol links exactly one contract); for a `"family"` namespace the contract must be
 *  named directly and unambiguously owned by exactly one member. */
function resolveContractDescriptor(
  ns: Namespace,
  contractName: string | undefined,
  headForError: string,
): {
  readonly protocol: string;
  readonly contract: string;
  readonly descriptor: ContractDescriptor;
} {
  if (ns.kind === "protocol") {
    const contract = contractName ?? ns.defaultContract;
    if (contract === undefined) {
      const known = [...ns.contracts.keys()].join(", ");
      fail(
        `'${headForError}.${contractName ?? "<method>"}(...)' has no default contract (protocol '${ns.protocol}' ` +
          `links more than one contract: ${known}) — use '${headForError}.<Contract>.<method>(...)' instead`,
      );
    }
    const descriptor = ns.contracts.get(contract);
    if (descriptor === undefined) {
      const known = [...ns.contracts.keys()].join(", ");
      fail(`Unknown contract '${contract}' in protocol '${ns.protocol}' (known: ${known})`);
    }
    return { protocol: ns.protocol, contract, descriptor };
  }

  if (contractName === undefined) {
    fail(
      `'${headForError}.<method>(...)' -- family alias '${ns.familyKey}' has no default contract; ` +
        `use '${headForError}.<Contract>.<method>(...)'`,
    );
  }
  const owners = ns.contractOwners.get(contractName);
  if (owners === undefined || owners.length === 0) {
    const known = [...ns.contractOwners.keys()].join(", ");
    fail(
      `Unknown contract '${contractName}' under family alias '${ns.familyKey}' (known: ${known})`,
    );
  }
  if (owners.length > 1) {
    const candidates = owners.map((slug) => `${pascalOfSlug(slug)}.${contractName}`).join(" or ");
    fail(
      `"${contractName}" is ambiguous under ${ns.familyKey} (${owners.join(", ")}) — use ${candidates}`,
    );
  }
  const protocol = owners[0]!;
  // Re-derive via a fresh protocol-namespace lookup so the descriptor comes from the SAME
  // registry-derived map every other path uses (never a second, hand-rolled lookup).
  const memberNs = resolveNamespace(pascalOfSlug(protocol));
  if (memberNs === undefined || memberNs.kind !== "protocol") {
    fail(`internal: family member '${protocol}' has no protocol namespace`);
  }
  const descriptor = memberNs.contracts.get(contractName);
  if (descriptor === undefined) {
    fail(`Unknown contract '${contractName}' in protocol '${protocol}'`);
  }
  return { protocol, contract: contractName, descriptor };
}

export interface AccessorTarget {
  readonly chain: CanonicalChain;
  readonly protocol: string;
  readonly contract: string;
  readonly descriptor: ContractDescriptor;
  readonly address: Address;
}

/** Resolves the (chain, protocol, contract, descriptor, deployed address) a namespace member chain
 *  points at -- shared by the CALL path (`path` ends with the method, `hasMethod`) and the bare
 *  VALUE path (`path` IS the whole `<Protocol>[.<Contract>]` / `<Chain>.<Protocol>[.<Contract>]`
 *  contract reference). Both apply the IDENTICAL shape rules, guards and named errors, so
 *  `Base.UniswapV3.UniversalRouter` resolves to the same address whether it is called or used as a
 *  value. `hasMethod` only changes whether a trailing segment is stripped and the wording of the
 *  shape/interface errors (which still say "call" for a call). */
function resolveAccessorTarget(
  head: string,
  path: readonly string[],
  hasMethod: boolean,
  enclosingChain: CanonicalChain,
  chainScope: ReadonlySet<number> | undefined,
  allowWidenedSelectors: boolean,
): AccessorTarget {
  const contractSegs = hasMethod ? path.slice(0, path.length - 1) : path; // strip a trailing method
  const shown = hasMethod ? `${head}.${path.join(".")}(...)` : `${head}.${path.join(".")}`;
  const suffix = hasMethod ? ".<method>(...)" : "";
  const { chain, namespaceHead, protocol, contract, descriptor } = resolveContractReference(
    head,
    contractSegs,
    enclosingChain,
    chainScope,
    `'${shown}'`,
    suffix,
  );

  if (descriptor.kind === "address-only" && hasMethod) {
    fail(
      `${protocol}.${contract} has an address but no ABI vendored for this role (kind: "address-only") — ` +
        `its address is '${namespaceHead}.${contract}'; see descriptor.coverage.caveats`,
    );
  }
  if (descriptor.kind === "interface") {
    fail(
      `${protocol}.${contract} is an interface descriptor (no fixed address) — bind the deployment ` +
        `to ${hasMethod ? "call" : "use"}: '${namespaceHead}.${contract}.at(<address>).<method>(...)'`,
    );
  }
  if (descriptor.coverage.typeFidelity === "widened" && !allowWidenedSelectors) {
    fail(
      `${protocol}.${contract}'s vendored ABI is "widened" (computed selectors do NOT match the deployed ` +
        `contract) — ${descriptor.coverage.caveats.join("; ")} — pass accessors: { allowWidenedSelectors: true } ` +
        "to call it anyway",
    );
  }

  const address: Address | undefined = addressOn(descriptor, chain);
  if (address === undefined) {
    const known = descriptor.chains.length > 0 ? descriptor.chains.join(", ") : "(none)";
    fail(
      `Contract '${contract}' (${protocol}) is not deployed on '${chain.slug}' (available: ${known})`,
    );
  }

  return { chain, protocol, contract, descriptor, address };
}

/** A contract reference resolved to its descriptor and the chain it is read on. */
export interface ContractReference {
  readonly chain: CanonicalChain;
  /** The namespace the reference names (`Uniswap`, `UniswapV4`), for messages. */
  readonly namespaceHead: string;
  readonly protocol: string;
  readonly contract: string;
  readonly descriptor: ContractDescriptor;
}

/**
 * Resolves `<Protocol|Family>[.<Contract>]` (`head` and `contractSegs`), or
 * `<Chain>.<Protocol>[.<Contract>]`, to its descriptor and chain — whether or not the contract is
 * deployed there, which is the caller's question. `shown` and `suffix` word the shape error.
 */
export function resolveContractReference(
  head: string,
  contractSegs: readonly string[],
  enclosingChain: CanonicalChain,
  chainScope: ReadonlySet<number> | undefined,
  shown: string,
  suffix: string,
): ContractReference {
  let chain: CanonicalChain;
  let nsSegments: readonly string[];
  let namespaceHead: string;

  if (isChainKey(head)) {
    // shapes C/D: <Chain>.<Protocol>[.<Contract>]
    const slug = chainSlugForKey(head);
    if (slug === undefined) fail(`internal: chain key '${head}' has no chain slug`);
    chain = requireChain(slug);
    if (chainScope !== undefined && !chainScope.has(chain.id)) {
      fail(`chain '${chain.slug}' (referenced as '${head}....') is outside the allowed chainScope`);
    }
    if (contractSegs.length < 1 || contractSegs.length > 2) {
      fail(`${shown} -- expected '${head}.<Protocol>[.<Contract>]${suffix}'`);
    }
    namespaceHead = contractSegs[0]!;
    nsSegments = contractSegs.slice(1); // [] (default contract) or [Contract]
  } else {
    // shapes A/B: <Protocol|Family>[.<Contract>]
    chain = enclosingChain;
    namespaceHead = head;
    nsSegments = contractSegs; // [] (default contract) or [Contract]
  }

  const ns = resolveNamespace(namespaceHead);
  if (ns === undefined) {
    fail(`'${namespaceHead}' is not a known protocol or family alias`);
  }
  const contractName = nsSegments[0];

  const { protocol, contract, descriptor } = resolveContractDescriptor(
    ns,
    contractName,
    namespaceHead,
  );
  return { chain, namespaceHead, protocol, contract, descriptor };
}

/**
 * The deployed contract `<namespace>[.<contract>]` names on `chain` — or the error a reference to it
 * gets. A name this resolves is one a program compiled for `chain` may use; `sourceGlobals` lists a
 * chain's contracts through it.
 */
export function resolveProtocolContract(
  namespace: string,
  contract: string | undefined,
  chain: CanonicalChain,
): AccessorTarget {
  return resolveAccessorTarget(
    namespace,
    contract === undefined ? [] : [contract],
    false,
    chain,
    undefined,
    false,
  );
}
