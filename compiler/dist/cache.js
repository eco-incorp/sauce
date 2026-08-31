// ── Compile cache ──────────────────────────────────────────────────────────
//
// `compile()` is a PURE function of (source, options, on-disk import contents):
// no clock, no randomness, no module-level mutable state (verified). So a
// content-addressed memo keyed on those inputs is correct by construction — a
// key collision can only ever come from genuinely-equal inputs, and any input
// difference we can serialize produces a different key (a MISS, never a wrong
// HIT). The two inputs we CANNOT serialize are `transformModule` (a function)
// and the bytes of the files reachable via `baseDirs` (source-module and .json
// ABI imports). A cache instance is therefore scoped to a stable environment:
// the CALLER owns its lifetime and must drop it if the transformModule's
// behavior or any imported file on disk changes. This mirrors how build tools
// memoize — key on the inputs you can see, invalidate when the world moves.
// For callers that want those two inputs pinned technically rather than by
// convention, `options.cacheKeyExtra` is mixed verbatim into the key: pass a
// hash of the transform config plus a fingerprint (mtime/size/content hash) of
// the imported files, and a mid-process file edit or a swapped transform can no
// longer mis-hit.
//
// `baseDirs` are resolved to ABSOLUTE paths for the key. A RELATIVE baseDir is
// resolved against process.cwd() at READ time (path.resolve in context.ts), so
// which file is read — and thus the output — depends on cwd; keying the raw
// relative string would let one options object mis-hit across a cwd change.
// Keying the resolved absolute path folds cwd in exactly where it matters (and
// harmlessly merges a relative dir with the absolute dir it points at).
//
// The whole result is memoized (not individual function bodies): a v1 function
// body embeds CALL_FUNCTION operands that are the callee's index in THIS
// program's function table, so a body is not portable to a program that
// registers a different set/order of functions. Whole-program results have no
// such cross-program coupling, and whole-program recurrence — the same solver
// program recompiled each tick, the same protocol template compiled repeatedly
// — is the pattern that actually recurs at scale.
import { resolve } from 'node:path';
/**
 * Stable, injective-enough serialization: equal inputs → equal string; any
 * difference we can see → a different string. Object keys are sorted so field
 * order never causes a spurious miss; bigint (in `args`/`defines`) is tagged so
 * `1n` and `"1"` and `1` stay distinct. Never throws on the value shapes that
 * reach it (bigint/string/number/boolean/null/array/plain object).
 */
function stableStringify(value) {
    if (typeof value === 'bigint')
        return `${value}n`;
    if (value === undefined)
        return 'null';
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;
    const obj = value;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
/**
 * The cache key for a compile. Includes every input that affects output, with
 * the SAME defaults `compile()` applies (so `{}` and `{ treeshake: true }` share
 * an entry). `transformModule` collapses to a presence flag — its behavior is
 * part of the cache's environment contract, not the key (see the file header).
 */
export function compileCacheKey(source, options = {}) {
    return stableStringify({
        source,
        target: options.target ?? 'v1',
        staged: options.staged ?? false,
        tsSource: options.tsSource ?? false,
        treeshake: options.treeshake ?? true,
        fold: options.fold ?? true,
        defines: options.defines ?? null,
        args: options.args ?? null,
        contracts: options.contracts ?? null,
        // Absolute-resolved so a relative baseDir keys by the file it actually reads
        // (cwd-dependent), not the ambiguous relative string.
        baseDirs: options.baseDirs ? options.baseDirs.map((d) => resolve(d)) : null,
        hasTransform: options.transformModule !== undefined,
        // Opaque caller-supplied discriminator for the inputs the key cannot see
        // (transformModule behavior, imported-file contents).
        extra: options.cacheKeyExtra ?? null,
    });
}
/**
 * Deep copy so a cached result and a caller's copy never share mutable state:
 * bytecode buffers are fresh (a caller may transfer/patch them), and the plan/
 * argsLayout — plain data (no class instances, no functions) — are rebuilt.
 * `compile()` stores a clone and returns a clone on a hit, so nothing a caller
 * does to a returned result can corrupt the cache, and nothing a later compile
 * does can corrupt an already-returned result.
 */
export function cloneCompileResult(result) {
    const clone = {
        bytecode: result.bytecode.map((b) => Uint8Array.from(b)),
        warnings: [...result.warnings],
    };
    if (result.accountPlan) {
        clone.accountPlan = {
            metas: result.accountPlan.metas.map((m) => ({ ...m })),
            ...(result.accountPlan.usesRawIndices ? { usesRawIndices: true } : {}),
        };
    }
    if (result.argsLayout) {
        clone.argsLayout = { ...result.argsLayout, slots: result.argsLayout.slots.map((s) => ({ ...s })) };
    }
    return clone;
}
/**
 * A bounded, in-process compile cache. `maxEntries` (default 1024) caps memory:
 * on overflow the least-recently-used entry is evicted (a hit refreshes
 * recency). Pass one to `compile(src, { cache })` from a long-lived process that
 * recompiles recurring programs — a recipe solver, a dev server, a batch job.
 * A fresh process starts empty; the cache never persists to disk.
 */
/**
 * The process-global cache `compile()` uses BY DEFAULT (when `options.cache` is
 * omitted or `true`). Lazily created, bounded (LRU). Because it is on by
 * default, the two inputs the key cannot see — `transformModule` behavior and
 * the on-disk bytes of `baseDirs` imports — become a default environment
 * contract: within one process the transform must be stable and imported files
 * must not change mid-run, else a recompile of the SAME source returns stale
 * bytecode. A caller that violates this (a file-watching dev server that edits
 * an imported ABI and recompiles) must pass `cache: false` for a guaranteed
 * fresh compile, `cacheKeyExtra` to pin the changed input, or its own instance.
 */
let defaultCache;
/** The lazily-created process-global default cache (see `defaultCache`). */
export function getDefaultCompileCache() {
    if (!defaultCache)
        defaultCache = createCompileCache(4096);
    return defaultCache;
}
/**
 * Empty the process-global default cache (and reset its stats). Call after a
 * change to an input the key cannot see — an edited imported file or a swapped
 * `transformModule` — so subsequent default-cached compiles recompile fresh.
 */
export function clearDefaultCompileCache() {
    defaultCache?.clear();
}
export function createCompileCache(maxEntries = 1024) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
        throw new Error(`createCompileCache: maxEntries must be a positive integer, got ${maxEntries}`);
    }
    const store = new Map();
    let hits = 0;
    let misses = 0;
    return {
        get(key) {
            const value = store.get(key);
            if (value === undefined) {
                misses++;
                return undefined;
            }
            hits++;
            // Refresh recency: re-insert moves the key to the newest position.
            store.delete(key);
            store.set(key, value);
            return value;
        },
        set(key, value) {
            // Re-inserting an existing key must not double-count toward the cap.
            store.delete(key);
            store.set(key, value);
            if (store.size > maxEntries) {
                const oldest = store.keys().next().value;
                if (oldest !== undefined)
                    store.delete(oldest);
            }
        },
        clear() {
            store.clear();
            hits = 0;
            misses = 0;
        },
        get stats() {
            return { hits, misses, size: store.size };
        },
    };
}
