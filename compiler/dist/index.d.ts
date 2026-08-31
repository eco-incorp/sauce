import { type CompileTarget } from './context.js';
import type { ContractsConfig } from './contracts.js';
import type { AccountPlan } from './planner/index.js';
import type { CompileCache } from './cache.js';
export { createCompileCache, compileCacheKey, cloneCompileResult, getDefaultCompileCache, clearDefaultCompileCache, } from './cache.js';
export type { CompileCache, BoundedCompileCache, CompileCacheStats } from './cache.js';
export { Saucer } from './saucer/saucer.js';
export { V12Saucer } from './saucer/saucer-v12.js';
export type { SaucerLike, OutputSpec } from './saucer/saucer-like.js';
export { CompilerContext } from './context.js';
export type { CompileTarget } from './context.js';
export { OPS } from './saucer/ops.js';
export { OPS_V12 } from './saucer/ops-v12.js';
export { SVM_UNSUPPORTED } from './saucer/svm-profile.js';
export { UnsupportedTargetError, TARGET_CAPABILITIES } from './capabilities.js';
export { estimatePacket, stagingTransactionCount, PAYER_REF } from './planner/index.js';
export type { AccountMeta, AccountPlan, PacketBudget, PacketBudgetOptions, PacketMode } from './planner/index.js';
export type { AbiParameter, AbiFunction, AbiItem, Abi, ContractConfig, ContractsConfig, ContractInfo, } from './contracts.js';
export type ArgValue = bigint | string | ArgValue[] | ArgObject;
/**
 * A struct arg at the main() boundary. Passed as a plain object, it is encoded as a
 * TUPLE with fields sorted ALPHABETICALLY — byte-identical to an in-script object
 * literal (see `extractStructType`/`processObjectExpression`) — so main() reads its
 * fields with `param.field` (and nested `param.child.field`) via the same INDEX
 * lowering as any in-script struct. Nested objects recurse; array/scalar/bytes field
 * values encode as their normal ArgValue forms.
 */
