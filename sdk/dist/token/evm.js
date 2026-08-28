/**
 * The ERC20 arm — statement/expression builders for the universal token interface's EVM lowering.
 * Typed-binding call against the engine-vendored `IERC20` artifact, the exact shape
 * `swap/source.ts`/`deposit/source.ts` already emit — nothing new reaches the compiler.
 */
import { formatAddressField, formatBigint } from "../deposit/format.js";
import { toAddressBigint } from "./params.js";
export const ERC20_IMPORT_LINE = `import { IERC20 } from "./artifacts/IERC20.json";`;
function formatOwner(owner) {
    if (owner === undefined)
        throw new Error("Token.balanceOf: owner is required on an EVM target");
    if (owner === "self")
        return "address.self";
    return formatAddressField(toAddressBigint(owner, "owner"));
}
function amountExpr(amount, tokenLiteral) {
    if (amount === "balance")
        return `IERC20.at(${tokenLiteral}).balanceOf(address.self)`;
    return formatBigint(typeof amount === "bigint" ? amount : BigInt(amount));
}
export function evmTransferStatement(spec) {
    const tokenLiteral = formatAddressField(toAddressBigint(spec.token, "token"));
    const toLiteral = formatAddressField(toAddressBigint(spec.to, "to"));
    return `IERC20.at(${tokenLiteral}).transfer(${toLiteral}, ${amountExpr(spec.amount, tokenLiteral)});`;
}
export function evmApproveStatement(spec) {
    const tokenLiteral = formatAddressField(toAddressBigint(spec.token, "token"));
    const spenderLiteral = formatAddressField(toAddressBigint(spec.spender, "spender"));
    return `IERC20.at(${tokenLiteral}).approve(${spenderLiteral}, ${amountExpr(spec.amount, tokenLiteral)});`;
}
export function evmBalanceExpression(spec) {
    const tokenLiteral = formatAddressField(toAddressBigint(spec.token, "token"));
    return `IERC20.at(${tokenLiteral}).balanceOf(${formatOwner(spec.owner)})`;
}
//# sourceMappingURL=evm.js.map