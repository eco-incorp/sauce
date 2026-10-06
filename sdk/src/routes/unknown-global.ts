/**
 * A name used as a token or a protocol that the destination does not have, reported as that.
 *
 * `DAIX.balanceOf(x)` and `Uniswapp.UniversalRouter` name nothing: not a registered token, not a
 * protocol, not a declaration of the program and not a builtin. The chain's module of names
 * (`chain-module.ts`) exports nothing for them — it exports every name some chain has, absent where
 * this one lacks it — so the compiler refuses the program and says where: a structured diagnostic
 * with a `code` and the span of the name. The route compiler knows what the chain has, so it says
 * which name, on which chain, and what it probably meant.
 *
 * Consulted only once the compiler has refused the program, on the diagnostics it threw: a program
 * the compiler accepts is never refused here, and the name is the text the compiler pointed at.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import type { ContractDescriptor } from "../descriptors/types.js";
import { addressOn } from "../descriptors/query.js";
import { chainSlugForKey, isChainKey, NAMESPACE_KEYS, resolveNamespace } from "./accessor-index.js";
import { requireChain } from "../chains/canonical.js";
import { registryTokenSymbols, resolveTokenMap } from "./token-registry.js";
import { ecoRoutesPortal } from "../protocols/eco-routes/lookup.js";
import { chainAt } from "./intent-parts.js";
import { pascalOfSlug } from "./pascal.js";

/** The diagnostics a name nothing declares produces: an unknown value, or a call of one. */
const UNKNOWN_CODES: ReadonlySet<string> = new Set([
  "UnknownIdentifier",
  "UnresolvedCall",
  "UnknownMember",
  "StaticAtRunTime",
]);

/** The part of a diagnostic this reads. */
interface Located {
  readonly path?: string;
  readonly code?: string;
  readonly start: { readonly offset: number };
  readonly end: { readonly offset: number };
}

/** Optimal string alignment distance: edits, with an adjacent swap counting as one. Three rolling
 *  rows, since a whole chain's names are matched at once. */
function distance(a: string, b: string): number {
  let before = new Uint16Array(b.length + 1);
  let previous = Uint16Array.from({ length: b.length + 1 }, (_, j) => j);
  let row = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, before[j - 2]! + 1);
      }
      row[j] = best;
    }
    [before, previous, row] = [previous, row, before];
  }
  return previous[b.length]!;
}

/** The protocol namespaces with at least one contract deployed on `chain`, worked out once per
 *  chain. */
const protocolsByChain = new Map<number, readonly string[]>();
export function protocolsOn(chain: CanonicalChain): readonly string[] {
  let found = protocolsByChain.get(chain.id);
  if (found === undefined) {
    found = deployedProtocols(chain);
    protocolsByChain.set(chain.id, found);
  }
  return found;
}

function deployedProtocols(chain: CanonicalChain): string[] {
  const deployed = (key: string): boolean => {
    const namespace = resolveNamespace(key);
    if (namespace === undefined) return false;
    if (namespace.kind === "protocol") {
      return [...namespace.contracts.values()].some((d) => addressOn(d, chain) !== undefined);
    }
    return namespace.members.some((slug) => deployed(pascalOfSlug(slug)));
  };
  return [...NAMESPACE_KEYS].filter(deployed);
}

/** The `candidates` nearest `name`, if any is close enough to be what was meant — at most three. */
export function nearMatches(name: string, candidates: Iterable<string>): string[] {
  const allowed = name.length <= 4 ? 1 : 2;
  const scored = [...new Set(candidates)]
    // A length further off than the edits allowed cannot be within them.
    .filter((candidate) => Math.abs(candidate.length - name.length) <= allowed)
    .map((candidate) => ({
      candidate,
      cost: candidate.toLowerCase() === name.toLowerCase() ? 0 : distance(name, candidate),
    }))
    .filter(({ cost }) => cost <= allowed);
  const nearest = Math.min(...scored.map(({ cost }) => cost));
  return scored
    .filter(({ cost }) => cost === nearest)
    .map(({ candidate }) => candidate)
    .sort()
    .slice(0, 3);
}

/** The compiler's own account of a failure: the last line of its chain of causes. */
function headline(error: unknown): string | undefined {
  const message = String((error as Error | undefined)?.message ?? error).replace(
    new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
    "",
  );
  const causes = [...message.matchAll(/─▶ (.+)/g)];
  return causes.length === 0 ? undefined : causes[causes.length - 1]![1]!.trim();
}

