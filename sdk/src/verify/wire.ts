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
  PROGRAM_BYTES: 370,
  /** Which compiler produced the bytes `PROGRAM_HASH` pins. The dependency is a caret range, and on
   *  `^1.0.0` that is the whole `1.x` line — a far wider window than the `0.7.x` a `^0.7.0` caret
   *  admitted, since a caret on `0.x` pins the minor. Any `1.x` that changes codegen makes a
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
   *  directions. So a compiler bump is not evidence either way: this string changes every time, the
   *  hash only when the output does, and the tests above are what tell them apart. */
  PROGRAM_COMPILER: "@eco-incorp/sauce-compiler@1.0.0",
  /** `keccak256` of those `PROGRAM_BYTES` bytes — the authenticity pin `validateSettleProgram`
   *  enforces, and the reason a matching payload runs the audited program and nothing else.
   *  Whole-program, not a body slice: program and arguments are disjoint byte regions on this wire.
   *  `verify.compile.test.ts` recomputes it from source every run and fails before any consumer does. */
  PROGRAM_HASH: "0x539ec5903000571508732abf3e46ac02fcaff5bd1f9cb4d2835aec40d3c70c2e",
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
