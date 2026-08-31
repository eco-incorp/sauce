/**
 * @eco-incorp/sauce-sdk/recipes — reusable Sauce recipes shipped as SOURCE.
 *
 * WHAT THIS IS FOR: a partner reproduces our bytecode with the ORDINARY compiler
 * (`@eco-incorp/sauce-sdk/compiler`), not a bespoke helper. This module exists only to answer the
 * two questions a partner genuinely cannot answer themselves — "what is the program text?" and
 * "where is this package installed?" — and then gets out of the way. Every compile option stays
 * explicit at the call site, so what you pass is what you can audit:
 *
 * ```ts
 * import { compile } from "@eco-incorp/sauce-sdk/compiler";
 * import { settleSource, SAUCE_BASE_DIRS } from "@eco-incorp/sauce-sdk/recipes";
 *
 * const { bytecode } = compile(settleSource(), {
 *   baseDirs: SAUCE_BASE_DIRS,   // resolves the program's `./artifacts/IERC20.json` import
 *   target: "v12",               // the program is v12-only
 *   treeshake: true,
 *   tsSource: true,              // the source is TypeScript-annotated SauceScript
 *   args: [tokens.map(BigInt), minOut, BigInt(recipient)],
 * });
 * // bytecode[0] is byte-identical to the program we hand you.
 * ```
 *
 * Those five options are the whole contract — change any of them and the bytes change. They are
 * deliberately NOT exported as a pre-baked options object: a partner reproducing our output should
 * see the target and the arg order, not inherit them from a constant they never read.
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
