import * as fs from 'fs';
import * as path from 'path';
import type { Abi, AbiParameter, ContractInfo, ContractsConfig } from './contracts.js';
import { parseAbiMethods } from './contracts.js';
import { RESERVED_BINDING_NAMES, RESERVED_NAMES } from './globals.js';
import { Saucer } from './saucer/saucer.js';
import { V12Saucer } from './saucer/saucer-v12.js';
import type { SaucerLike } from './saucer/saucer-like.js';
import { AccountRegistry } from './planner/registry.js';
import type { AccountPlan } from './planner/registry.js';

export type CompileTarget = 'v1' | 'v12' | 'svm';

// Fallback dedup key for an arm-only module (no neutral sibling on disk at all): strip the
// ".<target>" token that immediately precedes the file's own module extension, e.g.
// "/dir/token.svm.js" -> "/dir/token.js" and "/dir/token.svm.sauce.ts" -> "/dir/token.sauce.ts".
// Path-only string manipulation, arm-agnostic by construction — never reads the filesystem.
// True for a specifier the compiler must reject outright as a module import: a bare
// filesystem-root path, or (on Windows) a drive-letter path. A relative ("./x", "../x") or
// bare package specifier ("pkg", "@scope/pkg") is never absolute by this check.
function isAbsoluteSpecifier(source: string): boolean {
  return path.isAbsolute(source);
}

// Structural normalization of a package.json "exports"/"module"/"main" entry, mirroring
// compiler-rs's `path::normalize`: folds "." segments away, resolves ".." against what's
// already been folded, and fails (undefined) the moment a ".." would climb above the
// package root — the exact "did this entry escape the package" check, computed on the
// entry string ALONE (never by resolving-then-comparing), so an escaping path is never
// handed to the filesystem. An absolute entry also fails closed here.
function normalizeEntry(entry: string): string | undefined {
  if (path.isAbsolute(entry)) return undefined;

  const out: string[] = [];

  for (const seg of entry.split('/')) {
    if (seg === '' || seg === '.') continue;

    if (seg === '..') {
      if (out.length === 0) return undefined; // climbed above the package root

      out.pop();
      continue;
    }

    out.push(seg);
  }

  return out.join('/');
}

// Picks the "." subpath of a package.json `exports` field, then the first present of the
// import/node/default conditions (recursing through nested condition objects) — a small,
// deliberately non-exhaustive subset of Node's real exports resolution. An unmodeled shape
// (an array, a non-"." top-level subpath only, null, a number, ...) returns undefined so the
// caller degrades to `module`/`main` rather than failing the whole resolution.
function exportsEntry(value: unknown): string | undefined {
  if (typeof value === 'string') return value;

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const dot = obj['.'];

    if (dot !== undefined) return exportsEntry(dot);

    for (const cond of ['import', 'node', 'default']) {
      if (obj[cond] !== undefined) return exportsEntry(obj[cond]);
    }
  }

  return undefined;
}

function stripArmToken(filePath: string, target: CompileTarget): string {
  const armToken = `.${target}.`;
  const idx = filePath.lastIndexOf(armToken);

  if (idx === -1) return filePath;

  return filePath.slice(0, idx) + '.' + filePath.slice(idx + armToken.length);
}

export type VariableKind = 'scalar' | 'dynamic';

export interface ElementType {
  kind: VariableKind;
  element?: ElementType; // Nested element type for arrays of arrays
  structType?: StructType; // For structs: the field names
}

export interface StructType {
  fields: string[]; // Sorted alphabetically
  fieldStructTypes?: (StructType | undefined)[]; // Struct type for each field (parallel to fields array)
}

