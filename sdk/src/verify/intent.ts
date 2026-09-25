// @eco-incorp/sauce/verify — extract settle params from the CALLS an intent carries.
//
// `decodeSettleProgram` / `validateSettleProgram` (decode.ts) turn a raw settle PAYLOAD's bytes back
// into `(tokens, minOut, recipient)`. But a producer (eco-solver, the recipes API) never hands you the
// bare payload — on EVM it hands you an intent whose `route.calls[]` batch ends with a `cook` call
// carrying the settle payload as its program. These helpers close that last gap: unwrap the cook
// calldata and hand that program to the decoder, so a caller goes from an intent object to
// `(tokens, minOut, recipient)` in one step. Two cook shapes are decoded — see `COOK_V12_ABI`.
//
// Same dependency contract as decode.ts: `viem` ONLY (no compiler, no node, no artifact resolution), so
// this stays safe to import in a browser or edge runtime.
//
// IDENTIFICATION IS BY PROGRAM HASH. An ingredient is taken as the settle when its leading 356 bytes
// hash to `SETTLE_WIRE.PROGRAM_HASH` and its tail is canonical — `validateSettleProgram`, not the
// structural `decodeSettleProgram`. Under the v1 grammar the prologue's shape was itself the
// signature; a length pin alone is a far weaker one, since ANY 356-byte prefix followed by a
// well-formed tail would decode. The hash is both stronger and simpler, and it is available at all
// only because the arguments left the program — so what these helpers return is now "the audited
// settle, with these params", not "something settle-shaped, params unverified".
//
// The SVM analogue is `extractSvmSettleFromIntent` in `@eco-incorp/sauce/svm/verify`: an SVM intent
// wraps its settle CPI one layer deeper (the Eco Portal `CalldataWithAccounts` Borsh envelope), so that
// module decodes the envelope itself before handing the halves to `decodeSvmSettleExecution` /
// `verifySvmSettleExecution` — same "one call from intent to params" story, on the SVM side. It reaches
// its verdict by RECOMPILING, because an SVM settle's params are folded into its bytecode and no amount
// of reading the calldata recovers them; this EVM path needs no compiler for the same verdict, which is
// what keeps `/verify` viem-only.
import { decodeFunctionData, parseAbi, type Hex } from "viem";
import {
  SettleDecodeError,
  validateSettleProgram,
  type DecodedSettleProgram,
  type ProgramPin,
} from "./decode.js";

/**
 * TWO fragments, because the two cooks no longer share a signature.
 *
 * They used to: one `cook(bytes[])` fragment decoded a `V12Pot` and a v1 `SauceRouter` alike. v12
 * #432 changed the Pot to `cook(address engine, bytes program)` — the engine is named per call —
 * while a v1 `SauceRouter` still takes `bytes[]`. A single fragment now silently fails on one of
 * them, so both are tried, v12 first.
 */
const COOK_V12_ABI = parseAbi([
  "function cook(address engine, bytes program) payable returns (bytes)",
]);
const COOK_V1_ABI = parseAbi(["function cook(bytes[] ingredients) payable returns (bytes)"]);

export interface DecodedSettleCall extends DecodedSettleProgram {
  /** Index of the `cook` ingredient that validated as the settle payload. Always 0 — a v12 cook
   *  carries one program, and on a v1 `SauceRouter` only ingredient 0 is examined. Kept as a field
   *  because it is what the caller must reason about, not because it varies. */
  ingredientIndex: number;
  /** How many ingredients the cook carried. **A caller on a v1 `SauceRouter` must require this to be
   *  1.** On a `V12Pot` the rest are inert, so a settle here is the whole call; a SauceRouter executes
   *  EVERY ingredient, so `cook([settlePayload, drainPayload])` validates index 0 and returns a clean
   *  settle while the drain runs too. That is the one hazard in this module a caller cannot see from
   *  `(tokens, minOut, recipient)` — hence this count, in the same spirit as `target`. Always 1 for a
   *  v12 cook, which carries one program by signature. */
  ingredientCount: number;
  /**
   * The interpreter the cook names, for a v12 `cook(address engine, bytes program)`; `undefined` for
   * a v1 `SauceRouter.cook(bytes[])`, which has no such field.
   *
   * **A verifier must check this, and this module cannot do it.** Validating the program proves
   * which BYTES run, not what runs them: the audited settle program on an attacker-chosen engine is
   * an attacker-chosen computation. Only the caller knows which engines it trusts, so compare
   * against your own allow-list — **case-insensitively**, since this is lower-cased (like every
   * other address here) while a checksummed constant is not. It is reported for the same reason
   * `ingredientCount` is: a hazard visible in the calldata but not in
   * `(tokens, minOut, recipient)`.
   */
  engine?: `0x${string}`;
}

