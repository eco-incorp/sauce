/** Absolute path to the `settle.sauce.ts` source inside THIS installed package. */
export declare const SETTLE_SOURCE_PATH: string;
/**
 * `baseDirs` for compiling any program in this directory.
 *
 * One entry is sufficient and it is not this directory: it is the package's dist root, because what
 * needs resolving is the program's `import { IERC20 } from "./artifacts/IERC20.json"` — which lands
 * at `<dist>/artifacts/IERC20.json` (vendored from the pinned engine and shipped in this package's
 * `files` list). Measured: `[distRoot]` alone reproduces the identical bytes.
 */
export declare const SAUCE_BASE_DIRS: readonly string[];
/**
 * The `settle.sauce.ts` program text — sweep the Pot's balance of every listed token to one
 * recipient, with a minimum-output floor on `tokens[0]`. Read once and cached.
 *
 * Returned as the raw source (not pre-stripped, not pre-compiled) so a partner can read, hash, or
 * diff exactly what gets compiled. Pass `tsSource: true` so the compiler's own front-end handles
 * the TypeScript annotations.
 */
export declare function settleSource(): string;
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
export { buildCctpSplitTransfer, buildPlainTransfer, cctpSplitSource, plainTransferSource, CCTP_SPLIT_SOURCE_PATH, PLAIN_TRANSFER_SOURCE_PATH, type CctpTransferParams, } from "./cctp-transfer.js";
//# sourceMappingURL=index.d.ts.map