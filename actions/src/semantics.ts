/**
 * The rules an action list must satisfy beyond each action's own shape: where every amount comes
 * from, and that every value a source action produces is read. `program.ts` runs the structural
 * checks first, so by the time these run every field has its declared type.
 */
import { getChain, nativeErc20 } from "../../sdk/dist/chains/index.js";

import { ACTION_SPECS } from "./spec.js";
import type { Action, ActionType } from "./types.js";

/** One problem with a program, located by a path into the document (`actions[2].amountRef`). */
export interface ProgramIssue {
  readonly path: string;
  readonly message: string;
}

/** Thrown for a program that breaks any rule. `issues` lists every problem found, in order. */
export class ProgramError extends Error {
  readonly issues: readonly ProgramIssue[];

  constructor(issues: readonly ProgramIssue[]) {
    super(
      `invalid action program (${issues.length} ${issues.length === 1 ? "issue" : "issues"}):\n` +
        issues.map((i) => `  ${i.path}: ${i.message}`).join("\n"),
    );
    this.name = "ProgramError";
    this.issues = issues;
  }
}

/** A chaining name becomes a SauceScript local, so it has to be spellable as one. */
export const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function field(action: Action, key: "amount" | "amountRef"): string | undefined {
  return (action as { amount?: string; amountRef?: string })[key];
}

/** True when `action` spends the previous action's output: it could take an amount, and has none. */
export function consumesPrevious(action: Action): boolean {
  return (
    ACTION_SPECS[action.type].spends &&
    field(action, "amount") === undefined &&
    field(action, "amountRef") === undefined
  );
}

/**
 * Actions that exist only because the native coin is ETH with a canonical WETH9: they wrap or
 * unwrap it, or stake it as ETH. Where the native coin is itself an ERC-20 (Arc's USDC) none of
 * them has a meaning — there is nothing to wrap, and native value is not ETH.
 */
const NATIVE_ETH_ACTIONS: ReadonlySet<ActionType> = new Set([
  "wrapETH",
  "unwrapETH",
  "lidoStake",
  "rocketPoolStake",
  "etherFiStake",
]);

/** The actions that read `actions[i]`'s output: the next one implicitly, or later ones by name. */
function readersOf(actions: readonly Action[], i: number): number[] {
  const readers: number[] = [];
  const next = actions[i + 1];
  if (next !== undefined && consumesPrevious(next)) readers.push(i + 1);
  const name = actions[i]!.saveOutputAs;
  if (name === undefined) return readers;
  for (let k = i + 1; k < actions.length; k++) {
    if (field(actions[k]!, "amountRef") === name && !readers.includes(k)) readers.push(k);
    // A later action saving the same name reassigns it; readers after that read the new value.
    if (actions[k]!.saveOutputAs === name) break;
  }
  return readers;
}

/**
 * The rules a chain whose native coin is an ERC-20 adds (Arc: USDC, 18 decimals natively and 6
 * through the ERC-20 at `0x3600…0000`, one balance). Empty on every other chain.
 */
function nativeErc20Issues(actions: readonly Action[], chainId: number): ProgramIssue[] {
  const erc20 = nativeErc20(chainId);
  const chain = getChain(chainId);
  if (erc20 === undefined || chain === undefined) return [];
  const native = chain.nativeCurrency;
  const where = `${chain.name} (chain ${chainId})`;
  const issues: ProgramIssue[] = [];

  actions.forEach((action, i) => {
    if (NATIVE_ETH_ACTIONS.has(action.type)) {
      issues.push({
        path: `actions[${i}]`,
        message:
          `${action.type} needs native ETH and a canonical WETH9, and ${where} has neither: ` +
          `its native coin is ${native.symbol}, which is already the ERC-20 at ${erc20.address}. ` +
          "Spend that token directly — there is nothing to wrap",
      });
    }
    if (action.type === "balancerV3Swap" && action.wethIsEth) {
      issues.push({
        path: `actions[${i}].wethIsEth`,
        message:
          `${where} has no canonical wrapped native for the router to pay or receive as ` +
          "native; set it to false",
      });
    }
    if (action.type === "nativeBalance") {
      for (const k of readersOf(actions, i)) {
        const reader = actions[k]!;
        if (ACTION_SPECS[reader.type].value === "amount") continue; // spent as native value
        issues.push({
          path: `actions[${i}]`,
          message:
            `on ${where} the native balance is ${native.symbol} at ${native.decimals} decimals, and ` +
            `actions[${k}] (${reader.type}) spends it as a token amount — ${erc20.decimals}-decimal ` +
            `units through ${erc20.address}, so 10^${native.decimals - erc20.decimals} times too ` +
            `much. Read it with \`balanceOf\` on ${erc20.address} instead: the same balance, in ` +
            "token units",
        });
      }
    }
  });
  return issues;
}

