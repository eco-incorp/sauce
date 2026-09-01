// @eco-incorp/sauce-sdk/verify — extract settle params from the CALLS an intent carries.
//
// `decodeSettleProgram` / `validateSettleProgram` (decode.ts) turn a raw settle PAYLOAD's bytes back
// into `(tokens, minOut, recipient)`. But a producer (eco-solver, the recipes API) never hands you the
// bare payload — on EVM it hands you an intent whose `route.calls[]` batch ends with a
// `Pot.cook(bytes[])` call, and the settle payload is ONE ingredient inside that call's ABI-encoded
// argument array. These helpers close that last gap: unwrap the `cook(bytes[])` calldata and hand the
// settle ingredient to the decoder, so a caller goes from an intent object to
// `(tokens, minOut, recipient)` in one step.
//
// Same dependency contract as decode.ts: `viem` ONLY (no compiler, no node, no artifact resolution), so
// this stays safe to import in a browser or edge runtime.
//
// IDENTIFICATION IS BY PROGRAM HASH. An ingredient is taken as the settle when its leading 391 bytes
// hash to `SETTLE_WIRE.PROGRAM_HASH` and its tail is canonical — `validateSettleProgram`, not the
// structural `decodeSettleProgram`. Under the v1 grammar the prologue's shape was itself the
// signature; a length pin alone is a far weaker one, since ANY 391-byte prefix followed by a
// well-formed tail would decode. The hash is both stronger and simpler, and it is available at all
// only because the arguments left the program — so what these helpers return is now "the audited
// settle, with these params", not "something settle-shaped, params unverified".
//
// The SVM analogue is `extractSvmSettleFromIntent` in `@eco-incorp/sauce-sdk/svm/verify`: an SVM intent
// wraps its settle CPI one layer deeper (the Eco Portal `CalldataWithAccounts` Borsh envelope), so that
// module decodes the envelope itself before handing the halves to `decodeSvmSettleExecution` /
// `verifySvmSettleExecution` — same "one call from intent to params" story, on the SVM side. It reaches
// its verdict by RECOMPILING, because an SVM settle's params are folded into its bytecode and no amount
// of reading the calldata recovers them; this EVM path needs no compiler for the same verdict, which is
// what keeps `/verify` viem-only.
import { decodeFunctionData, parseAbi, type Hex } from "viem";
import { validateSettleProgram, type DecodedSettleProgram } from "./decode.js";

/** `Pot.cook` / `SauceRouter.cook` — identical input signature on both (`sdk/src/artifacts/*.json`), so
 *  one fragment decodes either. Only the input array matters for decoding a call. */
const COOK_ABI = parseAbi(["function cook(bytes[] ingredients) payable returns (bytes)"]);

export interface DecodedSettleCall extends DecodedSettleProgram {
  /** Index of the `cook` ingredient that validated as the settle payload (the batch may carry others). */
  ingredientIndex: number;
}

/**
 * Decodes one `Pot.cook(bytes[])` / `SauceRouter.cook(bytes[])` call and returns the settle payload it
 * carries — or `null` if the calldata is not a `cook` call, or no ingredient is the settle payload.
 * Never throws for a non-cook / non-settle input: a mismatched selector, malformed ABI, or a cook whose
 * ingredients are all non-settle all return `null`. The detection IS `validateSettleProgram` (the pinned
 * program hash, plus a canonical tail), so an accepted ingredient is the audited settle program AND the
 * unique byte encoding of the `(tokens, minOut, recipient)` reported.
 */
export function decodeSettleCall(callData: Hex): DecodedSettleCall | null {
  let ingredients: readonly Hex[];
  try {
    const decoded = decodeFunctionData({ abi: COOK_ABI, data: callData });
    if (decoded.functionName !== "cook") return null;
    ingredients = decoded.args[0] as readonly Hex[];
  } catch {
    return null; // not a cook call (wrong selector / malformed calldata)
  }

  // ONLY ingredient 0. `V12Pot.cook` executes `ingredients[0]` and silently ignores the rest
  // (`recipes/settle.sauce.ts`), so scanning further reports a payload that never runs: given
  // `cook([drainProgram, honestSettle])` a scan would skip the drain, validate the settle at index 1,
  // and hand the caller the honest program's parameters for an intent that drains. A verifier must
  // answer for what executes.
  if (ingredients.length === 0) return null;
  try {
    return { ...validateSettleProgram(ingredients[0]!), ingredientIndex: 0 };
  } catch {
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
 * Scans an intent's `route.calls[]` and returns the settle params from the first `cook` call carrying the
 * settle payload — the EVM settle in a batch is a `Pot.cook(settleBytecodes)` alongside a
 * `Pot.cook(swapBytecodes)`, so this finds it by CONTENT (which cook validates as settle), not by
 * position. `null` if no call carries one.
 */
export function extractEvmSettleFromCalls(calls: readonly IntentCallLike[]): ExtractedEvmSettle | null {
  for (let i = 0; i < calls.length; i++) {
    const decoded = decodeSettleCall(calls[i]!.data);
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
export function extractEvmSettleFromIntent(intent: IntentLike): ExtractedEvmSettle | null {
  return extractEvmSettleFromCalls(intent.route.calls);
}