/**
 * Decodes one `Pot.cook(address,bytes)` / `SauceRouter.cook(bytes[])` call and returns the settle payload it
 * carries — or `null` if the calldata is not a `cook` call, or ingredient 0 is not the settle payload.
 * Never throws for a non-cook / non-settle input: a mismatched selector, malformed ABI, or a non-settle
 * ingredient 0 all return `null`.
 *
 * The index-0 rule is a `V12Pot` property, and on a v1 `SauceRouter` it cuts BOTH ways, because a
 * SauceRouter executes EVERY ingredient. A settle at index ≥1 reads as `null` here (a missed settle —
 * harmless); but `cook([settlePayload, drainPayload])` on a SauceRouter validates index 0, returns the
 * settle, and the drain runs too — a settle reported for a call that does more than settle. The
 * returned `ingredientCount` is how a caller detects that: require it to be 1 on a SauceRouter. So a
 * non-null result is a statement about a v12 cook ONLY. On a SauceRouter it is not sufficient, for the
 * same reason `extractEvmSettleFromCalls` is not sufficient across `route.calls[]`. The detection IS `validateSettleProgram` (the pinned
 * program hash, plus a canonical tail), so an accepted ingredient is the audited settle program AND the
 * unique byte encoding of the `(tokens, minOut, recipient)` reported.
 */
export function decodeSettleCall(
  callData: Hex,
  accepted?: readonly (Hex | ProgramPin)[],
): DecodedSettleCall | null {
  let ingredients: readonly Hex[];
  let engine: `0x${string}` | undefined;
  try {
    // v12 first: one program, and the engine it names.
    const decoded = decodeFunctionData({ abi: COOK_V12_ABI, data: callData });
    if (decoded.functionName !== "cook") return null;
    const [namedEngine, program] = decoded.args as readonly [`0x${string}`, Hex];
    // Lowercased: viem returns EIP-55 casing, every other address this module reports comes out of
    // a raw-bytes decode in lower case, and a consumer comparing `engine === config.engine` with
    // `===` would fail on the mismatch alone.
    engine = namedEngine.toLowerCase() as `0x${string}`;
    ingredients = [program];
  } catch {
    try {
      // v1 `SauceRouter.cook(bytes[])` — a DIFFERENT selector, so this is not a fallback that could
      // reinterpret a v12 call; it only matches calldata the v12 fragment cannot decode at all.
      const decoded = decodeFunctionData({ abi: COOK_V1_ABI, data: callData });
      if (decoded.functionName !== "cook") return null;
      ingredients = decoded.args[0] as readonly Hex[];
    } catch {
      return null; // not a cook call (wrong selector / malformed calldata)
    }
  }

  // ONLY ingredient 0. A v12 cook has exactly one program, so this is the whole call; a v1
  // `SauceRouter` executes EVERY ingredient, and scanning further there would report a payload the
  // caller did not ask about: given `cook([drainProgram, honestSettle])` a scan would skip the drain,
  // validate the settle at index 1, and hand back the honest program's parameters for an intent that
  // drains. `ingredientCount` is what makes the rest visible.
  if (ingredients.length === 0) return null;
  try {
    // An EMPTY list is forwarded, NOT swapped for the default. `validateSettleProgram([])` refuses,
    // so this returns `null` -- fail-closed, matching that layer. Falling back to the built-in pin
    // would be fail-OPEN: a caller whose configured accept-list resolved to empty would be told
    // "this is the audited settle" against a trust anchor they never listed.
    return {
      ...validateSettleProgram(ingredients[0]!, ...(accepted ? [accepted] : [])),
      ingredientIndex: 0,
      ingredientCount: ingredients.length,
      ...(engine === undefined ? {} : { engine }),
    };
  } catch (error) {
    // Only a DECODE failure means "this cook does not settle". A malformed pin -- a `{ hash: null }`
    // from config -- would otherwise be swallowed as that, and every intent would report no settle
    // while a monitor built on this went silently blind. Let a programmer error escape.
    if (!(error instanceof SettleDecodeError)) throw error;

    return null; // ingredient 0 is not a settle payload — this cook does not settle
  }
}

