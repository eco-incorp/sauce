/**
 * Normalization + guards for the universal token interface. Mirrors `swap/params.ts`'s posture:
 * throws (never emits a program that would revert on-chain) rather than guessing.
 */
import type { AddressInput, SvmTokenRefs, TokenApproveSpec, TokenBalanceSpec, TokenSpec, TokenTarget, TokenTransferSpec } from "./types.js";
export declare function isEvmTarget(target: TokenTarget): boolean;
export declare function toAddressBigint(value: AddressInput, label: string): bigint;
/** Any literal (non-`"balance"`) amount destined for SVM must fit the SPL u64 `amount` field. */
export declare function assertU64Range(amount: bigint, label: string): void;
export declare function toAmountBigint(amount: bigint | number, label: string): bigint;
/** `owner`/`tokenProgram` default names — shared/reused across ops in one program by design (the
 *  SPL CPI-target intern is meant to dedupe across ops, unlike per-op instance refs). */
export declare function ownerRef(refs: SvmTokenRefs): string;
export declare function tokenProgramRef(refs: SvmTokenRefs): string;
export declare function validateTransferSpec(spec: TokenTransferSpec, target: TokenTarget): void;
export declare function validateApproveSpec(spec: TokenApproveSpec, target: TokenTarget): void;
export declare function validateBalanceSpec(spec: TokenBalanceSpec, target: TokenTarget): void;
/**
 * Rejects a duplicate SVM instance ref name across DIFFERENT ops in one `Token.program(...)` call —
 * a collision would silently merge two distinct AccountPlan slots. `owner`/`tokenProgram` are
 * exempt (shared by design).
 */
export declare function assertNoDuplicateSvmRefs(specs: readonly TokenSpec[]): void;
//# sourceMappingURL=params.d.ts.map