export interface Variable {
  name: string;
  slot: number;
  kind: VariableKind;
  elementType?: ElementType; // For arrays: the full element type chain
  structType?: StructType; // For structs: the field names
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

export class CompilerContext {
  readonly warnings: string[] = [];
  readonly target: CompileTarget;
  private scopes: Scope[] = [];
  private loopDepth = 0;
  private nextValueSlot = 0;
  private nextHeapSlot = 0;
  private nextTempId = 0;
  // High-water marks: the ALLOCATE_VALUE/ALLOCATE_HEAP prefix must cover the largest
  // slot INDEX ever used (slots are reused across non-overlapping scopes, so the
  // live count is far below the total declared). Slot indices are 1 byte, so >255
  // distinct LIVE slots would wrap — slot reuse keeps real programs well under that.
  private maxValueSlot = 0;
  private maxHeapSlot = 0;
  // Free-lists of slot indices released when a scope pops (its locals go out of
  // scope, so a later sibling scope can reuse the slot). SauceScript has no
  // closures, so a block-scoped local can never be read after its scope ends.
  private freeValueSlots: number[] = [];
  private freeHeapSlots: number[] = [];

  /** Module-level state, shared across a v12 module's per-function contexts. */
  private readonly module: SharedModule;
  private baseDirs: string[];
  // Absolute roots an import is allowed to resolve INSIDE — the caller-granted `baseDirs`, plus
  // a node_modules package directory once `resolvePackage` has located one (a package's own
  // internal relative imports live inside the package, which the walk-up may find ABOVE every
  // baseDir). Used only by the `..`-escape check (`assertDoesNotEscapeRoots`).
  private allowedRoots: string[];
  private pendingContractBinding?: { contractName: string; callTypeOverride?: 'static' | 'delegate' };
  private boundContracts: Map<string, { contract: ContractInfo; callTypeOverride?: 'static' | 'delegate' }> = new Map();

  // v12: function parameters live on the EVM stack (not memory slots). This tracks
  // the per-function stack layout so reads/writes resolve to SDUP/SSWAP positions.
  private stackDepth = 0;
  private stackVars: Map<string, number> = new Map();

  /**
   * v12: true while compiling main()'s body. main is INLINED (no call frame,
   * terminated by the assembly's trailing STOP), so its `return` just leaves the
   * value on the stack. A HELPER is entered via CALL_FUNCTION, so EVERY `return`
   * in it must emit FUNC_RETURN to pop its frame+params and jump back — including
   * an EARLY return inside a conditional, which otherwise just leaks the value and
   * falls through into the rest of the body (corrupting the stack — see
   * V12Saucer.return).
   */
  isMainFunction = true;

  /** Type info for main() function parameters, inferred from args option */
  mainArgTypes?: { kind: VariableKind; elementType?: ElementType; structType?: StructType }[];

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
  isMainBody = false;

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
  treeshake = true;

  /**
   * Compile-time constant environment for conditional compilation: names (from
   * CompileOptions.defines and top-level `const X = <literal>`) → their known bigint value.
   * Shared across a v12 module's per-function child contexts so a folded `if (HAS_CURVE)` in
   * any function sees the same defines. Booleans are normalized to 1n/0n.
   */
  private get defines(): Map<string, bigint> {
    return this.module.defines;
  }

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
  get fold(): boolean {
    return this.module.fold;
  }

  set fold(value: boolean) {
    this.module.fold = value;
  }

  /** Whether compile-time constant folding is active — see `fold`. */
  get foldEnabled(): boolean {
    return this.fold;
  }

  constructor(
    baseDirs: string[] = [],
    contracts: ContractsConfig = {},
    target: CompileTarget = 'v1',
    shared?: SharedModule,
  ) {
    this.scopes.push({ variables: new Map() });
    this.baseDirs = baseDirs;
    this.allowedRoots = baseDirs.map((dir) => path.resolve(dir));
    this.target = target;
    this.module = shared ?? {
      functions: [],
      contracts: new Map(),
      funcMeta: [],
      defines: new Map(),
      fold: true,
      accounts: new AccountRegistry(),
      staged: false,
      returnKinds: new Map(),
    };

    for (const [name, config] of Object.entries(contracts)) {
      this.registerContract(name, config.abi);
    }
  }

  /** True for BOTH postfix v12 dialects — 'v12' (EVM Huff runtime) and 'svm' (Solana engine). */
  get isV12(): boolean {
    return this.target !== 'v1';
  }

