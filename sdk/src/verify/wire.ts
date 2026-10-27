// SAUCE SETTLE PAYLOAD WIRE FORMAT — the byte-level constants a partner needs to implement the
// check in ANY language (Go/Solidity/Python), independent of this package. See decode.ts's module
// docstring for the full layout; this file carries only the numbers.
//
// Every value here was MEASURED against the published Rust compiler's actual emission for
// `recipes/settle.sauce.ts` and against a real v12 runtime executing it — none is a choice.
//

/** Canonical settlement payload constants for public verification. */
export const SETTLE_WIRE = {
  /** Byte length of the compiled `settle.sauce.ts` program. It is INVARIANT: the program takes its
   *  `(tokens, minOut, recipient)` as runtime entry arguments, so nothing about the caller's values
   *  reaches the compiler. This length is what locates the argument tail. */
  PROGRAM_BYTES: 410,
  /** Compiler that produced the program pin. Update its bytes, length and hash together.
   *  Historical payloads require an explicit accepted `{ hash, bytes }` pin:
   *  - 2.4.0–2.5.0: 0x9460111670cb654d7c56d685ef3caea67bfe90e0dca350a471d9ca9f97699ab6, 435
   *  - 2.3.0 SafeERC20 recipe: 0x35d103dc1f3a6077d987dc2a65daed650f2ed4e2a1fdd386608373e2aa4e2b40, 435
   *  - 0.99.2–0.99.4: 0xf9fffd262b32ad0cb07f2748f813626363497e09e4f4da134bed1b8da0c5d5fe, 356
   *  - 0.99.0–0.99.1: 0x2da5c63da0ed3e934f4bb09985a38723de1f2a8e9a9a97ef3993e526cb649d11, 362 */
  PROGRAM_COMPILER: "@eco-incorp/sauce-compiler@2.6.1",
  /** `keccak256` of those `PROGRAM_BYTES` bytes — the authenticity pin `validateSettleProgram`
   *  enforces, and the reason a matching payload runs the audited program and nothing else.
   *  Whole-program, not a body slice: program and arguments are disjoint byte regions on this wire.
   *  `verify.compile.test.ts` recomputes it from source every run and fails before any consumer does. */
  PROGRAM_HASH: "0x65e88f5f8772f37ed530f0469c440fa3834f4399efd8bd60a443fed53826449b",
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
