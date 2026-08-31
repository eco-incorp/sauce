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
        const mod = ctx.resolveModuleSource(source, importerDir);
        if (!mod) {
            // No source file resolves → a `.json` contract ABI import.
            processImportDeclaration(stmt, ctx, importerDir);
            continue;
        }
        // Dedup on the NEUTRAL identity (`mod.dedupKey`, when an arm won) rather than the file
        // actually read, so cross-module dedup stays arm-agnostic — a shared module imported by
        // two parents is pulled once regardless of which arm each import resolved to.
        const dedupKey = mod.dedupKey ?? mod.filePath;
        if (visited.has(dedupKey))
            continue; // shared module already pulled
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
    }
    return out;
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
function registerTopLevelConsts(program, ctx) {
    for (const stmt of program.body) {
        const decl = stmt.type === 'VariableDeclaration'
            ? stmt
            : stmt.type === 'ExportNamedDeclaration' &&
                stmt.declaration?.type === 'VariableDeclaration'
                ? stmt.declaration
                : undefined;
        if (!decl || decl.kind !== 'const')
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
