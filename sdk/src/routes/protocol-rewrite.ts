/**
 * Resolve EVM protocol accessors against the destination chain's descriptor registry.
 *
 * For example, a Base route's `Uniswap.UniversalRouter.execute(...)` becomes
 * `IUniswapV4_UniversalRouter.at(<base-address>).execute(...)`, with the descriptor's ABI supplied
 * as a compiler binding. Bare `self` is rewritten to `ctx.self()` in the same pass.
 *
 * Recognized call shapes:
 *   (A) `<Protocol>.<Contract>.<method>(...)`        — enclosing chain
 *   (B) `<Protocol>.<method>(...)`                   — enclosing chain, single default contract
 *   (C) `<Chain>.<Protocol>.<Contract>.<method>(...)` — explicitly named chain
 *   (D) `<Chain>.<Protocol>.<method>(...)`            — named chain, single default contract
 *   (E) `<Protocol>.<Contract>.at(<address>).<method>(...)` — the contract's ABI at another
 *       address: how an interface (an ABI with no fixed address, `Erc4626.Vault`) is called, and
 *       how a deployed contract's ABI reaches another deployment
 *   (F) `<Protocol>.<Interface>(<address>).<method>(...)` — an interface called with the address
 *       it is bound to, the same as shape E: `UniswapV3.Pool(pool).liquidity()`. Only an
 *       interface binds this way; a deployed contract's name called with an address is refused
 * and, in value position, `<Protocol>.<Contract>` / `<Chain>.<Protocol>.<Contract>` is the
 * contract's address on that chain — an address-only contract included.
 *
 * Chain qualification chooses an address; it does not change the execution chain. `chainScope`
 * optionally restricts the chains that may be named.
 *
 * This pass returns a parsed-ABI `contracts` map. The route compiler merges it with caller
 * bindings, and `rs-compile.ts` adapts the map to the published compiler's `inlineContracts`
 * option. No temporary ABI files or filesystem imports are needed for these bindings.
 *
 * Unrecognized or shadowed root names are left untouched. Once a registry root is recognized,
 * unsupported contracts, missing deployments/methods, widened ABIs, ambiguous family aliases,
 * binding collisions, and out-of-scope chains produce explicit errors.
 */
import type { Address } from "viem";
import type { ContractsConfig } from "./compile-types.js";

import { requireChain, type CanonicalChain, type ChainRef } from "../chains/canonical.js";
import { addressOn } from "../descriptors/query.js";
import type { ContractDescriptor, DescriptorMethod } from "../descriptors/types.js";
import { formatBigint } from "../deposit/format.js";
import { walk, collectDeclaredNames, type AstNode } from "./ast-walk.js";
import { pascalOfSlug } from "./builder.js";
import {
  chainSlugForKey,
  isChainKey,
  namedContractKind,
  resolveNamespace,
  type Namespace,
} from "./accessor-index.js";
import { parseSauce } from "./parse.js";

export interface ProtocolRewriteOptions {
  /** Allows a `typeFidelity: "widened"` descriptor (vendored ABI, real selector mismatch) to be
   *  rewritten anyway. Default `false` — a widened descriptor is refused with a named error quoting
   *  `descriptor.coverage.caveats`, since rewriting it would compile cleanly and then revert on
   *  chain. */
  allowWidenedSelectors?: boolean;
  /** Restricts a chain-QUALIFIED accessor (shapes C/D) to a named allowlist. Default: any canonical
   *  chain. */
  chainScope?: readonly ChainRef[];
  /** Rewrites bare `self` -> `ctx.self()` in read position. Default `true`. */
  selfSugar?: boolean;
  /** Caller-supplied `compile.contracts` bundle this rewrite's own synthesized bindings must not
   *  silently collide with (a same-name entry with a DIFFERENT ABI throws). */
  existingContracts?: Readonly<ContractsConfig>;
  /**
   * Told each contract reference the rewrite resolved — a call (`UniswapV3.Factory.getPool(…)`) or a
   * value (`Cctp.TokenMessenger`) — with the reference as written and what it resolved to: which
   * chain's deployment, and its address.
   */
  onContract?: (reference: string, target: AccessorTarget) => void;
}