/**
 * For a compile of `source` (the entry, at `entry`) that failed with `cause`: an error naming the
 * first name of the chain's registry the compiler could not resolve or use — a token or protocol the
 * chain lacks, a contract it does not deploy, a typo of one — in the chain's words, with its near
 * matches. `undefined` when there is none, and the compiler's error stands.
 */
export function unknownGlobalError(
  source: string,
  entry: string,
  chain: CanonicalChain,
  tokens: Iterable<string>,
  cause: unknown,
  options: NameOptions = {},
): Error | undefined {
  const diagnostics =
    (cause as { diagnostics?: readonly Located[] } | undefined)?.diagnostics ?? [];
  const tokenList = [...tokens];
  const refusal = diagnostics
    .filter((d) => d.path === entry && d.code !== undefined && UNKNOWN_CODES.has(d.code))
    .map((d) => {
      // The name as written, from where the span starts: a dotted path, the root alone included.
      const dotted = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(
        source.slice(d.start.offset),
      )?.[0];
      // Worded for the chain the code it is in runs on: an intent's body is its destination's.
      const on = chainAt(source, d.start.offset, chain);
      return dotted === undefined
        ? undefined
        : absentNameError(dotted, on, on.id === chain.id ? tokenList : undefined, options);
    })
    .find((message): message is string => message !== undefined);
  if (refusal === undefined) return undefined;

  const compiler = headline(cause);
  const stop = /[.?!]$/.test(refusal) ? "" : ".";
  return new Error(
    `compileSauceRoute: ${refusal}${stop}` +
      (compiler === undefined ? "" : ` The compiler reported: ${compiler}`),
    { cause },
  );
}

/** Why a contract is absent on `chain`, in the chain's words. */
export const notDeployed = (descriptor: ContractDescriptor, chain: CanonicalChain): string =>
  `Contract '${descriptor.contract}' (${descriptor.protocol}) is not deployed on '${chain.slug}'` +
  ` (available: ${descriptor.chains.length > 0 ? descriptor.chains.join(", ") : "(none)"})`;

/**
 * Why `name`, a name or dotted path a program wrote, is not on `chain` — a token or protocol it
 * lacks, a contract it does not deploy, a contract a namespace does not have, an ambiguous family
 * name, a token qualified by a chain — or `undefined` when `name` is not a registry name at all (a
 * program's own), or one `chain` has.
 */
/** How a compile treats the registry's names, as far as wording a refusal goes. */
export interface NameOptions {
  /** Whether a contract whose vendored ABI is widened is used anyway. */
  readonly allowWidenedSelectors?: boolean;
}

export function absentNameError(
  name: string,
  chain: CanonicalChain,
  tokens: Iterable<string> = resolveTokenMap(chain).keys(),
  options: NameOptions = {},
): string | undefined {
  const segments = name.split(".");
  let on = chain;
  let rest = segments;
  if (isChainKey(segments[0]!)) {
    on = requireChain(chainSlugForKey(segments[0]!)!);
    rest = segments.slice(1);
    if (rest[0] === undefined) return undefined;
    if (rest[0] === "Portal") return portalAbsence(chain, on);
    if (registryTokenSymbols().has(rest[0])) {
      return (
        `'${rest[0]}' is not a known protocol or family alias: a token is never qualified by a ` +
        `chain. \`${rest[0]}\` alone is the chain's own, compiled for it; another is an address`
      );
    }
    tokens = resolveTokenMap(on).keys();
  }
  const [head, contract] = rest as [string, ...string[]];
  const namespace = resolveNamespace(head);
  const own = [...tokens];
  if (namespace === undefined) {
    // A token the chain has, or a program's own name, is not the registry's to refuse.
    if (own.includes(head) || isChainKey(head)) return undefined;
    const known = registryTokenSymbols().has(head) || rest.length > 1;
    return known ? notOnChain(head, on, own) : undefined;
  }
  if (contract === undefined) {
    return protocolsOn(on).includes(head) ? undefined : notOnChain(head, on, own);
  }
  let descriptor: ContractDescriptor | undefined;
  if (namespace.kind === "family") {
    const owners = namespace.contractOwners.get(contract);
    if (owners !== undefined && owners.length > 1) {
      const candidates = owners.map((slug) => `${pascalOfSlug(slug)}.${contract}`).join(" or ");
      return (
        `"${contract}" is ambiguous under ${namespace.familyKey} (${owners.join(", ")}) — use ` +
        candidates
      );
    }
    const member = owners === undefined ? undefined : resolveNamespace(pascalOfSlug(owners[0]!));
    descriptor = member?.kind === "protocol" ? member.contracts.get(contract) : undefined;
  } else {
    descriptor =
      namespace.contracts.get(contract) ??
      (namespace.defaultContract === undefined
        ? undefined
        : namespace.contracts.get(namespace.defaultContract));
  }
  if (descriptor === undefined) {
    const known =
      namespace.kind === "protocol"
        ? [...namespace.contracts.keys()]
        : [...namespace.contractOwners.keys()];
    const matches = nearMatches(contract, known);
    return (
      `\`${head}.${contract}\` names no contract of ${head}: it has ${known.join(", ")}` +
      (matches.length === 0 ? "" : `. Did you mean \`${head}.${matches[0]}\`?`)
    );
  }
  if (descriptor.kind === "interface") return undefined;
  if (addressOn(descriptor, on) === undefined) return notDeployed(descriptor, on);
  if (descriptor.coverage.typeFidelity === "widened" && options.allowWidenedSelectors !== true) {
    return (
      `${descriptor.protocol}.${descriptor.contract}'s vendored ABI is "widened" (computed ` +
      `selectors do NOT match the deployed contract) — ${descriptor.coverage.caveats.join("; ")} — ` +
      "pass accessors: { allowWidenedSelectors: true } to use it anyway"
    );
  }

  return undefined;
}

