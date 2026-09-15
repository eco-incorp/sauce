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
  PROGRAM_BYTES: 362,
  /** Exact compiler bundled by the performance artifact manifest. */
  PROGRAM_COMPILER: "@eco-incorp/sauce-compiler@2.2.0-rc.1",
  /** `keccak256` of those `PROGRAM_BYTES` bytes — the authenticity pin `validateSettleProgram`
   *  enforces, and the reason a matching payload runs the audited program and nothing else.
   *  Whole-program, not a body slice: program and arguments are disjoint byte regions on this wire.
   *  `verify.compile.test.ts` recomputes it from source every run and fails before any consumer does. */
  PROGRAM_HASH: "0x2da5c63da0ed3e934f4bb09985a38723de1f2a8e9a9a97ef3993e526cb649d11",
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