/** Every rule `actions` breaks on `chainId`. */
export function programIssues(actions: readonly Action[], chainId?: number): ProgramIssue[] {
  const issues: ProgramIssue[] = [];
  const at = (i: number, key?: string): string =>
    key === undefined ? `actions[${i}]` : `actions[${i}].${key}`;
  const saved = new Set<string>();
  const argumentNames = new Map<string, number>();

  actions.forEach((action, i) => {
    const ref = field(action, "amountRef");
    if (ref !== undefined && field(action, "amount") !== undefined) {
      issues.push({
        path: at(i, "amountRef"),
        message: "both `amount` and `amountRef` are set — an action spends one amount; remove one",
      });
    } else if (ref !== undefined && !saved.has(ref)) {
      issues.push({
        path: at(i, "amountRef"),
        message: `'${ref}' is not saved by an earlier action (set \`saveOutputAs: "${ref}"\` on one before this)`,
      });
    }
    if (consumesPrevious(action) && i === 0) {
      issues.push({
        path: at(i),
        message:
          "has no amount: set `amount` or `amountRef`, or put an action before it whose output it spends",
      });
    }

    if (action.type === "argument") {
      const first = argumentNames.get(action.name);
      if (first !== undefined) {
        issues.push({
          path: at(i, "name"),
          message: `argument '${action.name}' is already declared by actions[${first}]`,
        });
      }
      argumentNames.set(action.name, first ?? i);
    }

    if (action.saveOutputAs !== undefined) saved.add(action.saveOutputAs);
  });

  // A source action exists only to feed a later one. Unread, it is almost certainly a mistake.
  actions.forEach((action, i) => {
    if (ACTION_SPECS[action.type].group !== "source") return;
    const next = actions[i + 1];
    const name = action.saveOutputAs;
    const read =
      (next !== undefined && consumesPrevious(next)) ||
      (name !== undefined &&
        actions.slice(i + 1).some((later) => field(later, "amountRef") === name));
    if (!read) {
      issues.push({
        path: at(i),
        message:
          `the value this ${action.type} produces is never read — the next action must omit its ` +
          "amount to spend it, or a later action must reference it by `amountRef`",
      });
    }
  });

  actions.forEach((action, i) => issues.push(...swapIssues(action, i)));

  if (chainId !== undefined) issues.push(...nativeErc20Issues(actions, chainId));
  return issues;
}

/** True when two addresses are the same, however each is cased. */
const same = (a: string, b: string): boolean => BigInt(a) === BigInt(b);

/**
 * What `@sauce/router` would refuse when the program runs, refused here instead, with a path: a
 * swap of a token for itself; a DODO V2 or Trader Joe LB trade that is not between the two tokens
 * the action says the pool holds; and a WOOFi swap with no floor, which the pool needs because it
 * prices from an oracle.
 */
function swapIssues(action: Action, i: number): ProgramIssue[] {
  const at = (key: string): string => `actions[${i}].${key}`;
  const issues: ProgramIssue[] = [];
  const pair = (a: string, b: string, names: string): void => {
    const { tokenIn, tokenOut } = action as { tokenIn: string; tokenOut: string };
    if ((same(tokenIn, a) && same(tokenOut, b)) || (same(tokenIn, b) && same(tokenOut, a))) return;
    issues.push({
      path: at("tokenIn"),
      message:
        `tokenIn and tokenOut must be the pool's ${names}, in either order — the swap would ` +
        "revert, because the side it trades is decided from them",
    });
  };

  switch (action.type) {
    case "uniswapV2Swap":
    case "uniswapV3Swap":
    case "uniswapV4Swap":
    case "curveSwap":
    case "balancerV2Swap":
    case "maverickV2Swap":
    case "dodoV2Swap":
    case "traderJoeLBSwap":
    case "woofiSwap":
      if (same(action.tokenIn, action.tokenOut)) {
        issues.push({ path: at("tokenOut"), message: "is tokenIn: a swap needs two tokens" });
        return issues;
      }
  }
  if (action.type === "dodoV2Swap") pair(action.baseToken, action.quoteToken, "base and quote");
  if (action.type === "traderJoeLBSwap") pair(action.tokenX, action.tokenY, "X and Y tokens");
  if (action.type === "woofiSwap" && action.amountOutMin === "0") {
    issues.push({
      path: at("amountOutMin"),
      message: "must be positive: WooPPV2 prices from an oracle, so a WOOFi swap needs a floor",
    });
  }

  return issues;
}
