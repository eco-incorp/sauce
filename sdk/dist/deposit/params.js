import { depositTemplateFor } from "./templates.js";
function toAddressBigint(value, label) {
    if (typeof value === "bigint")
        return value;
    return BigInt(value);
}
function toBigIntStrict(value, label) {
    if (typeof value === "bigint")
        return value;
    if (typeof value === "number") {
        if (!Number.isInteger(value))
            throw new Error(`${label}: expected an integer, got ${value}`);
        return BigInt(value);
    }
    return BigInt(value);
}
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
export function toDeposit(spec) {
    const template = depositTemplateFor(spec.protocol, spec.action);
    // A raw-call template (`binding === null`: weth:wrap, weth:unwrap, lido:stake) operates
    // directly on `target` via a hand-built calldata word — there is no separate ERC20 asset
    // address at all, so "token" must be omitted. Every typed-ABI template (`binding !== null`)
    // requires one, regardless of its `funding` (even a "none"-funded typed withdraw like
    // aave-v3:withdraw still names an `asset` argument).
    if (template.binding === null) {
        if (spec.token !== undefined) {
            throw new Error(`toDeposit: ${spec.protocol}:${spec.action} is a native-value template — there is no ERC20 leg, so "token" must be omitted`);
        }
    }
    else if (spec.token === undefined) {
        throw new Error(`toDeposit: ${spec.protocol}:${spec.action} requires "token" (the asset being approved/supplied/withdrawn)`);
    }
    if (template.beneficiary === "unsupported" && spec.beneficiary !== undefined) {
        throw new Error(`toDeposit: ${spec.protocol}:${spec.action} does not support a beneficiary — it always credits msg.sender; passing one would silently be ignored on-chain`);
    }
    const amount = spec.amount === "balance" || spec.amount === "delta" || spec.amount === "max"
        ? spec.amount
        : toBigIntStrict(spec.amount, "amount");
    if (amount === "max" && !template.allowsMaxAmount) {
        throw new Error(`toDeposit: ${spec.protocol}:${spec.action} does not document a uint256-max sentinel — "max" is only accepted where allowsMaxAmount is true`);
    }
    const extraInput = spec.extra ?? {};
    for (const name of Object.keys(extraInput)) {
        if (!(name in template.extras)) {
            const known = Object.keys(template.extras).sort().join(", ") || "(none)";
            throw new Error(`toDeposit: ${spec.protocol}:${spec.action} has no extra field "${name}". Known: ${known}`);
        }
    }
    const extra = {};
    for (const [name, fieldSpec] of Object.entries(template.extras)) {
        const raw = extraInput[name];
        extra[name] = raw !== undefined ? fieldSpec.normalize(raw, `extra.${name}`) : fieldSpec.defaultValue;
    }
    const approvalPolicy = spec.approvalPolicy ?? "exact";
    return {
        template,
        target: toAddressBigint(spec.target, "target"),
        token: template.binding === null ? null : toAddressBigint(spec.token, "token"),
        amount,
        beneficiary: template.beneficiary === "unsupported"
            ? null
            : spec.beneficiary !== undefined
                ? toAddressBigint(spec.beneficiary, "beneficiary")
                : "self",
        approvalPolicy,
        extra,
    };
}
//# sourceMappingURL=params.js.map