/**
 * An amount of a token as a person writes it, and its exact value in the token's smallest unit: the
 * one grammar and the one conversion the `sauce` command (`--fund`, `--assume-balance` on both kinds
 * of chain, a wallet policy's limits, `sauce units`, the MCP tools that take the same) and the
 * testing kit's `fund` share. It sits outside `cli/`, as `numeric.ts` does, because the testing kit
 * never imports the command; it reads nothing and imports no `node:*`, so a browser can load it.
 *
 * A refusal is a {@link TokenAmountError} whose message the caller's `context` leads, as
 * `evm/balance-slot.ts` leaves its errors' wording to each caller.
 */
import { parseUnits } from "viem";

/** An amount as written: whole tokens (`1.5`), or base units (`1500000n`). */
export type TokenAmount = { readonly units: string } | { readonly base: bigint };

/** Whole tokens that the token's smallest unit cannot hold exactly. */
export class TokenAmountError extends Error {
  override readonly name = "TokenAmountError";
}

/**
 * An amount as written: whole tokens (`1.5`, `1000`), or base units with a trailing `n`
 * (`1500000n`). Anything else, a separator, sign or exponent included, is undefined rather than
 * read as another number.
 */
export function tokenAmount(amount: string): TokenAmount | undefined {
  const base = /^(\d+)n$/.exec(amount);
  if (base !== null) return { base: BigInt(base[1]!) };

  return /^\d+(\.\d+)?$/.test(amount) ? { units: amount } : undefined;
}

/** The decimal places whole tokens are written with, trailing zeros not counted: `1.50` has 1. */
export const decimalPlaces = (units: string): number =>
  (units.split(".")[1] ?? "").replace(/0+$/, "").length;

/**
 * Whole tokens in the smallest unit of a token with `decimals`, exactly. An amount that would need
 * rounding, a digit other than 0 past the decimals, is refused naming its places, never rounded:
 * `1.2345678` is no amount a 6-decimal token holds, while `1.5000000` is `1500000`. `context` (a
 * flag and its value, or what a test was doing) leads the refusal; `token` names the token in it.
 */
export function exactUnits(
  units: string,
  decimals: number,
  token: string,
  context?: string,
): bigint {
  const places = decimalPlaces(units);
  if (places > decimals) {
    throw new TokenAmountError(
      `${context === undefined ? "" : `${context}: `}${units} ${token} has ${places} decimal ` +
        `places; ${token} has ${decimals}, so it cannot be written exactly`,
    );
  }

  return parseUnits(units, decimals);
}
