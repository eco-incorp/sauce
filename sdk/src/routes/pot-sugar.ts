/**
 * The holder sugar's one vocabulary, shared by the EVM (`token-rewrite.ts`, `protocol-rewrite.ts`,
 * `pot-owner.ts`) and Solana (`svm-token-rewrite.ts`, `svm-account-expressions.ts`) lowerings, so a
 * refusal reads the same on either:
 *
 *   `pot`                 the Pot's address (EVM: `ctx.self()`; Solana: the Pot account's key)
 *   `pot.owner`           the Pot's owner (EVM: the Pot's `owner()`; Solana: the owner's account,
 *                         which signs the cook)
 *   `pot.<TOKEN>`         the Pot's balance of a token the chain registers
 *   `<holder>.<TOKEN>`    a holder's balance of a registered token
 *   `<holder>.balance`    a holder's native-coin balance (wei on EVM, lamports on Solana)
 *
 * `.<SYMBOL>` always means a registered token: a chain whose native coin is also a registered
 * token (Arc's USDC) reads the token, and the coin is `.balance`. A program that declares its own
 * `pot` (an import included), or a compile that gives it one (a define, a contract binding), owns
 * the name, `pot.owner` with it. A `pot` only an ambient module exports is refused where the
 * program reads it (`ambientPotRefusal`): it would replace the Pot with no word in the program.
 * Bare `self`, `self.<TOKEN>`, `Solana.self` and `<holder>.<native symbol>` are refused by name,
 * each naming what to write instead.
 */
import { walk, type AstNode } from "./ast-walk.js";

/** The Pot, as a program spells it. */
export const POT_NAME = "pot";

/** The Pot's member that is its owner: `pot.owner`. */
export const OWNER_MEMBER = "owner";

/** The member that reads a holder's native-coin balance. */
export const BALANCE_MEMBER = "balance";

/** `self`: refused as a name for the Pot, which is `pot`. */
export const RETIRED_POT_NAME = "self";

/**
 * Every `pot.owner` in `program` that is read, not called or written, by the `pot` it is read on:
 * the Pot's owner, which reads no Pot. Whether that `pot` is the Pot (one neither the program nor
 * the compile binds there) is the caller's to decide.
 */
export function potOwners(program: AstNode): ReadonlyMap<AstNode, AstNode> {
  const owners = new Map<AstNode, AstNode>();
  /** Each callee, assignment target and update target: a member there is no read. */
  const unread = new Set<AstNode>();
  walk(program, (n) => {
    if (n.type === "CallExpression") unread.add(n.callee as AstNode);
    if (n.type === "AssignmentExpression") unread.add(n.left as AstNode);
    if (n.type === "UpdateExpression") unread.add(n.argument as AstNode);
    if (n.type !== "MemberExpression" || n.computed === true || n.optional === true) return;
    const object = n.object as AstNode;
    const property = n.property as AstNode;
    if (
      object.type === "Identifier" &&
      object.name === POT_NAME &&
      property.type === "Identifier" &&
      property.name === OWNER_MEMBER
    ) {
      owners.set(object, n);
    }
  });
  for (const [pot, member] of owners) if (unread.has(member)) owners.delete(pot);

  return owners;
}

/** The refusal of `self` for the Pot: `site` is the text refused, `instead` what to write. */
export function selfRefusal(site: string, instead: string): Error {
  return new Error(
    `\`${site}\`: the Pot is \`pot\`, not \`self\`: write \`${instead}\` (\`pot\` is the Pot's ` +
      "address, `pot.<TOKEN>` its balance of a token, `pot.balance` its native coin).",
  );
}

/**
 * The refusal of a write to `site`, a member of the Pot (`pot.owner`, `pot.USDC`): each is read,
 * never written.
 */
export function potWriteRefusal(site: string): Error {
  return new Error(
    `\`${site}\` is written: a member of the Pot is read, never written (\`pot.owner\` is its ` +
      "owner, `pot.<TOKEN>` and `pot.balance` its balances). Keep the value in a local of your own.",
  );
}

/**
 * The refusal of a `pot` the program reads with no declaration of its own where only an ambient
 * module exports one: the module's value would stand in for the Pot. `line` and `column`, 1-based,
 * are where the program reads it.
 */
export function ambientPotRefusal(line: number, column: number): Error {
  return new Error(
    `\`pot\` at line ${line}, column ${column}: an ambient module exports \`pot\`, and the ` +
      "program reads it with no import, so it would read that module's value and not the Pot. " +
      'Write `ctx.self()` for the Pot, or import it by name (`import { pot } from "<module>"`) ' +
      "for the module's value.",
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
