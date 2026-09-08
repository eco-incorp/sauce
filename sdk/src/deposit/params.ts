/**
 * Normalization core for E4.2's universal deposit adapter — `toDeposit`. See
 * `sdk/src/deposit/index.ts` for the module overview.
 */
import { toExactBigInt } from "../numeric.js";
import type { AddressInput, AmountInput } from "../swap/types.js";
import { depositTemplateFor } from "./templates.js";
import type { ApprovalPolicy, DepositSpec, NormalizedDeposit } from "./types.js";

function toAddressBigint(value: AddressInput, _label: string): bigint {
  if (typeof value === "bigint") return value;
  return BigInt(value);
}

function toBigIntStrict(value: AmountInput, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return toExactBigInt(value, label);
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
 * with `allowsMaxAmount: false`; an unrecognized `extra` field name; an `amount` given as a `number`
 * that is not a safe integer (past 2^53-1 pass a bigint or a string, since the double has already
 * been rounded); and whatever the field's own `ExtraFieldSpec.normalize` throws for an out-of-range
 * extra value.
 */
export function toDeposit(
  spec: DepositSpec | (Omit<DepositSpec, "amount"> & { amount: "balance" | "delta" | "max" }),
): NormalizedDeposit {
  const template = depositTemplateFor(spec.protocol, spec.action);

  // A raw-call template (`binding === null`: weth:wrap, weth:unwrap, lido:stake) operates
  // directly on `target` via a hand-built calldata word — there is no separate ERC20 asset
  // address at all, so "token" must be omitted. Every typed-ABI template (`binding !== null`)
  // requires one, regardless of its `funding` (even a "none"-funded typed withdraw like
  // aave-v3:withdraw still names an `asset` argument).
  if (template.binding === null) {
    if (spec.token !== undefined) {
      throw new Error(
        `toDeposit: ${spec.protocol}:${spec.action} is a native-value template — there is no ERC20 leg, so "token" must be omitted`,
      );
    }
  } else if (spec.token === undefined) {
    throw new Error(
      `toDeposit: ${spec.protocol}:${spec.action} requires "token" (the asset being approved/supplied/withdrawn)`,
    );
  }

  if (template.beneficiary === "unsupported" && spec.beneficiary !== undefined) {
    throw new Error(
      `toDeposit: ${spec.protocol}:${spec.action} does not support a beneficiary — it always credits msg.sender; passing one would silently be ignored on-chain`,
    );
  }

  const amount: bigint | "balance" | "delta" | "max" =
    spec.amount === "balance" || spec.amount === "delta" || spec.amount === "max"
      ? spec.amount
      : toBigIntStrict(spec.amount, "amount");

  if (amount === "max" && !template.allowsMaxAmount) {
    throw new Error(
      `toDeposit: ${spec.protocol}:${spec.action} does not document a uint256-max sentinel — "max" is only accepted where allowsMaxAmount is true`,
    );
  }

  const extraInput = spec.extra ?? {};
  for (const name of Object.keys(extraInput)) {
    if (!(name in template.extras)) {
      const known = Object.keys(template.extras).sort().join(", ") || "(none)";
      throw new Error(
        `toDeposit: ${spec.protocol}:${spec.action} has no extra field "${name}". Known: ${known}`,
      );
    }
  }
  const extra: Record<string, bigint> = {};
  for (const [name, fieldSpec] of Object.entries(template.extras)) {
    const raw = extraInput[name];
    extra[name] =
      raw !== undefined ? fieldSpec.normalize(raw, `extra.${name}`) : fieldSpec.defaultValue;
  }

  const approvalPolicy: ApprovalPolicy = spec.approvalPolicy ?? "exact";

  return {
    template,
    target: toAddressBigint(spec.target, "target"),
    token: template.binding === null ? null : toAddressBigint(spec.token as AddressInput, "token"),
    amount,
    beneficiary:
      template.beneficiary === "unsupported"
        ? null
        : spec.beneficiary !== undefined
          ? toAddressBigint(spec.beneficiary, "beneficiary")
          : "self",
    approvalPolicy,
    extra,
  };
}
