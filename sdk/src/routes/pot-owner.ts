/**
 * `pot.owner` in a program compiled for an EVM chain: the Pot's owner, which the released Pot
 * returns from `owner()`. Each read becomes `__sauce_Pot.view(ctx.self()).owner()`, a binding of
 * that one function the compile adds to its contracts; `pot.owner.balance` is the owner's native
 * coin, `ctx.balance` of it, and `pot.owner.<TOKEN>` the token pass's read of the address it returns.
 * Lowered before the token pass, which would read `pot.owner` as a member of the Pot. On Solana
 * `pot.owner` is the owner's account (`svm-account-expressions.ts`).
 *
 * A `pot` the program declares where it reads it (an import included), or one the compile binds (a
 * define, a contract binding), is the program's or the caller's, its `.owner` with it; and a called
 * `pot.owner(…)` reads no owner (`pot-sugar.ts#potOwners`).
 */
import type { Abi } from "viem";

import { walk, type AstNode } from "./ast-walk.js";
import type { ContractsConfig } from "./compile-types.js";
import { parseSauce } from "./parse.js";
import { BALANCE_MEMBER, OWNER_MEMBER, POT_NAME, potOwners } from "./pot-sugar.js";
import { freeReadsIn } from "./protocol-rewrite.js";
import { applySplices, type Splice } from "./token-rewrite.js";

/** The binding `pot.owner` is read through: the SDK's name, which a program cannot also take. */
export const POT_OWNER_BINDING = "__sauce_Pot";

/**
 * The released Pot's `owner()`, the one function of its ABI a program reads, copied from the
 * kitchen-evm release's V12Pot ABI (`artifacts/V12Pot.json`, which a browser compile does not
 * have); `routes-svm-account-expressions.test.ts` holds it to that ABI.
 */
export const POT_OWNER_ABI = [
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

/** `pot.owner` as the compiler reads it: the Pot's `owner()`. */
const OWNER_READ = `${POT_OWNER_BINDING}.view(ctx.self()).${OWNER_MEMBER}()`;

/**
 * `source` with each `pot.owner` the Pot's `owner()`, and the binding that reads it, for the
 * compile's contracts. `bound` is the names the compile binds beside the source: a `pot` among them
 * is the caller's.
 */
export function rewritePotOwner(
  source: string,
  bound: ReadonlySet<string>,
): { readonly source: string; readonly contracts?: ContractsConfig } {
  if (bound.has(POT_NAME) || !source.includes(OWNER_MEMBER)) return { source };
  const program = parseSauce(source);
  const free = new Set(freeReadsIn(program, POT_NAME));
  const reads = [...potOwners(program)].filter(([pot]) => free.has(pot)).map(([, read]) => read);
  if (reads.length === 0) return { source };
  const reserved = (): Error =>
    new Error(
      `\`${POT_OWNER_BINDING}\` is reserved: \`pot.owner\` is the Pot's \`owner()\`, read through ` +
        `a binding of that name. Rename your \`${POT_OWNER_BINDING}\`.`,
    );
  if (bound.has(POT_OWNER_BINDING)) throw reserved();
  const called = new Set<AstNode>();
  /** Each `<x>.balance` read, by its `<x>`. */
  const balances = new Map<AstNode, AstNode>();
  walk(program, (n) => {
    if (n.type === "Identifier" && n.name === POT_OWNER_BINDING) throw reserved();
    if (n.type === "CallExpression") called.add(n.callee as AstNode);
    const property = n.property as AstNode | undefined;
    if (
      n.type === "MemberExpression" &&
      n.computed !== true &&
      property?.type === "Identifier" &&
      property.name === BALANCE_MEMBER
    ) {
      balances.set(n.object as AstNode, n);
    }
  });
  const splices = reads.map((read): Splice => {
    const balance = balances.get(read);
    return balance !== undefined && !called.has(balance)
      ? { start: balance.start, end: balance.end, replacement: `ctx.balance(${OWNER_READ})` }
      : { start: read.start, end: read.end, replacement: OWNER_READ };
  });

  return {
    source: applySplices(source, splices),
    contracts: { [POT_OWNER_BINDING]: { abi: POT_OWNER_ABI } },
  };
}
