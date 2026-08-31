const EVM_TARGETS = ['v1', 'v12'];
const V12_DIALECT_TARGETS = ['v12', 'svm'];
const SVM_ONLY = ['svm'];
/**
 * TARGET_CAPABILITIES — one row per gated feature. This is the single source of truth: every
 * gate site (processor, globals, and the saucer-v12 builders via `assertSvmSupported`) looks
 * a feature up here rather than hand-rolling its own target check.
 */
export const TARGET_CAPABILITIES = {
    // EVM-only (v1 + v12): external-contract surface + typed ABI bindings.
    'storage.read': { targets: EVM_TARGETS, hint: 'accountData(ref, offset, len)' },
    'storage.write': { targets: EVM_TARGETS, hint: 'writeAccountData(ref, offset, value)' },
    create: { targets: EVM_TARGETS },
    create2: { targets: EVM_TARGETS },
    create3: { targets: EVM_TARGETS },
    createAddress: { targets: EVM_TARGETS },
    create2Address: { targets: EVM_TARGETS },
    create3Address: { targets: EVM_TARGETS },
    delegatecall: { targets: EVM_TARGETS },
    'contract bindings': {
        targets: EVM_TARGETS,
        // Plural subject ("bindings are") doesn't fit the singular-subject formatter
        // ("<feature> is not supported...") the other EVM-only rows share, so this one
        // is spelled out verbatim rather than mis-agreeing.
        message: `contract bindings are not supported on target 'svm'; use contract.call(target, calldata, accounts)`,
    },
    'array destructuring': {
        targets: EVM_TARGETS,
        message: `array destructuring is not supported on target 'svm' — contract bindings are not available there; ` +
            `read fields from the contract.call(...) returndata with slice()/uint()`,
    },
    // svm-only: account-data storage surface (SLOAD/SSTORE's divergent, non-slot shape) and
    // the accounts-list call-argument shape (contract.call/static's 3rd operand on svm).
    accountData: { targets: SVM_ONLY },
    writeAccountData: { targets: SVM_ONLY },
    accountUint: { targets: SVM_ONLY },
    'accounts list': {
        targets: SVM_ONLY,
        message: `an accounts list (string refs / {ref, writable?, signer?} objects) is not supported on an EVM target — ` +
            `that argument slot is raw calldata bytes there, not an svm account list`,
    },
    // v1-only: a NESTED array LITERAL (`[[1, 2], [3, 4]]`). This is a pure target-gate on a
    // syntactic construct (detected at the emit site in collection.ts by an ArrayExpression
    // element, exactly like the 'array destructuring'/'accounts list' rows detect their own
    // shapes) — NOT a value/kind-shape guard: it never consults dynamic-vs-scalar kind
    // inference, so it is safe to centralize here (unlike the K-family descriptor guards in
    // processor/statement.ts + collection.ts, which stay put by design). v1 handles the
    // nested-literal encoding; the engine-v12/svm runtimes have no nested-ARRAY encoding yet.
    'nested array literal': {
        targets: ['v1'],
        // Names the specific rejecting target ('v12' or 'svm') inline, so the phrasing needs
        // the current target — hence the function form rather than a static string.
        message: (target) => `nested array literals (e.g. [[1, 2], [3, 4]]) are not supported on target '${target}' — the ` +
            `engine-v12 runtime has no nested-ARRAY encoding yet (a v1-only capability today); build the nested ` +
            `structure with new Array(n) instead (e.g. \`let outer = new Array(2); outer[0] = inner;\`), which is ` +
            `supported on every target`,
    },
    // v12-dialect-only (v12 + svm): v1's Saucer builder has no cast surface at all.
    uint: { targets: V12_DIALECT_TARGETS },
    // evm.* namespace (compiler-parity §1.3, adopted from compiler-rs): the EVM-only mirror of the
    // storage.*/contract.* surface. RS gates each with `require_available(..., Builtin::Evm*)` and
    // rejects it on the svm target (contract.rs `evm_call`, statement.rs `evm_sstore`).
    'evm.call': { targets: EVM_TARGETS },
    'evm.static': { targets: EVM_TARGETS },
    'evm.delegate': { targets: EVM_TARGETS },
    'evm.sload': { targets: EVM_TARGETS },
    'evm.sstore': { targets: EVM_TARGETS },
    // Transient storage (EIP-1153) mirror. RS gates these EVM-only via
    // `Feature::TransientStorage` (targets.rs — Unavailable on svm); the underlying
    // storage.tRead/tWrite spelling is deliberately UNGATED as a universal fork op, but the
    // evm.* namespace already implies an EVM target, so these match RS and gate EVM-only.
    'evm.tload': { targets: EVM_TARGETS },
    'evm.tstore': { targets: EVM_TARGETS },
    // Code-inspection reads (EXTCODESIZE/EXTCODEHASH-style, no svm analogue) — gated EVM-only. Post
    // NS-CONVERGE they live under `ctx.*` (not `evm.*`), matching RS main, which keeps every
    // context/address read under `ctx.*` and expresses target availability with a per-read gate like
    // its own `ctx.msgValue`; the gate here is identical, only the namespace changed.
    'ctx.codeSize': { targets: EVM_TARGETS },
    'ctx.codeHash': { targets: EVM_TARGETS },
    'ctx.isContract': { targets: EVM_TARGETS },
    'ctx.isEOA': { targets: EVM_TARGETS },
    // §1.5 (ECO-2163 continuation): the EVM-only wei-sent-with-the-call read, the EVM-only half of the
    // retired `msg.value`. Gated under `ctx.*` (NS-CONVERGE) — RS main carries the identical
    // `ctx.msgValue` (RS #348) and gates it per-read the same way. The other former `msg`/`block`/`tx`
    // EVM-only env reads (origin/gasPrice/coinbase/prevrandao/gasLimit/baseFee/blobBaseFee) were
    // DROPPED entirely rather than gated here — no consumers, not in either compiler's canonical ctx.*.
    'ctx.msgValue': { targets: EVM_TARGETS },
    // svm.* namespace (§1.3): the svm-only mirror of the accountData/CPI surface. RS gates each with
    // `require_available(..., Builtin::Svm*)` and rejects it on any EVM target (contract.rs
    // `svm_call`, statement.rs `svm_sstore`).
    'svm.sload': { targets: SVM_ONLY },
    'svm.sstore': { targets: SVM_ONLY },
    'svm.call': { targets: SVM_ONLY },
};
/** Re-derived, not hand-listed — kept only for `saucer/svm-profile.ts`'s existing named
 *  export shape (`SVM_GATED`), so nothing outside this file needs a second source of truth. */
