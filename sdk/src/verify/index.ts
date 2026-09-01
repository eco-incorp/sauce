// @eco-incorp/sauce-sdk/verify — turn a compiled Sauce settle payload's bytes back into the
// `(tokens, minOut, recipient)` it will run with, and prove the program half is the audited one.
//
// That is the whole job. Dependency closure is `viem` ONLY (no node:fs, no compiler, no @solana/*,
// no artifact resolution, no program source on disk), so this surface is safe to import anywhere —
// including a browser or an edge runtime. That closure is the reason this decodes rather than
// recompiling-and-comparing: a recompile would put a 1.96 MB wasm compiler in every consumer's
// dependency graph to answer a question `viem` alone answers with one `keccak256`.
//
// WHICH PROGRAMS. The settle program this decodes is what the PUBLISHED RUST COMPILER emits for
// `recipes/settle.sauce.ts` — the only compiler this package ships against. `main` takes
// `(tokens, minOut, recipient)` as RUNTIME entry arguments, so the compiled program is a
// 391-byte constant and the arguments ride the payload AFTER it, as 32-byte big-endian words the
// engine reads back through CALLDATA. `SETTLE_VECTORS` is the conformance corpus and
// `verify.compile.test.ts` recompiles the program and re-pins it on every run.
//
// SCOPE, stated plainly, in two tiers:
//   • `decodeSettleProgram` is STRUCTURAL. It pins the program's LENGTH and reads the argument tail,
//     so it names the tokens, floor and recipient a payload carries and nothing about what those
//     391 bytes do. It is strict about the encoding (§4 of decode.ts: the canonical tokens pointer,
//     no trailing slack, no dirty bytes above an address, a nonzero recipient), so an accepted
//     payload is the UNIQUE byte encoding of the values it decodes to.
//   • `validateSettleProgram` adds the authenticity half: one `keccak256` over the WHOLE program
//     against `SETTLE_WIRE.PROGRAM_HASH`. Because the arguments are no longer inside the program,
//     a match means the payload runs the audited `settle.sauce.ts` and nothing else — the complete
//     answer, from bytes alone, with no compiler. Prefer it; the structural tier exists for callers
//     inspecting a payload they already know is not canonical.
//
// The `intent.js` exports (`decodeSettleCall`, `extractEvmSettleFromIntent`) go one wrapper further:
// a producer hands you an intent whose `route.calls[]` ends in a `Pot.cook(bytes[])` call, not a bare
// payload, so these unwrap the cook calldata and hand the settle ingredient to `validateSettleProgram`
// — same viem-only dependency closure, same strict decode, and identification by program hash.
export { SETTLE_WIRE } from "./wire.js";
export {
  decodeSettleProgram,
  validateSettleProgram,
  encodeSettleProgram,
  parseSettleProgram,
  bestEffortDecode,
  SettleDecodeError,
  type DecodedSettleProgram,
  type SettleFailureCode,
  type SettleParse,
  type Address20,
} from "./decode.js";
export {
  SETTLE_PROGRAM,
  SETTLE_VECTORS,
  SETTLE_REJECTIONS,
  settlePayload,
  type ConformanceVector,
  type RejectionVector,
} from "./vectors.js";
export {
  decodeSettleCall,
  extractEvmSettleFromCalls,
  extractEvmSettleFromIntent,
  type DecodedSettleCall,
  type ExtractedEvmSettle,
  type IntentCallLike,
  type IntentLike,
} from "./intent.js";
