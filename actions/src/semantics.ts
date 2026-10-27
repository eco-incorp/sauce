/**
 * The rules an action list must satisfy beyond each action's own shape: where every amount comes
 * from, and that every value a source action produces is read. `program.ts` runs the structural
 * checks first, so by the time these run every field has its declared type.
 */
import type { CanonicalChain } from "../../sdk/dist/chains/canonical.js";
import { getChain, nativeErc20 } from "../../sdk/dist/chains/index.js";
import { TOKEN_REGISTRY } from "../../sdk/dist/routes/index.js";

import { ACTION_SPECS } from "./spec.js";
import type { Action, ActionType } from "./types.js";

/** One problem with a program, located by a path into the document (`actions[2].amountRef`). */
export interface ProgramIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Thrown for a program that breaks any rule. `issues` lists every problem found, in order; `chain`
 * is set when they are the compiled chain's — a name it lacks — rather than the document's own.
 */
export class ProgramError extends Error {
  readonly issues: readonly ProgramIssue[];
  readonly chain?: CanonicalChain;

  constructor(issues: readonly ProgramIssue[], chain?: CanonicalChain) {
    const count = `${issues.length} ${issues.length === 1 ? "issue" : "issues"}`;
    super(
      (chain === undefined
        ? `invalid action program (${count}):\n`
        : `the action program does not compile for ${chain.name} (${chain.slug}, chain ${chain.id}) (${count}):\n`) +
        issues.map((i) => `  ${i.path}: ${i.message}`).join("\n"),
    );
    this.name = "ProgramError";
    this.issues = issues;
    if (chain !== undefined) this.chain = chain;
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

  actions.forEach((action, i) =>
    issues.push(...swapIssues(action, i), ...balancerBatchIssues(action, at(i), chainId)),
  );

  if (chainId !== undefined) issues.push(...nativeErc20Issues(actions, chainId));
  return issues;
}

/**
 * An `ambientSwap`'s amount is what it spends, so it must be denominated in the token the swap pays:
 * the base token when buying (`isBuy`), the quote token otherwise. The other pairing is Ambient's
 * exact-output swap, whose `qty` is what the Pot receives, and the dex then pulls whatever input it
 * takes: more than `amount`, up to the allowance.
 */
export function ambientSwapIssues(action: Action, path: string): ProgramIssue[] {
  if (action.type !== "ambientSwap" || action.inBaseQty === action.isBuy) return [];

  return [
    {
      path: `${path}.inBaseQty`,
      message:
        `must be ${action.isBuy}: the amount is what the swap spends, so it is in the token paid — ` +
        `the ${action.isBuy ? "base" : "quote"} token when isBuy is ${action.isBuy}. ` +
        "The other pairing is an exact-output swap, which takes more than the amount",
    },
  ];
}

/** Batch value rules shared by program parsing, standalone actions and resolved-name callers. */
export function balancerBatchIssues(
  action: Action,
  path: string,
  chainId?: number,
): ProgramIssue[] {
  if (action.type !== "balancerV2BatchSwap") return [];
  const issues: ProgramIssue[] = [];
  if (BigInt(action.amountOutMin) > 1n << 255n) {
    issues.push({
      path: `${path}.amountOutMin`,
      message:
        `must be at most 2^255 (${1n << 255n}): ` +
        "the Vault output floor is a negative int256 limit",
    });
  }
  const seen = new Map<string, number>();
  for (const [i, asset] of action.assets.entries()) {
    // Parsing may already know the chain, while resolveNames supplies addresses directly.
    const resolved =
      chainId === undefined
        ? asset
        : (TOKEN_REGISTRY[chainId]?.find((token) => token.symbol === asset)?.address ?? asset);
    const key =
      resolved === "native" ? "0x0000000000000000000000000000000000000000" : resolved.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      issues.push({
        path: `${path}.assets[${i}]`,
        message: `duplicates assets[${first}]: each asset must appear once so its limit covers its net payout`,
      });
    } else {
      seen.set(key, i);
    }
  }
  return issues;
}

/** A token value as the address it names, or `undefined` for a name not yet resolved. */
const valueOf = (value: string): bigint | undefined =>
  value === "native" ? 0n : /^0x/i.test(value) ? BigInt(value) : undefined;

/**
 * Whether two token values are the same token: two addresses however cased, two identical names,
 * `"native"` and the zero address. `undefined` when only the chain can tell — a name beside an
 * address — which the compile decides once every name is resolved on its chain.
 */
const same = (a: string, b: string): boolean | undefined => {
  const [x, y] = [valueOf(a), valueOf(b)];
  if (x !== undefined && y !== undefined) return x === y;

  return a === b ? true : x === undefined && y === undefined ? false : undefined;
};

/**
 * Swap constraints refused here with a path: a swap of a token for itself; a DODO V2 or Trader
 * Joe LB trade outside the pool's token pair; and a WOOFi swap with no oracle-price floor. A
 * comparison only the chain can decide (a name beside an address) is left to the compile, which
 * runs these again on the resolved addresses.
 */
function swapIssues(action: Action, i: number): ProgramIssue[] {
  const at = (key: string): string => `actions[${i}].${key}`;
  const issues: ProgramIssue[] = [];
  const pair = (a: string | undefined, b: string | undefined, names: string): void => {
    if (a === undefined || b === undefined) return;
    const { tokenIn, tokenOut } = action as { tokenIn: string; tokenOut: string };
    const straight = [same(tokenIn, a), same(tokenOut, b)];
    const crossed = [same(tokenIn, b), same(tokenOut, a)];
    const holds = (pair: (boolean | undefined)[]) =>
      pair.includes(false) ? false : pair.includes(undefined) ? undefined : true;
    if (holds(straight) !== false || holds(crossed) !== false) return;
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
      if (same(action.tokenIn, action.tokenOut) === true) {
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
