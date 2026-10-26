/**
 * The holder sugar's one vocabulary, shared by the EVM (`token-rewrite.ts`, `protocol-rewrite.ts`)
 * and Solana (`svm-token-rewrite.ts`, `svm-account-expressions.ts`) lowerings, so a refusal reads
 * the same on either:
 *
 *   `pot`                 the Pot's address (EVM: `ctx.self()`; Solana: the Pot account's key)
 *   `pot.<TOKEN>`         the Pot's balance of a token the chain registers
 *   `<holder>.<TOKEN>`    a holder's balance of a registered token
 *   `<holder>.balance`    a holder's native-coin balance (wei on EVM, lamports on Solana)
 *   `owner`               Solana: the Pot's owner, who signs the cook, as an account
 *
 * `.<SYMBOL>` always means a registered token: a chain whose native coin is also a registered
 * token (Arc's USDC) reads the token, and the coin is `.balance`. A program that declares its own
 * `pot` or `owner` (an import included), or a compile that gives it one (a define, a contract
 * binding), owns the name. A `pot` only an ambient module exports is refused where the program
 * reads it (`ambientNameRefusal`): it would replace the Pot with no word in the program, and so is
 * an `owner` on Solana. The old spellings — bare `self`, `self.<TOKEN>`, `Solana.self`,
 * `Solana.owner` and `<holder>.<native symbol>` — are refused by name, each naming what to write
 * instead.
 */

/** The Pot, as a program spells it. */
export const POT_NAME = "pot";

/** The Pot's owner, as a program compiled for Solana spells it. */
export const OWNER_NAME = "owner";

/** The member that reads a holder's native-coin balance. */
export const BALANCE_MEMBER = "balance";

/** The name the language no longer has for the Pot. */
export const RETIRED_POT_NAME = "self";

/** The refusal of `self` for the Pot: `site` is the text refused, `instead` what to write. */
export function selfRefusal(site: string, instead: string): Error {
  return new Error(
    `\`${site}\`: the Pot is \`pot\`, not \`self\`: write \`${instead}\` (\`pot\` is the Pot's ` +
      "address, `pot.<TOKEN>` its balance of a token, `pot.balance` its native coin).",
  );
}

/**
 * The refusal of `name` — the Pot, `pot`, or on Solana its owner, `owner` — that the program reads
 * with no declaration of its own where only an ambient module exports one: the module's value would
 * stand in for the Pot or its owner. `line` and `column`, 1-based, are where the program reads it.
 */
export function ambientNameRefusal(name: string, line: number, column: number): Error {
  const [what, instead] =
    name === POT_NAME
      ? ["the Pot", "Write `ctx.self()` for the Pot"]
      : [
          "the Pot's owner",
          "Take the Pot's owner as an `Account<Signer>` parameter of main, passed as " +
            "`--account <name>=owner`",
        ];
  return new Error(
    `\`${name}\` at line ${line}, column ${column}: an ambient module exports \`${name}\`, and ` +
      `the program reads it with no import, so it would read that module's value and not ${what}. ` +
      `${instead}, or import it by name (\`import { ${name} } from "<module>"\`) for the module's ` +
      "value.",
  );
}

/**
 * The refusal of `<holder>.<symbol>` where the symbol is the chain's native coin and not a token
 * it registers: `instead` is the read to write, `<holder>.balance` (or `ctx.balance(<holder>)`
 * where `.balance` would read a field of the holder).
 */
export function nativeSymbolRefusal(
  site: string,
  symbol: string,
  chain: string,
  instead: string,
): Error {
  return new Error(
    `\`${site}\`: a holder's native coin is \`.balance\`: write \`${instead}\`. \`.${symbol}\` ` +
      `is not a token on ${chain}, and \`.<SYMBOL>\` reads only a token the chain registers.`,
  );
}
