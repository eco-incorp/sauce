import type { DepositSpec, NormalizedDeposit } from "./types.js";
/**
 * The whole normalization/defaulting/guard decision: lowers a chain-agnostic {@link DepositSpec}
 * into a fully normalized {@link NormalizedDeposit} — plain bigints (+ the `"self"` sentinel for a
 * defaulted `beneficiary`), with its resolved {@link DepositTemplate} attached.
 *
 * `spec.amount` may be `"balance" | "delta" | "max"` — see {@link DepositSourceSpec} — in which case
 * it passes through unresolved (the caller, `depositCallStatement`/`swapThenDepositSource`, decides
 * the actual amount EXPRESSION; this function only validates every OTHER field and, for `"max"`,
 * checks `allowsMaxAmount`).
 *
 * Throws (never emits a program that would misbehave on-chain) for: an unknown `protocol:action`;
 * `token` supplied to a native-value template; `token` omitted from an erc20-approve/none template;
 * `beneficiary` supplied to a `beneficiary: "unsupported"` template; `amount: "max"` on a template
 * with `allowsMaxAmount: false`; an unrecognized `extra` field name; and whatever the field's own
 * `ExtraFieldSpec.normalize` throws for an out-of-range extra value.
 */
export declare function toDeposit(spec: DepositSpec | (Omit<DepositSpec, "amount"> & {
    amount: "balance" | "delta" | "max";
})): NormalizedDeposit;
//# sourceMappingURL=params.d.ts.map