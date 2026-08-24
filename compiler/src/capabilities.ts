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
 * crypto.*, msg.*, block.*, tx.*, ctx.* (the unified context namespace — `ctx.self()`/
 * `ctx.selfBalance()`/`ctx.balance()` included; the `address.*` namespace these used to alias was
 * dropped entirely in favor of `ctx.*` — see compiler-parity ECO-2163), gasLeft/blockHash/blobHash,
 * storage.tRead/tWrite (transient storage — a divergent-lowering, fork-parity op, not a gated one),
 * eval, Math.*, Uint8Array.from. A future edit MUST NOT "complete" this table with any of those.
 * (The former `address.codeSize`/`codeHash`/`isContract`/`isEOA` — EVM-only concepts with no svm
 * analogue — moved to the `evm.*` namespace below and ARE gated, unlike the rest of the old
 * `address.*` surface; they were never covered by the over-gating guard above.)
 */

/** One gated feature: the targets it's allowed on, plus how to phrase the rejection. */
interface CapabilityRow {
  /** The compile targets this feature may be used on. */
  readonly targets: readonly CompileTarget[];
  /** Suggested replacement, embedded in the derived message ("...; use <hint>"). */
  readonly hint?: string;
  /** Full message override, for a feature whose rejection needs bespoke phrasing
   *  the generic formatter can't produce (e.g. destructuring's two-clause sentence).
   *  A function form receives the current target, for a message that must name the
   *  specific rejecting target inline (e.g. the nested-array-literal row, which reads
   *  differently on 'v12' vs 'svm'). */
  readonly message?: string | ((target: CompileTarget) => string);
}

const EVM_TARGETS: readonly CompileTarget[] = ['v1', 'v12'];
const V12_DIALECT_TARGETS: readonly CompileTarget[] = ['v12', 'svm'];
const SVM_ONLY: readonly CompileTarget[] = ['svm'];

/**
 * TARGET_CAPABILITIES — one row per gated feature. This is the single source of truth: every
 * gate site (processor, globals, and the saucer-v12 builders via `assertSvmSupported`) looks
 * a feature up here rather than hand-rolling its own target check.
 */
export const TARGET_CAPABILITIES: Record<string, CapabilityRow> = {
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
    message:
      `array destructuring is not supported on target 'svm' — contract bindings are not available there; ` +
      `read fields from the contract.call(...) returndata with slice()/uint()`,
  },
  // svm-only: account-data storage surface (SLOAD/SSTORE's divergent, non-slot shape) and
  // the accounts-list call-argument shape (contract.call/static's 3rd operand on svm).
  accountData: { targets: SVM_ONLY },
  writeAccountData: { targets: SVM_ONLY },
  accountUint: { targets: SVM_ONLY },
  'accounts list': {
    targets: SVM_ONLY,
    message:
      `an accounts list (string refs / {ref, writable?, signer?} objects) is not supported on an EVM target — ` +
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
    message: (target) =>
      `nested array literals (e.g. [[1, 2], [3, 4]]) are not supported on target '${target}' — the ` +
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

  // svm.* namespace (§1.3): the svm-only mirror of the accountData/CPI surface. RS gates each with
  // `require_available(..., Builtin::Svm*)` and rejects it on any EVM target (contract.rs
  // `svm_call`, statement.rs `svm_sstore`).
  'svm.sload': { targets: SVM_ONLY },
  'svm.sstore': { targets: SVM_ONLY },
  'svm.call': { targets: SVM_ONLY },
};

/** Re-derived, not hand-listed — kept only for `saucer/svm-profile.ts`'s existing named
 *  export shape (`SVM_GATED`), so nothing outside this file needs a second source of truth. */
export const SVM_GATED_HINTS: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(TARGET_CAPABILITIES)
    .filter(([, row]) => !row.targets.includes('svm'))
    .map(([feature, row]) => [feature, row.hint]),
);

function targetList(targets: readonly CompileTarget[]): string {
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
function deriveMessage(feature: string, row: CapabilityRow, target: CompileTarget): string {
  if (row.message) return typeof row.message === 'function' ? row.message(target) : row.message;

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
  readonly feature: string;
  readonly target: CompileTarget;
  readonly supported: readonly CompileTarget[];
  readonly start?: number;
  readonly end?: number;

  constructor(
    feature: string,
    target: CompileTarget,
    supported: readonly CompileTarget[],
    message: string,
    node?: { start?: number; end?: number },
  ) {
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
export function assertCapability(ctx: CompilerContext, feature: string, node?: { start?: number; end?: number }): void {
  const row = TARGET_CAPABILITIES[feature];

  if (!row) throw new Error(`unknown capability "${feature}" — add a TARGET_CAPABILITIES row`);

  if (row.targets.includes(ctx.target)) return;

  throw new UnsupportedTargetError(feature, ctx.target, row.targets, deriveMessage(feature, row, ctx.target), node);
}
