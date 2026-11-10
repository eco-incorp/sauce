/**
 * `sauce units`: an amount of a token in whole tokens and in its smallest unit, the one a program's
 * `main` takes. `1.5 USDC` is `1500000` on Base; `1500000n USDC` reads it back, base units written
 * as `--fund` writes them. The token is named the way a program names it, a symbol
 * `sauce globals` lists for the chain, or by address, with its decimals given by `--decimals`.
 */
import { isAddress as isSolanaAddress } from "@solana/kit";
import { formatUnits, isAddress, parseUnits } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { wordsOf } from "../evm/effects.js";
import { sourceGlobals, type SourceToken } from "../routes/source-globals.js";
import { UsageError } from "./args.js";
import type { CommandOutput } from "./commands.js";
import { tokenAmount } from "./funding.js";

export interface UnitsInput {
  readonly chain: CanonicalChain;
  /** The amount as written: whole tokens (`1.5`), or the smallest unit ending in n (`1500000n`). */
  readonly amount: string;
  /** A symbol the chain knows (`USDC`, any case), or a token's address with `decimals`. */
  readonly token: string;
  /** The token's decimals, for a token the chain has no symbol for. */
  readonly decimals?: number;
}

/**
 * The token a name means on one chain: an exact symbol first, then a symbol in another case, then
 * an address or mint. Two tokens whose symbols differ only in case are refused rather than guessed.
 */
export function findToken(
  tokens: readonly SourceToken[],
  name: string,
  chainName: string,
): SourceToken | undefined {
  const exact = tokens.find((token) => token.symbol === name);
  if (exact !== undefined) return exact;
  const wanted = name.toLowerCase();
  const anyCase = tokens.filter((token) => token.symbol.toLowerCase() === wanted);
  if (anyCase.length > 1) {
    throw new UsageError(
      `${chainName} has ${anyCase.length} tokens named ${name} in different cases ` +
        `(${anyCase.map((token) => `${token.symbol} ${token.mint ?? token.address}`).join(", ")}): ` +
        "name it with the exact case or by address",
    );
  }
  return (
    anyCase[0] ??
    tokens.find((token) => token.address.toLowerCase() === wanted || token.mint === name)
  );
}

/** The token named, from the chain's registries, or a bare one with the decimals given. */
function tokenOf(input: UnitsInput): { symbol: string; address?: string; decimals: number } {
  const { tokens } = sourceGlobals(input.chain);
  const found = findToken(tokens, input.token, input.chain.name);
  if (found !== undefined) {
    if (input.decimals !== undefined && input.decimals !== found.decimals) {
      throw new UsageError(
        `--decimals ${input.decimals}: ${found.symbol} on ${input.chain.slug} has ${found.decimals}`,
      );
    }

    return { symbol: found.symbol, address: found.mint ?? found.address, decimals: found.decimals };
  }
  const isTokenAddress =
    input.chain.kind === "evm"
      ? isAddress(input.token, { strict: false })
      : isSolanaAddress(input.token);
  if (input.decimals !== undefined) {
    // --decimals stands in for the registry only for a token named by address or mint: a
    // misspelled symbol (USCD) is refused here, not given the decimals and printed.
    if (!isTokenAddress) {
      throw new UsageError(
        `--decimals requires a token address or mint, not a symbol: ${input.chain.name} has ` +
          `no token ${input.token}`,
      );
    }

    return { symbol: input.token, address: input.token, decimals: input.decimals };
  }
  if (isTokenAddress) {
    throw new UsageError(
      `${input.chain.name} has no token ${input.token} in its registry: pass --decimals <n> ` +
        "for a token the registry doesn't have",
    );
  }
  const close = tokens
    .filter((token) => token.stock === undefined)
    .map((token) => token.symbol)
    .slice(0, 12);
  throw new UsageError(
    `${input.chain.name} has no token ${input.token}` +
      (close.length === 0 ? "" : ` (it knows ${close.join(", ")})`) +
      ": give its address with --decimals <n>, or see `sauce globals --chain " +
      `${input.chain.slug} --search <text>\``,
  );
}

export function unitsCommand(input: UnitsInput): CommandOutput {
  const token = tokenOf(input);
  // Validated as written, with --fund's grammar: a separator is refused, not stripped, so a
  // decimal comma (1,5) never reads as 15.
  const amount = tokenAmount(input.amount);
  if (amount === undefined) {
    throw new UsageError(
      `${input.amount} is not an amount: whole tokens (1.5, 1000) or base units ending in n ` +
        "(1500000n)",
    );
  }
  let baseUnits: bigint;
  let note: string | undefined;
  if ("base" in amount) {
    baseUnits = amount.base;
  } else {
    const { units } = amount;
    const fraction = units.split(".")[1] ?? "";
    if (fraction.length > token.decimals) {
      throw new UsageError(
        `${units} ${token.symbol} has ${fraction.length} decimal places; ` +
          `${token.symbol} has ${token.decimals}, so it cannot be written exactly`,
      );
    }
    baseUnits = parseUnits(units, token.decimals);
    // The note --fund gives: a bare integer at or above 10^decimals reads like base units
    // (1500000 USDC is 1.5 million USDC), the mistake this command is most often run to catch.
    if (fraction === "" && token.decimals > 0 && BigInt(units) >= 10n ** BigInt(token.decimals)) {
      note =
        `${units} ${token.symbol}: that is ${wordsOf(units)} ${token.symbol}; for base units ` +
        `write ${units}n`;
    }
  }
  // The most a token amount can hold on the chain: a uint256 on EVM, an SPL token's u64 on Solana.
  const [limit, limitName] =
    input.chain.kind === "evm" ? [2n ** 256n - 1n, "uint256"] : [2n ** 64n - 1n, "u64"];
  if (baseUnits > limit) {
    throw new UsageError(
      `${input.amount} ${token.symbol} is ${baseUnits} in its smallest unit, more than a ` +
        `${limitName} holds (${limit})`,
    );
  }
  const whole = formatUnits(baseUnits, token.decimals);
  const text = [
    `${whole} ${token.symbol} = ${baseUnits} in its smallest unit (${token.decimals} decimals, ` +
      `${input.chain.slug})`,
    "",
    "base" in amount ? `Whole tokens: ${whole}` : `For --args: ${baseUnits}`,
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
      ...(note === undefined ? {} : { note }),
    },
    ...(note === undefined ? {} : { notes: [note] }),
  };
}
