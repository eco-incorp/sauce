import * as path from 'path';
import * as acorn from 'acorn';
import { CompilerContext } from '../context.js';
import { processLiteral, processUnaryExpression, processBinaryExpression, processLogicalExpression, processCallExpression, processMemberExpression, processNewExpression, processTaggedTemplateExpression, literalToInt, } from './expression.js';
import { processVariableDeclaration, processIfStatement, processForStatement, processWhileStatement, processMutation, } from './statement.js';
import { processArrayExpression, processObjectExpression } from './collection.js';
import { evalConst, evalConstBool } from './const-eval.js';
import { analyzeFunctionReturnKinds } from './return-kind.js';
import { tsPartialEval } from '../ts-frontend.js';
import { extractInlineDeclarations, buildInlineMap, expandInlineFunctionsInDeclarations, } from './inline.js';
export function processNode(node, ctx) {
    switch (node.type) {
        case 'Program':
            return processProgram(node, ctx);
        default:
            throw new Error(`not implemented: ${node.type}`);
    }
}
function processImportDeclaration(stmt, ctx, importerDir) {
    const source = stmt.source.value;
    // One ABI is one contract, so a `.json` import binds exactly one name. Binding several
    // (`import { A, B } from "./Erc20.json"`) used to silently register EVERY name against the
    // SAME ABI — `B.at(addr).transfer(...)` would compile against A's selectors — so it is a
    // clear error instead, checked before the file is even read (mirroring compiler-rs's
    // `MultiBindingContractImport`). A SOURCE module import is unaffected: it binds N names.
    if (stmt.specifiers.length > 1) {
        throw new Error(`contract import "${source}" binds ${stmt.specifiers.length} names; a .json ABI import binds exactly one`);
    }
    const artifact = ctx.resolveImport(source, importerDir);
    // Both shipped shapes of an ABI `.json`: the bare top-level entry ARRAY, and a build-tool
    // artifact OBJECT (`{ "abi": [...], "bytecode": ... }`, as forge/hardhat/OpenZeppelin emit)
    // whose `abi` field holds it. Anything else is not an ABI.
    const abi = Array.isArray(artifact) ? artifact : artifact?.abi;
    if (!Array.isArray(abi)) {
        throw new Error(`import "${source}" does not contain an ABI.`);
    }
    for (const specifier of stmt.specifiers) {
        const localName = specifier.local.name;
        // Idempotent: the SAME contract ABI imported by two source modules (or already
        // bound) must not throw "already registered" — skip a re-import of an identical
        // ABI. But a DIFFERENT ABI under the same local name is a genuine collision: the
        // first registration would silently win and the second module's functions would
        // compile against the wrong ABI (wrong selector/calldata), so reject it.
        const existing = ctx.lookupContract(localName);
        if (existing) {
            if (!abisEqual(existing.abi, abi)) {
                throw new Error(`Conflicting ABIs registered for "${localName}".`);
            }
            continue;
        }
        ctx.registerContract(localName, abi);
    }
}
// Stable structural equality of two ABIs (key order irrelevant) so a re-import of the
// same ABI dedups while a different ABI under the same local name is rejected.
function abisEqual(a, b) {
    return canonicalJson(a) === canonicalJson(b);
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
// Top-level FunctionDeclarations, including those behind `export`/`export default`.
// Imported modules and the main program both expose their functions this way.
function extractFunctionDeclarations(program) {
    const out = [];
    for (const stmt of program.body) {
        if (stmt.type === 'FunctionDeclaration') {
            out.push(stmt);
        }
        else if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
            const decl = stmt.declaration;
            if (decl && decl.type === 'FunctionDeclaration')
                out.push(decl);
        }
    }
    return out;
}
// Recursively pull function declarations from `import { fn } from "./mod"` source
// modules into the SAME function table as local functions, so they compile/emit
// identically. A `.json` import remains a contract ABI (processImportDeclaration).
// `seen` maps an imported function name → the module file it came from (duplicate
// detection across modules); `visited` is the set of already-pulled module paths
// (a shared module imported by two parents is pulled once). Imports recurse FIRST
// so a transitively-imported function is registered before the importing module's.
function collectImportedFunctions(program, ctx, seen, visited, inlineOut, importerDir) {
    const out = [];
    for (const stmt of program.body) {
        if (stmt.type !== 'ImportDeclaration')
            continue;
        const source = stmt.source.value;
        out.push(...collectFunctionsFromSpecifier(stmt, source, ctx, seen, visited, inlineOut, importerDir));
    }
    return out;
}
// The per-specifier body `collectImportedFunctions` above runs once per `ImportDeclaration` it
// finds: resolve, dedup against already-pulled modules, parse, recurse into the module's OWN
// imports, then register its exported functions + inline (arrow-const) functions into the
// shared `seen`/`inlineOut` namespaces. Factored out (rather than inlined in the loop above) so
// the ambient-import mechanism (`collectAmbientExports` below) can drive this EXACT same
// resolution+registration machinery from a bare specifier string with no `ImportDeclaration`
// node at all — CompileOptions.ambient has no import line, just a list of module specifiers.
// Two things differ per caller, both optional: `importStmt`, present only for a REAL import,
// carries the specifiers a `.json` contract ABI import binds local names from (an ambient
// specifier has none — see collectAmbientExports for what happens when one resolves to a
// `.json` instead of a source module); and `onModule`, invoked once per newly-visited module
// (never for one skipped by the `visited` dedup) with that module's own parsed AST — ambient
// uses this to additionally pull the module's exported top-level consts, a real import never
// needs it.
function collectFunctionsFromSpecifier(importStmt, source, ctx, seen, visited, inlineOut, importerDir, onModule) {
    const out = [];
    const mod = ctx.resolveModuleSource(source, importerDir);
    if (!mod) {
        // No source file resolves → a `.json` contract ABI import. Only a REAL import can mean
        // this (it alone carries the specifiers a contract binds local names from); an ambient
        // specifier calling this has no `importStmt` and no use for a contract ABI either, so
        // that path rejects it outright instead (see collectAmbientExports).
        if (importStmt) {
            processImportDeclaration(importStmt, ctx, importerDir);
        }
        else {
            throw new Error(`ambient module "${source}" does not resolve to a source module (a .json contract ABI cannot be ambient)`);
        }
        return out;
    }
    // Dedup on the NEUTRAL identity (`mod.dedupKey`, when an arm won) rather than the file
    // actually read, so cross-module dedup stays arm-agnostic — a shared module imported by
    // two parents is pulled once regardless of which arm each import resolved to.
    const dedupKey = mod.dedupKey ?? mod.filePath;
    if (visited.has(dedupKey))
        return out; // shared module already pulled
    visited.add(dedupKey);
    // A caller-supplied transformModule always wins; absent one, a `.ts`/`.sauce.ts`
    // module gets the built-in fold+strip front-end automatically — `.js`/`.sauce`/`.mjs`
    // are untouched (no ts-evaluator/typescript invocation at all).
    const code = ctx.transformModule
        ? ctx.transformModule(mod.code, mod.filePath)
        : mod.filePath.endsWith('.ts')
            ? tsPartialEval(mod.code, mod.filePath)
            : mod.code;
    let modAst;
    try {
        modAst = acorn.parse(code, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            allowReturnOutsideFunction: true,
        });
    }
    catch (e) {
        const hint = mod.filePath.endsWith('.ts')
            ? '' // .ts/.sauce.ts already ran through the built-in fold+strip front-end
            : ' (if it is TypeScript, pass options.transformModule to strip types before parsing)';
        throw new Error(`failed to parse imported module "${mod.filePath}": ${e.message}${hint}`);
    }
    // Recurse into the imported module's own imports FIRST so transitive functions
    // (and contracts) are registered before this module's.
    out.push(...collectImportedFunctions(modAst, ctx, seen, visited, inlineOut, path.dirname(mod.filePath)));
    for (const fn of extractFunctionDeclarations(modAst)) {
        const name = fn.id?.name;
        if (!name)
            continue;
        if (name === 'main')
            throw new Error(`imported module "${mod.filePath}" must not define main()`);
        const prev = seen.get(name);
        // Same name from a DIFFERENT module is an ambiguous collision; the same module
        // seen twice (re-entrant graph) is already handled by `visited`, so a repeat
        // here with the same path is just skipped.
        if (prev && prev !== mod.filePath) {
            throw new Error(`duplicate imported function "${name}" (from "${prev}" and "${mod.filePath}")`);
        }
        if (prev)
            continue;
        seen.set(name, mod.filePath);
        out.push(fn);
    }
    // Same collision-detection namespace (`seen`) covers inline (arrow-const) function
    // declarations too, so a real function in one module colliding with an inline
    // function of the same name in another (or the same) module is rejected identically.
    for (const [name, decl] of extractInlineDeclarations(modAst)) {
        const prev = seen.get(name);
        if (prev && prev !== mod.filePath) {
            throw new Error(`duplicate imported function "${name}" (from "${prev}" and "${mod.filePath}")`);
        }
        if (prev)
            continue;
        seen.set(name, mod.filePath);
        inlineOut.set(name, decl);
    }
    onModule?.(modAst, mod.filePath);
    return out;
}
// Ambient const channel (CompileOptions.ambient): an ambient module's own top-level
// `export const X = <literal>` declarations, evaluated + registered directly into ctx.defines
// — mirroring `registerTopLevelConsts` below, but scoped to ONE already-parsed ambient
// module's AST instead of the entry program's. Registration goes through
// `ctx.registerConstant` (insert-if-absent), so a name the user's own top-level CONST already
// claims simply keeps that value — the "user always wins" precedence — while still letting a
// LATER const in the SAME ambient module reference an EARLIER one, since each is registered
// into ctx.defines (and so resolvable via ctx.getConstant) as soon as it's evaluated, in file
// order, exactly like registerTopLevelConsts already does for the entry program. `ambientSeen`
// is the caller's own unified ambient-name namespace (SHARED with the function/inline channel
// collected alongside it in collectAmbientExports below) — consulted here ONLY to detect a
// genuine ambient-vs-ambient collision (two DIFFERENT ambient modules exporting the same name),
// unconditionally, exactly like the function channel's own `seen`-based collision check does
// regardless of `userNames` — it never gates whether a value lands in ctx.defines.
//
// `userNames` is the SAME user-claimed name set (local/imported functions, inline arrow-const
// functions, top-level consts, imported contract bindings) the function channel filters
// `ambientFns`/`ambientInlines` against in processProgram — threaded in here too so a user
// FUNCTION/inline/contract-binding name also shadows an ambient CONST, not just a user const
// (which `registerConstant`'s own insert-if-absent already handled "for free"). Skipping the
// registration entirely (rather than letting `registerConstant` no-op) is what closes that
// gap: a function/inline/contract-binding name is never itself present in ctx.defines, so
// `registerConstant`'s insert-if-absent check alone can't see it's already claimed.
//
// Deliberately NOT transitive: only the DIRECTLY-specified ambient module's own top-level
// consts are pulled — a nested module it itself imports is not walked for consts (unlike the
// function channel, which gets that for free by reusing collectImportedFunctions's existing
// recursion). A first-cut scope decision, not a soundness requirement.
function registerAmbientConsts(modAst, ctx, ambientSeen, filePath, userNames) {
    for (const stmt of modAst.body) {
        if (stmt.type !== 'ExportNamedDeclaration')
            continue;
        const decl = stmt.declaration;
        if (!decl || decl.type !== 'VariableDeclaration' || decl.kind !== 'const')
            continue;
        for (const d of decl.declarations) {
            if (d.id.type !== 'Identifier' || !d.init)
                continue;
            const name = d.id.name;
            const value = evalConst(d.init, ctx);
            if (value === undefined)
                continue; // non-literal-foldable export: out of scope, skip
            const prev = ambientSeen.get(name);
            if (prev && prev !== filePath) {
                throw new Error(`duplicate ambient export "${name}" (from "${prev}" and "${filePath}")`);
            }
            if (!prev)
                ambientSeen.set(name, filePath);
            // A user function/inline/contract-binding of the same name wins — never register the
            // ambient const at all (a same-named user CONST is already handled by registerConstant's
            // own insert-if-absent below, so this check is additive, not a replacement for it).
            if (userNames.has(name))
                continue;
            ctx.registerConstant(name, value);
        }
    }
}
// Ambient imports (CompileOptions.ambient): resolve every listed specifier as a source module
// (never a `.json` contract — a bare specifier has no local-name binding for one) and pull its
// exported functions, inline (arrow-const) functions, and top-level exported consts, exactly
// like a normal `import { x } from "./mod"` would, but with NO import line anywhere in the
// program. `seen`/`visited` here are ambient-SCOPED — a fresh namespace never shared with the
// entry program's own import-graph collection in processProgram — so an ambient name colliding
// with something the USER already declared/imported never throws here (the caller filters
// those out, silently, so user code always wins); only two DIFFERENT ambient modules (or an
// ambient module and one of its own transitively-ambient-imported siblings) naming the SAME
// function/inline/const is a genuine ambient-vs-ambient collision, and that still throws via
// `seen`'s existing collision check (functions + inlines) and `registerAmbientConsts`'s own
// (consts) — one unified namespace spanning all three, matching compiler-rs's P3 ambient
// primitive. `userNames` (the caller's full user-claimed name set, computed BEFORE this
// function runs — see the ordering note in processProgram) is threaded straight through to
// `registerAmbientConsts` via the `onModule` hook, so the const channel gets the identical
// "user code always wins" precedence the function/inline channel's own (separate, later)
// filter in processProgram applies to `fns`/`inlineOut` below.
function collectAmbientExports(specifiers, ctx, userNames) {
    const seen = new Map();
    const visited = new Set();
    const inlineOut = new Map();
    const fns = [];
    for (const source of specifiers) {
        fns.push(...collectFunctionsFromSpecifier(undefined, source, ctx, seen, visited, inlineOut, undefined, (modAst, filePath) => registerAmbientConsts(modAst, ctx, seen, filePath, userNames)));
    }
    return { fns, inlines: inlineOut };
}
// Reachability walk for tree-shaking: every function name transitively CALLED from
// main(). Constant-aware — an if/ternary with a const-known test is pruned to its
// taken branch EXACTLY as the emitter prunes it (statement.ts), so the set of CALL
// targets walked == the set emitted; with treeshake on, every emitted call therefore
// targets a registered (kept) function.
function treeshake(declarations, ctx) {
    const declMap = new Map();
    for (const d of declarations) {
        const name = d.id?.name;
        if (name)
            declMap.set(name, d);
    }
    const reachable = new Set();
    const stack = ['main'];
    while (stack.length > 0) {
        const name = stack.pop();
        if (reachable.has(name))
            continue;
        reachable.add(name);
        const decl = declMap.get(name);
        if (!decl)
            continue;
        for (const callee of collectCalls(decl.body, ctx, declMap)) {
            if (!reachable.has(callee))
                stack.push(callee);
        }
    }
    return declarations.filter((d) => d.id?.name === 'main' || reachable.has(d.id?.name ?? ''));
}
// Collect the names of user functions a node (sub)tree calls. Conservative by design:
// EVERYTHING is traversed fully EXCEPT an if/ternary with a const-known test, which is
// pruned to its taken branch — matching the emitter bit-for-bit. Loops and value-position
// `&&`/`||` are NOT special-cased (traversed fully) so the walker never drops a call the
// emitter still emits.
function collectCalls(node, ctx, declMap, out = new Set()) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string')
        return out;
    switch (node.type) {
        case 'IfStatement': {
            const stmt = node;
            if (ctx.foldEnabled) {
                const taken = evalConstBool(stmt.test, ctx);
                if (taken === true)
                    return collectCalls(stmt.consequent, ctx, declMap, out);
                if (taken === false)
                    return collectCalls(stmt.alternate, ctx, declMap, out); // alternate may be undefined
            }
            break;
        }
        case 'ConditionalExpression': {
            const expr = node;
            if (ctx.foldEnabled) {
                const taken = evalConstBool(expr.test, ctx);
                if (taken === true)
                    return collectCalls(expr.consequent, ctx, declMap, out);
                if (taken === false)
                    return collectCalls(expr.alternate, ctx, declMap, out);
            }
            break;
        }
        case 'CallExpression': {
            const callee = node.callee;
            if (callee.type === 'Identifier') {
                const name = callee.name;
                if (declMap.has(name))
                    out.add(name);
            }
            break;
        }
    }
    // Generic walk: recurse into every child node / array of nodes.
    eachChild(node, (child) => collectCalls(child, ctx, declMap, out));
    return out;
}
// Walk every AST-node child of a node (node-valued props + arrays of nodes), skipping
// acorn's bookkeeping fields. Generic so collectCalls needn't enumerate node shapes.
// Exported for reuse by the inline-function expansion pass (processor/inline.ts) —
// its own recursion-detection / bail-condition scans need the identical generic walk.
export function eachChild(node, visit) {
    for (const [key, value] of Object.entries(node)) {
        if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range')
            continue;
        if (Array.isArray(value)) {
            for (const el of value) {
                if (el && typeof el === 'object' && typeof el.type === 'string')
                    visit(el);
            }
        }
        else if (value && typeof value === 'object' && typeof value.type === 'string') {
            visit(value);
        }
    }
}
// Register top-level `const X = <foldable init>` (and `export const`) in the MAIN
// program as compile-time constants BEFORE treeshake/compile, so they fold branch
// conditions. They emit no runtime code (top-level consts are compile-time only).
// Shared by registerTopLevelConsts and collectTopLevelConstNames below: a top-level `const`
// statement, plain or `export`-wrapped, or undefined for anything else (an ImportDeclaration, a
// FunctionDeclaration, a top-level `let`/`var` — rejected by isAllowedTopLevel regardless, so
// this never needs to recognize one).
function topLevelConstDeclOf(stmt) {
    const decl = stmt.type === 'VariableDeclaration'
        ? stmt
        : stmt.type === 'ExportNamedDeclaration' &&
            stmt.declaration?.type === 'VariableDeclaration'
            ? stmt.declaration
            : undefined;
    return decl && decl.kind === 'const' ? decl : undefined;
}
function registerTopLevelConsts(program, ctx) {
    for (const stmt of program.body) {
        const decl = topLevelConstDeclOf(stmt);
        if (!decl)
            continue;
        for (const d of decl.declarations) {
            if (d.id.type !== 'Identifier' || !d.init)
                continue;
            const value = evalConst(d.init, ctx);
            if (value !== undefined)
                ctx.registerConstant(d.id.name, value);
        }
    }
}
// Every top-level `const X = …` name in the entry program — regardless of whether its
// initializer actually folds to a literal (registerTopLevelConsts only registers the ones that
// do; this collects the NAME either way, since the identifier is claimed by the user's own
// top-level declaration regardless). Used by the ambient-import mechanism (processProgram) to
// keep an ambient function from leaking past a same-named user top-level const — see the
// "userNames" audit note there.
function collectTopLevelConstNames(program) {
    const names = new Set();
    for (const stmt of program.body) {
        const decl = topLevelConstDeclOf(stmt);
        if (!decl)
            continue;
        for (const d of decl.declarations) {
            if (d.id.type === 'Identifier')
                names.add(d.id.name);
        }
    }
    return names;
}
// Top-level node types allowed in the main program: imports, function declarations
// (incl. exported), empty statements, and `const X = …` (compile-time constants).
function isAllowedTopLevel(stmt) {
    switch (stmt.type) {
        case 'ImportDeclaration':
        case 'FunctionDeclaration':
        case 'ExportNamedDeclaration':
        case 'ExportDefaultDeclaration':
        case 'EmptyStatement':
            return true;
        case 'VariableDeclaration':
            return stmt.kind === 'const';
        default:
            return false;
    }
}
function processProgram(program, ctx) {
    // Pull imported source-module functions (and process .json contract imports) FIRST,
    // so they join the same function table as local functions. Recursive across modules.
    // Inline (arrow-const) function declarations are collected alongside, into the same
    // cross-module duplicate-name namespace (`seen`, threaded inside collectImportedFunctions).
    const importedInlines = new Map();
    const importedFns = collectImportedFunctions(program, ctx, new Map(), new Set(), importedInlines);
    // Register top-level consts (compile-time only) before validating / folding.
    registerTopLevelConsts(program, ctx);
    const nonAllowed = program.body.find((stmt) => !isAllowedTopLevel(stmt));
    if (nonAllowed) {
        throw new Error('top-level statements not allowed, use function main()');
    }
    const localFns = extractFunctionDeclarations(program);
    let declarations = [...importedFns, ...localFns];
    // Ambient imports (CompileOptions.ambient, threaded onto ctx by compile()): broadcast each
    // listed module's exported functions/inline-functions/consts into this compile's resolution
    // set with NO import line — mirroring compiler-rs's P3 ambient primitive. Precedence: **user
    // code always wins** — a name already claimed by the entry program's own local/imported
    // functions, inline (arrow-const) functions, top-level consts, or imported contract bindings
    // is filtered out here (silently) rather than added, on EVERY channel (functions, inlines,
    // AND consts — `registerAmbientConsts` takes the identical `userNames` set below); a
    // function-local/parameter additionally shadows an ambient const for free, since
    // `processExpression`'s Identifier case only consults `ctx.getConstant` when `ctx.getVar` is
    // undefined — no change needed here for that.
    if (ctx.ambient && ctx.ambient.length > 0) {
        // Snapshot the user's own contract-binding names BEFORE collectAmbientExports runs — an
        // ambient module can itself transitively import a `.json` ABI (via its own nested imports,
        // recursed through the ordinary collectImportedFunctions path), which would register a NEW
        // contract into the same shared `ctx` this checks. That must never retroactively count as
        // "the user's" for the filter below, so the snapshot has to be taken first.
        const userContractNames = new Set(ctx.contractNames);
        const userConstNames = collectTopLevelConstNames(program);
        // Build the full user-claimed name set BEFORE collectAmbientExports runs (unlike the
        // function/inline filter below, which only needs it AFTER collection) — `registerAmbientConsts`
        // is invoked DURING collectAmbientExports, via its `onModule` hook, so it needs `userNames`
        // in hand already to keep an ambient const from shadowing a user function/inline/contract
        // binding of the same name.
        const userNames = new Set();
        for (const d of declarations)
            if (d.id?.name)
                userNames.add(d.id.name);
        for (const name of extractInlineDeclarations(program).keys())
            userNames.add(name);
        for (const name of importedInlines.keys())
            userNames.add(name);
        for (const name of userConstNames)
            userNames.add(name);
        for (const name of userContractNames)
            userNames.add(name);
        const { fns: ambientFns, inlines: ambientInlines } = collectAmbientExports(ctx.ambient, ctx, userNames);
        for (const fn of ambientFns) {
            if (fn.id?.name && !userNames.has(fn.id.name))
                declarations.push(fn);
        }
        for (const [name, decl] of ambientInlines) {
            if (!userNames.has(name))
                importedInlines.set(name, decl);
        }
    }
    const mainFunc = declarations.find((stmt) => stmt.id?.name === 'main');
    if (!mainFunc) {
        throw new Error('missing main() function');
    }
    // Inline (arrow-const) function expansion: a top-level `const NAME = (…) => …` call is
    // spliced into ordinary statements at its call site, BEFORE treeshake/v1/v12 dispatch —
    // both targets then compile the (already-expanded) plain SauceScript unmodified. A no-op
    // when the program declares no inline functions (buildInlineMap/expand both fast-path on
    // an empty map), so an unmodified program is unaffected byte-for-byte.
    const inlineMap = buildInlineMap(program, importedInlines, declarations);
    expandInlineFunctionsInDeclarations(declarations, inlineMap);
    // Drop functions unreachable from main() (constant-aware) so an imported-but-unused
    // function — or a handler behind a statically-false branch — is never emitted. Runs
    // AFTER inline expansion so a real function reachable only THROUGH an inline function's
    // (now-spliced) body is correctly seen as reachable.
    if (ctx.treeshake)
        declarations = treeshake(declarations, ctx);
    // Analyze every (surviving) declared function's own RETURN storage kind up front — a
    // fixpoint pre-pass (return-kind.ts), independent of declaration order — and record it
    // on the shared module BEFORE either target compiles a single body. This is what lets
    // `inferKindWithContext` (inference.ts) infer `let arr = helper();` as `dynamic` when
    // `helper()` returns a `new Array(n)`-built TUPLE, on BOTH v1 and v12/svm (a v12/svm
    // helper's own child context shares the same module, see `forFunction()`). Running here
    // (after treeshake, before the v1/v12 dispatch) means an unreachable function's shape
    // never affects analysis, and both targets see identical results. `ctx` is passed through
    // so a `const [n, xs] = Contract.at(addr).method();` destructuring return can resolve its
    // bound names' REAL per-output ABI kinds (`ctx.lookupContract` is already populated by
    // `collectImportedFunctions` above, well before this line runs).
    const returnKinds = analyzeFunctionReturnKinds(declarations, ctx);
    for (const [name, kind] of returnKinds)
        ctx.setFunctionReturnKind(name, kind);
    if (ctx.isV12) {
        return processProgramV12(declarations, mainFunc, ctx);
    }
    // Register EVERY helper name up front (mirroring processProgramV12 below) before
    // compiling any body, so a helper may call an as-yet-uncompiled LATER-declared helper —
    // matching v12, which already has no such ordering restriction (v1 used to interleave
    // addFunc with compilation in one pass, so a forward reference threw "Function X is
    // undefined."; this fixes that asymmetry).
    const helpers = declarations.filter((stmt) => stmt.id?.name !== 'main');
    for (const stmt of helpers)
        ctx.addFunc(stmt.id?.name);
    ctx.addFunc('main');
    const functions = helpers.map((stmt) => 
    // Compile each helper in a CHILD context (fresh slots/scopes, isolated like the
    // legacy fresh-context behaviour) that SHARES the module's function index table
    // and contracts — so an imported helper that calls a sibling imported function
    // (or uses an imported contract ABI) resolves instead of failing late with
    // "Function … is undefined".
    processFunction(stmt, ctx.forFunction()));
    // main compiles directly on the module-level `ctx` (not a `forFunction()` child, unlike every
    // helper above) — flip `isMainBody` only NOW, after every helper has already compiled against
    // its own separate child context, so no helper ever sees it set. Narrows
    // `ctx.wideReturnArrays`'s (value-based, not node-identity) fingerprint match to main()'s own
    // return — see `processReturnStatement`/`CompilerContext.isMainBody`.
    ctx.isMainBody = true;
    return [...functions, processFunction(mainFunc, ctx)];
}
/**
 * v12: every function (helpers + main) compiles in its own child context (fresh
 * slots/scopes/stack) sharing the module's function index table, so calls resolve
 * across functions. Each function's build artifacts are recorded for the single-blob
 * assembly in compile(). Function names are registered up front so a body can call a
 * function declared later.
 */
