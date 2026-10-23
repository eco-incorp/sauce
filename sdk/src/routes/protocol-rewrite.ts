/**
 * The protocol names a module cannot hold, lowered before the compiler reads the program.
 *
 * A chain's contracts are its names module (`chain-module.ts`): `UniswapV3.Factory.getPool(…)`,
 * `Base.UniswapV3.Factory` and a contract's address in value position are the compiler's, with no
 * rewrite. What needs a function as a value stays here:
 *   (B) `<Protocol>.<method>(...)`            — a protocol's one contract with an ABI, its default,
 *       called through the namespace: written `<Protocol>.<Default>.<method>(...)`, which the names
 *       module holds, so the chain decides it like any other contract;
 *   (D) `<Chain>.<Protocol>.<method>(...)`    — the same, on a chain by name;
 *   (E) `<Protocol>.<Contract>.at(<address>).<method>(...)` — the contract's ABI at another
 *       address: how an interface (an ABI with no fixed address, `Erc4626.Vault`) is called, and
 *       how a deployed contract's ABI reaches another deployment;
 *   (F) `<Protocol>.<Interface>(<address>).<method>(...)` — an interface called with the address
 *       it is bound to, the same as shape E: `UniswapV3.Pool(pool).liquidity()`. Only an
 *       interface binds this way; a deployed contract's name called with an address is refused.
 * And (G) a scalar method on a contract the names module binds, `<Protocol>.<Contract>.toBytesBe(n)`
 * or a local holding one: 2.6.0 takes `.toBytesBe`/`.toBytesLe` only on an address, which a binding
 * is everywhere else a value goes, so `.address` goes before the method (EVM only).
 * Bare `pot` is rewritten to `ctx.self()` in the same pass, and a bare `self` (the Pot's old name)
 * is refused, naming `pot`.
 *
 * Shapes E and F return a parsed-ABI `contracts` map. The route compiler merges it with caller
 * bindings, and `rs-compile.ts` adapts the map to the published compiler's `inlineContracts`
 * option. No temporary ABI files or filesystem imports are needed for these bindings.
 *
 * Unrecognized or shadowed root names are left untouched. Once a registry root is recognized,
 * unsupported contracts, missing methods, widened ABIs, ambiguous family aliases, binding
 * collisions, and out-of-scope chains produce explicit errors.
 */
import type { Address } from "viem";
import type { ContractsConfig } from "./compile-types.js";

import { requireChain, type CanonicalChain, type ChainRef } from "../chains/canonical.js";
import { addressOn } from "../descriptors/query.js";
import type { ContractDescriptor, DescriptorMethod } from "../descriptors/types.js";
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
import { POT_NAME, RETIRED_POT_NAME, selfRefusal } from "./pot-sugar.js";
import { shadowed as shadowedAt, walkScoped } from "./lexical-scope.js";

export interface ProtocolRewriteOptions {
  /** Allows a `typeFidelity: "widened"` descriptor (vendored ABI, real selector mismatch) to be
   *  rewritten anyway. Default `false` — a widened descriptor is refused with a named error quoting
   *  `descriptor.coverage.caveats`, since rewriting it would compile cleanly and then revert on
   *  chain. */
  allowWidenedSelectors?: boolean;
  /** Restricts a chain-QUALIFIED name (`Base.UniswapV3.Factory`) to a named allowlist. Default: any
   *  canonical chain. */
  chainScope?: readonly ChainRef[];
  /** Rewrites bare `pot` -> `ctx.self()` in read position. Default `true`. A bare `self` is refused
   *  either way. */
  potSugar?: boolean;
  /** Caller-supplied `compile.contracts` bundle this rewrite's own synthesized bindings must not
   *  silently collide with (a same-name entry with a DIFFERENT ABI throws). */
  existingContracts?: Readonly<ContractsConfig>;
  /**
   * Told each deployed contract the program uses — a call (`UniswapV3.Factory.getPool(…)`) or a
   * value (`Cctp.TokenMessenger`), not a test of it — with the reference as written and what it
   * resolved to: which chain's deployment, and its address. The route compiler's name check
   * (`absent-names.ts`) tells it, before this pass runs.
   */
  onContract?: (reference: string, target: AccessorTarget) => void;
}

