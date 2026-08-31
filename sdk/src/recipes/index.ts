/**
 * @eco-incorp/sauce-sdk/recipes — reusable Sauce recipes shipped as SOURCE.
 *
 * WHAT THIS IS FOR: answering the two questions a partner genuinely cannot answer themselves —
 * "what is the program text?" and "where is this package installed?" — and then getting out of the
 * way. It ships no compile helper, so whatever options a caller passes are the ones they can audit.
 *
 * BYTE-FOR-BYTE REPRODUCIBILITY IS NO LONGER OFFERED — it was against the in-repo TypeScript compiler,
 * the TypeScript compiler this package ships. It is the only one with compile-time `args`, which is
 * what bakes `(tokens, minOut, recipient)` into the fixed PROLOGUE that IS the v1 wire grammar
 * `@eco-incorp/sauce-sdk/verify` decodes:
 *
 * ```ts
 * import { compileSauceRoute } from "@eco-incorp/sauce-sdk";
 * import { settleSource, SAUCE_BASE_DIRS } from "@eco-incorp/sauce-sdk/recipes";
 *
 * // The settle program takes its `(tokens, minOut, recipient)` as RUNTIME entry arguments, which
 * // ride the instruction payload after the program bytes -- they are not baked at compile time.
 * const { compiled } = compileSauceRoute({
 *   source: settleSource(),
 *   baseDirs: SAUCE_BASE_DIRS,       // resolves the program's `./artifacts/IERC20.json` import
 * });
 * // bytecode[0] is byte-identical to the program we hand you, and to `SETTLE_VECTORS`.
 * ```
 *
 * Those five options are the whole contract — change any of them and the bytes change. They are
 * deliberately NOT exported as a pre-baked options object: a partner reproducing our output should
 * see the target and the arg order, not inherit them from a constant they never read.
 * `test/verify.compile.test.ts` runs exactly this snippet against `SETTLE_VECTORS` on every CI run,
 * so the promise is a live pin rather than a claim.
 *
 * ⚠ THE PUBLISHED RUST COMPILER IS A DIFFERENT LINEAGE AND DOES NOT REPRODUCE THESE BYTES. It has no
 * `args` option, and the `defines` that stand in for it are constant-folded AT EACH USE SITE rather
 * than materialized up front — measured on this program, `minOut` lands at byte 48 and `recipient` at
 * byte 104, inside the body, and an array literal terminates with `0x92` where the grammar specifies
 * `0x94`. So its output has no prologue to decode and no argument-independent body to hash, and
 * `decodeSettleProgram` correctly refuses it. Reproducibility and `/verify` both mean the compiler
 * named above; the SDK's own route builders (`routes/`, `svm/`) compile through the Rust one, which is
 * why nothing there is decodable by `/verify` either.
 *
 * PREFER `settleSource()` OVER READING THE FILE YOURSELF, but both work — the raw asset is a
 * real file inside the package and is reachable by subpath if you want to hash, diff, or vendor it:
 *
 * ```ts
 * const path = fileURLToPath(import.meta.resolve("@eco-incorp/sauce-sdk/recipes/settle.sauce.ts"));
 * ```
 *
 * A bare `readFileSync("@eco-incorp/sauce-sdk/...")` does NOT work — `readFileSync` takes a
 * filesystem path and performs no package resolution. Use either form above.
 *
 * To go the other direction — compiled bytecode back to `(tokens, minOut, recipient)` — use
 * `@eco-incorp/sauce-sdk/verify`'s `decodeSettleProgram`, whose dependency closure is `viem` only.
 *
 * THIS MODULE IS EVM/v12 ONLY. The SVM twin — the SVM `settle.sauce.ts`, same contract, adapted to
 * SPL's account model — lives under the SVM subtree with the rest of the SVM SDK and is exported from
 * `@eco-incorp/sauce-sdk/svm` (`svmSettleSource` / `svmSettleRefs`); see
 * `sdk/src/svm/recipes/index.ts`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the `settle.sauce.ts` source inside THIS installed package. */
export const SETTLE_SOURCE_PATH: string = join(__dirname, "settle.sauce.ts");

/**
 * `baseDirs` for compiling any program in this directory.
 *
 * One entry is sufficient and it is not this directory: it is the package's dist root, because what
 * needs resolving is the program's `import { IERC20 } from "./artifacts/IERC20.json"` — which lands
 * at `<dist>/artifacts/IERC20.json` (vendored from the pinned engine and shipped in this package's
 * `files` list). Measured: `[distRoot]` alone reproduces the identical bytes.
 */
export const SAUCE_BASE_DIRS: readonly string[] = [join(__dirname, "..")];

let cached: string | null = null;

/**
 * The `settle.sauce.ts` program text — sweep the Pot's balance of every listed token to one
 * recipient, with a minimum-output floor on `tokens[0]`. Read once and cached.
 *
 * Returned as the raw source (not pre-stripped, not pre-compiled) so a partner can read, hash, or
 * diff exactly what gets compiled. Pass `tsSource: true` so the compiler's own front-end handles
 * the TypeScript annotations.
 */
export function settleSource(): string {
  if (cached === null) cached = readFileSync(SETTLE_SOURCE_PATH, "utf-8");
  return cached;
}

/**
 * The CCTP transfer demo — a BUILDER that constructs V2 `Intent`s via the cross-chain intent DSL,
 * distinct in kind from the source-shipped `settle` recipe above but built the SAME way underneath:
 * its two route PROGRAMS are standalone `.sauce.ts` assets (`cctp-split.sauce.ts`,
 * `plain-transfer.sauce.ts`) whose parameterized `main` is baked with each intent's values as
 * compile-time `args` — the `settle.sauce.ts` mechanism, a TS-compiler feature.
 *
 * A Base→Arbitrum USDC transfer "with interop/CCTP and without": `buildCctpSplitTransfer` splits the
 * amount into N sub-`perMessageLimit` `depositForBurn` chunks burned in ONE atomic cook (all-or-revert
 * on the source chain); `buildPlainTransfer` is the no-bridge baseline. Both programs read `USDC` and
 * `Cctp.TokenMessenger` from the DSL registries — no hardcoded ABIs or addresses. `cctpSplitSource()` /
 * `plainTransferSource()` return the raw program text (read once, cached), the same way `settleSource()`
 * does. See `cctp-transfer.ts`.
 */
export {
  buildCctpSplitTransfer,
  buildPlainTransfer,
  cctpSplitSource,
  plainTransferSource,
  CCTP_SPLIT_SOURCE_PATH,
  PLAIN_TRANSFER_SOURCE_PATH,
  type CctpTransferParams,
} from "./cctp-transfer.js";
