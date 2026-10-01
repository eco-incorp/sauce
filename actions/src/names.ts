/**
 * Tokens and protocol contracts by name, as a Sauce program names them.
 *
 * A token field takes a registry symbol (`"USDC"`) and a contract field a namespace reference
 * (`"UniswapV3.Factory"`), beside an address. The generated program carries the NAME — the program
 * global it is — so the compile for a chain resolves it there, exactly as a hand-written program's
 * `USDC` resolves: an action document that names everything is chain-agnostic. This module is the
 * check made first, on the chain being compiled for, so a name that chain lacks is reported with
 * its path, the chain and the name, rather than as the compiler's "not a declared variable".
 *
 * The names come from `routes.sourceGlobals(chain)` — the SDK's own list of what a program compiled
 * for the chain may use, read from the same registries the compile reads — never a second table.
 * The same pass also yields each name's address, for the checks that compare tokens (a swap of a
 * token for itself) and for the quote calls, which are built here rather than compiled.
 */
import { CANONICAL_CHAINS, type CanonicalChain } from "../../sdk/dist/chains/canonical.js";
import { sourceGlobals } from "../../sdk/dist/routes/index.js";

import { ACTION_SPECS, type FieldKind } from "./spec.js";
import type { ProgramIssue } from "./semantics.js";
import type { Action } from "./types.js";

/** A registry token symbol: the registry's own ticker rule (`token-registry.ts`). */
export const TOKEN_SYMBOL_RE = /^[A-Z][A-Z0-9]{1,10}$/;

/** A protocol contract by namespace: `Namespace.Contract`, as a program writes it. */
export const CONTRACT_NAME_RE = /^[A-Z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/;

/** The native currency, where a venue trades it itself: the zero address it keys it as. */
export const NATIVE = "native";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type Address = `0x${string}`;

/** True for a token symbol or a namespace reference — anything but an address or `"native"`. */
export function isName(value: string): boolean {
  return TOKEN_SYMBOL_RE.test(value) || CONTRACT_NAME_RE.test(value);
}

/** A contract a program can name on one chain. */
interface NamedContract {
  readonly address: Address;
  /** Its methods' canonical signatures, as the registry declares them. */
  readonly signatures: ReadonlySet<string>;
}

/** What a program compiled for one chain can name. */
interface ChainNames {
  readonly chain: CanonicalChain;
  readonly tokens: ReadonlyMap<string, Address>;
  /** `Namespace.Contract` -> the contract. */
  readonly contracts: ReadonlyMap<string, NamedContract>;
  /** Namespace -> its contracts on this chain. */
  readonly namespaces: ReadonlyMap<string, readonly string[]>;
}

const cache = new Map<number, ChainNames>();

/** The names a program compiled for `chain` resolves, from `routes.sourceGlobals`. */
export function chainNames(chain: CanonicalChain): ChainNames {
  const cached = cache.get(chain.id);
  if (cached !== undefined) return cached;
  const globals = sourceGlobals(chain);
  const contracts = new Map<string, NamedContract>();
  const namespaces = new Map<string, string[]>();
  for (const ns of globals.protocols) {
    namespaces.set(
      ns.namespace,
      ns.contracts.map((c) => c.name),
    );
    for (const contract of ns.contracts) {
      contracts.set(`${ns.namespace}.${contract.name}`, {
        address: contract.address,
        signatures: new Set(contract.methods.map((m) => m.signature)),
      });
    }
  }
  const names: ChainNames = {
    chain,
    tokens: new Map(globals.tokens.map((t) => [t.symbol, t.address])),
    contracts,
    namespaces,
  };
  cache.set(chain.id, names);

  return names;
}

/** Every EVM chain on which `namespace` has a contract, for a name the compiled chain lacks. */
function chainsWith(namespace: string): CanonicalChain[] {
  return (CANONICAL_CHAINS as readonly CanonicalChain[]).filter(
    (chain) => chain.kind === "evm" && chainNames(chain).namespaces.has(namespace),
  );
}

/** Every namespace any EVM chain has, for a suggestion when a name matches none. */
function allNamespaces(): string[] {
  const all = new Set<string>();
  for (const chain of CANONICAL_CHAINS as readonly CanonicalChain[]) {
    if (chain.kind !== "evm") continue;
    for (const ns of chainNames(chain).namespaces.keys()) all.add(ns);
  }

  return [...all].sort();
}

/** `Base (base, chain 8453)`. */
export function chainLabel(chain: CanonicalChain): string {
  return `${chain.name} (${chain.slug}, chain ${chain.id})`;
}

/** `Base (chain 8453)`: the chain in an issue, under a heading that already gives its slug. */
const onChain = (chain: CanonicalChain): string => `${chain.name} (chain ${chain.id})`;

const list = (names: readonly string[]): string =>
  names.length <= 12 ? names.join(", ") : `${names.slice(0, 12).join(", ")}, …`;

/** The closest of `candidates` to `word`, ignoring case, when it is close enough to be a typo. */
function closest(word: string, candidates: readonly string[]): string | undefined {
  const distance = (a: string, b: string): number => {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]!;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const next = row[j]!;
        row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = next;
      }
    }

    return row[b.length]!;
  };
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = distance(word.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }

  return bestDistance <= Math.max(2, Math.floor(word.length / 4)) ? best : undefined;
}