export interface ProtocolRewriteResult {
  readonly source: string;
  /** True if at least one accessor or `self` site was rewritten. */
  readonly rewrote: boolean;
  /** One entry per REFERENCED descriptor -- merge straight into `compile()`'s own `contracts`. */
  readonly contracts: ContractsConfig;
  /** Count of accessor call sites rewritten (excludes `self` sites) -- for tests/diagnostics. */
  readonly accessorSites: number;
  /** Count of bare `self` sites rewritten. */
  readonly selfSites: number;
  /** Count of bare `<Protocol>.<Contract>` VALUE-position sites resolved to an address literal. */
  readonly valueAccessSites: number;
}

interface Splice {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

function fail(message: string): never {
  throw new Error(`rewriteProtocolAccessors: ${message}`);
}

/** Decomposes a non-computed member-access chain rooted at a bare Identifier into its head name
 *  plus the ordered property-name path (the LAST element is always the method name). Returns
 *  `undefined` for anything outside that shape (a computed member, `this`, a call/paren in the
 *  middle, …) -- such a chain is simply not a candidate, not an error. */
export function decomposeMemberChain(
  node: AstNode,
): { readonly head: string; readonly path: readonly string[] } | undefined {
  if (node.type === "Identifier") {
    return { head: (node as unknown as { name: string }).name, path: [] };
  }
  if (node.type !== "MemberExpression") return undefined;
  const computed = (node as { computed?: boolean }).computed;
  if (computed) return undefined;
  const object = (node as { object?: AstNode }).object;
  const property = (node as { property?: AstNode }).property;
  if (!object || !property || property.type !== "Identifier") return undefined;
  const inner = decomposeMemberChain(object);
  if (inner === undefined) return undefined;
  return {
    head: inner.head,
    path: [...inner.path, (property as unknown as { name: string }).name],
  };
}

interface AccessorCandidate {
  readonly calleeStart: number;
  readonly calleeEnd: number;
  readonly head: string;
  readonly path: readonly string[];
}

function collectAccessorCandidates(
  program: AstNode,
  shadowed: ReadonlySet<string>,
): AccessorCandidate[] {
  const out: AccessorCandidate[] = [];
  walk(program, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = (n as { callee?: AstNode }).callee;
    if (!callee || callee.type !== "MemberExpression") return;
    const decomposed = decomposeMemberChain(callee);
    if (decomposed === undefined) return;
    const { head, path } = decomposed;
    if (path.length < 1 || (path.length > 2 && !isChainKey(head))) return;
    if (shadowed.has(head)) return;
    // Only a recognized head (namespace key or chain key) is a candidate at all -- an unrecognized
    // head is left completely untouched (isolation).
    if (!isChainKey(head) && resolveNamespace(head) === undefined) return;
    if (path.length < 1 || path.length > 3) return;
    // `<…>.<Contract>.at(<address>)`: shape E, and `<…>.<Interface>(<address>)`: shape F, which
    // `collectBoundCandidates` owns.
    if (path.length >= 2 && path[path.length - 1] === "at") return;
    const named = namedContractKind(head, path);
    if (named === "interface") return;
    if (named !== undefined) {
      const shown = `${head}.${path.join(".")}`;
      fail(
        `'${shown}(...)' calls a deployed contract's name: call one of its methods, ` +
          `'${shown}.<method>(...)', or bind its ABI to another address with ` +
          `'${shown}.at(<address>).<method>(...)'. Only an interface is called with an address.`,
      );
    }
    out.push({ calleeStart: callee.start, calleeEnd: callee.end, head, path });
  });
  return out;
}

interface BoundCandidate {
  /** The `<…>.<Contract>.at` (or `<…>.<Interface>`) callee of the binding call, which the rewrite
   *  replaces. */
  readonly calleeStart: number;
  readonly calleeEnd: number;
  readonly head: string;
  /** The contract path, without the trailing `at`. */
  readonly path: readonly string[];
  /** The method called on the bound contract. */
  readonly method: string;
  /** The binding as the program spells it, for messages: `UniswapV3.Pool.at` or `UniswapV3.Pool`. */
  readonly spelled: string;
}

