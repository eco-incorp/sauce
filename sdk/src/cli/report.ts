/**
 * What a compile applied, for `sauce compile --json`: the defines the program reads with the value
 * each one took, where it came from (the command line, or the chain: a token symbol, a protocol
 * contract, the chain id) and the chain it applied on, and the protocol contracts it calls,
 * resolved on their chain.
 *
 * Nothing here decides anything the compile does not. The defines follow the compile's own rule
 * (`sauce-route.ts#chainModules`): the program reads the values of the chain it is compiled for,
 * and a user define named like one of them replaces it there. The contracts are the registry names the file writes, resolved by the same rules the
 * chain's module of names is written by (`protocol-names.ts`).
 */
import { getAddressDecoder } from "@solana/kit";
import { getAddress, hexToBytes, numberToHex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { chainDefines } from "../routes/ambient.js";
import { walk, type AstNode } from "../routes/ast-walk.js";
import { parseSauce } from "../routes/parse.js";
import { resolveContractReference } from "../routes/protocol-names.js";
import { isChainKey, resolveNamespace } from "../routes/accessor-index.js";
import { addressOn } from "../descriptors/query.js";
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

/**
 * Every name the file reads as a value: identifiers outside declarations, member properties and
 * object keys, with annotations and type declarations stepped over (the file is parsed as the
 * compile's rewrites parse it, as written).
 */
export function namesRead(text: string): readonly string[] {
  let program: AstNode;
  try {
    program = parseSauce(text);
  } catch {
    // The compile reports a file it cannot parse; a report of it has nothing to add.
    return [];
  }
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
  const names: string[] = [];
  walk(program, (node) => {
    if (node.type !== "Identifier" || skipped.has(node)) return;
    names.push(node.name as string);
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

/**
 * The defines `text`, compiled for `chain` with `user`'s defines, reads: a user define where the
 * program reads it, and otherwise the value the chain sets. `unread` is each user define the
 * program never reads, which changes nothing.
 */
export function appliedDefines(
  text: string,
  chain: CanonicalChain,
  user: Readonly<Record<string, DefineValue>>,
  addresses: ReadonlySet<string> = new Set(),
): { readonly defines: readonly AppliedDefine[]; readonly unread: readonly string[] } {
  const applied = new Map<string, AppliedDefine>();
  const used = new Set<string>();
  const fromChain = chainDefines(chain);
  const kinds = chainKinds(chain);
  for (const name of namesRead(text)) {
    const key = `${chain.slug} ${name}`;
    if (applied.has(key)) continue;
    const address = isAddressKind(kinds.get(name));
    if (Object.hasOwn(user, name)) {
      used.add(name);
      const replaced = fromChain[name];
      applied.set(key, {
        name,
        value: shownValue(
          user[name]!,
          chain,
          (replaced !== undefined && address) || addresses.has(name),
        ),
        source: "user",
        ...(replaced === undefined ? {} : { replaces: shownValue(replaced, chain, address) }),
        chain: chain.slug,
      });
    } else if (Object.hasOwn(fromChain, name)) {
      const kind = kinds.get(name) ?? "contract";
      applied.set(key, {
        name,
        value: shownValue(fromChain[name]!, chain, isAddressKind(kind)),
        source: "chain",
        kind,
        chain: chain.slug,
      });
    }
  }
  const byName = (a: AppliedDefine, b: AppliedDefine): number =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.chain < b.chain ? -1 : 1;

  return {
    defines: [...applied.values()].sort(byName),
    unread: Object.keys(user).filter((name) => !used.has(name)),
  };
}

/**
 * The protocol contracts `text` names, each resolved on `chain`, or on the chain a qualified name
 * names:
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
    for (const take of [2, 1]) {
      if (rest.length < take) continue;
      try {
        const found = resolveContractReference(
          qualified ? head : rest[0]!,
          qualified ? rest.slice(0, take) : rest.slice(1, take),
          chain,
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
  });

  return [...seen.values()].sort(
    (a, b) => a.chain.localeCompare(b.chain) || (a.reference < b.reference ? -1 : 1),
  );
}
