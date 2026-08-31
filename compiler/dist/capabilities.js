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
    // v12-dialect-only (v12 + svm): v1's Saucer builder has no cast surface at all.
    uint: { targets: V12_DIALECT_TARGETS },
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
        return row.message;
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
