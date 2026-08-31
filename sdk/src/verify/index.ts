// @eco-incorp/sauce-sdk/verify — turn a v1-grammar Sauce program's bytes back into the input params
// it was compiled with: `(tokens, minOut, recipient)`.
//
// That is the whole job. Dependency closure is `viem` ONLY (no node:fs, no compiler, no @solana/*,
// no artifact resolution, no program source on disk), so this surface is safe to import anywhere —
// including a browser or an edge runtime. That closure is the reason this decodes rather than
// recompiling-and-comparing: a recompile would put a ~2 MB wasm compiler in every consumer's
// dependency graph to answer a question `viem` alone answers today.
//
// ⚠ WHICH PROGRAMS. The v1 grammar is an ARTIFACT of compile-time `args`, so it is the grammar of
// exactly one compiler: `@eco-incorp/sauce-sdk/compiler`, the TypeScript compiler this package
// ships, which bakes the params into a fixed prologue ahead of the body. The published RUST compiler
// has no `args` option, and the `defines` standing in for it are constant-folded at each USE SITE —
// on `recipes/settle.sauce.ts`, `minOut` lands at byte 48 and `recipient` at byte 104, with `0x92`
// rather than `0x94` terminating the array. Such a program has no prologue and this decoder
// correctly refuses it. So: use this for programs compiled by `/compiler` (and for any
// reimplementation checked against `SETTLE_VECTORS`), not as a general "decode any settle" tool —
// and note that the SDK's own route builders compile through the Rust one.
//
// SCOPE, stated plainly: this decodes the PROLOGUE. It tells you which tokens, floor and recipient a
// program carries, and it is strict about the encoding (every push minimal-length, addresses capped
// at 20 bytes, a zero recipient rejected), so an accepted program is the UNIQUE byte encoding of the
// values it decodes to. It does NOT tell you the trailing body is a program you have audited — a
// prologue-shaped program can carry anything after it. Recompile-and-byte-compare answers THAT, and
// still does for `/compiler` output (`test/verify.compile.test.ts` runs it); it is a node-side check
// with a compiler in its closure, which is why it does not live in this module.
//
// The `intent.js` exports (`decodeSettleCall`, `extractEvmSettleFromIntent`) go one wrapper further:
// a producer hands you an intent whose `route.calls[]` ends in a `Pot.cook(bytes[])` call, not a bare
// program, so these unwrap the cook calldata and hand the settle ingredient to the decoder above — same
// viem-only dependency closure, same strict decode.
export { SETTLE_WIRE, scanMinimalPush, encodeMinimalPush, type PushScanResult } from "./wire.js";
export {
  decodeSettleProgram,
  encodeSettleProgram,
  parseSettleProgram,
  bestEffortDecode,
  SettleDecodeError,
  type DecodedSettleProgram,
  type SettleFailureCode,
  type SettleParse,
  type Address20,
} from "./decode.js";
export { SETTLE_VECTORS, type ConformanceVector } from "./vectors.js";
export {
  decodeSettleCall,
  extractEvmSettleFromCalls,
  extractEvmSettleFromIntent,
  type DecodedSettleCall,
  type ExtractedEvmSettle,
  type IntentCallLike,
  type IntentLike,
} from "./intent.js";
