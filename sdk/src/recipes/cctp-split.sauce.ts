/**
 * cctp-split — move a USDC `CCTP_AMOUNT` in CCTP burns capped at `CCTP_CHUNK_SIZE`, ATOMIC in one
 * Sauce cook.
 *
 * The INTERFACE is the whole point: you pass the TOTAL amount and the per-message chunk size, and
 * THE SCRIPT does the splitting — `count = amount / chunkSize` full-cap burns, then one final burn of
 * the leftover `remainder = amount % chunkSize` when it isn't zero. No divisibility assumption, no
 * remainder dropped: `$2.50` at a `$1` cap becomes `$1 + $1 + $0.50`. The TypeScript builder computes
 * nothing; it only hands the script its two numbers.
 *
 * THIS INTENT'S VALUES ARRIVE AS `defines`. The five consts below are declared with placeholder
 * defaults so this file reads (and compiles) standalone; the builder
 * (`recipes/cctp-transfer.ts`) overrides each one per intent, and a define REPLACES the module's own
 * `const` of that name. They are constant-folded, so a given set of values yields fixed bytecode.
 * Standalone asset, not a string assembled in TypeScript. NOT the same shape as `settle.sauce.ts`: that one takes its values as runtime entry
 * arguments precisely so its bytecode stays invariant and hash-pinnable (`settle.sauce.ts:44`), where
 * these fold the values in and change bytecode with them.
 *
 * DSL-NATIVE, ZERO HARDCODING — no ABI, no address:
 *   • `USDC` resolves to the source chain's USDC address from the token registry.
 *   • `Cctp.TokenMessenger.depositForBurn(...)` resolves interface + address from the CCTP protocol
 *     descriptor.
 *   • `Cctp.TokenMessenger` (the approve spender) resolves to that same address as a VALUE — the
 *     accessor works in value position, not just as a call target (equivalent to the underscore
 *     ambient define `Cctp_TokenMessenger`, just the accessor-consistent spelling).
 * One approval for the whole amount, then the burns against it — if any burn reverts (e.g. it
 * exceeds Circle's per-message cap) the entire source-chain tx reverts (all-or-nothing). The
 * approval is `@sauce/token`'s SafeERC20 `approve`: it resets an allowance a previous cook left
 * standing to zero before setting the new one, and reverts on a `false` return.
 *
 * Declarations are unannotated: every value here is a number, which is what SauceScript reads an
 * unannotated declaration as.
 */
const CCTP_RECIPIENT = 0n;
const CCTP_AMOUNT = 0n;
const CCTP_CHUNK_SIZE = 1n;
const CCTP_DEST_DOMAIN = 0n;
const CCTP_MAX_FEE = 0n;

function main() {
  USDC.approve(Cctp.TokenMessenger, CCTP_AMOUNT);
  let count = CCTP_AMOUNT / CCTP_CHUNK_SIZE;
  for (let i = 0n; i < count; i++) {
    Cctp.TokenMessenger.depositForBurn(
      CCTP_CHUNK_SIZE,
      CCTP_DEST_DOMAIN,
      CCTP_RECIPIENT,
      USDC,
      0n,
      CCTP_MAX_FEE,
      0n,
    );
  }
  let remainder = CCTP_AMOUNT % CCTP_CHUNK_SIZE;
  if (remainder > 0n) {
    Cctp.TokenMessenger.depositForBurn(
      remainder,
      CCTP_DEST_DOMAIN,
      CCTP_RECIPIENT,
      USDC,
      0n,
      CCTP_MAX_FEE,
      0n,
    );
  }
  return 0n;
}
