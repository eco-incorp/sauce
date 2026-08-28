/**
 * `Token` — the runtime value behind the DEFAULT GLOBAL `Token` (see `sdk/src/routes/globals.ts`).
 * A plain, inert builder: `Token.transfer(spec)`/`.approve(spec)`/`.balanceOf(spec)` return a
 * `TokenCall`, synchronous, no RPC, no compiler import — the same posture as
 * `descriptors/call.ts`'s `ContractCall`.
 */
import { encodeFunctionData } from "viem";
import { ERC20ABI } from "../protocols/erc20/abis.js";
import { ata } from "../svm/venues/scale-common.js";
import { toAddressBigint, validateApproveSpec, validateBalanceSpec, validateTransferSpec } from "./params.js";
import { tokenAccountRefs, tokenExpression, TOKEN_BASE_DIRS, tokenCallStatement, tokenImportLines, tokenSource } from "./source.js";
import { TOKEN_PROGRAM_BIGINT, TOKEN_2022_PROGRAM_BIGINT } from "./svm.js";
import { MINT_DECIMALS_OFFSET, SPL_AMOUNT_OFFSET, SPL_APPROVE_CHECKED, SPL_TRANSFER_CHECKED, } from "./types.js";
function makeTokenCall(spec) {
    return {
        spec,
        source: (target) => tokenSource(spec, target),
        statement: (target) => tokenCallStatement(spec, target),
        expression: (target) => tokenExpression(spec, target),
        toSauceScript: (target) => {
            const imports = tokenImportLines([spec], target);
            const src = tokenSource(spec, target);
            const isBalance = spec.op === "balanceOf";
            const statement = isBalance ? `${tokenExpression(spec, target)};` : tokenCallStatement(spec, target);
            return {
                imports,
                statement,
                source: src,
                baseDirs: TOKEN_BASE_DIRS,
                ...(target === "svm" ? { accountRefs: tokenAccountRefsSafe(spec, target) } : {}),
            };
        },
        toCall: () => {
            if (spec.svm !== undefined) {
                throw new Error(`TokenCall.toCall: Token.${spec.op} is an SVM spec — use accountRefs()/toSauceScript('svm') instead`);
            }
            if (spec.op === "balanceOf") {
                validateBalanceSpec(spec, "evm");
                if (spec.owner === "self") {
                    throw new Error("TokenCall.toCall: Token.balanceOf('self') has no fixed calldata — compile it instead");
                }
                return {
                    target: hexAddress(spec.token, "token"),
                    data: encodeFunctionData({ abi: ERC20ABI, functionName: "balanceOf", args: [hexAddress(spec.owner, "owner")] }),
                    value: 0n,
                };
            }
            if (spec.op === "transfer")
                validateTransferSpec(spec, "evm");
            else
                validateApproveSpec(spec, "evm");
            if (spec.amount === "balance") {
                throw new Error(`TokenCall.toCall: Token.${spec.op} with amount: "balance" has no fixed calldata — compile it instead`);
            }
            if (spec.op === "transfer") {
                return {
                    target: hexAddress(spec.token, "token"),
                    data: encodeFunctionData({
                        abi: ERC20ABI,
                        functionName: "transfer",
                        args: [hexAddress(spec.to, "to"), toAmount(spec.amount)],
                    }),
                    value: 0n,
                };
            }
            return {
                target: hexAddress(spec.token, "token"),
                data: encodeFunctionData({
                    abi: ERC20ABI,
                    functionName: "approve",
                    args: [hexAddress(spec.spender, "spender"), toAmount(spec.amount)],
                }),
                value: 0n,
            };
        },
        accountRefs: () => tokenAccountRefsSafe(spec, "svm"),
    };
}
function tokenAccountRefsSafe(spec, target) {
    return tokenAccountRefs(spec, target);
}
function hexAddress(value, label) {
    if (value === undefined)
        throw new Error(`TokenCall.toCall: ${label} is required`);
    const big = toAddressBigint(value, label);
    return `0x${big.toString(16).padStart(40, "0")}`;
}
function toAmount(amount) {
    return typeof amount === "bigint" ? amount : BigInt(amount);
}
/**
 * The universal token interface — ERC20 on an EVM compile target, SPL Token on `svm`. See
 * `sdk/src/token/index.ts` for the module overview. Installed as the DEFAULT GLOBAL `Token` (zero
 * import) by `sdk/src/routes/globals.ts`; also available as the named export `token.Token`.
 */
export const Token = Object.freeze({
    transfer: (spec) => makeTokenCall({ op: "transfer", ...spec }),
    approve: (spec) => makeTokenCall({ op: "approve", ...spec }),
    balanceOf: (spec) => makeTokenCall({ op: "balanceOf", ...spec }),
    program: (specs, opts) => tokenSource(specs, opts.target),
    ata,
    TOKEN_PROGRAM: TOKEN_PROGRAM_BIGINT,
    TOKEN_2022_PROGRAM: TOKEN_2022_PROGRAM_BIGINT,
    ERC20ABI,
    SPL_TRANSFER_CHECKED,
    SPL_APPROVE_CHECKED,
    SPL_AMOUNT_OFFSET,
    MINT_DECIMALS_OFFSET,
});
//# sourceMappingURL=api.js.map