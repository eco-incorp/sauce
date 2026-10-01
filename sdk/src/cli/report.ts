/**
 * What a compile applied, for `sauce compile --json`: the defines the program reads with the value
 * each one took, where it came from (the command line, or the chain: a token symbol, a protocol
 * contract, the chain id) and the chain it applied on, and the protocol contracts it calls,
 * resolved on their chain.
 *
 * Nothing here decides anything the compile does not. The defines follow the compile's own rule
 * (`sauce-route.ts#levelOn`): each part of the program reads its own chain's values — an intent's
 * body and delivery the destination's, its reward the enclosing chain's — and a user define named
 * like a chain-scoped value stays on the chain it was given for, while any other holds at every
 * depth. The contracts are the ones the compile resolved (`accessors.onContract`).
 */
import { getAddressDecoder } from "@solana/kit";
import { getAddress, hexToBytes, numberToHex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { chainDefines } from "../routes/ambient.js";
import { walk, type AstNode } from "../routes/ast-walk.js";
import { parseSauce } from "../routes/parse.js";
import type { AccessorTarget } from "../routes/protocol-rewrite.js";
import { chainAccessorNames } from "../routes/sauce-route.js";
import { resolveTokenMap } from "../routes/token-registry.js";
import { pascalOfSlug } from "../routes/builder.js";
import type { DefineValue } from "./args.js";

/** One define the program reads, as the compile applied it. */
export interface AppliedDefine {
  readonly name: string;
  /** An address-sized value as an address (base58 on Solana), any other in decimal. */
  readonly value: string | boolean;
  /** `user`: `--define` or `--defines`. `chain`: what compiling for the chain sets. */
  readonly source: "user" | "chain";
  /** For a chain value: what it is. */
  readonly kind?: "token" | "contract" | "chain id";
  /** A user define that replaced a value the chain sets: that value. */
  readonly replaces?: string | boolean;
  /** The chain it applied on: the program's, or that of an intent body that reads it. */
  readonly chain: string;
}

/** One protocol contract the program names, resolved. */
export interface UsedContract {
  /** As the program wrote it: `UniswapV3.Factory`, `Base.UniswapV3.Factory`, `Cctp`. */
  readonly reference: string;
  /** The contract it resolved to: `UniswapV3.Factory`. */
  readonly contract: string;
  /** The chain whose deployment it is: an intent body's resolve on the intent's chain. */
  readonly chain: string;
  readonly address: string;
}

/**
 * A define's value as the report shows it: an address as an address (a base58 key on Solana), any
 * other number in decimal. `address` says it is one (a chain's token or contract); otherwise a
 * value is taken for an address only where a number seldom is — 20 bytes with the top ones set, or
 * on Solana 32 — so a price or an amount reads as the number it is.
 */
export function shownValue(
  value: DefineValue | number,
  chain: CanonicalChain,
  address = false,
): string | boolean {
  if (typeof value === "boolean") return value;
  const word = BigInt(value);
  if (chain.kind === "svm") {
    return word < 1n << 256n && (address || word >= 1n << 200n)
      ? getAddressDecoder().decode(hexToBytes(numberToHex(word, { size: 32 })))
      : word.toString();
  }

  return word < 1n << 160n && (address || word >= 1n << 140n)
    ? getAddress(numberToHex(word, { size: 20 }))
    : word.toString();
}

/** A source range that runs on another chain: an intent's body or its delivery argument. */
interface IntentPart {
  readonly chain: CanonicalChain;
  readonly start: number;
  readonly end: number;
}

/** The parts of `program` each intent it opens runs on its destination, as the intent lowering
 *  finds them: `Chain(() => { body }, delivery).reward(reward)`, the reward left out. */
function intentParts(program: AstNode): IntentPart[] {
  const chains = chainAccessorNames();
  const parts: IntentPart[] = [];
  walk(program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee as AstNode | undefined;
    if (callee?.type !== "MemberExpression" || callee.computed === true) return;
    if ((callee.property as AstNode | undefined)?.name !== "reward") return;
    const opener = callee.object as AstNode | undefined;
    if (opener?.type !== "CallExpression") return;
    const name = (opener.callee as AstNode | undefined)?.name;
    const chain = typeof name === "string" ? chains.get(name) : undefined;
    const [body, delivery] = (opener.arguments as AstNode[] | undefined) ?? [];
    if (chain === undefined || body?.type !== "ArrowFunctionExpression") return;
    for (const part of [body, delivery]) {
      if (part !== undefined) parts.push({ chain, start: part.start, end: part.end });
    }
  });

  return parts;
}

/** A name the file reads, and the chains of the intents it is read inside, outermost first. */
interface ReadName {
  readonly name: string;
  readonly path: readonly CanonicalChain[];
}

/**
 * Every name the file reads as a value: identifiers outside declarations, member properties and
 * object keys, with annotations and type declarations stepped over (the file is parsed as the
 * compile's rewrites parse it, as written). Each comes with the chains of the intent bodies it is
 * read inside, which decide what it resolves to.
 */
