/**
 * `@eco-incorp/sauce-sdk`'s `deposit` module — E4.2, the universal deposit/stake/wrap adapter.
 *
 * Types + the per-protocol template registry shape. See `sdk/src/deposit/index.ts` for the
 * module-level overview, and `sdk/src/swap/types.ts` (E4.1) for the sibling module this one mirrors
 * — `Address`/`AddressInput`/`AmountInput` are re-used from there, not re-declared.
 */
export type { Address, AddressInput, AmountInput, Hex } from "../swap/types.js";
import type { AddressInput, AmountInput } from "../swap/types.js";

/**
 * How a template's protocol call pulls in the token amount being deposited.
 *
 * - `"erc20-approve"` — an ERC20 asset; `depositCallStatement` emits `IERC20.approve(target,
 *   amount)` immediately before the protocol call (see {@link ApprovalPolicy}).
 * - `"native-value"` — no ERC20 leg at all; the amount rides as `msg.value` on a raw
 *   `evm.call(target, value, calldata)` (a typed ABI binding can never attach value — see
 *   `sdk/src/deposit/index.ts`'s "native vs ERC20" note). No approve is ever emitted.
 * - `"none"` — a redeem/withdraw leg that burns a balance this contract already holds (e.g. Aave's
 *   `withdraw`, which burns aTokens). No approve, no value.
 */
export type Funding = "erc20-approve" | "native-value" | "none";

/** Whether a template's protocol call accepts a caller-chosen beneficiary/recipient address. */
export type BeneficiarySupport = "supported" | "unsupported";

/** How much of `spec.amount` to approve, when `funding === "erc20-approve"`. */
export type ApprovalPolicy = "exact" | "max" | "none";

/** A single extra, protocol-specific field a template accepts beyond the common shape. */
export interface ExtraFieldSpec {
  /** Default value used when the caller omits this field entirely. */
  readonly defaultValue: bigint;
  /** Normalizes + range-checks a caller-supplied value; throws (naming the field) on violation. */
  normalize(value: AmountInput, fieldName: string): bigint;
}

/**
 * The chain-agnostic deposit SPEC a caller builds — the input to {@link toDeposit} /
 * `depositCallStatement` / `depositSource`.
 *
 * `token` is required for an `"erc20-approve"`/`"none"` template (the asset being approved/
 * supplied/withdrawn) and must be omitted for a `"native-value"` template (there is no ERC20 leg).
 * `beneficiary` defaults to `ctx.self()` and must be omitted on a `beneficiary: "unsupported"`
 * template (every such protocol credits `msg.sender` unconditionally — accepting one would silently
 * send the position to the wrong account).
 */
export interface DepositSpec {
  /** SDK protocol slug (`"aave-v3"`, `"spark"`, …), or `"weth"` — see `skippedProtocols` in the
   *  module doc for why WETH has no SDK protocol entry but is still supported here. */
  protocol: string;
  /** `"supply" | "withdraw" | "deposit" | "wrap" | "unwrap" | "stake"`, per the registered template. */
  action: string;
  /** The contract this deposit calls into (the Aave Pool, the Comet, the vault, WETH9, stETH, …). */
  target: AddressInput;
  /** Required for an ERC20-funded template; must be omitted for a native-value one. */
  token?: AddressInput;
  amount: AmountInput;
  /** Defaults to `ctx.self()`. Must be omitted on a `beneficiary: "unsupported"` template. */
  beneficiary?: AddressInput;
  /** Defaults to `"exact"`. See {@link ApprovalPolicy}. */
  approvalPolicy?: ApprovalPolicy;
  /** Extra, protocol-specific fields (e.g. Aave/Spark `referralCode`). */
  extra?: Readonly<Record<string, AmountInput>>;
}

