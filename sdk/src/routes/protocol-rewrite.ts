/**
 * Full protocol-accessor rewrite — "chain selection unlocks its namespace as globals."
 *
 * Inside a `Base.route(() => { ... })` body, a bare protocol accessor resolves to BASE's
 * deployment:
 *
 *   Uniswap.UniversalRouter.execute(args)  ==>  IUniswapV4_UniversalRouter.at(<BASE_ADDR>n).execute(args)
 *
 * Generalizes U4 (`token-rewrite.ts`, ERC20-only) to arbitrary protocol accessors, driven by the
 * E2.3 descriptor registry (`descriptors/registry.ts#DESCRIPTORS`) via the registry-derived name
 * index in `accessor-index.ts`. Also rewrites bare `self` -> `ctx.self()` in the same pass (same
 * acorn parse, same reverse-ordered splice, disjoint ranges by construction).
 *
 * FOUR recognized callee shapes (see the module design doc,
 * `docs/plans/2026-08-09-xchain-intent-dsl-v2.md`, for the full derivation):
 *   (A) `<Protocol>.<Contract>.<method>(...)`        -> the ENCLOSING chain
 *   (B) `<Protocol>.<method>(...)`                   -> the ENCLOSING chain, protocol's single
 *                                                        default contract
 *   (C) `<Chain>.<Protocol>.<Contract>.<method>(...)` -> the NAMED chain
 *   (D) `<Chain>.<Protocol>.<method>(...)`            -> the NAMED chain, default contract
 *
 * `<Chain>` NAMES a chain, it does not verify ancestry — construction order (`.nest()` receives an
 * ALREADY-BUILT child) makes a lineage check unenforceable at compile time; see the design doc's
 * "chainScoping" section. `opts.chainScope` is the opt-in allowlist for callers who want a named
 * chain restricted to a known set.
 *
 * ARTIFACT SERVING: the compiler's `CompileOptions.contracts` (`ContractsConfig`) is a landed,
 * already-shipped option — `new CompilerContext` registers every `contracts` entry's ABI directly,
 * with ZERO import line and ZERO baseDirs (verified by compiling; see the design doc's
 * "artifactServing" section for the full measurement). This pass therefore returns a `contracts`
 * map the caller (`sauce-route.ts`) merges straight into its own `compile()` call — no temp files,
 * no compiler change.
 *
 * FALLBACK, per the design doc's "fallback" section: a head that is not a registry namespace/chain
 * key, or is shadowed anywhere in the program, is left silently untouched (isolation — the pass
 * must never claim an identifier it doesn't own). Once a head IS recognized as owned, every other
 * failure mode (unknown contract, not deployed, widened ABI, wrong kind, method not vendored,
 * ambiguous family member, binding-name collision, out-of-scope chain) is a named, thrown error —
 * never a silent skip and never left to the compiler's own, more confusing error text.
 */
import * as acorn from "acorn";
import type { Address } from "viem";
import type { ContractsConfig } from "./compile-types.js";

import { requireChain, type CanonicalChain, type ChainRef } from "../chains/canonical.js";
import { addressOn } from "../descriptors/query.js";
import type { ContractDescriptor, DescriptorMethod } from "../descriptors/types.js";
import { formatBigint } from "../deposit/format.js";
import { walk, collectDeclaredNames, type AstNode } from "./ast-walk.js";
import { pascalOfSlug } from "./builder.js";
import { chainSlugForKey, isChainKey, resolveNamespace, type Namespace } from "./accessor-index.js";

