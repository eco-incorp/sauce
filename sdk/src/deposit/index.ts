/**
 * `@eco-incorp/sauce-sdk`'s `deposit` module — E4.2, the universal deposit/stake/wrap adapter.
 *
 * There is no engine Router adapter for deposit/stake/wrap — the Router is swap+quote only. So a
 * deposit lowers to a DIRECT protocol call in SauceScript: `token.approve(spender, amount);
 * IProtocol.at(addr).method(...)` — the `swapAndSupply` recipe's own shape. E4.2 is therefore a
 * PER-PROTOCOL call-template registry (`sdk/src/deposit/templates.ts`), not a dispatch into one
 * entry point like `swap`.
 *
 * Two layers, both pure/sync, no compiler import (mirrors `sdk/src/swap/index.ts`'s posture):
 *
 *   1. {@link toDeposit} — the whole normalization/defaulting/guard decision, as a plain
 *      `NormalizedDeposit` object (bigint scalars, the resolved `DepositTemplate` attached).
 *   2. {@link depositCallStatement} / {@link depositSource} — pure string templating over that
 *      object, producing SauceScript source. `depositSource` returns a complete
 *      `function main() { ... }` program; `depositCallStatement` returns one statement block
 *      (approve + protocol call) for splicing into a larger program.
 *
 * ## Composing with E4.1 (swap)
 *
 * {@link swapThenDepositSource} is the seam: a swap-then-deposit program is ONE `main()` with the
 * swap statement(s) followed by the deposit statement(s) — because `V12Pot.cook` executes only
 * `ingredients[0]`, exactly like `swap`'s own multi-leg story.
 *
 * ```ts
 * import { compileSauceRoute, deposit } from "@eco-incorp/sauce-sdk";
 *
 * // compileSauceRoute, not the compiler directly: it applies the source post-processing a
 * // generated program needs (a `main` that falls off the end has no return type of its own,
 * // and a raw compile rejects it with "`main` does not return on every path").
 * const { compiled } = compileSauceRoute({
 *   source: deposit.swapThenDepositSource(swapLeg, { protocol: "aave-v3", action: "supply",
 *     target: aavePool, token: tokenOut, amount: "delta", extra: { referralCode: 0n } }),
 *   baseDirs: deposit.COMPOSED_BASE_DIRS,
 * });
 * ```
 *
 * ## Starter templates (eleven; see `templates.ts` for the full registry)
 *
 * - `aave-v3:supply` / `aave-v3:withdraw`, `spark:supply` / `spark:withdraw` — Aave-v3-shaped
 *   `Pool.supply/withdraw`; Spark is a verified Aave-v3 fork with the identical selector, kept as
 *   its own template entry for address-registry/documentation clarity.
 * - `compound-v3:supply` — Comet's `supplyTo(dst, asset, amount)`, used unconditionally (rather
 *   than the plain 2-arg `supply`) so a beneficiary is always representable.
 * - `euler-v2:deposit`, `erc4626:deposit` — ERC-4626-shaped `deposit(assets, receiver)`; `erc4626`
 *   is the universal catch-all for any 4626 vault reachable without its own template.
 * - `lido:wrap` (wstETH, ERC20-funded), `lido:stake` (stETH `submit`, native-value — must be a raw
 *   call, see below), and `weth:wrap` / `weth:unwrap` (WETH9, also raw — see `skippedProtocols`).
 *
 * ## Native vs ERC20 — why this is the one place E4.2 differs from E4.1's shape
 *
 * A TYPED ABI binding can never attach ETH: the compiler's non-view external-call path hardcodes
 * `value = 0` (`compiler/src/processor/expression.ts`'s `processContractCall`), and there is no
 * `.value()`/`{value:}` syntax anywhere in SauceScript. The only way to attach value is the raw
 * builtin `evm.call(target, value, calldata)`. So every
 * `funding: "native-value"` template (`weth:wrap`, `lido:stake`) emits a raw call instead of a
 * typed one — `WETH.deposit(){value}` becomes
 * `evm.call(<weth>, <amount>, hex`d0e30db0`)`. `weth:unwrap` is
 * ALSO a raw call (no vendored ABI exists for WETH at all — see below) but attaches no value; its
 * amount rides as an `abi.encode`d calldata word instead.
 *
 * ## `skippedProtocols` — what was left out, and why
 *
 * - **WETH has NO vendored SDK ABI anywhere** (there is no `weth`/`wrapped-native` protocol slug
 *   among the SDK's ~130 entries, and `sdk/src/artifacts/` — `.gitignore`d, engine artifacts only —
 *   could not host a hand-added one even if invented). Both WETH templates therefore use the raw
 *   `evm.call` path with WETH9's two well-known selectors as SDK constants, forced anyway for
 *   `wrap` (native value) and costing nothing for `unwrap`. The selectors are pinned in
 *   `sdk/test/deposit.test.ts` against `toFunctionSelector`, so they cannot silently rot.
 * - **`morpho-blue`'s `supply`** really does exist in the vendored ABI and does compile, but is
 *   deliberately NOT registered: its argument list mixes a static 5-field `marketParams` tuple with
 *   a dynamic `bytes data` field — a shape nothing in this repo has executed on-chain, against the
 *   backdrop of a recorded, still-open v12 all-dynamic `abi.encode` head/tail framing bug — and
 *   `supply` is assets-XOR-shares and market-keyed, which needs its own spec surface, not the flat
 *   `{token, amount, beneficiary}` shape this module is scoped to.
 * - **Also considered, left out:** `euler-v2` `EVCABI.enableCollateral/enableController` (position
 *   management, not a deposit); `aave-v2`'s `LendingPoolABI.deposit` (a 5-line alias of the
 *   registered `aave-v3:supply`, omitted to keep the starter set to current protocols);
 *   `compound-v3`'s `withdraw`/`withdrawTo` (present, deferred so the withdraw direction lands with
 *   one shape — Aave/Spark — first); most vault-shaped protocols not registered here are already
 *   reachable through `erc4626:deposit`.
 *
 * ## Approvals
 *
 * `depositCallStatement` prepends `IERC20.at(token).approve(target, amount)` immediately before the
 * protocol call whenever `funding === "erc20-approve"` — the ONE place this decision is made, so no
 * template can emit its own approve or forget one. The spender is always the template's own
 * `target`. `approvalPolicy` (default `"exact"`) may be `"none"` (skip — the token is already
 * approved) or `"max"` (approve `2n**256n - 1n`; NOT the default, since a cook's approval outlives
 * the cook — a lingering unlimited allowance is a real residual-risk change, not a gas
 * micro-optimization). No allowance CHECK is ever emitted (a read-then-branch inside a single
 * atomic cook is pure gas).
 *
 * ## Packaging note
 *
 * `DEPOSIT_BASE_DIRS`'s protocol-registry entry depends on the root `package.json` `files` list
 * shipping `sdk/src/protocols` verbatim in the published package — true today, but nothing in this
 * module enforces it going forward.
 *
 * See `docs/plans/2026-08-08-universal-interfaces-epic.md` for the wider epic this is E4.2 of.
 */
export type {
  Address,
  AddressInput,
  AmountInput,
  Hex,
  ApprovalPolicy,
  BeneficiarySupport,
  DepositSpec,
  DepositSourceSpec,
  DepositTemplate,
  ExtraFieldSpec,
  Funding,
  NormalizedDeposit,
  SkippedProtocolNote,
} from "./types.js";

export { DEPOSIT_TEMPLATES, depositTemplateFor, listDepositTemplates } from "./templates.js";
export type { DepositKey } from "./templates.js";

export { toDeposit } from "./params.js";

export {
  depositCallStatement,
  depositImportLines,
  depositSource,
  swapThenDepositSource,
  DEPOSIT_BASE_DIRS,
  COMPOSED_BASE_DIRS,
} from "./source.js";
export type { DepositSourceOptions, SwapThenDepositOptions } from "./source.js";