/**
 * The extra shapes `depositCallStatement`/`depositSource` accept beyond a concrete
 * {@link DepositSpec}:
 *
 * - `amount: "balance"` — emit a RUNTIME balance read instead of a baked-in literal (`IERC20.
 *   balanceOf(ctx.self())` for an ERC20 template, `ctx.selfBalance()` for a native one) — the shape
 *   a swap-then-deposit program needs when the deposit amount is an earlier leg's (unknown at
 *   compile time) output.
 * - `amount: "delta"` — only meaningful inside `swapThenDepositSource` (it needs a pre-swap balance
 *   snapshot to compute against); `depositCallStatement`/`depositSource` alone reject it.
 * - `amount: "max"` — only accepted on a template with `allowsMaxAmount: true` (Aave/Spark
 *   `withdraw`'s documented `type(uint256).max` withdraw-all sentinel); rejected everywhere else.
 */
export type DepositSourceSpec =
  DepositSpec | (Omit<DepositSpec, "amount"> & { amount: "balance" | "delta" | "max" });

/**
 * A {@link DepositSpec}, fully normalized — bigint scalars (+ the `"self"` sentinel for a defaulted
 * `beneficiary`, matching `SwapParams`'s own convention), plus the resolved {@link DepositTemplate}.
 * `amount` stays a passthrough of whatever `toDeposit` was handed for the runtime-amount shapes
 * (`"balance"` etc.) so a caller can tell a concrete deposit from a source-only one apart.
 */
export interface NormalizedDeposit {
  template: DepositTemplate;
  target: bigint;
  token: bigint | null;
  amount: bigint | "balance" | "delta" | "max";
  beneficiary: bigint | "self" | null;
  approvalPolicy: ApprovalPolicy;
  extra: Readonly<Record<string, bigint>>;
}

/**
 * One per-protocol call template — data + a small pure emitter, deliberately not a class
 * hierarchy. See `sdk/src/deposit/templates.ts` for the concrete registry and
 * `sdk/src/deposit/index.ts` for which protocols are included/skipped and why.
 */
export interface DepositTemplate {
  /** SDK protocol slug this template is keyed under, or `"weth"` (no SDK protocol entry — see the
   *  module doc's `skippedProtocols` note). */
  readonly protocol: string;
  readonly action: string;
  /** Provenance: which vendored ABI backs this template. `null` only for the two WETH9 templates,
   *  which have no SDK ABI at all. */
  readonly source: { readonly module: string; readonly exportName: string } | null;
  /** The exact method signature, transcribed from the vendored ABI (or WETH9's well-known one). */
  readonly signature: string;
  /** `toFunctionSelector(signature)`, pinned by a drift test. */
  readonly selector: `0x${string}`;
  readonly funding: Funding;
  readonly beneficiary: BeneficiarySupport;
  /** True only where the protocol documents a `uint256` max-amount sentinel (Aave/Spark withdraw). */
  readonly allowsMaxAmount: boolean;
  /** SauceScript import lines this template needs (empty for the two raw-call WETH templates,
   *  which use no typed ABI binding at all). */
  readonly imports: readonly string[];
  /** The SauceScript identifier the import binds the ABI to (e.g. `"IAavePool"`); `null` for a
   *  raw-call template. */
  readonly binding: string | null;
  /** Extra spec fields this template accepts (e.g. Aave/Spark `referralCode`). */
  readonly extras: Readonly<Record<string, ExtraFieldSpec>>;
  /**
   * Pure: the normalized deposit + the already-resolved amount EXPRESSION (a SauceScript literal
   * like `"1000n"` or a bound identifier like `"depositAmt0"`/`"ctx.selfBalance()"`) -> the
   * protocol-call statement line(s). The approve line is NOT emitted here — `depositCallStatement`
   * prepends it from `funding`/`approvalPolicy`, so the approve rule lives in exactly one place
   * across every template.
   *
   * `varSuffix` is the emitting spec's own index within the program (the same one
   * `depositCallStatement` uses for `depositAmtN`), so a template that BINDS a local must suffix it
   * — two deposits of the same kind in one `main` would otherwise redeclare one name.
   */
  emit(d: NormalizedDeposit, amountExpr: string, varSuffix: string): readonly string[];
}

/** A short, human-readable note on a protocol considered but not registered as a template. */
export interface SkippedProtocolNote {
  readonly protocol: string;
  readonly reason: string;
}
