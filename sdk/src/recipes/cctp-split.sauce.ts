/**
 * cctp-split — split a USDC transfer into full sub-limit CCTP burns plus a final remainder burn,
 * ATOMIC in one Sauce cook.
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
 * One approval for the whole batch, then the burns against it — if any burn reverts (e.g. it
 * exceeds Circle's per-message cap) the entire source-chain tx reverts (all-or-nothing).
 *
 * The split is `count` full `chunk`-sized burns plus, when `amount` is NOT an exact multiple of the
 * per-message cap, ONE final `remainder` burn (`0 < remainder < chunk`) so the whole `amount` moves
 * — never a truncated total. `count`/`chunk`/`remainder` arrive as runtime params (the compiler
 * pushes the baked `args` via a call prologue; `main` is a normal function receiving them), so the
 * loop and the remainder guard are ordinary runtime control flow — a zero remainder simply skips
 * the extra burn.
 *
 * Params are intentionally UNANNOTATED: the DSL accessor rewrite that resolves `USDC`/`Cctp` is
 * acorn-based (plain JS), so a `.sauce.ts` routed through it must carry no TypeScript type syntax.
 */
function main(recipient, chunk, count, remainder, destinationDomain, maxFee) {
  USDC.approve(Cctp_TokenMessenger, chunk * count + remainder);
  for (let i = 0n; i < count; i = i + 1n) {
    Cctp.TokenMessenger.depositForBurn(chunk, destinationDomain, recipient, USDC, 0n, maxFee, 0n);
  }
  if (remainder > 0n) {
    Cctp.TokenMessenger.depositForBurn(remainder, destinationDomain, recipient, USDC, 0n, maxFee, 0n);
  }
  return 0n;
}