  /** True only for the Solana target ('svm' is a v12 dialect with divergent call/storage lowering). */
  get isSvm(): boolean {
    return this.target === 'svm';
  }

  /** svm: compiling for staged execution — args read from the payload via CALLDATA; msg.data rejected. */
  get staged(): boolean {
    return this.module.staged;
  }

  /** svm: mark the module staged (set once by compile() before processing). */
  setStaged(staged: boolean): void {
    this.module.staged = staged;
  }

  /** The function index table (shared across a v12 module's contexts). */
  get functions(): string[] {
    return this.module.functions;
  }

  /** v12: per-function build artifacts collected during processing. */
  get funcMeta(): FunctionMeta[] {
    return this.module.funcMeta;
  }

  /** Target-aware builder factory — the seam that keeps the processor agnostic. */
  newSaucer(): SaucerLike {
    return this.target === 'v1' ? new Saucer(this) : new V12Saucer(this);
  }

  // ── svm account registry (module-shared, see planner/registry.ts) ──

  /** svm: intern a symbolic account ref → stable user-account index (first-use order). */
  internAccount(ref: string, flags: { writable?: boolean; signer?: boolean } = {}): number {
    return this.module.accounts.intern(ref, flags);
  }

  /** svm: record that a raw numeric account index was used (locks out symbolic refs). */
  useRawAccountIndex(): void {
    this.module.accounts.useRawIndex();
  }

  /** svm: the ordered account plan assembled from the shared registry. */
  buildAccountPlan(): AccountPlan {
    return this.module.accounts.buildPlan();
  }

  /**
   * v12: a child context for compiling one function body — fresh slots, scopes
   * and stack tracker, but a SHARED module (function index table, contracts,
   * collected metadata) so calls resolve across functions.
   */
  forFunction(): CompilerContext {
    return new CompilerContext(this.baseDirs, {}, this.target, this.module);
  }

  recordFunction(meta: FunctionMeta): void {
    this.module.funcMeta.push(meta);
  }

  /**
   * Record a same-file function's analyzed return kind (see `SharedModule.returnKinds`).
   * Set once, up front, by the `analyzeFunctionReturnKinds` pre-pass — never mutated
   * during ordinary body compilation.
   */
  setFunctionReturnKind(name: string, kind: VariableKind): void {
    this.module.returnKinds.set(name, kind);
  }

  /** A same-file function's analyzed return kind, or undefined if never recorded. */
  getFunctionReturnKind(name: string): VariableKind | undefined {
    return this.module.returnKinds.get(name);
  }

  // ── v12 stack-variable tracking ──

  /** Push a named value onto the (tracked) EVM stack — e.g. a function param. */
  pushStack(name: string): void {
    this.stackDepth++;

    if (name) this.stackVars.set(name, this.stackDepth);
  }

  /** Absolute 1-indexed stack position of a tracked variable (0 = not found). */
  getStackVarPos(name: string): number {
    return this.stackVars.get(name) ?? 0;
  }

  /** Relative-from-top position of a tracked variable (0 = not found). */
  findStackVar(name: string): number {
    const stored = this.stackVars.get(name) ?? 0;

    if (stored === 0 || this.stackDepth < stored) return 0;

    return this.stackDepth - stored + 1;
  }

  get valueSlotCount(): number {
    // High-water mark (largest index + 1), NOT the total declared — slots are reused
    // across non-overlapping scopes, so this is what the ALLOCATE_VALUE prefix needs.
    return this.maxValueSlot;
  }

  get heapSlotCount(): number {
    return this.maxHeapSlot;
  }

  /** @deprecated Use valueSlotCount instead */
  get slotCount(): number {
    return this.maxValueSlot;
  }

  get resolvedBaseDirs(): string[] {
    return this.baseDirs;
  }

  get contractsConfig(): ContractsConfig {
    const config: ContractsConfig = {};
    for (const [name, info] of this.module.contracts) {
      config[name] = { abi: info.abi };
    }

    return config;
  }

  pushScope(): void {
    const parent = this.scopes[this.scopes.length - 1];
    this.scopes.push({ variables: new Map(), parent });
  }