export interface ProtocolRewriteOptions {
  /** Allows a `typeFidelity: "widened"` descriptor (vendored ABI, real selector mismatch) to be
   *  rewritten anyway. Default `false` — a widened descriptor is refused with a named error quoting
   *  `descriptor.coverage.caveats`, since rewriting it would compile cleanly and then revert on
   *  chain inside a value-carrying intent. */
  allowWidenedSelectors?: boolean;
  /** Restricts a chain-QUALIFIED accessor (shapes C/D) to a named allowlist. Default: any canonical
   *  chain (unrestricted — see the module doc's "names a chain, not an ancestor" note). */
  chainScope?: readonly ChainRef[];
  /** Rewrites bare `self` -> `ctx.self()` in read position. Default `true`. */
  selfSugar?: boolean;
  /** Caller-supplied `compile.contracts` bundle this rewrite's own synthesized bindings must not
   *  silently collide with (a same-name entry with a DIFFERENT ABI throws). */
  existingContracts?: Readonly<ContractsConfig>;
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
function decomposeMemberChain(node: AstNode): { readonly head: string; readonly path: readonly string[] } | undefined {
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
  return { head: inner.head, path: [...inner.path, (property as unknown as { name: string }).name] };
}

interface AccessorCandidate {
  readonly calleeStart: number;
  readonly calleeEnd: number;
  readonly head: string;
  readonly path: readonly string[];
}

function collectAccessorCandidates(program: AstNode, shadowed: ReadonlySet<string>): AccessorCandidate[] {
  const out: AccessorCandidate[] = [];
  walk(program, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = (n as { callee?: AstNode }).callee;
    if (!callee || callee.type !== "MemberExpression") return;
    const decomposed = decomposeMemberChain(callee);
    if (decomposed === undefined) return;
    const { head, path } = decomposed;
    if (path.length < 1 || path.length > 2 && !isChainKey(head)) return;
    if (shadowed.has(head)) return;
    // Only a recognized head (namespace key or chain key) is a candidate at all -- an unrecognized
    // head is left completely untouched (isolation).
    if (!isChainKey(head) && resolveNamespace(head) === undefined) return;
    if (path.length < 1 || path.length > 3) return;
    out.push({ calleeStart: callee.start, calleeEnd: callee.end, head, path });
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
    const { address } = resolveAccessorTarget(head, path, false, enclosingChain, chainScope, allowWidenedSelectors);
    sites.push({ start: n.start, end: n.end, replacement: formatBigint(BigInt(address)) });
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
): { readonly protocol: string; readonly contract: string; readonly descriptor: ContractDescriptor } {
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
    fail(`Unknown contract '${contractName}' under family alias '${ns.familyKey}' (known: ${known})`);
  }
  if (owners.length > 1) {
    const candidates = owners.map((slug) => `${pascalOfSlug(slug)}.${contractName}`).join(" or ");
    fail(`"${contractName}" is ambiguous under ${ns.familyKey} (${owners.join(", ")}) — use ${candidates}`);
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

interface AccessorTarget {
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
      fail(`'${shown}' -- expected '${head}.<Protocol>[.<Contract>]${suffix}'`);
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

  const { protocol, contract, descriptor } = resolveContractDescriptor(ns, contractName, namespaceHead);

  if (descriptor.kind === "address-only") {
    fail(
      `${protocol}.${contract} has an address but no ABI vendored for this role (kind: "address-only") — ` +
        `see descriptor.coverage.caveats`,
    );
  }
  if (descriptor.kind === "interface") {
    fail(
      `${protocol}.${contract} is an interface descriptor (no fixed address) — this is what the ERC20 ` +
        "token-member rewrite (options.tokens / token-rewrite.ts) already covers; a protocol-accessor " +
        `${hasMethod ? "call" : "reference"} needs a concrete deployed instance, not a bare interface`,
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
    fail(`Contract '${contract}' (${protocol}) is not deployed on '${chain.slug}' (available: ${known})`);
  }

  return { chain, protocol, contract, descriptor, address };
}

function resolveCandidate(
  candidate: AccessorCandidate,
  enclosingChain: CanonicalChain,
  chainScope: ReadonlySet<number> | undefined,
  allowWidenedSelectors: boolean,
): ResolvedSite {
  const { head, path } = candidate;
  const method = path[path.length - 1]!;

  const { protocol, contract, descriptor, address } = resolveAccessorTarget(
    head,
    path,
    true,
    enclosingChain,
    chainScope,
    allowWidenedSelectors,
  );

  const methodDescriptor = methodByName(descriptor, method);
  if (methodDescriptor === undefined) {
    const known = descriptor.methods.map((m) => m.name).join(", ");
    fail(`'${method}' is not in ${protocol}.${contract}'s vendored ABI (known methods: ${known})`);
  }

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
    if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
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

function collectSelfSites(program: AstNode, excluded: ReadonlySet<AstNode>, shadowed: ReadonlySet<string>): Splice[] {
  if (shadowed.has("self")) return [];
  const sites: Splice[] = [];
  walk(program, (n) => {
    if (n.type === "Identifier" && (n as unknown as { name: string }).name === "self" && !excluded.has(n)) {
      sites.push({ start: n.start, end: n.end, replacement: "ctx.self()" });
    }
  });
  return sites;
}

/**
 * Rewrites every recognized protocol-accessor call site (shapes A-D) and, unless
 * `opts.selfSugar === false`, every bare `self` read, over `source` for the enclosing/destination
 * `chain`. Purely textual surgery over the ORIGINAL source, driven by acorn ranges (U4's own
 * technique) -- everything else (formatting, comments, unrelated code) survives byte-for-byte.
 */
export function rewriteProtocolAccessors(
  source: string,
  chain: CanonicalChain,
  opts: ProtocolRewriteOptions = {},
): ProtocolRewriteResult {
  // sourceType: "module" -- this pass runs unconditionally (default ON), so it must tolerate a
  // source that ALREADY carries a leading `import { X } from "./X.json";` line, e.g. the
  // ERC20-import-prefixed transfer program `nest.ts#nestedTransferProgram` can hand
  // `compileSauceRoute` before this pass ever sees it.
  const program = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" }) as unknown as AstNode;
  const shadowed = collectDeclaredNames(program);

  const chainScope = opts.chainScope ? new Set(opts.chainScope.map((ref) => requireChain(ref).id)) : undefined;

  const candidates = collectAccessorCandidates(program, shadowed);
  const allowWidenedSelectors = opts.allowWidenedSelectors ?? false;
  const resolved = candidates.map((c) => resolveCandidate(c, chain, chainScope, allowWidenedSelectors));

  const contracts: ContractsConfig = { ...(opts.existingContracts ?? {}) };
  for (const site of resolved) {
    const existing = opts.existingContracts?.[site.bindingName];
    if (existing !== undefined && existing.abi !== (site.descriptor.abi as unknown)) {
      fail(
        `synthesized binding name '${site.bindingName}' collides with a caller-supplied ` +
          "compile.contracts entry of the same name but a DIFFERENT abi",
      );
    }
    contracts[site.bindingName] = { abi: site.descriptor.abi as unknown as ContractsConfig[string]["abi"] };
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
        fail(`synthesized binding name '${site.bindingName}' collides with an identifier already used in the program`);
      }
    }
  }

  const selfSugar = opts.selfSugar ?? true;
  const excluded = selfSugar ? collectSelfExclusions(program) : new Set<AstNode>();
  const selfSites = selfSugar ? collectSelfSites(program, excluded, shadowed) : [];

  // Bare `<Protocol>.<Contract>` / `<Chain>.<Protocol>[.<Contract>]` in value position -> its
  // on-chain address literal. Terminal by construction (never a call callee), so it can't overlap a
  // `resolved` call-site splice.
  const valueSites = collectValueAccessSites(program, shadowed, chain, chainScope, allowWidenedSelectors);

  const allSites = [...resolved, ...selfSites, ...valueSites];
  if (allSites.length === 0) {
    return { source, rewrote: false, contracts: {}, accessorSites: 0, selfSites: 0, valueAccessSites: 0 };
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
