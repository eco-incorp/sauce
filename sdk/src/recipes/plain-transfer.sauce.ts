/**
 * plain-transfer — the no-bridge baseline: move `amount` USDC to `recipient` in one call. Same
 * standalone-asset + compile-time-`args` shape as `cctp-split.sauce.ts` (the builder bakes this
 * intent's values into `main`); `USDC` resolves from the token registry. Params unannotated for the
 * same acorn-based-rewrite reason documented there.
 */
function main(recipient, amount) {
  USDC.transfer(recipient, amount);
  return 0n;
}