/** An intent call, duck-typed: only `data` (the cook calldata) is required; `target` (the Pot address)
 *  is carried through when present. Matches eco-solver's `Call` (`{ data, target, value }`). */
export interface IntentCallLike {
  data: Hex;
  target?: `0x${string}`;
}

export interface ExtractedEvmSettle extends DecodedSettleCall {
  /** Index of the `route.calls[]` entry the settle cook was found in. */
  callIndex: number;
  /** The call's `target` (the Pot / router address), when the input carried one. */
  target?: `0x${string}`;
}

/**
 * Scans an intent's `route.calls[]` and returns the settle params from the first `cook` call carrying
 * the settle payload — the EVM settle in a batch is a `Pot.cook(settleBytecodes)` alongside a
 * `Pot.cook(swapBytecodes)`, so this finds it by CONTENT (which cook validates as settle), not by
 * position. `null` if no call carries one.
 *
 * LOCATES THE SETTLE; DOES NOT CLEAR THE INTENT. Unlike a cook's sibling ingredients — where only
 * ingredient 0 runs, so reading further would describe dead bytes — EVERY entry in `route.calls[]`
 * executes. This returns the first entry that validates and leaves the others UNEXAMINED, so a
 * non-null result answers "this intent contains the audited settle, with these parameters" and NOT
 * "this intent does only that": in `[cook([drain]), cook([settle])]` the drain is real, executes
 * first, and is not reported. A caller deciding whether an intent is safe must check `callIndex`
 * against its own expectation and account for the remaining calls itself.
 *
 * AND IT MUST VALIDATE `target` AND `engine`. Matching is on a cook selector and the program bytes
 * ONLY — nothing here looks at the callee or the interpreter.
 *
 * `target`: the one-program rule that makes a non-null result meaningful is a property of
 * `V12Pot.cook`, so it says nothing about an arbitrary contract that merely exposes that selector.
 * For `[{ target: attackerContract, data: cook(engine, canonicalSettlePayload) }]` this returns the
 * correct `(tokens, minOut, recipient)` while the attacker's `cook` ignores the payload entirely.
 * Compare it against a V12Pot address you trust; unvalidated, the parameters describe bytes that
 * were handed to an unknown contract.
 *
 * `engine`: validating the program proves which BYTES run, not what runs them. The audited settle
 * program on an attacker-chosen interpreter is an attacker-chosen computation, and the interpreter
 * is a plain `cook` argument the producer picks. Compare it against your own allow-list,
 * CASE-INSENSITIVELY — it is reported lower-cased here, and a checksummed constant will not match
 * with `===`. It is `undefined` only for a v1 `SauceRouter.cook(bytes[])`, which names no engine.
 *
 * Both are carried on the result for exactly these checks. Neither is validated here, because only
 * the caller knows which Pots and which interpreters it trusts.
 */
export function extractEvmSettleFromCalls(
  calls: readonly IntentCallLike[],
  accepted?: readonly (Hex | ProgramPin)[],
): ExtractedEvmSettle | null {
  for (let i = 0; i < calls.length; i++) {
    const decoded = decodeSettleCall(calls[i]!.data, accepted);
    if (decoded) return { ...decoded, callIndex: i, target: calls[i]!.target };
  }
  return null;
}

/** An intent, duck-typed to just the calls this reads — so it accepts eco-solver's `Intent` (and its
 *  persisted schema) without importing either. */
export interface IntentLike {
  route: { calls: readonly IntentCallLike[] };
}

/**
 * Extracts the EVM settle params `(tokens, minOut, recipient)` from an intent object — the thin
 * intent-level wrapper over `extractEvmSettleFromCalls`. Duck-typed on `{ route: { calls } }`, so it takes
 * an eco-solver `Intent` (runtime or persisted) as-is. `null` if the intent carries no settle cook.
 */
export function extractEvmSettleFromIntent(
  intent: IntentLike,
  accepted?: readonly (Hex | ProgramPin)[],
): ExtractedEvmSettle | null {
  return extractEvmSettleFromCalls(intent.route.calls, accepted);
}
