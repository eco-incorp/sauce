/**
 * A name used as a token or a protocol that the destination does not have, reported as that.
 *
 * `DAIX.balanceOf(x)` and `Uniswapp.UniversalRouter` name nothing: not a registered token, not a
 * protocol, not a declaration of the program and not a builtin. The token and protocol rewrites
 * leave a name they do not know alone, which is right for them, so it reached the compiler, and the
 * compiler could only say "`this call expression` cannot be lowered to IR yet". The route compiler
 * knows what the chain has, so it says which name, on which chain, and what it probably meant.
 *
 * Consulted only once the compiler has refused the program (`sauce-route.ts`), on the source it
 * refused. So a program the compiler accepts is never refused here, and a name only the compiler
 * knows — an export of an ambient module — cannot be mistaken for an unknown one. By then a
 * registered token is a define, and every protocol namespace and chain key the registry knows has
 * been resolved, or refused with the protocol rewrite's own error.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import { addressOn } from "../descriptors/query.js";
import { collectDeclaredNames, walk, type AstNode } from "./ast-walk.js";
import { isChainKey, NAMESPACE_KEYS, resolveNamespace } from "./accessor-index.js";
import { pascalOfSlug } from "./builder.js";
import { parseSauce } from "./parse.js";
import { BALANCE_MEMBER, POT_NAME, RETIRED_POT_NAME, selfRefusal } from "./pot-sugar.js";

/** The compiler's own namespace roots, and the `pot` sugar the protocol rewrite resolves. */
const BUILTIN_ROOTS: ReadonlySet<string> = new Set([
  "ctx",
  "crypto",
  "Math",
  "abi",
  "evm",
  "svm",
  POT_NAME,
]);

/** What else gives a name meaning in this compile, beside the program's own declarations. */
export interface KnownNames {
  /** Every compile-time value the compile defines: token symbols, chain values, caller defines. */
  readonly defines: Iterable<string>;
  /** Contract bindings the caller supplies (`compile.contracts`). */
  readonly contracts: Iterable<string>;
  /** The chain's registered token symbols, for suggestions. */
  readonly tokens: Iterable<string>;
}

/** Optimal string alignment distance: edits, with an adjacent swap counting as one. */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      }
      rows[i]![j] = best;
    }
  }
  return rows[a.length]![b.length]!;
}

/** The protocol namespaces with at least one contract deployed on `chain`. */
function protocolsOn(chain: CanonicalChain): string[] {
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
 * For a compile that failed with `cause`: an error naming the first member access (`X.y`,
 * `X.y(...)`) whose root `X` nothing gives meaning to on `chain`, with the chain's near matches
 * among its tokens and protocols. `undefined` when there is none, and the compiler's error stands.
 */
export function unknownGlobalError(
  source: string,
  chain: CanonicalChain,
  known: KnownNames,
  cause: unknown,
): Error | undefined {
  const program = parseSauce(source);
  const meaningful = new Set([
    ...collectDeclaredNames(program),
    ...known.defines,
    ...known.contracts,
    ...BUILTIN_ROOTS,
  ]);
  let unknown: AstNode | undefined;
  walk(program, (node) => {
    if (unknown !== undefined || node.type !== "MemberExpression") return;
    if ((node as { computed?: boolean }).computed === true) return;
    const object = (node as { object?: AstNode }).object;
    if (object?.type !== "Identifier") return;
    const name = (object as unknown as { name: string }).name;
    if (meaningful.has(name) || isChainKey(name) || resolveNamespace(name) !== undefined) return;
    unknown = object;
  });
  if (unknown === undefined) return undefined;
  const name = (unknown as unknown as { name: string }).name;
  // `self.X` reaches here only where the protocol rewrite, which refuses `self`, did not run.
  if (name === RETIRED_POT_NAME) return selfRefusal(RETIRED_POT_NAME, POT_NAME);
  const matches = nearMatches(name, [...known.tokens, ...protocolsOn(chain)]);
  const suggestion =
    matches.length === 0
      ? ""
      : ` Did you mean ${matches.map((match) => `\`${match}\``).join(" or ")}?`;
  const compiler = headline(cause);
  return new Error(
    `compileSauceRoute: \`${name}\` is not a token or protocol on ${chain.slug}.${suggestion} ` +
      "A token the registry does not carry is `Token(address)`, or a `tokens` entry in the " +
      "compile options; a contract binding needs its ABI imported, or passed as `contracts`." +
      (compiler === undefined ? "" : ` The compiler reported: ${compiler}`),
    { cause },
  );
}

/** The ANSI escapes the compiler's message is styled with. */
const STYLE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * For a compile that failed reading a member of a value that is no record — `pot.USDCC`,
 * `to.WETHH` — an error saying the name is not a token on `chain`, with the near matches among its
 * tokens and `balance`: a balance read misspelled, which the balance shorthand left as it was
 * written. `x.balance` left as written on a value whose type the text does not show
 * (`balance-holder.ts#readsField`) is read as its native coin by `ctx.balance(x)`, which the error
 * names. The compiler says where (`field access is only valid on a tuple (bytes a..b)`), so a
 * real record's field, whose miss the compiler reports another way, is never taken for one.
 * `undefined` for any other failure, and the compiler's error stands.
 */
export function unknownBalanceError(
  source: string,
  chain: CanonicalChain,
  names: { readonly tokens: Iterable<string> },
  cause: unknown,
): Error | undefined {
  const message = String((cause as Error | undefined)?.message ?? cause).replace(STYLE, "");
  const at = /field access is only valid on a tuple \(bytes (\d+)\.\.(\d+)\)/.exec(message);
  if (at === null) return undefined;
  // The compiler counts bytes; the parse counts UTF-16 units.
  const bytes = new TextEncoder().encode(source);
  const unit = (offset: number): number =>
    new TextDecoder().decode(bytes.subarray(0, offset)).length;
  const [start, end] = [unit(Number(at[1])), unit(Number(at[2]))];
  let member: AstNode | undefined;
  walk(parseSauce(source), (node) => {
    if (member !== undefined || node.type !== "MemberExpression") return;
    if ((node as { computed?: boolean }).computed === true) return;
    if (node.start === start && node.end === end) member = node;
  });
  const property = (member as { property?: AstNode } | undefined)?.property;
  if (property?.type !== "Identifier") return undefined;

  const name = (property as unknown as { name: string }).name;
  const object = member!.object as AstNode;
  const holder = source.slice(object.start, object.end);
  if (name === BALANCE_MEMBER) {
    return new Error(
      `compileSauceRoute: \`${holder}.${name}\` was read as a field of \`${holder}\`, which has ` +
        `none: \`${holder}\` is a value whose type the program's text does not show (a contract ` +
        `call's result, a record's member or an import may be a struct with a \`${BALANCE_MEMBER}\` ` +
        `field), so \`.${BALANCE_MEMBER}\` is left to the compiler there. For its native coin write ` +
        `\`ctx.balance(${holder})\`, or bind it to a local declared \`Address\` first.`,
      { cause },
    );
  }
  const matches = nearMatches(name, [...names.tokens, BALANCE_MEMBER]);
  const suggestion =
    matches.length === 0
      ? ""
      : ` Did you mean ${matches.map((match) => `\`${match}\``).join(" or ")}?`;
  return new Error(
    `compileSauceRoute: \`${name}\` is not a token on ${chain.slug}.${suggestion} ` +
      `\`<holder>.<TOKEN>\` reads the holder's balance of a token the chain registers, and ` +
      `\`<holder>.${BALANCE_MEMBER}\` its native coin; a value that is not a record has no other member.`,
    { cause },
  );
}