/**
 * Collects shape E, `<…>.<Contract>.at(<address>).<method>(...)`, and shape F,
 * `<…>.<Interface>(<address>).<method>(...)`. The binding call has to be the object of a method
 * call, because a bound contract is not a value Sauce can hold: anything else spelled
 * `<…>.<Contract>.at(...)` or `<…>.<Interface>(...)` on a recognized namespace is refused by name.
 */
function collectBoundCandidates(program: AstNode, shadowed: ReadonlySet<string>): BoundCandidate[] {
  const calledOn = new Map<AstNode, string>();
  walk(program, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = (n as { callee?: AstNode }).callee;
    if (callee?.type !== "MemberExpression" || (callee as { computed?: boolean }).computed) return;
    const object = (callee as { object?: AstNode }).object;
    const property = (callee as { property?: AstNode }).property;
    if (object?.type === "CallExpression" && property?.type === "Identifier") {
      calledOn.set(object, (property as unknown as { name: string }).name);
    }
  });

  const out: BoundCandidate[] = [];
  walk(program, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = (n as { callee?: AstNode }).callee;
    if (!callee || callee.type !== "MemberExpression") return;
    const decomposed = decomposeMemberChain(callee);
    if (decomposed === undefined) return;
    const { head, path } = decomposed;
    if (shadowed.has(head)) return;
    if (!isChainKey(head) && resolveNamespace(head) === undefined) return;
    const viaAt = path.length >= 2 && path[path.length - 1] === "at";
    if (!viaAt && namedContractKind(head, path) !== "interface") return;
    const shown = `${head}.${path.join(".")}(...)`;
    const method = calledOn.get(n);
    if (method === undefined) {
      fail(
        `'${shown}' binds a contract to an address, which is not a value — call a method on it in ` +
          `the same expression: '${shown}.<method>(...)'`,
      );
    }
    if ((n as { arguments?: unknown[] }).arguments?.length !== 1) {
      fail(`'${shown}' takes exactly one argument, the address to bind`);
    }
    out.push({
      calleeStart: callee.start,
      calleeEnd: callee.end,
      head,
      path: viaAt ? path.slice(0, -1) : path,
      method,
      spelled: `${head}.${path.join(".")}`,
    });
  });
  return out;
}

/**
 * Collects bare `<Protocol|Family>.<Contract>` accessors used in VALUE position -- e.g. the spender
 * of `USDC.approve(Cctp.TokenMessenger, amount)`, where `Cctp.TokenMessenger` is an ADDRESS, not a
 * `.method(...)` call. The CALL pass above only ever owns a member chain that is a call's callee, so
 * without this a bare accessor value reached the compiler as an unresolved property access and
 * failed (`property 'TokenMessenger' access not supported`). Each resolved site becomes the SAME
 * on-chain address literal the call path binds `.at(...)` to, so the dot spelling is now usable as a
 * value everywhere the underscore ambient define (`Cctp_TokenMessenger`, ambient.ts#chainDefines)
 * already was -- the two are equivalent, dot is just the accessor-consistent spelling.
 *
 * A "value" site is a terminal 2-segment member access: NOT the object of a longer chain and NOT a
 * call's callee (both of which the CALL pass -- or a genuine `.method` chain -- already own). Only a
 * recognized namespace head is ever touched (isolation); an unresolvable-but-recognized head still
 * fails closed with the same named errors as the call path (unknown/undeployed/interface contract).
 */