export interface ProtocolRewriteResult {
  readonly source: string;
  /** True if at least one accessor or `pot` site was rewritten. */
  readonly rewrote: boolean;
  /** One entry per REFERENCED descriptor -- merge straight into `compile()`'s own `contracts`. */
  readonly contracts: ContractsConfig;
  /** Count of contract bindings rewritten, shapes E and F (excludes `pot` sites). */
  readonly accessorSites: number;
  /** Count of `<Protocol>.<method>(...)` calls written through the protocol's default contract. */
  readonly defaultSites: number;
  /** Count of bare `pot` sites rewritten. */
  readonly potSites: number;
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

/** A call through a protocol's default contract: shape B, `<Protocol>.<method>(...)`, or shape D,
 *  `<Chain>.<Protocol>.<method>(...)`. */
interface DefaultCandidate {
  readonly calleeStart: number;
  readonly calleeEnd: number;
  readonly head: string;
  readonly path: readonly string[];
}

function collectDefaultCandidates(
  program: AstNode,
  shadowed: ReadonlySet<string>,
): DefaultCandidate[] {
  const out: DefaultCandidate[] = [];
  walk(program, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = (n as { callee?: AstNode }).callee;
    if (!callee || callee.type !== "MemberExpression") return;
    const decomposed = decomposeMemberChain(callee);
    if (decomposed === undefined) return;
    const { head, path } = decomposed;
    if (shadowed.has(head)) return;
    // Only a recognized head (namespace key or chain key) is a candidate at all -- an unrecognized
    // head is left completely untouched (isolation).
    const chainKey = isChainKey(head);
    if (!chainKey && resolveNamespace(head) === undefined) return;
    // `<Protocol>.<method>` or `<Chain>.<Protocol>.<method>`: anything longer names a contract,
    // which the names module holds.
    if (path.length !== (chainKey ? 2 : 1)) return;
    const named = namedContractKind(head, path);
    // `<…>.<Interface>(<address>)`: shape F, which `collectBoundCandidates` owns.
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

/** The scalar methods 2.6.0 refuses on a contract binding: "`ABI_0` has no method named …". */
const SCALAR_METHODS: ReadonlySet<string> = new Set(["toBytesBe", "toBytesLe"]);

/**
 * Shape G: `.address` before a scalar method whose receiver is a contract the names module binds
 * (`AaveV3.Pool.toBytesBe(32)`, `Base.UniswapV3.Factory.toBytesBe(32)`) or a local initialized to
 * one (`const pool = AaveV3.Pool; pool.toBytesBe(32)`). On the EVM `.address` is the address itself
 * on any scalar, so a local of that name holding a number elsewhere compiles as written.
 */
function collectAddressReads(program: AstNode, shadowed: ReadonlySet<string>): Splice[] {
  const nameOf = (node: AstNode): string => (node as unknown as { name: string }).name;
  const isBinding = (node: AstNode | null | undefined): boolean => {
    if (!node) return false;
    const decomposed = decomposeMemberChain(node);
    if (decomposed === undefined || decomposed.path.length === 0) return false;
    if (shadowed.has(decomposed.head)) return false;
    return namedContractKind(decomposed.head, decomposed.path) === "singleton";
  };
  const locals = new Set<string>();
  walk(program, (n) => {
    if (n.type !== "VariableDeclarator") return;
    const id = (n as { id?: AstNode }).id;
    if (id?.type === "Identifier" && isBinding((n as { init?: AstNode | null }).init)) {
      locals.add(nameOf(id));
    }
  });
  const out: Splice[] = [];
  walk(program, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = (n as { callee?: AstNode }).callee;
    if (callee?.type !== "MemberExpression" || (callee as { computed?: boolean }).computed) return;
    const property = (callee as { property?: AstNode }).property;
    if (property?.type !== "Identifier" || !SCALAR_METHODS.has(nameOf(property))) return;
    const object = (callee as { object?: AstNode }).object!;
    if (isBinding(object) || (object.type === "Identifier" && locals.has(nameOf(object)))) {
      out.push({ start: object.end, end: object.end, replacement: ".address" });
    }
  });
  return out;
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

/**
 * `<Protocol>.<method>` written `<Protocol>.<Default>.<method>`: the protocol's default contract,
 * which the chain's names module holds like any other, so whether the chain has it is decided there.
 */
function throughDefault(candidate: DefaultCandidate): Splice {
  const { head, path } = candidate;
  const chainKey = isChainKey(head);
  const namespaceHead = chainKey ? path[0]! : head;
  const ns = resolveNamespace(namespaceHead);
  if (ns === undefined) fail(`'${namespaceHead}' is not a known protocol or family alias`);
  const { contract } = resolveContractDescriptor(ns, undefined, namespaceHead);
  const method = path[path.length - 1]!;

  return {
    start: candidate.calleeStart,
    end: candidate.calleeEnd,
    replacement: `${chainKey ? `${head}.` : ""}${namespaceHead}.${contract}.${method}`,
  };
}

// -- pot-sugar: bare `pot` -> `ctx.self()` in genuine read position --------------------------------

/** Collects, by node identity, every Identifier node that must NEVER be treated as a READ of a name
 *  (`pot`, or the refused `self`): a declarator id, a function/arrow parameter, a non-computed
 *  member property, a non-computed object-literal key, an assignment target, an update-expression
 *  operand, or a name in an import or export specifier (`import { pot as holder }` names a
 *  module's export, and binds `holder`). */
function collectReadExclusions(program: AstNode): ReadonlySet<AstNode> {
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
    if (
      n.type === "ImportSpecifier" ||
      n.type === "ImportDefaultSpecifier" ||
      n.type === "ImportNamespaceSpecifier" ||
      n.type === "ExportSpecifier"
    ) {
      walk(n, (name) => excluded.add(name));
    }
  });
  return excluded;
}

/** The bare reads of `name` where the program does not declare it (`lexical-scope.ts`), unless the
 *  compile binds it (`bound`): every `pot` the sugar rewrites. */
function bareReads(
  program: AstNode,
  name: string,
  excluded: ReadonlySet<AstNode>,
  bound: ReadonlySet<string>,
): AstNode[] {
  if (bound.has(name)) return [];
  const reads: AstNode[] = [];
  walkScoped(program, (n, at) => {
    if (
      n.type === "Identifier" &&
      (n as unknown as { name: string }).name === name &&
      !excluded.has(n) &&
      !shadowedAt(at, name, n.start)
    ) {
      reads.push(n);
    }
  });
  return reads;
}

/**
 * Rewrites every recognized protocol-accessor call site (shapes A-D) and, unless
 * `opts.potSugar === false`, every bare `pot` read where the program declares no `pot`
 * (`lexical-scope.ts`), over `source` for the enclosing/destination `chain`; refuses a bare `self`
 * read where the program declares no `self` (the Pot is `pot`). A `pot` or `self`
 * in `bound` — a name the compile gives a value beside the source: a define, an ambient module's
 * export — is that value, so neither is touched. Edits use parser ranges over the original source,
 * preserving unrelated formatting, comments, and code byte-for-byte.
 */
export function rewriteProtocolAccessors(
  source: string,
  chain: CanonicalChain,
  opts: ProtocolRewriteOptions = {},
  bound: ReadonlySet<string> = new Set(),
): ProtocolRewriteResult {
  // A module parse, annotations included -- this pass runs unconditionally (default ON), so it
  // must take whatever the compiler does, including a source that ALREADY carries a leading
  // `import { X } from "./X.json";` line.
  const program = parseSauce(source);
  const shadowed = collectDeclaredNames(program);

  const chainScope = opts.chainScope
    ? new Set(opts.chainScope.map((ref) => requireChain(ref).id))
    : undefined;

  const defaults = collectDefaultCandidates(program, shadowed).map(throughDefault);
  const addressReads = chain.kind === "evm" ? collectAddressReads(program, shadowed) : [];
  const allowWidenedSelectors = opts.allowWidenedSelectors ?? false;
  const resolved = collectBoundCandidates(program, shadowed).map((c) =>
    resolveBound(c, chain, chainScope, allowWidenedSelectors),
  );

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

  const excluded = collectReadExclusions(program);
  const [retired] = bareReads(program, RETIRED_POT_NAME, excluded, bound);
  if (retired !== undefined) throw selfRefusal(RETIRED_POT_NAME, POT_NAME);
  const potSites: Splice[] =
    (opts.potSugar ?? true)
      ? bareReads(program, POT_NAME, excluded, bound).map((n) => ({
          start: n.start,
          end: n.end,
          replacement: "ctx.self()",
        }))
      : [];

  const allSites = [...defaults, ...addressReads, ...resolved, ...potSites];
  if (allSites.length === 0) {
    return {
      source,
      rewrote: false,
      contracts: {},
      accessorSites: 0,
      defaultSites: 0,
      potSites: 0,
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
    defaultSites: defaults.length,
    potSites: potSites.length,
  };
}
