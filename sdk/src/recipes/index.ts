/**
 * @eco-incorp/sauce-sdk/recipes — reusable Sauce recipes shipped as SOURCE.
 *
 * WHAT THIS IS FOR: answering the two questions a partner genuinely cannot answer themselves —
 * "what is the program text?" and "where is this package installed?" — and then getting out of the
 * way. It ships no compile helper, so whatever options a caller passes are the ones they can audit.
 *
 * BYTE-FOR-BYTE REPRODUCIBILITY, against the published Rust compiler this package depends on. The
 * program is a pure function of the source, the target and the compiler pin — nothing about a
 * caller's `(tokens, minOut, recipient)` reaches it, because `main` takes them as RUNTIME entry
 * arguments:
 *
 * ```ts
 * import { compile } from "@eco-incorp/sauce-sdk/compiler";
 * import { settleSource, SAUCE_BASE_DIRS } from "@eco-incorp/sauce-sdk/recipes";
 *
 * // A raw compile is right HERE and not for the generated programs: settle's `main` declares its
 * // own return type, so it needs no annotating.
 * const { bytecode } = compile({
 *   target: "evm",
 *   entry: "settle.sauce.ts",
 *   resolve: (path) =>
 *     path.endsWith("settle.sauce.ts")
 *       ? new TextEncoder().encode(settleSource())
 *       : readFrom(SAUCE_BASE_DIRS, path),   // serves the program's `./artifacts/IERC20.json`
 * });
 * // bytecode -- 391 bytes, keccak256 === SETTLE_WIRE.PROGRAM_HASH, for every caller and every value
 * ```
 *
 * Those three compile inputs are the whole contract — change any of them and the bytes change. They are
 * deliberately NOT exported as a pre-baked options object: a partner reproducing our output should
 * see the target and the entry, not inherit them from a constant they never read.
 * `test/verify.compile.test.ts` runs exactly this snippet on every test run and compares the result
 * against `SETTLE_PROGRAM` and `SETTLE_WIRE.PROGRAM_HASH`, so the promise is a live pin, not a claim.
 *
 * THE VALUES RIDE THE PAYLOAD, NOT THE PROGRAM. `(tokens, minOut, recipient)` are appended after the
 * program as 32-byte big-endian words — `[program | tokensPtr | minOut | recipient | count | token…]`
 * — and read back through CALLDATA. That is why one 391-byte blob serves every argument set, and why
 * `@eco-incorp/sauce-sdk/verify` can answer "is this the audited settle, and what will it do?" from
 * the bytes alone with `viem` as its only dependency. `@eco-incorp/sauce-sdk/verify`'s
 * `encodeSettleProgram` builds the tail; its `validateSettleProgram` reads it back and checks the
 * program half against the pinned hash. The full layout is `sdk/src/verify/decode.ts`.
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
 * To go the other direction — a compiled payload back to `(tokens, minOut, recipient)` — use
 * `@eco-incorp/sauce-sdk/verify`'s `validateSettleProgram`, whose dependency closure is `viem` only.
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
 * diff exactly what gets compiled. The compiler's own front-end handles the TypeScript annotations,
 * so the source needs no pre-processing and no extra option — `CompileOptions` is
 * `{ target, resolve, resolvePackage?, entry?, contracts?, inlineContracts?, ambient?, defines?,
 * optimize? }`.
 */
export function settleSource(): string {
  if (cached === null) cached = readFileSync(SETTLE_SOURCE_PATH, "utf-8");
  return cached;
}

/**
 * The CCTP transfer demo — a BUILDER that constructs V2 `Intent`s via the cross-chain intent DSL,
 * distinct in kind from the source-shipped `settle` recipe above but built the SAME way underneath:
 * its two route PROGRAMS are standalone `.sauce.ts` assets (`cctp-split.sauce.ts`,
 * `plain-transfer.sauce.ts`) whose module-level `XFER_*` consts are replaced with each intent's
 * values via `defines` (see `cctp-transfer.ts:107,128`). That is the compile-time channel, and it
 * is a DIFFERENT mechanism from `settle.sauce.ts`, whose `main` takes its values as runtime entry
 * arguments and so compiles to one invariant program.
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