  popScope(): void {
    if (this.scopes.length <= 1) {
      throw new Error('cannot pop global scope');
    }

    // Release this scope's memory slots so a later sibling scope can reuse them.
    // (v12 params are slot -1 and live on the stack — skip those.) No closures in
    // SauceScript, so a popped local is unreachable and its slot is safe to reuse.
    const scope = this.scopes.pop()!;
    for (const v of scope.variables.values()) {
      if (v.slot < 0) continue;

      if (v.kind === 'scalar') this.freeValueSlots.push(v.slot);
      else this.freeHeapSlots.push(v.slot);
    }
  }

  get currentScope(): Scope {
    return this.scopes[this.scopes.length - 1];
  }

  setVar(
    name: string,
    kind: VariableKind = 'scalar',
    elementType?: ElementType,
    structType?: StructType,
    isParam = false,
  ): Variable {
    if (RESERVED_BINDING_NAMES.has(name)) throw new Error(`'${name}' is a reserved name`);

    const scope = this.currentScope;

    if (scope.variables.has(name)) {
      throw new Error(`variable '${name}' is already declared`);
    }

    // v12 params live on the EVM stack, not a memory slot (slot -1 = unused).
    // Memory-slot allocation reuses a slot freed by a popped sibling scope (lower
    // index → tighter packing → fewer total slots), else bumps the high-water mark.
    let slot: number;

    if (isParam) {
      slot = -1;
    } else if (kind === 'scalar') {
      slot = this.freeValueSlots.length > 0 ? this.freeValueSlots.pop()! : this.nextValueSlot++;

      if (slot + 1 > this.maxValueSlot) this.maxValueSlot = slot + 1;
    } else {
      slot = this.freeHeapSlots.length > 0 ? this.freeHeapSlots.pop()! : this.nextHeapSlot++;

      if (slot + 1 > this.maxHeapSlot) this.maxHeapSlot = slot + 1;
    }

    const variable: Variable = { name, slot, kind, elementType, structType, isParam };
    scope.variables.set(name, variable);

    return variable;
  }

  /**
   * Allocate a uniquely-named scratch local (a memory slot, never a stack param).
   * The `#` prefix can never collide with a parsed SauceScript identifier, so the
   * lowering can stash an intermediate value (e.g. a compound-assignment index that
   * must be evaluated exactly once) without shadowing a user variable.
   */
  freshTemp(kind: VariableKind = 'scalar'): string {
    const name = `#tmp${this.nextTempId++}`;
    this.setVar(name, kind);

    return name;
  }

  getVar(name: string): Variable | undefined {
    let scope: Scope | undefined = this.currentScope;
    while (scope) {
      const variable = scope.variables.get(name);

      if (variable) return variable;

      scope = scope.parent;
    }

    return;
  }

  addFunc(functionName: string) {
    if (RESERVED_NAMES.has(functionName)) throw new Error(`'${functionName}' is a reserved name`);

    const index = this.functions.findIndex((name) => name === functionName);

    if (index !== -1) {
      throw new Error(`Duplicate definition of function "${functionName}".`);
    }

    this.functions.push(functionName);
  }

  /** Seed the compile-time constant environment from CompileOptions.defines. */
  setDefines(defines: Record<string, bigint | boolean | number>): void {
    for (const [name, value] of Object.entries(defines)) {
      this.defines.set(name, defineToBigint(value));
    }
  }

  /**
   * Register a top-level `const X = <literal>` as a compile-time constant (so it can fold
   * branch conditions). A define of the same name already set via CompileOptions wins (an
   * explicit override), so a const never clobbers a caller-provided flag.
   */
  registerConstant(name: string, value: bigint): void {
    if (!this.defines.has(name)) this.defines.set(name, value);
  }

  /** Compile-time value of a name (define or folded top-level const), or undefined if unknown. */
  getConstant(name: string): bigint | undefined {
    return this.defines.get(name);
  }

  getFunc(functionName: string): number {
    const index = this.functions.findIndex((name) => name === functionName);

    if (index === -1) {
      throw new Error(`Function ${functionName} is undefined.`);
    }

    return index;
  }

