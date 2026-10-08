/**
 * What a compile applied, for `sauce compile --json`: the defines the program reads with the value
 * each one took, where it came from (the command line, or the chain: a token symbol, a protocol
 * contract, the chain id) and the chain it applied on, and the protocol contracts it calls,
 * resolved on their chain.
 *
 * Nothing here decides anything the compile does not. The defines follow the compile's own rule
 * (`sauce-route.ts#chainModules`): each part of the program reads its own chain's values — an
 * intent's body and delivery the destination's, its reward the enclosing chain's — and a user
 * define named like a chain-scoped value stays on the chain it was given for, while any other holds
 * at every depth. The contracts are the registry names the file writes, resolved by the same rules
 * the chain's module of names is written by (`protocol-names.ts`).
 */
import { getAddressDecoder } from "@solana/kit";
import { getAddress, hexToBytes, numberToHex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { chainDefines } from "../routes/ambient.js";
import { walk, type AstNode } from "../routes/ast-walk.js";
import { parseSauce } from "../routes/parse.js";
import { resolveContractReference } from "../routes/protocol-names.js";
import { resolveNamespace } from "../routes/accessor-index.js";
import { addressOn } from "../descriptors/query.js";
import { intentParts, pathsAt } from "../routes/intent-parts.js";
import { isChainKey } from "../routes/accessor-index.js";
import { resolveTokenMap } from "../routes/token-registry.js";
import { pascalOfSlug } from "../routes/pascal.js";
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
 * A define's value as the report shows it: an address as an address (a base58 key on Solana) when
 * `address` says it is one — a chain's token or contract, or a value written as one — and any
 * other number as the integer it is. Nothing is guessed from the size: a price limit near 2^160
 * reads as the number it is.
 */
export function shownValue(
  value: DefineValue | number,
  chain: CanonicalChain,
  address = false,
): string | boolean {
  if (typeof value === "boolean") return value;
  const word = BigInt(value);
  if (!address) return word.toString();

  return chain.kind === "svm"
    ? getAddressDecoder().decode(hexToBytes(numberToHex(word, { size: 32 })))
    : getAddress(numberToHex(word, { size: 20 }));
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
    for (const path of pathsAt(parts, node.start, node.end)) {
      names.push({ name: node.name as string, path });
    }
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
  addresses: ReadonlySet<string> = new Set(),
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
        value: shownValue(
          users[name]!,
          on,
          (replaced !== undefined && address) || addresses.has(name),
        ),
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

/**
 * The protocol contracts `text` names, each resolved on the chain the part naming it runs on — an
 * intent's body on its destination, the rest on `chain` — or on the chain a qualified name names:
 * `UniswapV3.Factory`, a family's `Uniswap.UniversalRouter`, a protocol's one contract `AaveV3`, and
 * `Ethereum.AaveV3.Pool`. A name the chain does not deploy is left out, as the compile refuses it.
 */
export function usedContracts(text: string, chain: CanonicalChain): readonly UsedContract[] {
  let program: AstNode;
  try {
    program = parseSauce(text);
  } catch {
    return [];
  }
  const parts = intentParts(program);
  const seen = new Map<string, UsedContract>();
  const inner = new Set<AstNode>();
  walk(program, (node) => {
    if (node.type === "MemberExpression") inner.add(node.object as AstNode);
  });
  walk(program, (node) => {
    if (node.type !== "MemberExpression" || inner.has(node)) return;
    const path: string[] = [];
    let at: AstNode = node;
    while (at.type === "MemberExpression" && at.computed !== true) {
      path.unshift((at.property as AstNode).name as string);
      at = at.object as AstNode;
    }
    if (at.type !== "Identifier") return;
    const head = at.name as string;
    const qualified = isChainKey(head);
    const rest = qualified ? path : [head, ...path];
    if (rest.length === 0 || resolveNamespace(rest[0]!) === undefined) return;
    // A name in a `try`'s handler runs on every chain the handler does.
    const chains = new Set(
      pathsAt(parts, node.start, node.end).map((each) => each.at(-1) ?? chain),
    );
    for (const on of chains) {
      for (const take of [2, 1]) {
        if (rest.length < take) continue;
        try {
          const found = resolveContractReference(
            qualified ? head : rest[0]!,
            qualified ? rest.slice(0, take) : rest.slice(1, take),
            on,
            undefined,
            "",
            "",
          );
          const address = addressOn(found.descriptor, found.chain);
          if (address === undefined) break;
          const reference = [...(qualified ? [head] : []), ...rest.slice(0, take)].join(".");
          seen.set(`${found.chain.slug} ${reference}`, {
            reference,
            contract: `${pascalOfSlug(found.protocol)}.${found.contract}`,
            chain: found.chain.slug,
            address: getAddress(address),
          });
          break;
        } catch {
          // Not a contract with that many segments: try fewer.
        }
      }
    }
  });

  return [...seen.values()].sort(
    (a, b) => a.chain.localeCompare(b.chain) || (a.reference < b.reference ? -1 : 1),
  );
}