export const SVM_GATED_HINTS = Object.fromEntries(Object.entries(TARGET_CAPABILITIES)
    .filter(([, row]) => !row.targets.includes('svm'))
    .map(([feature, row]) => [feature, row.hint]));
function targetList(targets) {
    const quoted = targets.map((t) => `'${t}'`);
    return `targets ${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}
/**
 * Three derived phrasings, chosen purely from (allowed set, current target) — this
 * reproduces every message that existed before this file centralized the checks,
 * verified by running the pre-existing assertion suites unedited:
 *   - allowed set excludes 'svm' (EVM-only)        -> "<feature> is not supported on
 *     target '<target>'[; use <hint>]" (an EVM-only row only ever rejects on 'svm').
 *   - allowed set is a single target (svm-only)     -> "<feature> is only available on
 *     target '<that target>'".
 *   - allowed set has 2+ targets including 'svm'    -> "<feature> is only available on
 *     targets 'a' and 'b'" (the v12-dialect-only row).
 */
function deriveMessage(feature, row, target) {
    if (row.message)
        return typeof row.message === 'function' ? row.message(target) : row.message;
    if (!row.targets.includes('svm')) {
        return `${feature} is not supported on target '${target}'${row.hint ? `; use ${row.hint}` : ''}`;
    }
    if (row.targets.length === 1) {
        return `${feature} is only available on target '${row.targets[0]}'`;
    }
    return `${feature} is only available on ${targetList(row.targets)}`;
}
/** Thrown by `assertCapability` when a feature is used on a target it doesn't support. */
export class UnsupportedTargetError extends Error {
    feature;
    target;
    supported;
    start;
    end;
    constructor(feature, target, supported, message, node) {
        super(message);
        this.name = 'UnsupportedTargetError';
        this.feature = feature;
        this.target = target;
        this.supported = supported;
        this.start = node?.start;
        this.end = node?.end;
    }
}
/**
 * Reject `feature` when it's used on a target `TARGET_CAPABILITIES` doesn't allow it on;
 * no-op otherwise. `node` (an acorn node with `start`/`end`) is optional — the nine
 * builder-layer call sites in saucer-v12.ts have no AST node in scope and leave the span
 * undefined, same as today's baseline (no location anywhere).
 */
export function assertCapability(ctx, feature, node) {
    const row = TARGET_CAPABILITIES[feature];
    if (!row)
        throw new Error(`unknown capability "${feature}" — add a TARGET_CAPABILITIES row`);
    if (row.targets.includes(ctx.target))
        return;
    throw new UnsupportedTargetError(feature, ctx.target, row.targets, deriveMessage(feature, row, ctx.target), node);
}
