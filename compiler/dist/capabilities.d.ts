import type { CompileTarget, CompilerContext } from './context.js';
/**
 * Per-target capability gate — the single, central, BIDIRECTIONAL classification of which
 * language features/opcodes/call-shapes are restricted to a subset of the three compile
 * targets ('v1' | 'v12' | 'svm'). This is what lets a "universal" source file (an evm/svm
 * arm pair, or one file relying on the fold/`defines`/treeshake machinery to drop the
 * unreachable arm) compile per target instead of per-branch: an EVM-only feature is allowed
 * on v1/v12 and rejected on svm; an svm-only feature is allowed on svm and rejected on
 * v1/v12; a v12-DIALECT feature (allowed on v12+svm, rejected on v1) is a third axis, which
 * is why each row carries an explicit `targets` SET rather than an evm/svm boolean.
 *
 * NOT a pre-codegen IR pass. This compiler has no IR to hang one on — `compile()` (index.ts)
 * goes acorn AST -> processor walk -> Saucer/V12Saucer builders that append bytes as the walk
 * proceeds. A separate pre-codegen scan would have to re-derive every contract-binding/global
 * resolution rule the real walk already owns (see expression.ts's four binding shapes,
 * globals.ts's GLOBALS dispatch, inline.ts's splicing) — exactly the class of duplicate-walk
 * bug this repo has already paid for once (return-kind.ts's `matchStandaloneBindingShape`
 * clone of `resolveStandaloneBinding`, and its own follow-up staleness fix). Worse, a
 * pre-pass would see code the fold pass / `defines` / treeshake will delete before it ever
 * reaches codegen, and would wrongly reject an EVM-only feature sitting in an already-dead
 * svm-only arm. So the gate is a small helper called AT the existing emit sites — it fires
 * only for code that actually reaches codegen, which is the precise semantics a per-target
 * library needs.
 *
 * NOT gated, deliberately (verified by compiling each on target 'svm' — see
 * test/target-capabilities.test.ts's over-gating guard): abi.encode/decode (the ABI CODEC
 * itself is universal — only the ABI-*typed-binding* surface below is EVM-only), emit/LOG,
 * crypto.*, msg.*, block.*, tx.*, address.*, gasLeft/blockHash/blobHash, storage.tRead/tWrite
 * (transient storage — a divergent-lowering, fork-parity op, not a gated one), eval, Math.*,
 * Uint8Array.from. A future edit MUST NOT "complete" this table with any of those.
 */
/** One gated feature: the targets it's allowed on, plus how to phrase the rejection. */
interface CapabilityRow {
    /** The compile targets this feature may be used on. */
    readonly targets: readonly CompileTarget[];
    /** Suggested replacement, embedded in the derived message ("...; use <hint>"). */
    readonly hint?: string;
    /** Full message override, for a feature whose rejection needs bespoke phrasing
     *  the generic formatter can't produce (e.g. destructuring's two-clause sentence). */
    readonly message?: string;
}
/**
 * TARGET_CAPABILITIES — one row per gated feature. This is the single source of truth: every
 * gate site (processor, globals, and the saucer-v12 builders via `assertSvmSupported`) looks
 * a feature up here rather than hand-rolling its own target check.
 */
export declare const TARGET_CAPABILITIES: Record<string, CapabilityRow>;
/** Re-derived, not hand-listed — kept only for `saucer/svm-profile.ts`'s existing named
 *  export shape (`SVM_GATED`), so nothing outside this file needs a second source of truth. */
export declare const SVM_GATED_HINTS: Record<string, string | undefined>;
/** Thrown by `assertCapability` when a feature is used on a target it doesn't support. */
export declare class UnsupportedTargetError extends Error {
    readonly feature: string;
    readonly target: CompileTarget;
    readonly supported: readonly CompileTarget[];
    readonly start?: number;
    readonly end?: number;
    constructor(feature: string, target: CompileTarget, supported: readonly CompileTarget[], message: string, node?: {
        start?: number;
        end?: number;
    });
}
/**
 * Reject `feature` when it's used on a target `TARGET_CAPABILITIES` doesn't allow it on;
 * no-op otherwise. `node` (an acorn node with `start`/`end`) is optional — the nine
 * builder-layer call sites in saucer-v12.ts have no AST node in scope and leave the span
 * undefined, same as today's baseline (no location anywhere).
 */
export declare function assertCapability(ctx: CompilerContext, feature: string, node?: {
    start?: number;
    end?: number;
}): void;
export {};
//# sourceMappingURL=capabilities.d.ts.map