/**
 * Why a dotted path a comparison read as 0 is refused — a typo, an ambiguous family name, a token
 * qualified by a chain — or `undefined` when it names something the registry has and `chain` lacks:
 * a real absence, which the comparison decides (`if (UniswapV3.Factory != 0) { … }`).
 */
export function absentPathError(name: string, chain: CanonicalChain): string | undefined {
  // A chain with no Portal from here, or a contract the chain lacks, is what a comparison with zero
  // is for.
  if (name.split(".")[1] === "Portal") return undefined;
  const refusal = absentNameError(name, chain);
  return refusal === undefined || refusal.startsWith("Contract '") ? undefined : refusal;
}

/** Why a program on `source` has no `Portal` of `destination` to open an intent with, or
 *  `undefined` when it has one. */
function portalAbsence(source: CanonicalChain, destination: CanonicalChain): string | undefined {
  if (source.kind !== "evm") {
    return `a program on ${source.slug} opens no intent: the Portals a program publishes through are EVM contracts`;
  }
  if (destination.kind !== "evm") {
    return (
      `an intent a program opens runs its body on an EVM chain: ${destination.slug} runs ` +
      "programs for its Kitchen, which a route call does not issue from here yet"
    );
  }
  for (const chain of [source, destination]) {
    try {
      ecoRoutesPortal(chain);
    } catch (error) {
      return (error as Error).message;
    }
  }
  return undefined;
}

/**
 * A chain's name called as a function — `Arbitrum(() => { … }).reward(…)`, the intent form a
 * program no longer has — reported with the form that replaced it. A chain's name is an instance
 * of its chain's class (`chain-module.ts`), which the compiler refuses to call.
 */
export function chainCalledError(cause: unknown): Error | undefined {
  const message = String((cause as Error | undefined)?.message ?? cause);
  const name = /an instance of `On(\w+)` is not a function/.exec(message)?.[1];
  if (name === undefined || !isChainKey(name)) return undefined;

  return new Error(
    `compileSauceRoute: \`${name}\` is a chain id, not a function: an intent opens with ` +
      `\`${name}.Portal.send(reward).receive(delivery).then(() => { ... })\`. The compiler ` +
      `reported: ${headline(cause) ?? `\`${name}\` is not a function`}`,
    { cause },
  );
}

/**
 * Why `name`, a token or a protocol, is refused on `chain`: it is neither there, what the chain has
 * that it is closest to, and how to name a token the registry does not carry.
 */
export function notOnChain(name: string, chain: CanonicalChain, tokens: Iterable<string>): string {
  return notOnChainAmong(name, chain, [...new Set([...tokens, ...protocolsOn(chain)])]);
}

/** {@link notOnChain}, with the chain's names to match against given: for many names at once. */
export function notOnChainAmong(
  name: string,
  chain: CanonicalChain,
  candidates: readonly string[],
): string {
  const matches = nearMatches(name, candidates);
  const suggestion =
    matches.length === 0
      ? ""
      : ` Did you mean ${matches.map((match) => `\`${match}\``).join(" or ")}?`;

  return (
    `\`${name}\` is not a token or protocol on ${chain.slug}.${suggestion} A token the registry ` +
    "does not carry is `Token(address)`, or a `tokens` entry in the compile options"
  );
}