function processProgramV12(declarations, mainFunc, ctx) {
    const helpers = declarations.filter((stmt) => stmt.id?.name !== 'main');
    for (const stmt of helpers)
        ctx.addFunc(stmt.id?.name);
    ctx.addFunc('main');
    const helperSaucers = helpers.map((stmt) => processFunctionV12(stmt, ctx));
    const mainSaucer = processFunctionV12(mainFunc, ctx);
    return [...helperSaucers, mainSaucer];
}
function processFunctionV12(stmt, parentCtx) {
    const ctx = parentCtx.forFunction();
    const name = stmt.id?.name ?? 'main';
    const isMain = name === 'main';
    // Helpers self-terminate every `return` with FUNC_RETURN; main is inlined and
    // just leaves its value (see CompilerContext.isMainFunction / V12Saucer.return).
    ctx.isMainFunction = isMain;
    // `forFunction()` is a FRESH CompilerContext instance for every function (helpers AND main
    // alike, on v12/svm) — unlike v1's main (compiled directly on the module-level `ctx`, see
    // `processProgram`), so `wideReturnArrays`/`isMainBody` need an explicit copy from
    // `parentCtx` here (mirroring the existing `parentCtx.mainArgTypes` read just below) rather
    // than relying on shared module state. Copying unconditionally is harmless: a helper's own
    // `ctx.isMainBody` stays false, so `processReturnStatement`'s width-forcing branch never
    // fires for one regardless of whether `wideReturnArrays` happens to be set.
    ctx.wideReturnArrays = parentCtx.wideReturnArrays;
    ctx.isMainBody = isMain;
    const argTypes = isMain ? parentCtx.mainArgTypes : undefined;
    // Params live on the EVM stack (isParam) in declaration order.
    stmt.params.forEach((param, i) => {
        if (param.type !== 'Identifier')
            throw new Error(`Unsupported function variable type: ${param.type}`);
        const argType = argTypes?.[i];
        ctx.setVar(param.name, argType?.kind ?? 'scalar', argType?.elementType, argType?.structType, true);
        ctx.pushStack(param.name);
    });
    const body = stmt.body.body.reduce((saucer, st) => processStatement(st, ctx, saucer), ctx.newSaucer());
    ctx.recordFunction({ name, isMain, paramCount: stmt.params.length, saucer: body });
    return body;
}
function processFunction(stmt, ctx = new CompilerContext()) {
    const argTypes = ctx.mainArgTypes;
    stmt.params.forEach((param, i) => {
        if (param.type !== 'Identifier')
            throw new Error(`Unsupported function variable type: ${param.type}`);
        const argType = argTypes?.[i];
        ctx.setVar(param.name, argType?.kind ?? 'scalar', argType?.elementType, argType?.structType);
    });
    return stmt.body.body.reduce((saucer, st) => processStatement(st, ctx, saucer), ctx.newSaucer());
}
export function processStatement(stmt, ctx, saucer) {
    switch (stmt.type) {
        case 'VariableDeclaration':
            return processVariableDeclaration(stmt, ctx, saucer);
        case 'IfStatement':
            return processIfStatement(stmt, ctx, saucer);
        case 'ReturnStatement':
            return processReturnStatement(stmt, ctx, saucer);
        case 'ForStatement':
            return processForStatement(stmt, ctx, saucer);
        case 'WhileStatement':
            return processWhileStatement(stmt, ctx, saucer);
        case 'BreakStatement':
            return saucer.break();
        case 'ContinueStatement':
            return saucer.continue();
        case 'ExpressionStatement':
            return processMutation(stmt.expression, ctx, saucer);
        case 'ThrowStatement':
            return processThrowStatement(stmt, ctx, saucer);
        default:
            throw new Error(`not implemented: ${stmt.type}`);
    }
}
/**
 * The VALUE-based fingerprint the ts-frontend's return-array escape fold keys `wideReturnArrays`
 * by (`localArrayFoldTransformer`'s Rule 6b in ts-frontend.ts: `candidate.elements.join(',')`).
 * `undefined` for anything other than an array literal whose every element is a non-negative
 * integer `Literal` (bigint or integer number) — a spread element, a non-literal expression, a
 * float, or a negative value all decline (matching Rule 6b's own guard, which never lets a
 * negative element reach `wideReturnArrays` in the first place). This is a pure VALUE match, not
 * a node-identity one: a user hand-written return-position array literal with the exact same
 * element values also matches — see `CompilerContext.wideReturnArrays`'s own doc comment for why
 * that's harmless (can only WIDEN an already-correct value, never change it), and `isMainBody`
 * for how the match is additionally narrowed to main()'s own return.
 */
