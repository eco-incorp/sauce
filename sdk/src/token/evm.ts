/**
 * The ERC20 arm — statement/expression builders for the universal token interface's EVM lowering.
 * The writes go through `safe.ts` (OpenZeppelin `SafeERC20`); the read is a typed call against the
 * engine-vendored `IERC20` artifact, the shape `deposit/source.ts` already emits.
 */
import { formatAddressField } from "../deposit/format.js";
import { toAddressBigint, toAmountBigint } from "./params.js";
import { safeApproveStatements, safeTransferStatements } from "./safe.js";
import type { TokenApproveSpec, TokenBalanceSpec, TokenTransferSpec } from "./types.js";

export const ERC20_IMPORT_LINE = `import { IERC20 } from "./artifacts/IERC20.json";`;

function formatOwner(owner: TokenBalanceSpec["owner"]): string {
  if (owner === undefined) throw new Error("Token.balanceOf: owner is required on an EVM target");
  if (owner === "self") return "ctx.self()";
  return formatAddressField(toAddressBigint(owner, "owner"));
}

/** A write's amount as a `token/safe.ts` word: a literal folds into the calldata, a `"balance"`
 *  read is bound to a local first so the call and any later use see one value. */
function amountWord(
  spec: { amount: bigint | number | "balance" },
  tokenLiteral: string,
  label: string,
  prefix: string,
): { readonly word: { literal: bigint } | { local: string }; readonly pre: readonly string[] } {
  if (spec.amount !== "balance") {
    return { word: { literal: toAmountBigint(spec.amount, label) }, pre: [] };
  }
  const local = `${prefix}amt`;
  return {
    word: { local },
    pre: [`const ${local} = IERC20.at(${tokenLiteral}).balanceOf(ctx.self());`],
  };
}

/** `transfer`, with OpenZeppelin `SafeERC20` semantics — see `token/safe.ts` for why this is not
 *  `IERC20.at(t).transfer(...)`. `balanceOf` keeps that binding: a `uint256` return is always there. */
export function evmTransferStatements(spec: TokenTransferSpec, prefix = "t0_"): readonly string[] {
  const tokenLiteral = formatAddressField(toAddressBigint(spec.token!, "token"));
  const to = toAddressBigint(spec.to!, "to");
  const { word, pre } = amountWord(spec, tokenLiteral, "Token.transfer amount", prefix);

  return [...pre, ...safeTransferStatements(prefix, tokenLiteral, { literal: to }, word)];
}

/** `approve`, with `SafeERC20` semantics plus `forceApprove`'s reset of a non-zero allowance. */
export function evmApproveStatements(spec: TokenApproveSpec, prefix = "t0_"): readonly string[] {
  const tokenLiteral = formatAddressField(toAddressBigint(spec.token!, "token"));
  const spender = toAddressBigint(spec.spender!, "spender");
  const { word, pre } = amountWord(spec, tokenLiteral, "Token.approve amount", prefix);

  return [...pre, ...safeApproveStatements(prefix, tokenLiteral, { literal: spender }, word)];
}

export function evmBalanceExpression(spec: TokenBalanceSpec): string {
  const tokenLiteral = formatAddressField(toAddressBigint(spec.token!, "token"));
  return `IERC20.at(${tokenLiteral}).balanceOf(${formatOwner(spec.owner)})`;
}
