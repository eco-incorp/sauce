// SAUCE SETTLE PAYLOAD WIRE FORMAT — the byte-level constants a partner needs to implement the
// check in ANY language (Go/Solidity/Python), independent of this package. See decode.ts's module
// docstring for the full layout; this file carries only the numbers.
//
// Every value here was MEASURED against the published Rust compiler's actual emission for
// `recipes/settle.sauce.ts` and against a real v12 runtime executing it — none is a choice.
//
// GONE WITH THE v1 GRAMMAR: `scanMinimalPush` / `encodeMinimalPush` / `PushScanResult`. Those
// decoded the retired TypeScript compiler's `L || data[L]` argument pushes. The arguments no longer
// live in the program at all — they ride a fixed-width 32-byte-word tail — so there is no push to
// scan and no minimality to enforce. The uniqueness those checks bought is now bought by the fixed
// layout itself, plus `HEAD_BYTES` and the zero-upper-bytes rule (decode.ts, §4).
//
// ALSO GONE FROM `SETTLE_WIRE` in that change: `TUPLE_OP`, `PUSH_MIN`, `PUSH_MAX`, `MAX_ARITY`. All
// four described that same prologue — there are no pushes to bound and no arity to cap when every
// value is a fixed 32-byte word. A build breaking on one of them wants `PROGRAM_BYTES`, `WORD_BYTES`
// or `HEAD_BYTES` instead. This is a breaking change to the published `./verify` subpath.

/** Wire-format constants for the settle payload on engine target v12. */
export const SETTLE_WIRE = {
  /** Byte length of the compiled `settle.sauce.ts` program. It is INVARIANT: the program takes its
   *  `(tokens, minOut, recipient)` as runtime entry arguments, so nothing about the caller's values
   *  reaches the compiler. This length is what locates the argument tail. */
  PROGRAM_BYTES: 435,
  /** Which compiler produced the bytes `PROGRAM_HASH` pins. The dependency is a caret range, and on
   *  `^2.0.0` that is the whole `2.x` line — a far wider window than the `0.7.x` a `^0.7.0` caret
   *  admitted, since a caret on `0.x` pins the minor. Any `2.x` that changes codegen makes a
   *  consumer's own compile fail that pin; the fix then is to re-pin all three of these, not to
   *  loosen the check. `verify.compile.test.ts` asserts this
   *  exact version against the resolved package, so it cannot silently describe a producer that never
   *  ran — and it must be asserted against the version EVERY workspace resolves, since a bump in one
   *  package.json leaves this string describing a compiler no consumer runs.
   *
   *  0.5.0 → 0.7.0 moved these bytes: 391 → 370, with a different hash. A consumer on the newer
   *  compiler and the older pin has every settle it produces rejected on `PROGRAM_HASH`, which is why
   *  the bump and the re-pin are one change. Intents published against the old hash still verify —
   *  pass it via `validateSettleProgram`'s accepted-hash set.
   *
   *  0.7.0 → 1.0.0 did NOT move them, despite carrying ABI type widths through both codec
   *  directions, and neither did 1.0.0 → 2.0.0 — whose major is an artifact of the release config
   *  rather than a compiler change. 2.0.0 → 2.1.0 DID: 370 → 363, on the element/field write
   *  boxing change. 2.1.0 → 2.2.0 DID too: 363 → 362, on the UNPACK opcode and the entry-argument
   *  lowering it came with. 2.2.0 → 2.2.1 did NOT: its two compiler fixes both tighten what the
   *  frontend REFUSES, so nothing this program already compiled to could move. 2.2.1 → 2.3.0
   *  DOES: 362 → 356, with a new hash after the optimizer updates. So a compiler bump
   *  is not evidence either way: this string changes
   *  every time, the hash only when the output does, and the tests above tell them apart.
   *
   *  The TEMPLATE moved them once on 2.3.0 with the compiler unchanged: 356 → 435, when the sweep's
   *  `transfer` became the SDK's SafeERC20 transfer (`token/safe.ts`). Through `IERC20` it decoded a
   *  `bool` from a no-return token's empty returndata, which reverts on this engine, so USDT could not
   *  be swept; and nothing checked the `bool`, so a token answering `false` read as swept.
   *
   *  Compiler 2.4.0 keeps the length at 435 bytes but changes the ABI encoding instructions
   *  and therefore the program hash. Compiler 2.5.0 leaves both unchanged.
   *
   *  Pins that shipped before this one, for `validateSettleProgram`'s `accepted` list so payloads
   *  built against them stay readable:
   *    - `{ hash: "0x35d103dc1f3a6077d987dc2a65daed650f2ed4e2a1fdd386608373e2aa4e2b40", bytes: 435 }`
   *      (compiler 2.3.0, SafeERC20 settlement template)
   *    - `{ hash: "0xf9fffd262b32ad0cb07f2748f813626363497e09e4f4da134bed1b8da0c5d5fe", bytes: 356 }`
   *      (0.99.2 – 0.99.4)
   *    - `{ hash: "0x2da5c63da0ed3e934f4bb09985a38723de1f2a8e9a9a97ef3993e526cb649d11", bytes: 362 }`
   *      (0.99.0 – 0.99.1) */
  PROGRAM_COMPILER: "@eco-incorp/sauce-compiler@2.5.0",
  /** `keccak256` of those `PROGRAM_BYTES` bytes — the authenticity pin `validateSettleProgram`
   *  enforces, and the reason a matching payload runs the audited program and nothing else.
   *  Whole-program, not a body slice: program and arguments are disjoint byte regions on this wire.
   *  `verify.compile.test.ts` recomputes it from source every run and fails before any consumer does. */
  PROGRAM_HASH: "0x9460111670cb654d7c56d685ef3caea67bfe90e0dca350a471d9ca9f97699ab6",
  /** Every argument word is 32 bytes, big-endian. */
  WORD_BYTES: 32,
  /** An address occupies the LOW 20 bytes of its word; the upper 12 MUST be zero (§4). */
  ADDRESS_BYTES: 20,
  /** The three head slots — `tokens` pointer, `minOut`, `recipient` — ahead of the token array. */
  HEAD_SLOTS: 3,
  /** `HEAD_SLOTS * WORD_BYTES`. Also the ONLY legal value of the `tokens` pointer: the array data
   *  follows the head immediately, so the pointer is a constant on a canonical payload even though
   *  the engine would follow any offset. */
  HEAD_BYTES: 96,
} as const;
