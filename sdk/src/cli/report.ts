/**
 * What a compile applied, for `sauce compile --json`: the defines the program reads with the value
 * each one took and where it came from (the command line, or the chain: a token symbol, a protocol
 * contract, the chain id), and the protocol contracts it calls, resolved on their chain.
 *
 * Nothing here decides anything the compile does not: the defines are the ones `withChainAmbient`
 * hands the compiler, filtered to the names the file reads, and the contracts are the ones the
 * protocol rewrite resolved (`accessors.onContract`), reported as it resolved them.
 */
import { parse } from "acorn";
import { getAddressDecoder } from "@solana/kit";
import { getAddress, hexToBytes, numberToHex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { chainDefines } from "../routes/ambient.js";
import { walk, type AstNode } from "../routes/ast-walk.js";
import { liftSignatures } from "../routes/entry.js";
import type { AccessorTarget } from "../routes/protocol-rewrite.js";
import { wrapSauceBody } from "../routes/sauce-route.js";
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

/**
 * Every name the file reads as a value: identifiers outside declarations, member properties and
 * object keys. Defines apply program-wide, so a name read anywhere in the file — an intent body
 * included — is one a define of that name reaches.
 */
export function namesRead(text: string): ReadonlySet<string> {
  const source = liftSignatures(wrapSauceBody(text)).source;
  let program: AstNode;
  try {
    program = parse(source, { ecmaVersion: "latest", sourceType: "module" }) as unknown as AstNode;
  } catch {
    // The compile reports a file it cannot parse; a report of it has nothing to add.
    return new Set();
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
  const names = new Set<string>();
  walk(program, (node) => {
    if (node.type === "Identifier" && !skipped.has(node)) names.add(node.name as string);
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
 * The defines `text`, compiled for `chain` with `user`'s defines, reads: every one of `user` the
 * file reads, and every chain value it reads that no user define replaced. `unread` is each user
 * define the file never reads, which changes nothing.
 */
export function appliedDefines(
  text: string,
  chain: CanonicalChain,
  user: Readonly<Record<string, DefineValue>>,
): { readonly defines: readonly AppliedDefine[]; readonly unread: readonly string[] } {
  const read = namesRead(text);
  const fromChain = chainDefines(chain);
  const kinds = chainKinds(chain);
  const defines: AppliedDefine[] = [];
  for (const [name, value] of Object.entries(user)) {
    if (!read.has(name)) continue;
    const replaced = fromChain[name];
    const address = isAddressKind(kinds.get(name));
    defines.push({
      name,
      value: shownValue(value, chain, replaced !== undefined && address),
      source: "user",
      ...(replaced === undefined ? {} : { replaces: shownValue(replaced, chain, address) }),
    });
  }
  for (const [name, value] of Object.entries(fromChain)) {
    if (!read.has(name) || Object.hasOwn(user, name)) continue;
    const kind = kinds.get(name) ?? "contract";
    defines.push({
      name,
      value: shownValue(value, chain, isAddressKind(kind)),
      source: "chain",
      kind,
    });
  }

  return {
    defines: defines.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    unread: Object.keys(user).filter((name) => !read.has(name)),
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