/** Why `symbol` is not a token on `names.chain`. */
function missingToken(symbol: string, names: ChainNames): string {
  const known = [...names.tokens.keys()].sort();
  const listed =
    known.length === 0 ? "which registers no token symbols" : `whose tokens are ${list(known)}`;
  const hint =
    symbol === "ETH"
      ? '; the native currency is "native" where an action trades it, and wrapped ETH is "WETH"'
      : "";

  return (
    `no token "${symbol}" on ${onChain(names.chain)}, ${listed}${hint} — give its address there ` +
    "instead"
  );
}

/** Why `name` (`Namespace.Contract`) is not a contract a program on `names.chain` can name. */
function missingContract(name: string, names: ChainNames): string {
  const where = onChain(names.chain);
  const [namespace, contract] = name.split(".") as [string, string];
  const here = names.namespaces.get(namespace);
  if (here !== undefined) {
    return `${namespace} on ${where} has no contract "${contract}"; it has ${list(here)}`;
  }
  const elsewhere = chainsWith(namespace);
  if (elsewhere.length > 0) {
    return (
      `no "${name}" on ${where}: ${namespace} is not deployed there (it is on ` +
      `${list(elsewhere.map((c) => c.slug))}) — give the contract's address there instead`
    );
  }
  const hint = closest(namespace, allNamespaces());

  return (
    `no protocol namespace "${namespace}"${hint === undefined ? "" : ` — did you mean ${hint}?`}` +
    " (`sauce globals --chain <chain> --protocols` lists them)"
  );
}

/** One named field's value on the compiled chain: its address, or why it has none. */
function resolveValue(
  value: string,
  names: ChainNames,
): { readonly address: Address } | { readonly problem: string } {
  if (value === NATIVE) return { address: ZERO_ADDRESS };
  if (!isName(value)) return { address: value as Address };
  if (CONTRACT_NAME_RE.test(value)) {
    const found = names.contracts.get(value);

    return found === undefined
      ? { problem: missingContract(value, names) }
      : { address: found.address };
  }
  const token = names.tokens.get(value);

  return token === undefined ? { problem: missingToken(value, names) } : { address: token };
}

/** Walks `value` of `kind`, replacing every name with its address and reporting the missing. */
function walk(
  path: string,
  value: unknown,
  kind: FieldKind,
  names: ChainNames,
  issues: ProgramIssue[],
): unknown {
  switch (kind.k) {
    case "token":
    case "contract":
    case "tokenContract": {
      const found = resolveValue(value as string, names);
      if ("problem" in found) {
        issues.push({ path, message: found.problem });
        return value;
      }
      return found.address;
    }
    case "array":
      return (value as unknown[]).map((item, i) =>
        walk(`${path}[${i}]`, item, kind.of, names, issues),
      );
    case "tuple":
      return (value as unknown[]).map((item, i) =>
        walk(`${path}[${i}]`, item, kind.of[i]!, names, issues),
      );
    case "object": {
      const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
      for (const [key, def] of Object.entries(kind.fields)) {
        if (out[key] !== undefined)
          out[key] = walk(`${path}.${key}`, out[key], def.kind, names, issues);
      }
      return out;
    }
    default:
      return value;
  }
}