  pushLoop(): void {
    this.loopDepth++;
  }

  popLoop(): void {
    this.loopDepth--;
  }

  assertInLoop(keyword: string): void {
    if (this.loopDepth === 0) {
      throw new Error(`${keyword} outside loop`);
    }
  }

  warn(message: string): void {
    this.warnings.push(message);
  }

  // `importerDir`, when provided, is tried BEFORE `baseDirs` — so a `.json` contract ABI
  // shipped alongside an imported SauceScript module (or inside a resolved node_modules
  // package) resolves relative to that module, not just the entry program's own baseDirs.
  // Omitted, this is byte-identical to before this parameter existed.
  resolveImport(source: string, importerDir?: string): unknown {
    const roots = importerDir ? [importerDir, ...this.baseDirs] : this.baseDirs;

    this.assertDoesNotEscapeRoots(source, roots);

    for (const root of roots) {
      const filePath = path.resolve(root, source);

      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        continue;
      }
    }
    throw new Error(`Cannot resolve import "${source}". File not found in any of the provided baseDirs.`);
  }

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
  // `importerDir`, when provided, is tried BEFORE `baseDirs` for both (a) resolving a
  // relative specifier next to the importing module (compiler-rs's #274 fix — today this is
  // simply unreachable: a transitive relative import can only ever find something under a
  // baseDir) and (b) as the walk-up start for a bare package specifier. Omitted, every code
  // path below is byte-identical to before this parameter existed — `roots === this.baseDirs`.
  //
  // A BARE specifier (no leading "./" "../" "/", not ending ".json") that the path-based probe
  // below can't resolve is additionally tried as a node_modules package specifier
  // (`resolvePackage`) — see that method's own doc comment for the full algorithm. A specifier
  // resolving as an ordinary path (relative OR bare-as-a-baseDir-file, the latter a pre-existing,
  // deliberately preserved behavior) always wins over the package interpretation.
  resolveModuleSource(
    source: string,
    importerDir?: string,
  ): { code: string; filePath: string; dedupKey?: string } | undefined {
    if (source.endsWith('.json')) return undefined; // a .json import is a contract ABI, not a module

    if (isAbsoluteSpecifier(source)) {
      throw new Error(
        `absolute module import "${source}" is not supported; use a relative ("./x.js") or package specifier`,
      );
    }

    const roots = importerDir ? [importerDir, ...this.baseDirs] : this.baseDirs;

    this.assertDoesNotEscapeRoots(source, roots);

    const hit = this.resolveInRoots(source, roots);

    if (hit) return hit;

    if (!source.startsWith('./') && !source.startsWith('../')) {
      return this.resolvePackage(source, roots);
    }

    return undefined;
  }

  // compiler-rs's `ImportEscapesRoot` (`path::normalize` -> `None`): a specifier whose own ".."
  // segments climb ABOVE every root it is resolved against is rejected outright — a real-but-
  // unintended file next to the project ("../secret.json", "abi/../../secret.json") is never
  // read, on the module path and the `.json` contract path alike. A ".." that stays INSIDE a
  // root is untouched: a module in a subdirectory importing "../shared.js" still resolves,
  // because containment is judged against the granted roots (`allowedRoots`), not against the
  // importing module's own directory. A specifier with no ".." at all short-circuits, so every
  // ordinary import keeps its exact previous behavior — including the "no baseDirs at all" case,
  // which has no root to escape and still reports plain unresolvability.
  private assertDoesNotEscapeRoots(source: string, roots: string[]): void {
    if (this.allowedRoots.length === 0 || !source.split('/').includes('..')) return;

    const staysInside = roots.some((root) => {
      const target = path.resolve(root, source);

      return this.allowedRoots.some((allowed) => target === allowed || target.startsWith(allowed + path.sep));
    });

    if (!staysInside) throw new Error(`import "${source}" escapes the project root`);
  }

