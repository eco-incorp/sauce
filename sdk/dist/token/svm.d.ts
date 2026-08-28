import { type SvmTokenProgramInput, type SvmTokenRefs, type TokenApproveSpec, type TokenBalanceSpec, type TokenTransferSpec } from "./types.js";
/** Well-known SPL program ids, converted once to the bigint literal `contract.call`'s target wants. */
export declare const TOKEN_PROGRAM_BIGINT: bigint;
export declare const TOKEN_2022_PROGRAM_BIGINT: bigint;
/** The SauceScript expression for a `SvmTokenProgramInput` CPI-target VALUE. Defaults to `"spl"`. */
export declare function tokenProgramValueExpr(input: SvmTokenProgramInput | undefined): string;
/**
 * Per-program emission state: tracks which `tokenProgram` refs have already been interned (via
 * `accountData(ref, 0, 0)`) and whether `le8` has already been emitted — both are load-bearing but
 * must appear AT MOST ONCE per ref / per program, mirroring `svmSettleSource`'s own dedup rules.
 */
export interface SvmEmitState {
    internedTokenPrograms: Set<string>;
}
export declare function newSvmEmitState(): SvmEmitState;
export declare const LE8_HELPER_SOURCE: string;
export declare function svmTransferLines(spec: TokenTransferSpec, index: number, state: SvmEmitState): readonly string[];
export declare function svmApproveLines(spec: TokenApproveSpec, index: number, state: SvmEmitState): readonly string[];
export declare function svmBalanceExpression(spec: TokenBalanceSpec): string;
/** The AccountPlan refs, in intern order, for `transfer`/`approve` with the given (defaulted) refs. */
export declare function accountRefsForTransfer(refs: SvmTokenRefs): readonly string[];
export declare function accountRefsForApprove(refs: SvmTokenRefs): readonly string[];
//# sourceMappingURL=svm.d.ts.map