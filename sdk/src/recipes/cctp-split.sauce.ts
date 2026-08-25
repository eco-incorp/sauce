/**
 * cctp-split — split a USDC transfer into N equal sub-limit CCTP burns, ATOMIC in one Sauce cook.
 *
 * `main` is parameterized; the recipe builder (`recipes/cctp-transfer.ts`) bakes THIS intent's
 * concrete values in as compile-time `args` — the compiler rewrites `main(recipient, chunk, ...)`
 * into a no-arg `main` that opens with those literals — so the shipped bytecode carries no runtime
 * inputs, and the program stays a readable, standalone asset instead of a string assembled in
 * TypeScript. Same shape as `settle.sauce.ts`.
 *
 * DSL-NATIVE, ZERO HARDCODING — no ABI, no address:
 *   • `USDC` resolves to the source chain's USDC address from the token registry.
 *   • `Cctp.TokenMessenger.depositForBurn(...)` resolves interface + address from the CCTP protocol
 *     descriptor.
 *   • `Cctp_TokenMessenger` (the approve spender) is that same address, auto-injected as an ambient
 *     define.
 * One approval for the whole batch, then N burns against it — if any burn reverts (e.g. it exceeds
 * Circle's per-message cap) the entire source-chain tx reverts (all-or-nothing).
 *
 * Params are intentionally UNANNOTATED: the DSL accessor rewrite that resolves `USDC`/`Cctp` is
 * acorn-based (plain JS), so a `.sauce.ts` routed through it must carry no TypeScript type syntax.
 */
function main(recipient, chunk, count, destinationDomain, maxFee) {
  USDC.approve(Cctp_TokenMessenger, chunk * count);
  for (let i = 0n; i < count; i = i + 1n) {
    Cctp.TokenMessenger.depositForBurn(chunk, destinationDomain, recipient, USDC, 0n, maxFee, 0n);
  }
  return 0n;
}
