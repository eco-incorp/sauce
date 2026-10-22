/**
 * What a compile applied, for `sauce compile --json`: the defines the program reads with the value
 * each one took, where it came from (the command line, or the chain: a token symbol, a protocol
 * contract, the chain id) and the chain it applied on, and the protocol contracts it calls,
 * resolved on their chain.
 *
 * Nothing here decides anything the compile does not. The defines follow the compile's own rule: a
 * user define replaces the value the chain sets under the same name, and every other name the
 * program reads takes the chain's. The contracts are the ones the protocol rewrite resolved
 * (`accessors.onContract`).
 */
import { getAddressDecoder } from "@solana/kit";
import { getAddress, hexToBytes, numberToHex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { chainDefines } from "../routes/ambient.js";
import { walk, type AstNode } from "../routes/ast-walk.js";
import { parseSauce } from "../routes/parse.js";
import { resolveNamespace } from "../routes/accessor-index.js";
import { collectValuePositionExclusions } from "../routes/token-rewrite.js";
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
  /** The chain it applied on: the program's. */
  readonly chain: string;
}

/** One protocol contract the program names, resolved. */
export interface UsedContract {
  /** As the program wrote it: `UniswapV3.Factory`, `Base.UniswapV3.Factory`, `Cctp`. */
  readonly reference: string;
  /** The contract it resolved to: `UniswapV3.Factory`. */
  readonly contract: string;
  /** The chain whose deployment it is: the program's, or the chain a reference names
   *  (`Base.UniswapV3.Factory`). */
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

/** A name the file reads. */
interface ReadName {
  readonly name: string;
  /** Read as a holder's balance, `pot.USDC`: a name only a token symbol is read as. */
  readonly balance?: true;
}

/**
 * `<holder>.<name>` as the token syntax reads a balance (`token-rewrite.ts#collectBalanceSites`):
 * a value, on any holder but a chain's or a protocol's own name. Its property names the token.
 */
function isBalanceRead(
  node: AstNode,
  excluded: ReadonlySet<AstNode>,
  chains: ReadonlyMap<string, CanonicalChain>,
): boolean {
  const object = node.object as AstNode | undefined;
  if (node.computed === true || excluded.has(node) || object === undefined) return false;
  if (object.type !== "Identifier") return true;
  const name = object.name as string;

  return !chains.has(name) && resolveNamespace(name) === undefined;
}

/**
 * Every name the file reads as a value: identifiers outside declarations, member properties and
 * object keys, with annotations and type declarations stepped over (the file is parsed as the
 * compile's rewrites parse it, as written).
 */
export function namesRead(text: string): readonly ReadName[] {
  let program: AstNode;
  try {
    program = parseSauce(text);
  } catch {
    // The compile reports a file it cannot parse; a report of it has nothing to add.
    return [];
  }
  const chains = chainAccessorNames();
  const excluded = collectValuePositionExclusions(program);
  const skipped = new Set<AstNode>();
  const balances = new Set<AstNode>();
  walk(program, (node) => {
    const at = node as AstNode & Record<string, AstNode | undefined>;
    if (node.type === "MemberExpression" && node.computed !== true) {
      if (isBalanceRead(node, excluded, chains)) balances.add(at.property!);
      else skipped.add(at.property!);
    }
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
    names.push({
      name: node.name as string,
      ...(balances.has(node) ? { balance: true as const } : {}),
    });
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
  for (const { name, balance } of namesRead(text)) {
    if (balance === true && kinds.get(name) !== "token") continue;
    if (applied.has(name)) continue;
    const address = isAddressKind(kinds.get(name));
    if (Object.hasOwn(user, name)) {
      used.add(name);
      const replaced = fromChain[name];
      applied.set(name, {
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
      applied.set(name, {
        name,
        value: shownValue(fromChain[name]!, chain, isAddressKind(kind)),
        source: "chain",
        kind,
        chain: chain.slug,
      });
    }
  }
  const byName = (a: AppliedDefine, b: AppliedDefine): number => (a.name < b.name ? -1 : 1);

  return {
    defines: [...applied.values()].sort(byName),
    unread: Object.keys(user).filter((name) => !used.has(name)),
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