export function namesRead(text: string): readonly ReadName[] {
  let program: AstNode;
  try {
    program = parseSauce(text);
  } catch {
    // The compile reports a file it cannot parse; a report of it has nothing to add.
    return [];
  }
  const parts = intentParts(program);
  const skipped = new Set<AstNode>();
  walk(program, (node) => {
    const at = node as AstNode & Record<string, AstNode | undefined>;
    if (node.type === "MemberExpression" && node.computed !== true) skipped.add(at.property!);
    if (node.type === "Property" && node.computed !== true && node.shorthand !== true) {
      skipped.add(at.key!);
    }
    if (node.type === "VariableDeclarator") skipped.add(at.id!);
    if (node.type === "FunctionDeclaration" && at.id !== undefined) skipped.add(at.id);
    if (node.type === "ImportSpecifier" || node.type === "ImportDefaultSpecifier") {
      skipped.add(at.local!);
      if (at.imported !== undefined) skipped.add(at.imported);
    }
  });
  const names: ReadName[] = [];
  walk(program, (node) => {
    if (node.type !== "Identifier" || skipped.has(node)) return;
    const path = parts
      .filter((part) => part.start <= node.start && node.end <= part.end)
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .map((part) => part.chain);
    names.push({ name: node.name as string, path });
  });

  return names;
}

const isAddressKind = (kind: AppliedDefine["kind"]): boolean =>
  kind === "token" || kind === "contract";

/** What each name `chainDefines` sets for `chain` is. */
function chainKinds(chain: CanonicalChain): ReadonlyMap<string, AppliedDefine["kind"]> {
  const kinds = new Map<string, AppliedDefine["kind"]>();
  for (const name of Object.keys(chainDefines(chain))) kinds.set(name, "contract");
  for (const symbol of resolveTokenMap(chain).keys()) kinds.set(symbol, "token");
  kinds.set("chainId", "chain id");
  kinds.set("CHAIN_ID", "chain id");

  return kinds;
}

/** A user define that changes nothing: the file never reads it, or reads it only inside intents
 *  on other chains (`readOn`), where a chain-scoped name is that chain's own. */
export interface UnreadDefine {
  readonly name: string;
  readonly readOn: readonly string[];
}

/** The user defines a level on `path`'s last chain still has: entering an intent on another
 *  chain drops each one named like a chain-scoped value of either chain (`levelOn`). */
function userDefinesOn(
  chain: CanonicalChain,
  path: readonly CanonicalChain[],
  user: Readonly<Record<string, DefineValue>>,
): Readonly<Record<string, DefineValue>> {
  let defines = user;
  let enclosing = chain;
  for (const destination of path) {
    if (destination.id !== enclosing.id) {
      const scoped = new Set([
        ...Object.keys(chainDefines(enclosing)),
        ...Object.keys(chainDefines(destination)),
      ]);
      defines = Object.fromEntries(Object.entries(defines).filter(([name]) => !scoped.has(name)));
    }
    enclosing = destination;
  }

  return defines;
}

/**
 * The defines `text`, compiled for `chain` with `user`'s defines, reads, each on the chain it
 * applied on: a user define where the part of the program reading it still has it, and otherwise
 * the value that part's chain sets. `unread` is each user define no part reads where it applies,
 * which changes nothing.
 */
export function appliedDefines(
  text: string,
  chain: CanonicalChain,
  user: Readonly<Record<string, DefineValue>>,
): { readonly defines: readonly AppliedDefine[]; readonly unread: readonly UnreadDefine[] } {
  const applied = new Map<string, AppliedDefine>();
  const used = new Set<string>();
  const readOn = new Map<string, Set<string>>();
  for (const { name, path } of namesRead(text)) {
    const on = path.at(-1) ?? chain;
    const key = `${on.slug} ${name}`;
    readOn.set(name, (readOn.get(name) ?? new Set()).add(on.slug));
    if (applied.has(key)) continue;
    const fromChain = chainDefines(on);
    const kinds = chainKinds(on);
    const address = isAddressKind(kinds.get(name));
    const users = userDefinesOn(chain, path, user);
    if (Object.hasOwn(users, name)) {
      used.add(name);
      const replaced = fromChain[name];
      applied.set(key, {
        name,
        value: shownValue(users[name]!, on, replaced !== undefined && address),
        source: "user",
        ...(replaced === undefined ? {} : { replaces: shownValue(replaced, on, address) }),
        chain: on.slug,
      });
    } else if (Object.hasOwn(fromChain, name)) {
      const kind = kinds.get(name) ?? "contract";
      applied.set(key, {
        name,
        value: shownValue(fromChain[name]!, on, isAddressKind(kind)),
        source: "chain",
        kind,
        chain: on.slug,
      });
    }
  }
  const byName = (a: AppliedDefine, b: AppliedDefine): number =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.chain < b.chain ? -1 : 1;

  return {
    defines: [...applied.values()].sort(byName),
    unread: Object.keys(user)
      .filter((name) => !used.has(name))
      .map((name) => ({ name, readOn: [...(readOn.get(name) ?? [])].sort() })),
  };
}

/** Collects the contracts a compile resolves, through `accessors.onContract`. */
export function contractCollector(): {
  readonly onContract: (reference: string, target: AccessorTarget) => void;
  readonly contracts: () => readonly UsedContract[];
} {
  const seen = new Map<string, UsedContract>();

  return {
    onContract: (reference, target) => {
      const used: UsedContract = {
        reference,
        contract: `${pascalOfSlug(target.protocol)}.${target.contract}`,
        chain: target.chain.slug,
        address: getAddress(target.address),
      };
      seen.set(`${used.chain} ${reference}`, used);
    },
    contracts: () =>
      [...seen.values()].sort(
        (a, b) => a.chain.localeCompare(b.chain) || (a.reference < b.reference ? -1 : 1),
      ),
  };
}
