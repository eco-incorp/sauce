/**
 * The ERC20 arm — statement/expression builders for the universal token interface's EVM lowering.
 * Typed-binding call against the engine-vendored `IERC20` artifact, the exact shape
 * `swap/source.ts`/`deposit/source.ts` already emit — nothing new reaches the compiler.
 */
import { formatAddressField, formatBigint } from "../deposit/format.js";
import { toAddressBigint, toAmountBigint } from "./params.js";
import type { TokenApproveSpec, TokenBalanceSpec, TokenTransferSpec } from "./types.js";

export const ERC20_IMPORT_LINE = `import { IERC20 } from "./artifacts/IERC20.json";`;

function formatOwner(owner: TokenBalanceSpec["owner"]): string {
  if (owner === undefined) throw new Error("Token.balanceOf: owner is required on an EVM target");
  if (owner === "self") return "ctx.self()";
  return formatAddressField(toAddressBigint(owner, "owner"));
}

function amountExpr(amount: bigint | number | "balance", tokenLiteral: string, label: string): string {
  if (amount === "balance") return `IERC20.at(${tokenLiteral}).balanceOf(ctx.self())`;
  // formatBigint takes a bigint, so a `number` amount CANNOT be stringified into the emitted
  // source without going through toAmountBigint first.
  return formatBigint(toAmountBigint(amount, label));
}

export function evmTransferStatement(spec: TokenTransferSpec): string {
  const tokenLiteral = formatAddressField(toAddressBigint(spec.token!, "token"));
  const toLiteral = formatAddressField(toAddressBigint(spec.to!, "to"));
  return `IERC20.at(${tokenLiteral}).transfer(${toLiteral}, ${amountExpr(spec.amount, tokenLiteral, "Token.transfer amount")});`;
}

export function evmApproveStatement(spec: TokenApproveSpec): string {
  const tokenLiteral = formatAddressField(toAddressBigint(spec.token!, "token"));
  const spenderLiteral = formatAddressField(toAddressBigint(spec.spender!, "spender"));
  return `IERC20.at(${tokenLiteral}).approve(${spenderLiteral}, ${amountExpr(spec.amount, tokenLiteral, "Token.approve amount")});`;
}

export function evmBalanceExpression(spec: TokenBalanceSpec): string {
  const tokenLiteral = formatAddressField(toAddressBigint(spec.token!, "token"));
  return `IERC20.at(${tokenLiteral}).balanceOf(${formatOwner(spec.owner)})`;
}
