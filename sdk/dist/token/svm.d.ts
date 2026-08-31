import { type SvmTokenProgramInput, type SvmTokenRefs, type TokenApproveSpec, type TokenBalanceSpec, type TokenSpec, type TokenTransferSpec } from "./types.js";
/** Well-known SPL program ids, converted once to the bigint literal the identity check wants. */
export declare const TOKEN_PROGRAM_BIGINT: bigint;
export declare const TOKEN_2022_PROGRAM_BIGINT: bigint;
/** The SauceScript expression for a `SvmTokenProgramInput` CPI-target VALUE. Defaults to `"spl"`. */
export declare function tokenProgramValueExpr(input: SvmTokenProgramInput | undefined): string;
export declare function assertRefIsIdentifier(ref: string, label: string): void;
/** Per-program emission state: a token program is pinned at most once per ref per program. */
export interface SvmEmitState {
    pinnedTokenPrograms: Set<string>;
}
export declare function newSvmEmitState(): SvmEmitState;
interface Role {
    writable: boolean;
    signer: boolean;
}
/** One `main` account parameter: the ref name and the role its annotation asserts. */
export interface SvmAccountParam {
    ref: string;
    writable: boolean;
    signer: boolean;
}
/** `Account`, `Account<Writable>`, `Account<Signer>` or `Account<Writable, Signer>`. */
export declare function accountParamType({ writable, signer }: Role): string;
/**
 * Every account the program's specs touch, in FIRST-USE order — the order a caller attaches them
 * and the order the manifest reports. A ref shared across ops (`owner`/`tokenProgram` by design)
 * appears once, holding the strongest role any op demanded of it.
 */
export declare function svmAccountParams(specs: readonly TokenSpec[]): readonly SvmAccountParam[];
/** The `main(...)` parameter list for `specs`, annotated with each slot's required role. */
export declare function svmAccountParamList(specs: readonly TokenSpec[]): string;
export declare function svmTransferLines(spec: TokenTransferSpec, index: number, state: SvmEmitState): readonly string[];
export declare function svmApproveLines(spec: TokenApproveSpec, index: number, state: SvmEmitState): readonly string[];
export declare function svmBalanceExpression(spec: TokenBalanceSpec): string;
/** The account manifest refs, in attach order, for `transfer`/`approve` with the given refs. */
export declare function accountRefsForTransfer(refs: SvmTokenRefs): readonly string[];
export declare function accountRefsForApprove(refs: SvmTokenRefs): readonly string[];
export {};
//# sourceMappingURL=svm.d.ts.map