function wideReturnFingerprint(expr) {
    if (expr.type !== 'ArrayExpression')
        return undefined;
    const values = [];
    for (const el of expr.elements) {
        if (!el || el.type !== 'Literal')
            return undefined;
        const lit = el;
        if (typeof lit.value !== 'number' && typeof lit.value !== 'bigint')
            return undefined;
        let value;
        try {
            value = literalToInt(lit);
        }
        catch {
            return undefined;
        }
        if (value < 0n)
            return undefined;
        values.push(value);
    }
    return values.join(',');
}
function processReturnStatement(stmt, ctx, saucer) {
    if (!stmt.argument)
        return saucer.return();
    // Force BYTE_32 (uint256) element width for a return-position array literal the ts-frontend's
    // local-array return-escape fold synthesized (see CompilerContext.wideReturnArrays and
    // ts-frontend.ts's "Forcing uint256 element width" doc note). `ctx.wideReturnArrays` is
    // populated ONLY for a tsSource compile that actually performed such a fold, and `isMainBody`
    // narrows the (value-based, not node-identity) fingerprint match to main()'s own return — so
    // this branch is completely dead for a plain .js/.sauce source, a tsSource compile with no
    // such fold, or a helper's own return, and an ordinary array-literal return keeps its existing
    // auto-narrowed encoding everywhere else.
    const fp = ctx.isMainBody && ctx.wideReturnArrays ? wideReturnFingerprint(stmt.argument) : undefined;
    if (fp !== undefined && ctx.wideReturnArrays?.has(fp)) {
        return saucer.return(processArrayExpression(stmt.argument, ctx, ctx.newSaucer(), 32));
    }
    return saucer.return(processExpression(stmt.argument, ctx));
}
function processThrowStatement(stmt, ctx, saucer) {
    return saucer.revert(processExpression(stmt.argument, ctx));
}
export function processExpression(expr, ctx) {
    const saucer = ctx.newSaucer();
    switch (expr.type) {
        case 'Literal':
            return processLiteral(expr, saucer);
        case 'Identifier': {
            // A compile-time constant (CompileOptions.defines or a top-level `const X = …`)
            // emits its literal value here, so it behaves as a true constant in non-folding
            // positions too (e.g. `rt + SCALE`, or a partially-folding `FLAG && rt`) — not
            // just inside a fully-foldable condition. A runtime variable falls through to read.
            const constant = ctx.getConstant(expr.name);
            if (constant !== undefined && !ctx.getVar(expr.name))
                return saucer.int(constant);
            return saucer.read(expr.name);
        }
        case 'UnaryExpression':
            return processUnaryExpression(expr, ctx, saucer);
        case 'BinaryExpression':
            return processBinaryExpression(expr, ctx, saucer);
        case 'LogicalExpression':
            return processLogicalExpression(expr, ctx, saucer);
        case 'CallExpression':
            return processCallExpression(expr, ctx, saucer);
        case 'ArrayExpression':
            return processArrayExpression(expr, ctx, saucer);
        case 'ObjectExpression':
            return processObjectExpression(expr, ctx, saucer);
        case 'NewExpression':
            return processNewExpression(expr, ctx, saucer);
        case 'MemberExpression':
            return processMemberExpression(expr, ctx, saucer);
        case 'TaggedTemplateExpression':
            return processTaggedTemplateExpression(expr, ctx, saucer);
        case 'ConditionalExpression':
            throw new Error('ternary must be used directly in an assignment');
        default:
            throw new Error(`not implemented: ${expr.type}`);
    }
}
