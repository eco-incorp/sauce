import { IERC20 } from "./artifacts/IERC20.json";

// settle.sauce.ts — a STANDALONE, reusable Sauce program: sweep the Pot's balance of a list of
// tokens to one recipient, with a minimum-output floor enforced on the first token.
//
// It is deliberately NOT tied to any recipe, protocol or product. Nothing in the program below
// knows what produced the balances it moves — a swap, a bridge, an airdrop, a manual transfer, or
// nothing at all. Its contract is exactly "these tokens, this floor, this recipient", so any caller
// that needs a Pot emptied to a destination can compile and run it. Keep it that way: no
// caller-specific names, in the code OR in the revert string (the string is inside the compiled
// body, so changing it rotates the pinned authenticity root — see sdk/src/verify/template.ts).
//
// COMPOSING IT AFTER ANOTHER PROGRAM (the common case, and the reason the floor exists): a
// V12Pot.cook executes ONLY ingredients[0] and silently ignores the rest, so ONE cook cannot run
// "do the thing, then sweep". That composition is TWO TOP-LEVEL cook() calls joined by an
// owner-authorised multicall in ONE transaction:
//   multicall → [ Pot.cook([producerProgram]) , Pot.cook([sweepProgram]) ]
// The multicall contract MUST be this Pot's `owner` (V12Pot.cook is
// `msg.sender == owner || msg.sender == address(this)`-gated — there is no third path) and MUST
// propagate a reverting call's revert data rather than swallow it (a non-reverting/tryAggregate
// dispatch turns a sweep failure into "the first cook landed, the recipient got nothing").
// SECURITY: the multicall must NEVER be a permissionless batcher. Multicall3's `aggregate3` CALLs
// from its own address, so if it owned a Pot, any address could call
// `aggregate3([{target: pot, callData: cook([drainProgram])}])` and drain it — owning the batcher
// IS owning the Pot. The operator's batcher must be owner-controlled (see OwnerMulticall.sol,
// this repo's test-only reference fixture for the shape a real deployment needs).
//
// COMPILED BY THE ORDINARY COMPILER — see `sdk/src/recipes/index.ts` for the exact snippet and
// options. This file is the ONE source of truth for the program text; consumers compile it rather
// than keeping a second copy. `sdk/src/verify/` itself is the DECODING /
// authenticity surface (turn program bytes back into `(tokens, minOut, recipient)` and prove the
// body is this audited template); the program source lives here, outside it, because a reusable
// program is not a verification concern.
//
// THE COMPILED SHAPE IS A FUNCTION OF THIS FILE AND THE COMPILER PIN ONLY — never of the arguments
// (measured: identical 165-byte body for 1/2/3/5-element token lists with varying minOut/recipient).
// That holds because the sweep below stays REAL RUNTIME code: `tokens.length` is not a compile-time
// constant, so the TS front-end's loop unroller has no constant bound to unroll against. If that
// loop ever DID unroll, the body would vary with the token count and the pinned-hash design would
// collapse — keep it a runtime loop.
//
// THE SHAPE: `main(tokens, minOut, recipient)` sweeps the Pot's CURRENT balance of EVERY token in
// `tokens` to `recipient` — a full-balance sweep is the EXPLICIT INTENT (not a hazard to guard
// against): after this cook lands, the Pot holds none of the listed tokens. `tokens[0]` is the
// FLOOR TOKEN by POSITION (not a separately-named arg) — chosen over a named field because the
// decoded shape this way is exactly `(tokens[], minOut, recipient)`, the same three values the
// caller compiled it with, with no fourth field that could itself drift out of sync with which
// array slot it names. `minOut` is enforced against tokens[0]'s balance BEFORE any transfer runs,
// so an unmeetable floor reverts the WHOLE sweep cook (and, when composed with another cook in one
// transaction, that whole transaction) before anything moves.
//
// USEFUL ORDERING PROPERTY: tokens[0] is swept FIRST, and no external call runs between the floor
// check and that transfer — so for the floor token the amount CHECKED is the amount TRANSFERRED. A
// hostile token later in the list cannot retroactively affect it, and a duplicate entry is a no-op
// on its second pass (its balance is already 0).
//
// KNOWN PROPERTY, DOCUMENTED AND ACCEPTED — NOT DEFENDED AGAINST: the floor and the sweep both
// read the Pot's CURRENT balance, not a delta against some baseline. A pre-existing or donated
// balance of tokens[0] in the Pot therefore counts toward minOut and rides to the recipient along
// with whatever the caller actually produced. This is a consequence of the sweep model the
// maintainer chose (the Pot ending clean is the point), not an oversight — do not add baseline/
// delta machinery to defend against it.
//
// A given compile's `tokens`/`minOut`/`recipient` are ordinary compile-time args — there is no
// cross-cook or cross-program handoff of any kind (an earlier design used a tagged EIP-1153
// transient-storage handoff between two cooks; the sweep model made it unnecessary — this program
// simply carries its own destination and floor, and reads only the Pot's live balances). Running it
// on its own, against a Pot holding nothing, sweeps whatever is there (0, ordinarily) — there is
// nothing to "orphan" against, since its target and floor are self-contained.
//
// THE DECODER (sdk/src/verify/decode.ts's decodeSettleProgram/validateSettleProgram): this template
// is helper-free (no jump-table offsets, no branches beyond the floor check) and always compiles
// to the SAME shape — N minimal-length pushes for `tokens` (reversed), a TUPLE-build opcode
// carrying the array's arity as its one operand, then one minimal-length push each for `minOut`
// and `recipient` — followed by a BODY that is a byte-for-byte CONSTANT regardless of the array's
// length or any of the three values (confirmed by direct compile: identical body hash for 1, 2, 3
// and 5-element token arrays with varying minOut/recipient). decodeSettleProgram parses that
// prologue back into (tokens, minOut, recipient); validateSettleProgram additionally hashes the
// trailing body against the hash of a genuine compile, so a settle-shaped program that decodes
// cleanly (parses as that exact prologue shape) but carries different/extra behavior after it
// (e.g. sweeping to a hardcoded address instead of the decoded `recipient`) is rejected on the
// body-hash mismatch, not on the decode step.
function main(tokens: Address[], minOut: Uint256, recipient: Address): Uint256 {
  const floorToken = IERC20.at(tokens[0]);
  const floorBal: Uint256 = floorToken.balanceOf(ctx.self());
  if (minOut > 0) {
    if (floorBal < minOut) {
      throw "settle: balance below minOut";
    }
  }
  for (let i = 0; i < tokens.length; i = i + 1) {
    const t = IERC20.at(tokens[i]);
    const bal: Uint256 = t.balanceOf(ctx.self());
    if (bal > 0) {
      t.transfer(recipient, bal);
    }
  }
  return floorBal;
}