function collectValueAccessSites(
  program: AstNode,
  shadowed: ReadonlySet<string>,
  enclosingChain: CanonicalChain,
  chainScope: ReadonlySet<number> | undefined,
  allowWidenedSelectors: boolean,
  onContract?: ProtocolRewriteOptions["onContract"],
): Splice[] {
  // A node that is the `.object` of a member access, or a call's `.callee`, is part of a longer
  // chain the CALL pass (or an ordinary `.method` access) already owns -- never a terminal value.
  const nonTerminal = new Set<AstNode>();
  walk(program, (n) => {
    if (n.type === "MemberExpression" && !(n as { computed?: boolean }).computed) {
      const object = (n as { object?: AstNode }).object;
      if (object) nonTerminal.add(object);
    }
    if (n.type === "CallExpression") {
      const callee = (n as { callee?: AstNode }).callee;
      if (callee) nonTerminal.add(callee);
    }
  });

  const sites: Splice[] = [];
  walk(program, (n) => {
    if (n.type !== "MemberExpression" || (n as { computed?: boolean }).computed) return;
    if (nonTerminal.has(n)) return; // object of a longer chain / a call callee -> not a terminal value
    const decomposed = decomposeMemberChain(n);
    if (decomposed === undefined) return;
    const { head, path } = decomposed;
    if (shadowed.has(head)) return;
    // Isolation: only a recognized head (chain key or protocol/family namespace) is ever claimed.
    const chainKey = isChainKey(head);
    if (!chainKey && resolveNamespace(head) === undefined) return;
    // Shape gate mirroring the call collector, minus the method: a protocol head is exactly
    // `<Protocol>.<Contract>` (path 1); a chain head is `<Chain>.<Protocol>[.<Contract>]` (path 1-2).
    if (chainKey ? path.length < 1 || path.length > 2 : path.length !== 1) return;
    const target = resolveAccessorTarget(
      head,
      path,
      false,
      enclosingChain,
      chainScope,
      allowWidenedSelectors,
    );
    onContract?.([head, ...path].join("."), target);
    sites.push({ start: n.start, end: n.end, replacement: formatBigint(BigInt(target.address)) });
  });
  return sites;
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

/** The first overload of `name`. It only decides `.view` vs `.at`, which every overload of a name
 *  agrees on (`descriptors-linkage.test.ts`); the compiler picks the overload by argument count. */
function methodByName(descriptor: ContractDescriptor, name: string): DescriptorMethod | undefined {
  return descriptor.methods.find((m) => m.name === name);
}

function bindingOpFor(method: DescriptorMethod): "at" | "view" {
  return method.stateMutability === "view" || method.stateMutability === "pure" ? "view" : "at";
}

interface ResolvedSite extends Splice {
  readonly bindingName: string;
  readonly descriptor: ContractDescriptor;
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
        `to ${hasMethod ? "call" : "use"}: '${namespaceHead}.${contract}(<address>).<method>(...)'`,
    );
  }
  if (descriptor.coverage.typeFidelity === "widened" && !allowWidenedSelectors) {
    fail(
      `${protocol}.${contract}'s vendored ABI is "widened" (computed selectors do NOT match the deployed ` +
        `contract) — ${descriptor.coverage.caveats.join("; ")} — pass accessors: { allowWidenedSelectors: true } ` +
        "to rewrite it anyway",
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

/** Resolves shape E: the ABI of the named contract, bound to the address the program supplies.
 *  An interface is allowed here, and a contract need not be deployed on the chain: the address is
 *  the program's. */
function resolveBound(
  candidate: BoundCandidate,
  enclosingChain: CanonicalChain,
  chainScope: ReadonlySet<number> | undefined,
  allowWidenedSelectors: boolean,
): ResolvedSite {
  const { path, method, spelled } = candidate;
  const head = candidate.head;
  const shown = `'${spelled}(...).${method}(...)'`;
  // A bound contract is always named: `<Protocol>.<Contract>`, never a protocol's default.
  if (path.length !== (isChainKey(head) ? 2 : 1)) {
    fail(`${shown} -- expected '<Protocol>.<Contract>.at(<address>).<method>(...)'`);
  }
  const { protocol, contract, descriptor } = resolveContractReference(
    head,
    path,
    enclosingChain,
    chainScope,
    shown,
    ".at(<address>).<method>(...)",
  );
  if (descriptor.kind === "address-only") {
    fail(
      `${protocol}.${contract} has no ABI vendored (kind: "address-only") — there is nothing to bind`,
    );
  }
  if (descriptor.coverage.typeFidelity === "widened" && !allowWidenedSelectors) {
    fail(
      `${protocol}.${contract}'s vendored ABI is "widened" (computed selectors do NOT match the deployed ` +
        `contract) — ${descriptor.coverage.caveats.join("; ")} — pass accessors: { allowWidenedSelectors: true } ` +
        "to rewrite it anyway",
    );
  }
  const methodDescriptor = methodByName(descriptor, method);
  if (methodDescriptor === undefined) {
    const known = descriptor.methods.map((m) => m.name).join(", ");
    fail(`'${method}' is not in ${protocol}.${contract}'s vendored ABI (known methods: ${known})`);
  }
  const bindingName = `I${pascalOfSlug(protocol)}_${contract}`;
  return {
    start: candidate.calleeStart,
    end: candidate.calleeEnd,
    replacement: `${bindingName}.${bindingOpFor(methodDescriptor)}`,
    bindingName,
    descriptor,
  };
}

/**
 * The deployed contract `<namespace>[.<contract>]` names on `chain`, by exactly the rules the
 * rewrite applies to that reference in a program — or the error it would raise there. A name this
 * resolves is one a program compiled for `chain` may use; `sourceGlobals` lists a chain's
 * contracts through it, so the listing and the rewrite cannot disagree.
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

function resolveCandidate(
  candidate: AccessorCandidate,
  enclosingChain: CanonicalChain,
  chainScope: ReadonlySet<number> | undefined,
  allowWidenedSelectors: boolean,
  onContract?: ProtocolRewriteOptions["onContract"],
): ResolvedSite {
  const { head, path } = candidate;
  const method = path[path.length - 1]!;

  const target = resolveAccessorTarget(
    head,
    path,
    true,
    enclosingChain,
    chainScope,
    allowWidenedSelectors,
  );
  const { protocol, contract, descriptor, address } = target;

  const methodDescriptor = methodByName(descriptor, method);
  if (methodDescriptor === undefined) {
    const known = descriptor.methods.map((m) => m.name).join(", ");
    fail(`'${method}' is not in ${protocol}.${contract}'s vendored ABI (known methods: ${known})`);
  }

  onContract?.([head, ...path.slice(0, -1)].join("."), target);
  const bindingName = `I${pascalOfSlug(protocol)}_${contract}`;
  const bindingOp = bindingOpFor(methodDescriptor);
  const addressLiteral = formatBigint(BigInt(address));
  const replacement = `${bindingName}.${bindingOp}(${addressLiteral}).${method}`;

  return {
    start: candidate.calleeStart,
    end: candidate.calleeEnd,
    replacement,
    bindingName,
    descriptor,
  };
}

// -- self-sugar: bare `self` -> `ctx.self()` in genuine read position -------------------------

/** Collects, by node identity, every Identifier node that must NEVER be treated as a `self` READ
 *  even if its name happens to be `"self"`: a declarator id, a function/arrow parameter, a
 *  non-computed member property, a non-computed object-literal key, an assignment target, or an
 *  update-expression operand. */
function collectSelfExclusions(program: AstNode): ReadonlySet<AstNode> {
  const excluded = new Set<AstNode>();
  walk(program, (n) => {
    if (n.type === "VariableDeclarator") {
      const id = (n as { id?: AstNode }).id;
      if (id?.type === "Identifier") excluded.add(id);
    }
    if (
      n.type === "FunctionDeclaration" ||
      n.type === "FunctionExpression" ||
      n.type === "ArrowFunctionExpression"
    ) {
      const params = (n as { params?: AstNode[] }).params ?? [];
      for (const p of params) if (p.type === "Identifier") excluded.add(p);
    }
    if (n.type === "MemberExpression" && !(n as { computed?: boolean }).computed) {
      const property = (n as { property?: AstNode }).property;
      if (property?.type === "Identifier") excluded.add(property);
    }
    if (n.type === "Property" && !(n as { computed?: boolean }).computed) {
      const key = (n as { key?: AstNode }).key;
      if (key?.type === "Identifier") excluded.add(key);
    }
    if (n.type === "AssignmentExpression") {
      const left = (n as { left?: AstNode }).left;
      if (left?.type === "Identifier") excluded.add(left);
    }
    if (n.type === "UpdateExpression") {
      const argument = (n as { argument?: AstNode }).argument;
      if (argument?.type === "Identifier") excluded.add(argument);
    }
  });
  return excluded;
}

function collectSelfSites(
  program: AstNode,
  excluded: ReadonlySet<AstNode>,
  shadowed: ReadonlySet<string>,
): Splice[] {
  if (shadowed.has("self")) return [];
  const sites: Splice[] = [];
  walk(program, (n) => {
    if (
      n.type === "Identifier" &&
      (n as unknown as { name: string }).name === "self" &&
      !excluded.has(n)
    ) {
      sites.push({ start: n.start, end: n.end, replacement: "ctx.self()" });
    }
  });
  return sites;
}

/**
 * Rewrites every recognized protocol-accessor call site (shapes A-D) and, unless
 * `opts.selfSugar === false`, every bare `self` read, over `source` for the enclosing/destination
 * `chain`. Edits use parser ranges over the original source, preserving unrelated formatting,
 * comments, and code byte-for-byte.
 */
export function rewriteProtocolAccessors(
  source: string,
  chain: CanonicalChain,
  opts: ProtocolRewriteOptions = {},
): ProtocolRewriteResult {
  // A module parse, annotations included -- this pass runs unconditionally (default ON), so it
  // must take whatever the compiler does, including a source that ALREADY carries a leading
  // `import { X } from "./X.json";` line.
  const program = parseSauce(source);
  const shadowed = collectDeclaredNames(program);

  const chainScope = opts.chainScope
    ? new Set(opts.chainScope.map((ref) => requireChain(ref).id))
    : undefined;

  const candidates = collectAccessorCandidates(program, shadowed);
  const allowWidenedSelectors = opts.allowWidenedSelectors ?? false;
  // A bound contract (`.at(<address>)`) is the program's own address with a registry ABI, not a
  // deployment, so `onContract` hears only the accessors that resolve to one.
  const resolved = [
    ...candidates.map((c) =>
      resolveCandidate(c, chain, chainScope, allowWidenedSelectors, opts.onContract),
    ),
    ...collectBoundCandidates(program, shadowed).map((c) =>
      resolveBound(c, chain, chainScope, allowWidenedSelectors),
    ),
  ];

  const contracts: ContractsConfig = { ...(opts.existingContracts ?? {}) };
  for (const site of resolved) {
    const existing = opts.existingContracts?.[site.bindingName];
    if (existing !== undefined && existing.abi !== site.descriptor.abi) {
      fail(
        `synthesized binding name '${site.bindingName}' collides with a caller-supplied ` +
          "compile.contracts entry of the same name but a DIFFERENT abi",
      );
    }
    contracts[site.bindingName] = { abi: site.descriptor.abi };
  }

  // Binding-name collision with a user identifier anywhere in the program (declared or merely
  // referenced) -- fails closed rather than silently shadowing/being shadowed by user code.
  if (resolved.length > 0) {
    const allIdentifiers = new Set<string>();
    walk(program, (n) => {
      if (n.type === "Identifier") allIdentifiers.add((n as unknown as { name: string }).name);
    });
    for (const site of resolved) {
      if (allIdentifiers.has(site.bindingName)) {
        fail(
          `synthesized binding name '${site.bindingName}' collides with an identifier already used in the program`,
        );
      }
    }
  }

  const selfSugar = opts.selfSugar ?? true;
  const excluded = selfSugar ? collectSelfExclusions(program) : new Set<AstNode>();
  const selfSites = selfSugar ? collectSelfSites(program, excluded, shadowed) : [];

  // Bare `<Protocol>.<Contract>` / `<Chain>.<Protocol>[.<Contract>]` in value position -> its
  // on-chain address literal. Terminal by construction (never a call callee), so it can't overlap a
  // `resolved` call-site splice.
  const valueSites = collectValueAccessSites(
    program,
    shadowed,
    chain,
    chainScope,
    allowWidenedSelectors,
    opts.onContract,
  );

  const allSites = [...resolved, ...selfSites, ...valueSites];
  if (allSites.length === 0) {
    return {
      source,
      rewrote: false,
      contracts: {},
      accessorSites: 0,
      selfSites: 0,
      valueAccessSites: 0,
    };
  }

  const ordered = [...allSites].sort((a, b) => b.start - a.start);
  let out = source;
  for (const site of ordered) {
    out = out.slice(0, site.start) + site.replacement + out.slice(site.end);
  }

  return {
    source: out,
    rewrote: true,
    contracts,
    accessorSites: resolved.length,
    selfSites: selfSites.length,
    valueAccessSites: valueSites.length,
  };
}