  // The original resolveModuleSource loop body, unchanged, now parameterized over an
  // arbitrary root list (a plain baseDir list for the top-level/backward-compatible case, or
  // `[importerDir, ...baseDirs]`, or `[packageDir]` when resolving a package's own entry).
  private resolveInRoots(
    source: string,
    roots: string[],
  ): { code: string; filePath: string; dedupKey?: string } | undefined {
    const MODULE_EXTS = ['.ts', '.sauce.ts', '.js', '.sauce', '.mjs'];
    // Strip the longest matching module extension so an explicit-extension specifier
    // (e.g. "./token.js") probes its own extension's arm first (`./token.svm.js`).
    const matchedExt = [...MODULE_EXTS].sort((a, b) => b.length - a.length).find((ext) => source.endsWith(ext));
    const base = matchedExt ? source.slice(0, -matchedExt.length) : source;

    const neutralCandidates = [
      source,
      `${source}.ts`,
      `${source}.sauce.ts`,
      `${source}.js`,
      `${source}.sauce`,
      `${source}.mjs`,
    ];

    const armExts = matchedExt ? [matchedExt, ...MODULE_EXTS.filter((e) => e !== matchedExt)] : MODULE_EXTS;
    const armCandidates = armExts.map((ext) => `${base}.${this.target}${ext}`);

    for (const root of roots) {
      for (const cand of armCandidates) {
        const filePath = path.resolve(root, cand);

        try {
          const code = fs.readFileSync(filePath, 'utf-8');
          const dedupKey = this.findNeutralPathForKey(neutralCandidates, roots) ?? stripArmToken(filePath, this.target);

          return { code, filePath, dedupKey };
        } catch {
          continue;
        }
      }

      for (const cand of neutralCandidates) {
        const filePath = path.resolve(root, cand);

        try {
          return { code: fs.readFileSync(filePath, 'utf-8'), filePath };
        } catch {
          continue;
        }
      }
    }

    return undefined;
  }

  // Path-only probe (never reads/parses) for the NEUTRAL identity of an already-arm-selected
  // module, scanned in the SAME root+candidate order `resolveInRoots` itself uses — so
  // when an arm wins in root X, this can only find a neutral file in X or a LATER root
  // (an earlier root contained neither, or the arm probe there would have already won).
  private findNeutralPathForKey(neutralCandidates: string[], roots: string[]): string | undefined {
    for (const root of roots) {
      for (const cand of neutralCandidates) {
        const filePath = path.resolve(root, cand);

        try {
          if (fs.statSync(filePath).isFile()) return filePath;
        } catch {
          continue;
        }
      }
    }

    return undefined;
  }

  // Resolves a BARE specifier (`spec`) as a node_modules package, mirroring compiler-rs's
  // `FsResolver::resolve_package`/`package_entry`/`exports_entry`. Only reached once the
  // ordinary path-based probe in `resolveModuleSource` has already failed, so this can never
  // shadow an existing relative-or-baseDir-file import (a bare specifier that resolves as a
  // plain path today keeps resolving that way, unchanged).
  //
  // Returns undefined (never throws) when the package simply isn't installed — the caller
  // falls through to the pre-existing ".json contract ABI" path and its existing error, so an
  // uninstalled bare specifier fails exactly as it always has. Every OTHER rejection (a
  // subpath, a bare "@scope", an escaping package-entry) throws, since those can only be
  // reached once the package DOES exist on disk, at which point silently falling through to
  // "unresolvable" would misreport a real, actionable configuration error as a missing file.
  private resolvePackage(
    spec: string,
    roots: string[],
  ): { code: string; filePath: string; dedupKey?: string } | undefined {
    const pkgSegments = spec.startsWith('@') ? 2 : 1;
    const parts = spec.split('/');

    if (spec.startsWith('@') && parts.length < 2) {
      throw new Error(`invalid package specifier "${spec}"; a scoped package is "@scope/name"`);
    }

    const pkg = parts.slice(0, pkgSegments).join('/');
    const subpath = parts.slice(pkgSegments).join('/');

    const pkgDir = this.findPackageDir(pkg, roots);

    if (!pkgDir) return undefined; // not installed: fall through to the existing ".json" error

    if (subpath !== '') {
      throw new Error(`subpath import "${spec}" is not supported; import the package root "${pkg}"`);
    }

    // The package itself becomes a root: the walk-up may find it ABOVE every baseDir, and its
    // own internal relative imports (and in-package `.json` ABIs) must keep resolving inside it.
    const pkgRoot = path.resolve(pkgDir);

    if (!this.allowedRoots.includes(pkgRoot)) this.allowedRoots.push(pkgRoot);

    const entry = this.packageEntry(pkgDir) ?? 'index.js';
    const normalized = normalizeEntry(entry);

    if (normalized === undefined) {
      throw new Error(`package "${pkg}" entry "${entry}" escapes the package root`);
    }

    const resolved = this.resolveInRoots(`./${normalized}`, [pkgDir]);

    if (!resolved) {
      throw new Error(`package "${pkg}" entry "${entry}" did not resolve`);
    }

    return resolved;
  }

