import type { Abi, AbiParameter, ContractInfo, ContractsConfig } from './contracts.js';
import { V12Saucer } from './saucer/saucer-v12.js';
import type { SaucerLike } from './saucer/saucer-like.js';
import { AccountRegistry } from './planner/registry.js';
import type { AccountPlan } from './planner/registry.js';
export type CompileTarget = 'v1' | 'v12' | 'svm';
export type VariableKind = 'scalar' | 'dynamic';
export interface ElementType {
    kind: VariableKind;
    element?: ElementType;
    structType?: StructType;
}
export interface StructType {
    fields: string[];
    fieldStructTypes?: (StructType | undefined)[];
}
export interface Variable {
    name: string;
    slot: number;
    kind: VariableKind;
    elementType?: ElementType;
    structType?: StructType;
    /** v12: a function parameter (lives on the EVM stack, not a memory slot). */
    isParam?: boolean;
    /**
     * Holds a static packed array literal (`[1, 2, 3]`) — element-width-packed and
     * IMMUTABLE in the engine, which reverts SET_INDEX on it. Element assignment
     * (`arr[i] = x`) requires a mutable collection (`new Array(n)` / object literal,
     * both TUPLE), so the lowering rejects assignment to a flagged variable.
     */
    immutablePacked?: boolean;
    /**
     * v1 only, metadata (never changes emitted bytes): the variable was assigned a
     * multi-output contract call result (`const s = pool.slot0()`). The decoded
     * tuple's descriptor does not survive the v1 variable round-trip, so an indexed
     * read `s[k]` is GUARANTEED to fault SauceInvalidOperationArgs(INDEX) at
     * runtime — the lowering rejects it at compile time and points at destructuring
     * (`const [a, b] = pool.slot0()`), which never stores the descriptor. Bare
     * reads (`return s` — shipping protocol functions do this) stay untouched.
     */
    multiOutputCall?: AbiParameter[];
}
export interface Scope {
    variables: Map<string, Variable>;
    parent?: Scope;
}
/** v12: per-function build artifacts collected during processing, assembled by compile(). */
export interface FunctionMeta {
    name: string;
    isMain: boolean;
    paramCount: number;
    saucer: V12Saucer;
}
/** State shared across a v12 module's per-function child contexts. */
interface SharedModule {
    functions: string[];
    contracts: Map<string, ContractInfo>;
    funcMeta: FunctionMeta[];
    /** Compile-time constants (name → known bigint) for conditional compilation. */
    defines: Map<string, bigint>;
    /**
     * Whether if/ternary constant folding is active (CompileOptions.fold, default true) —
     * module-shared, like `defines`, so a helper compiled in its own child context (forFunction)
     * sees the same setting main() was compiled with.
     */
    fold: boolean;
    /** svm: symbolic account refs → user-account indices, shared so helper functions share numbering. */
    accounts: AccountRegistry;
    /**
     * svm: compiling for staged execution (execute_from_account). Compile-time
     * args are NOT baked into the blob — the prologue SLICEs them out of the
     * CALLDATA composite (`program ++ payload args`) — and user-level msg.data
     * is rejected (the prologue owns the single CALLDATA; a second one copies
     * the whole staged program to the heap again). Module-shared so every
     * function context sees the gate.
     */
    staged: boolean;
    /**
     * Same-file user function name → its analyzed RETURN storage kind, populated once
     * up front by `analyzeFunctionReturnKinds` (processor/return-kind.ts), a fixpoint
     * pre-pass run in `processProgram` right after treeshake and before the v1/v12
     * dispatch. Module-shared (like `functions`/`funcMeta`) so a helper's own child
     * context (`forFunction()`) sees the SAME map main's compilation does — this is what
     * lets `inferKindWithContext` (inference.ts) correctly infer `let arr = helper();` as
     * `dynamic` when `helper()`'s own body returns a `new Array(n)`-built TUPLE,
     * regardless of whether `helper` is declared before or after its caller (see the
     * "Same-file user-function return-kind inference" CLAUDE.md note). Absent an entry
     * (a name the pre-pass never saw, e.g. it runs before this map is populated) is
     * treated as "unknown", NOT "scalar" — `getFunctionReturnKind` returns `undefined`,
     * and callers fall back to the pre-existing ctx-free inference.
     */
    returnKinds: Map<string, VariableKind>;
}
export declare class CompilerContext {
    readonly warnings: string[];
    readonly target: CompileTarget;
    private scopes;
    private loopDepth;
    private nextValueSlot;
    private nextHeapSlot;
    private nextTempId;
    private maxValueSlot;
    private maxHeapSlot;
    private freeValueSlots;
    private freeHeapSlots;
    /** Module-level state, shared across a v12 module's per-function contexts. */
    private readonly module;
    private baseDirs;
    private allowedRoots;
    private pendingContractBinding?;
    private boundContracts;
    private stackDepth;
    private stackVars;
    /**
     * v12: true while compiling main()'s body. main is INLINED (no call frame,
     * terminated by the assembly's trailing STOP), so its `return` just leaves the
     * value on the stack. A HELPER is entered via CALL_FUNCTION, so EVERY `return`
     * in it must emit FUNC_RETURN to pop its frame+params and jump back — including
     * an EARLY return inside a conditional, which otherwise just leaks the value and
     * falls through into the rest of the body (corrupting the stack — see
     * V12Saucer.return).
     */
    isMainFunction: boolean;
    /** Type info for main() function parameters, inferred from args option */
    mainArgTypes?: {
        kind: VariableKind;
        elementType?: ElementType;
        structType?: StructType;
    }[];
    /**
     * Populated ONLY for a `tsSource` compile whose ts-frontend pass
     * (`localArrayFoldTransformer`'s return-escape Rule 6b, ts-frontend.ts — gated to a top-level
     * `function main` only) actually folded a `return arr;` into a literal array: a set of
     * `elements.join(',')` fingerprints (e.g. `"0,2,4"`), one per fold-synthesized literal.
     * Consulted by `processReturnStatement` (processor/index.ts) to force BYTE_32 (uint256)
     * element width for a matching return-position array literal — so `cook()`'s return value is
     * real ABI-decodable `uint256[N]` instead of the auto-narrowed (and, for the `new Array(n)`
     * TUPLE this fold replaces, otherwise raw-memory-pointer-leaking) encoding a plain array
     * literal would otherwise get. See the "Forcing uint256 element width" doc note in CLAUDE.md.
     * `undefined` for a plain `.js`/`.sauce` source or any `tsSource` compile that performed no
     * such fold — `processReturnStatement`'s width-forcing branch is then completely dead, so an
     * ordinary array-literal return is entirely unaffected either way. Set once, on the top-level
     * `ctx` `compileFresh` (src/index.ts) creates, before `processNode` ever runs; a v12 helper's
     * own per-function child context (`forFunction()`) gets a COPY of the same reference (see
     * `processFunctionV12`) so `ctx.isMainBody` alone is what actually gates its use (a helper
     * could in principle see this set, but never matches it — see `isMainBody`).
     */
    wideReturnArrays?: ReadonlySet<string>;
    /**
     * True ONLY while compiling `main()`'s own body — v1 directly on the module-level `ctx`
     * (`processProgram` flips it right before `processFunction(mainFunc, ctx)`, after every
     * helper has already compiled against its own separate `forFunction()` child); v12/svm via
     * `processFunctionV12`'s own per-function child context (`ctx.isMainBody = isMain`, alongside
     * the existing `ctx.isMainFunction`). Narrows `wideReturnArrays`'s fingerprint match (a pure
     * VALUE match, not a node-identity one — see there) to main()'s own return only, mirroring the
     * return-escape fold's own main()-only scope: a same-VALUED array literal hand-written inside
     * a HELPER must never widen just because it happens to match a fold that only ever fires in
     * main. Defaults false.
     */
    isMainBody: boolean;
    /**
     * Optional hook to transform an imported SOURCE module's text before it is parsed —
     * e.g. strip TypeScript types. Receives (code, absoluteFilePath); returns plain JS the
     * acorn parser accepts. Set from CompileOptions.transformModule. Consulted ONLY for
     * source-file imports (a `.json` contract ABI is never passed through it), and ONLY
     * overrides the built-in behavior: absent a caller-supplied hook, a `.ts`/`.sauce.ts`
     * import already runs through the compiler's own `ts-frontend.ts` (fold via
     * ts-evaluator, strip via ts.transpileModule) automatically — see processor/index.ts's
     * `collectImportedFunctions`. `.js`/`.sauce`/`.mjs` imports never invoke either path.
     */
    transformModule?: (code: string, filePath: string) => string;
    /**
     * Drop functions unreachable from main() after constant folding (CompileOptions.treeshake,
     * default true — set false for the legacy "every declared/imported function is emitted"
     * shape).
     */
    treeshake: boolean;
    /**
     * Compile-time constant environment for conditional compilation: names (from
     * CompileOptions.defines and top-level `const X = <literal>`) → their known bigint value.
     * Shared across a v12 module's per-function child contexts so a folded `if (HAS_CURVE)` in
     * any function sees the same defines. Booleans are normalized to 1n/0n.
     */
    private get defines();
    /**
     * Whether compile-time constant folding of if/ternary is active (CompileOptions.fold,
     * default true). Independent of `treeshake`: folding a dead branch out of a function
     * body is always safe on its own (evalConst only ever resolves an ACTUAL compile-time
     * constant — a literal, or a name in `defines`/top-level `const`; anything runtime-derived
     * yields `undefined` and falls through to normal codegen unchanged), whereas dropping a
     * whole unreferenced function (treeshake) is a bigger, still-opt-in structural change.
     * Set `fold: false` to get the pre-folding literal output (e.g. a test pinning the exact
     * unfolded bytecode of `if (1 === 1)`). Module-shared (like `defines`) so a helper compiled
     * in its own child context (forFunction) sees the same setting main() was compiled with.
     */
    get fold(): boolean;
    set fold(value: boolean);
    /** Whether compile-time constant folding is active — see `fold`. */
    get foldEnabled(): boolean;
    constructor(baseDirs?: string[], contracts?: ContractsConfig, target?: CompileTarget, shared?: SharedModule);
    /** True for BOTH postfix v12 dialects — 'v12' (EVM Huff runtime) and 'svm' (Solana engine). */
    get isV12(): boolean;
    /** True only for the Solana target ('svm' is a v12 dialect with divergent call/storage lowering). */
    get isSvm(): boolean;
    /** svm: compiling for staged execution — args read from the payload via CALLDATA; msg.data rejected. */
    get staged(): boolean;
    /** svm: mark the module staged (set once by compile() before processing). */
    setStaged(staged: boolean): void;
    /** The function index table (shared across a v12 module's contexts). */
    get functions(): string[];
    /** v12: per-function build artifacts collected during processing. */
    get funcMeta(): FunctionMeta[];
    /** Target-aware builder factory — the seam that keeps the processor agnostic. */
    newSaucer(): SaucerLike;
    /** svm: intern a symbolic account ref → stable user-account index (first-use order). */
    internAccount(ref: string, flags?: {
        writable?: boolean;
        signer?: boolean;
    }): number;
    /** svm: record that a raw numeric account index was used (locks out symbolic refs). */
    useRawAccountIndex(): void;
    /** svm: the ordered account plan assembled from the shared registry. */
    buildAccountPlan(): AccountPlan;
    /**
     * v12: a child context for compiling one function body — fresh slots, scopes
     * and stack tracker, but a SHARED module (function index table, contracts,
     * collected metadata) so calls resolve across functions.
     */
    forFunction(): CompilerContext;
    recordFunction(meta: FunctionMeta): void;
    /**
     * Record a same-file function's analyzed return kind (see `SharedModule.returnKinds`).
     * Set once, up front, by the `analyzeFunctionReturnKinds` pre-pass — never mutated
     * during ordinary body compilation.
     */
    setFunctionReturnKind(name: string, kind: VariableKind): void;
    /** A same-file function's analyzed return kind, or undefined if never recorded. */
    getFunctionReturnKind(name: string): VariableKind | undefined;
    /** Push a named value onto the (tracked) EVM stack — e.g. a function param. */
    pushStack(name: string): void;
    /** Absolute 1-indexed stack position of a tracked variable (0 = not found). */
    getStackVarPos(name: string): number;
    /** Relative-from-top position of a tracked variable (0 = not found). */
    findStackVar(name: string): number;
    get valueSlotCount(): number;
    get heapSlotCount(): number;
    /** @deprecated Use valueSlotCount instead */
    get slotCount(): number;
    get resolvedBaseDirs(): string[];
    get contractsConfig(): ContractsConfig;
    pushScope(): void;
    popScope(): void;
    get currentScope(): Scope;
    setVar(name: string, kind?: VariableKind, elementType?: ElementType, structType?: StructType, isParam?: boolean): Variable;
    /**
     * Allocate a uniquely-named scratch local (a memory slot, never a stack param).
     * The `#` prefix can never collide with a parsed SauceScript identifier, so the
     * lowering can stash an intermediate value (e.g. a compound-assignment index that
     * must be evaluated exactly once) without shadowing a user variable.
     */
    freshTemp(kind?: VariableKind): string;
    getVar(name: string): Variable | undefined;
    addFunc(functionName: string): void;
    /** Seed the compile-time constant environment from CompileOptions.defines. */
    setDefines(defines: Record<string, bigint | boolean | number>): void;
    /**
     * Register a top-level `const X = <literal>` as a compile-time constant (so it can fold
     * branch conditions). A define of the same name already set via CompileOptions wins (an
     * explicit override), so a const never clobbers a caller-provided flag.
     */
    registerConstant(name: string, value: bigint): void;
    /** Compile-time value of a name (define or folded top-level const), or undefined if unknown. */
    getConstant(name: string): bigint | undefined;
    getFunc(functionName: string): number;
    pushLoop(): void;
    popLoop(): void;
    assertInLoop(keyword: string): void;
    warn(message: string): void;
    resolveImport(source: string, importerDir?: string): unknown;
    /**
     * Resolve a SOURCE-FILE import (a SauceScript module that exports functions) — distinct
     * from `resolveImport`, which loads a `.json` contract ABI. Returns the module's raw text
     * + absolute path, or undefined if no source file resolves (the caller then treats the
     * import as a `.json` contract). Tries the literal path, then the common SauceScript source
     * extensions, across every baseDir. A `.json` source is never a module (returns undefined).
     *
     * Per-target arm selection: for each baseDir, a target-arm sibling (`<base>.<target>.<ext>`,
     * e.g. `./token.svm.js` when `this.target === 'svm'`) is probed BEFORE the neutral candidate
     * list, so a module can ship a target-specific implementation alongside a neutral fallback.
     * The unselected arm (a different target's arm file) is never read. `dedupKey`, when present,
     * is the NEUTRAL specifier's own resolved path — the identity `collectImportedFunctions` should
     * dedup/graph-key on, so cross-module dedup stays arm-agnostic regardless of which arm a given
     * import happened to select. It is omitted whenever the neutral candidate itself won (the
     * common, backward-compatible case), so `filePath` alone is the correct key there, exactly as
     * before this feature existed.
     */
    resolveModuleSource(source: string, importerDir?: string): {
        code: string;
        filePath: string;
        dedupKey?: string;
    } | undefined;
    private assertDoesNotEscapeRoots;
    private resolveInRoots;
    private findNeutralPathForKey;
    private resolvePackage;
    private findPackageDir;
    private packageEntry;
    registerContract(name: string, abi: Abi): void;
    lookupContract(name: string): ContractInfo | undefined;
    setPendingContractBinding(contractName: string, callTypeOverride?: 'static' | 'delegate'): void;
    consumePendingContractBinding(variableName: string): void;
    lookupBoundContract(variableName: string): {
        contract: ContractInfo;
        callTypeOverride?: 'static' | 'delegate';
    } | undefined;
}
export {};
//# sourceMappingURL=context.d.ts.map