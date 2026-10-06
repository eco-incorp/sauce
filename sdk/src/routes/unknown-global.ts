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
import { addressOn } from "../descriptors/query.js";
import { isChainKey, NAMESPACE_KEYS, resolveNamespace } from "./accessor-index.js";
import { pascalOfSlug } from "./builder.js";

/** The diagnostics a name nothing declares produces: an unknown value, or a call of one. */
const UNKNOWN_CODES: ReadonlySet<string> = new Set(["UnknownIdentifier", "UnresolvedCall"]);

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
 * first name the compiler could not resolve whose root is a dotted member (`X.y`, `X.y(...)`), with
 * the chain's near matches among `tokens` and its protocols. `undefined` when there is none, and the
 * compiler's error stands.
 */
export function unknownGlobalError(
  source: string,
  entry: string,
  chain: CanonicalChain,
  tokens: Iterable<string>,
  cause: unknown,
): Error | undefined {
  const diagnostics =
    (cause as { diagnostics?: readonly Located[] } | undefined)?.diagnostics ?? [];
  const name = diagnostics
    .filter((d) => d.path === entry && d.code !== undefined && UNKNOWN_CODES.has(d.code))
    // The name as written, when it is the root of a member access: the span is the access, or
    // the root alone with a `.` after it.
    .map((d) => {
      const text = source.slice(d.start.offset, d.end.offset);
      const root = /^[A-Za-z_$][\w$]*/.exec(text)?.[0];
      const member =
        root !== undefined &&
        (text[root.length] === "." || (text === root && source[d.end.offset] === "."));
      return root !== undefined && member ? root : undefined;
    })
    .find((root): root is string => root !== undefined);
  if (name === undefined) return undefined;

  const compiler = headline(cause);
  return new Error(
    `compileSauceRoute: ${notOnChain(name, chain, tokens)}; a contract binding needs its ABI ` +
      "imported, or passed as `contracts`." +
      (compiler === undefined ? "" : ` The compiler reported: ${compiler}`),
    { cause },
  );
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