  // Walks UP from each root's directory looking for `<dir>/node_modules/<pkg>`, mirroring
  // Node's own module resolution walk-up (so a package-local `node_modules/dep` correctly
  // shadows a top-level one when `roots[0]` is inside a package already reached this way).
  // `fs.statSync` follows symlinks, so a pnpm `node_modules/<pkg> -> ../.pnpm/...` link
  // resolves as a directory; the returned path keeps the symlinked spelling.
  private findPackageDir(pkg: string, roots: string[]): string | undefined {
    const visited = new Set<string>();

    for (const root of roots) {
      let dir = path.resolve(root);

      for (;;) {
        if (visited.has(dir)) break;

        visited.add(dir);

        const candidate = path.join(dir, 'node_modules', pkg);

        try {
          if (fs.statSync(candidate).isDirectory()) return candidate;
        } catch {
          // not here, keep climbing
        }

        const parent = path.dirname(dir);

        if (parent === dir) break; // filesystem root

        dir = parent;
      }
    }

    return undefined;
  }

  // Reads `<pkgDir>/package.json` and picks its module entry: the "." export condition
  // first, then "module", then "main" — a small, deliberately non-exhaustive subset of real
  // Node resolution. Returns undefined on any parse/read failure or when none of the three
  // fields yields a usable string, so the caller falls back to "index.js".
  private packageEntry(pkgDir: string): string | undefined {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')) as Record<string, unknown>;

      const fromExports = exportsEntry(pkg.exports);

      if (fromExports) return fromExports;

      if (typeof pkg.module === 'string') return pkg.module;

      if (typeof pkg.main === 'string') return pkg.main;

      return undefined;
    } catch {
      return undefined;
    }
  }

  registerContract(name: string, abi: Abi): void {
    if (this.module.contracts.has(name)) {
      throw new Error(`Contract "${name}" is already registered.`);
    }

    this.module.contracts.set(name, { name, abi, methods: parseAbiMethods(abi) });
  }

  lookupContract(name: string): ContractInfo | undefined {
    return this.module.contracts.get(name);
  }

  setPendingContractBinding(contractName: string, callTypeOverride?: 'static' | 'delegate'): void {
    this.pendingContractBinding = { contractName, callTypeOverride };
  }

  consumePendingContractBinding(variableName: string): void {
    if (!this.pendingContractBinding) return;

    const contract = this.module.contracts.get(this.pendingContractBinding.contractName);

    if (contract) {
      this.boundContracts.set(variableName, {
        contract,
        callTypeOverride: this.pendingContractBinding.callTypeOverride,
      });
    }

    this.pendingContractBinding = undefined;
  }

  lookupBoundContract(
    variableName: string,
  ): { contract: ContractInfo; callTypeOverride?: 'static' | 'delegate' } | undefined {
    return this.boundContracts.get(variableName);
  }
}

/** Normalize a `defines` value to a compile-time bigint (booleans → 1n/0n). */
function defineToBigint(value: bigint | boolean | number): bigint {
  if (typeof value === 'boolean') return value ? 1n : 0n;

  return BigInt(value);
}
