/**
 * `sauce units`: an amount of a token in whole tokens and in its smallest unit, the one a program's
 * `main` takes. `1.5 USDC` is `1500000` on Base; `--base 1500000 USDC` reads it back. The token is
 * named the way a program names it, a symbol `sauce globals` lists for the chain, or by address,
 * with its decimals given by `--decimals`.
 */
import { formatUnits, parseUnits } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { sourceGlobals, type SourceToken } from "../routes/source-globals.js";
import { UsageError } from "./args.js";
import type { CommandOutput } from "./commands.js";

export interface UnitsInput {
  readonly chain: CanonicalChain;
  /** The amount as written: whole tokens (`1.5`), or with `base` the smallest unit (`1500000`). */
  readonly amount: string;
  /** A symbol the chain knows (`USDC`, any case), or a token's address with `decimals`. */
  readonly token: string;
  /** The amount is already in the smallest unit; print it in whole tokens. */
  readonly base: boolean;
  /** The token's decimals, for a token the chain has no symbol for. */
  readonly decimals?: number;
}

/** The token named, from the chain's registries, or a bare one with the decimals given. */
function tokenOf(input: UnitsInput): { symbol: string; address?: string; decimals: number } {
  const { tokens } = sourceGlobals(input.chain);
  const wanted = input.token.toLowerCase();
  const found: SourceToken | undefined =
    tokens.find((token) => token.symbol === input.token) ??
    tokens.find((token) => token.symbol.toLowerCase() === wanted) ??
    tokens.find((token) => token.address.toLowerCase() === wanted || token.mint === input.token);
  if (found !== undefined) {
    if (input.decimals !== undefined && input.decimals !== found.decimals) {
      throw new UsageError(
        `--decimals ${input.decimals}: ${found.symbol} on ${input.chain.slug} has ${found.decimals}`,
      );
    }

    return { symbol: found.symbol, address: found.mint ?? found.address, decimals: found.decimals };
  }
  if (input.decimals !== undefined) return { symbol: input.token, decimals: input.decimals };
  const close = tokens
    .filter((token) => token.stock === undefined)
    .map((token) => token.symbol)
    .slice(0, 12);
  throw new UsageError(
    `${input.chain.name} has no token ${input.token}` +
      (close.length === 0 ? "" : ` (it knows ${close.join(", ")})`) +
      ": give its decimals with --decimals <n>, or see `sauce globals --chain " +
      `${input.chain.slug} --search <text>\``,
  );
}

export function unitsCommand(input: UnitsInput): CommandOutput {
  const token = tokenOf(input);
  const amount = input.amount.replaceAll("_", "").replaceAll(",", "");
  let baseUnits: bigint;
  if (input.base) {
    if (!/^\d+$/.test(amount)) {
      throw new UsageError(`--base: ${input.amount} is not a whole number of the smallest unit`);
    }
    baseUnits = BigInt(amount);
  } else {
    if (!/^\d+(\.\d+)?$|^\.\d+$/.test(amount)) {
      throw new UsageError(`${input.amount} is not an amount: write it like 1.5 or 1000`);
    }
    const fraction = amount.split(".")[1] ?? "";
    if (fraction.length > token.decimals) {
      throw new UsageError(
        `${input.amount} ${token.symbol} has ${fraction.length} decimal places; ` +
          `${token.symbol} has ${token.decimals}, so it cannot be written exactly`,
      );
    }
    baseUnits = parseUnits(amount, token.decimals);
  }
  const whole = formatUnits(baseUnits, token.decimals);
  const text = [
    `${whole} ${token.symbol} = ${baseUnits} in its smallest unit (${token.decimals} decimals, ` +
      `${input.chain.slug})`,
    "",
    input.base ? `Whole tokens: ${whole}` : `For --args: ${baseUnits}`,
  ];

  return {
    text: text.join("\n"),
    json: {
      chain: input.chain.slug,
      token: token.symbol,
      ...(token.address === undefined ? {} : { address: token.address }),
      decimals: token.decimals,
      amount: whole,
      baseUnits: baseUnits.toString(),
    },
  };
}
