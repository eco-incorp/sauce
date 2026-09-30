/**
 * plain-transfer — the no-bridge baseline: move `XFER_AMOUNT` USDC to `XFER_RECIPIENT` in one call.
 * Same standalone-asset shape as `cctp-split.sauce.ts`: the two consts below carry placeholder
 * defaults and the builder overrides them per intent via `defines`, which are constant-folded into
 * fixed bytecode. `USDC` resolves from the token registry. Declarations unannotated for the same
 * acorn-based-rewrite reason documented there.
 *
 * `USDC.transfer(...)` is lowered to `@sauce/token`'s `transfer`, which is OpenZeppelin `SafeERC20`:
 * a token that returns nothing is accepted, and one that returns `false` reverts the cook.
 */
const XFER_RECIPIENT = 0n;
const XFER_AMOUNT = 0n;

function main() {
  USDC.transfer(XFER_RECIPIENT, XFER_AMOUNT);
  return 0n;
}
