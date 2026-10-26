/**
 * EVM deposit, withdrawal, staking, and wrapping builders for `@eco-incorp/sauce`.
 *
 * `toDeposit` normalizes a specification against the templates in `templates.ts`.
 * `depositSource` emits a complete program; `depositCallStatement` emits a block for composition.
 * These helpers construct source synchronously and do not compile or send transactions.
 *
 * Programs call the protocol directly. ERC-20-funded templates prepend an approval to the target;
 * native-funded templates attach value with `evm.call(target, value, calldata)`. The executing Pot
 * must hold the assets. WETH wrapping and unwrapping use their raw selectors.
 *
 * Compile generated source with `routes.compileSauceRoute`, supplying both `pot` and `engine`.
 * The route compiler serves the protocol and ERC-20 ABIs the program imports, and supplies a `void`
 * annotation for a falling-through entry. To deposit what a swap delivered, compile an action
 * program (`@eco-incorp/sauce/actions`), whose swap output feeds the next action, or splice
 * `depositCallStatement` with `amount: "balance"` after a call into `@sauce/router`.
 *
 * Query `listDepositTemplates()` for supported protocol/action pairs. Templates include Aave and
 * Spark supply/withdrawal, Compound V3 supply, Euler/ERC-4626 deposits, Lido operations, and WETH
 * wrapping/unwrapping. The registry does not cover every operation in the protocol catalog.
 *
 * The default approval policy is `exact`; `none` skips the approval and `max` grants the maximum
 * allowance. Approvals persist after the cook. The default beneficiary is the Pot when the
 * template supports a beneficiary. Runtime `balance` reads native ETH for native-funded templates,
 * WETH at `target` for unwrapping, or the supplied `token` otherwise.
 * For Aave/Spark withdrawals, use fixed amounts or `amount: "max"`: the runtime balance is the
 * underlying token held by the Pot, not its supplied position.
 *
 * See `docs/guides/builders-and-actions.md` for public usage and funding requirements.
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

export { depositCallStatement, depositImportLines, depositSource } from "./source.js";
export type { DepositSourceOptions } from "./source.js";