export interface ArgObject {
    [key: string]: ArgValue;
}
export type ArgsLayoutKind = 'scalar' | 'bytes';
export interface ArgsLayoutSlot {
    /** main() parameter position this slot feeds (slot i ↔ arg i, in order). */
    arg: number;
    kind: ArgsLayoutKind;
    /** Byte offset within the payload args (composite CALLDATA offset = programLength + offset). */
    offset: number;
    /** Slot byte length (32 for scalars; the fixed compile-time length for bytes). */
    length: number;
}
export interface ArgsLayout {
    /** Args transport: per-execution values ride the instruction payload, read via CALLDATA. */
    mode: 'calldata';
    /** Compiled program byte length L — arg i lives at composite offset L + slots[i].offset. */
    programLength: number;
    /** Total payload-arg bytes (slots laid out back to back, no padding). */
    byteLength: number;
    slots: ArgsLayoutSlot[];
}
export interface CompileOptions {
    label?: string;
    baseDirs?: string[];
    contracts?: ContractsConfig;
    args?: ArgValue[];
    /**
     * Bytecode target: 'v1' (prefix, Solidity interpreter), 'v12' (postfix, Huff runtime) or
     * 'svm' (postfix v12 dialect for the Solana engine — same assembler/opcodes, divergent
     * call/storage lowering; the result carries an accountPlan). Default 'v1'.
     */
    target?: CompileTarget;
    /**
     * Target 'svm' only: compile for STAGED execution (execute_from_account).
     * Compile-time `args` are not baked into the bytecode — the prologue reads
     * them from the instruction payload via CALLDATA (see the staged arg ABI
     * above) so one staged buffer serves every per-execution argument set. User
     * refs intern from index 0 (no reserved accounts); msg.data is rejected (the
     * prologue owns the single CALLDATA). The result carries `argsLayout`, the
     * contract the SDK encodes execute payload args against.
     */
    staged?: boolean;
    /**
     * Transform an imported SOURCE module's text before parsing — e.g. strip TypeScript types.
     * Receives (code, absoluteFilePath); return plain JS. Only invoked for source-file function
     * imports (`import { fn } from "./mod"`), never for `.json` contract ABIs, and only OVERRIDES
     * the built-in behavior: absent this, a `.ts`/`.sauce.ts` import already runs through the
     * compiler's own ts-evaluator-powered fold+strip front-end automatically; plain `.js`/`.sauce`
     * modules need no transform either way.
     */
    transformModule?: (code: string, filePath: string) => string;
    /**
     * Treat the top-level `source` string as TypeScript: runs it through the same built-in
     * fold+strip front-end as a `.ts`/`.sauce.ts` import (constant-condition branches provably
     * dead per `ts-evaluator` are dropped, then types are stripped) before `acorn.parse` ever
     * sees it. Default false — a plain SauceScript/JS `source` needs no TS handling and this
     * option is a no-op cost otherwise. `options.label`, if set, is used as the synthetic
     * filename ts-evaluator/TypeScript diagnostics reference.
     */
    tsSource?: boolean;
    /**
     * Drop every function NOT reachable from main() (after compile-time constant folding) so an
     * imported-but-unreferenced function — or a handler behind a statically-false branch — is not
     * emitted. Default true — minimal bytecode by default. Set `false` for the legacy shape where
     * every declared/imported function is emitted regardless of use (e.g. a test pinning an exact
     * v1 function-table layout, where dropping a function would shift every later index).
     */
    treeshake?: boolean;
    /**
     * Whether an if/ternary/`&&`/`||` whose condition is a compile-time constant (a literal, a
     * `defines` name, or a top-level `const X = <literal>`) emits only its taken branch. Default
     * true — this can only ever act on an ACTUALLY-constant condition (anything runtime-derived
     * evaluates to `undefined` and compiles as a normal branch, unchanged), so it's always safe.
     * Set `false` to get the pre-folding literal output, e.g. a test pinning the exact unfolded
     * bytecode of `if (1 === 1)`.
     */
    fold?: boolean;
    /**
     * Compile-time constants (name → value) used for conditional compilation: an `if`/ternary/
     * `&&`/`||` whose condition folds to a known value emits only the taken branch, so a guarded
     * protocol handler call (`if (HAS_CURVE) curve(...)`) vanishes when its flag is false — and
     * with `treeshake`, the now-unreferenced handler is dropped from the bytecode. Booleans map to
     * 1n/0n. Top-level `const X = <literal>` in the program are folded the same way.
     */
    defines?: Record<string, bigint | boolean | number>;
    /**
     * Compile cache — ON BY DEFAULT. `compile()` returns a cached result for a
     * repeat (source + options) instead of recompiling, and stores each fresh
     * result. Values:
     *   - omitted / `true` → the process-global default cache (getDefaultCompileCache)
     *   - `false`          → no caching; always recompile (a guaranteed-fresh compile)
     *   - a `CompileCache` → use that store (a Map, or createCompileCache() for
     *                        bounded size + hit/miss stats)
     * The key covers every serializable input, so a difference can only ever miss,
     * never mis-hit. The two inputs it cannot capture — `transformModule`'s behavior
     * and the on-disk contents of `baseDirs` imports — are an environment contract:
     * keep them stable for the process, or pin them with `cacheKeyExtra`, or pass
     * `cache: false` when you need to bypass a possibly-stale entry (e.g. after
     * editing an imported file — see also clearDefaultCompileCache()).
     */
    cache?: CompileCache | boolean;
    /**
     * Opaque string mixed verbatim into the cache key — only consulted when `cache`
     * is set. Use it to pin the inputs the key cannot capture on its own: the
     * behavior of `transformModule` and the on-disk contents of `baseDirs` imports.
     * A caller whose imported files can change mid-process (a watch/dev server), or
     * that swaps `transformModule` against a shared cache, should pass a fingerprint
     * (e.g. a hash of the transform config plus the imported files' mtime/size) so a
     * changed input yields a distinct key instead of a stale hit. Omit it and those
     * inputs remain the caller's documented environment contract (see cache.ts).
     */
    cacheKeyExtra?: string;
}
export interface CompileResult {
    bytecode: Uint8Array[];
    warnings: string[];
    /** target 'svm' only: ordered user-account plan (metas[i] = user-account index i). */
    accountPlan?: AccountPlan;
    /** target 'svm' + staged only: the payload-args layout the SDK encodes execute args against. */
    argsLayout?: ArgsLayout;
}
export declare function compile(source: string, options?: CompileOptions): CompileResult;
//# sourceMappingURL=index.d.ts.map