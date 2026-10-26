/**
 * `@eco-incorp/sauce`'s `deposit` module — E4.2, the universal deposit/stake/wrap adapter.
 *
 * Types + the per-protocol template registry shape. See `sdk/src/deposit/index.ts` for the
 * module-level overview.
 */

/** A 20-byte EVM address, as an ordinary `0x`-prefixed hex string. */
export type Address = `0x${string}`;

/** A `0x`-prefixed hex byte string. */
export type Hex = `0x${string}`;

/** Anything the builders accept for an address-shaped field. */
export type AddressInput = Address | bigint;

/** Anything the builders accept for a numeric-shaped field. */
export type AmountInput = bigint | number | string;

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
 * `token` names the asset for a typed-ABI template. Omit it for WETH wrap/unwrap and Lido stake;
 * WETH unwrap uses `target` as its token address, while wrap and stake use native ETH.
 * `beneficiary` defaults to the Pot and must be omitted on a `beneficiary: "unsupported"`
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
  /** Required for typed-ABI templates; omit for WETH wrap/unwrap and Lido stake. */
  token?: AddressInput;
  amount: AmountInput;
  /** Defaults to the Pot. Must be omitted on a `beneficiary: "unsupported"` template. */
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
 *   balanceOf(ctx.self())` on `token` or the WETH unwrap `target`, `ctx.selfBalance()` for a
 *   native-funded template) — the shape a program needs when the deposit amount is only known when
 *   it runs, such as what an earlier swap delivered.
 * - `amount: "max"` — only accepted on a template with `allowsMaxAmount: true` (Aave/Spark
 *   `withdraw`'s documented `type(uint256).max` withdraw-all sentinel); rejected everywhere else.
 */
export type DepositSourceSpec =
  DepositSpec | (Omit<DepositSpec, "amount"> & { amount: "balance" | "max" });

/**
 * A {@link DepositSpec}, fully normalized — bigint scalars (+ the `"pot"` sentinel for a defaulted
 * `beneficiary`), plus the resolved {@link DepositTemplate}.
 * `amount` stays a passthrough of whatever `toDeposit` was handed for the runtime-amount shapes
 * (`"balance"` etc.) so a caller can tell a concrete deposit from a source-only one apart.
 */
export interface NormalizedDeposit {
  template: DepositTemplate;
  target: bigint;
  token: bigint | null;
  amount: bigint | "balance" | "max";
  beneficiary: bigint | "pot" | null;
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