/**
 * The method a pool key reads from its factory, by action and key: what a `factory` given by name
 * must declare, so a factory of the wrong kind is refused before it is called.
 */
export function poolLookup(
  action: Action,
): { readonly signature: string; readonly kind: string } | undefined {
  const factory = (action as { factory?: string }).factory;
  if (factory === undefined) return undefined;
  switch (action.type) {
    case "uniswapV2Swap":
      return { signature: "getPair(address,address)", kind: "a Uniswap V2-style factory" };
    case "uniswapV3Swap":
      return action.fee !== undefined
        ? {
            signature: "getPool(address,address,uint24)",
            kind: "a Uniswap V3-style factory, which `fee` keys",
          }
        : {
            signature: "getPool(address,address,int24)",
            kind: "a Slipstream factory, which `tickSpacing` keys",
          };
    case "traderJoeLBSwap":
      return { signature: "getLBPairInformation(address,address,uint256)", kind: "an LBFactory" };
    default:
      return undefined;
  }
}

/** A named `factory` that lacks the method its pool key reads. */
function factoryIssue(action: Action, path: string, names: ChainNames): ProgramIssue | undefined {
  const lookup = poolLookup(action);
  const factory = (action as { factory?: string }).factory;
  if (lookup === undefined || factory === undefined || !CONTRACT_NAME_RE.test(factory)) {
    return undefined;
  }
  const contract = names.contracts.get(factory);
  if (contract === undefined || contract.signatures.has(lookup.signature)) return undefined;
  const fitting = [...names.contracts.entries()]
    .filter(([, c]) => c.signatures.has(lookup.signature))
    .map(([name]) => name)
    .sort();

  return {
    path: `${path}.factory`,
    message:
      `"${factory}" has no ${lookup.signature}: this action's factory is ${lookup.kind}` +
      (fitting.length === 0
        ? ` — ${onChain(names.chain)} has none by name; give its address`
        : ` (on ${onChain(names.chain)}: ${list(fitting)})`),
  };
}

/**
 * Every name in `actions` checked on `chain`: the issues for the ones it lacks, each with its path,
 * and a copy of the actions with every name replaced by its address on that chain.
 */
export function resolveNames(
  actions: readonly Action[],
  chain: CanonicalChain,
  path = "actions",
): { readonly resolved: Action[]; readonly issues: ProgramIssue[] } {
  const names = chainNames(chain);
  const issues: ProgramIssue[] = [];
  const resolved = actions.map((action, i) => {
    const at = `${path}[${i}]`;
    const spec = ACTION_SPECS[action.type];
    const out = walk(at, action, { k: "object", fields: spec.fields }, names, issues) as Action;
    const factory = factoryIssue(action, at, names);
    if (factory !== undefined) issues.push(factory);

    return out;
  });

  return { resolved, issues };
}

/** True when any action names a token or a contract rather than giving its address. */
export function usesNames(actions: readonly Action[]): boolean {
  let found = false;
  const visit = (value: unknown, kind: FieldKind): void => {
    if (found || value === undefined) return;
    if (kind.k === "token" || kind.k === "contract" || kind.k === "tokenContract") {
      found = isName(value as string);
    } else if (kind.k === "array") {
      for (const item of value as unknown[]) visit(item, kind.of);
    } else if (kind.k === "tuple") {
      (value as unknown[]).forEach((item, i) => visit(item, kind.of[i]!));
    } else if (kind.k === "object") {
      for (const [key, def] of Object.entries(kind.fields)) {
        visit((value as Record<string, unknown>)[key], def.kind);
      }
    }
  };
  for (const action of actions)
    visit(action, { k: "object", fields: ACTION_SPECS[action.type].fields });

  return found;
}
