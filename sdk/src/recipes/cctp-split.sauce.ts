/**
 * cctp-split — move a USDC `amount` in CCTP burns capped at `chunkSize`, ATOMIC in one Sauce cook.
 *
 * The INTERFACE is the whole point: you pass the TOTAL `amount` and the per-message `chunkSize`, and
 * THE SCRIPT does the splitting — it burns `chunkSize` at a time until the amount is drained, the
 * last burn taking whatever is left (`< chunkSize`). No divisibility assumption, no remainder dropped:
 * `$2.50` at a `$1` cap becomes `$1 + $1 + $0.50`. The TypeScript builder computes nothing; it only
 * hands the script its two numbers.
 *
 * `main` is parameterized; the builder (`recipes/cctp-transfer.ts`) bakes THIS intent's concrete
 * values in as compile-time `args`. The compiler pushes them via a call prologue and `main` receives
 * them as ordinary runtime params, so the drain `while` loop is real runtime control flow — the burn
 * count is decided on-chain from `amount`/`chunkSize`, not precomputed off-chain. Standalone asset,
 * not a string assembled in TypeScript. Same shape as `settle.sauce.ts`.
 *
 * DSL-NATIVE, ZERO HARDCODING — no ABI, no address:
 *   • `USDC` resolves to the source chain's USDC address from the token registry.
 *   • `Cctp.TokenMessenger.depositForBurn(...)` resolves interface + address from the CCTP protocol
 *     descriptor.
 *   • `Cctp_TokenMessenger` (the approve spender) is that same address, auto-injected as an ambient
 *     define.
 * One approval for the whole amount, then the burns against it — if any burn reverts (e.g. it
 * exceeds Circle's per-message cap) the entire source-chain tx reverts (all-or-nothing).
 *
 * Params are intentionally UNANNOTATED: the DSL accessor rewrite that resolves `USDC`/`Cctp` is
 * acorn-based (plain JS), so a `.sauce.ts` routed through it must carry no TypeScript type syntax.
 */
function main(recipient, amount, chunkSize, destinationDomain, maxFee) {
  USDC.approve(Cctp_TokenMessenger, amount);
  let remaining = amount;
  while (remaining > 0n) {
    let burnAmount = chunkSize;
    if (remaining < chunkSize) {
      burnAmount = remaining;
    }
    Cctp.TokenMessenger.depositForBurn(burnAmount, destinationDomain, recipient, USDC, 0n, maxFee, 0n);
    remaining = remaining - burnAmount;
  }
  return 0n;
}
