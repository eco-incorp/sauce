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

/** Wire-format constants for the settle payload on engine target v12. */
export const SETTLE_WIRE = {
  /** Byte length of the compiled `settle.sauce.ts` program. It is INVARIANT: the program takes its
   *  `(tokens, minOut, recipient)` as runtime entry arguments, so nothing about the caller's values
   *  reaches the compiler. This length is what locates the argument tail. */
  PROGRAM_BYTES: 391,
  /** `keccak256` of those 391 bytes — the authenticity pin `validateSettleProgram` enforces.
   *  Whole-program, not a body slice: program and arguments are disjoint byte regions now.
   *
   *  PRODUCED BY `@eco-incorp/sauce-compiler@0.5.0`. The dependency is a caret range, so a later
   *  0.5.x that changes codegen would make a consumer's own compile fail this pin. When that happens
   *  the fix is to re-pin here (`verify.compile.test.ts` recomputes both constants every run and will
   *  fail first), not to loosen the check. */
  PROGRAM_COMPILER: "@eco-incorp/sauce-compiler@0.5.0",
  PROGRAM_HASH: "0x39ef0a5f26a7c586649ca3c59726cb4c1156105805ce5f39edfff9ff8704c743",
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
