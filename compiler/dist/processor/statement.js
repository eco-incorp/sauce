import { isImmutablePackedArray, OPS } from '../saucer/index.js';
import { processExpression, processStatement } from './index.js';
import { applyBinaryOp, resolveContractCallTarget, emitRawContractCall, resolveCatchChain, abiDecodeTypeSpecs, } from './expression.js';
import { evalConstBool } from './const-eval.js';
import { assertCapability } from '../capabilities.js';
import { inferKindWithContext, inferElementTypeWithContext, inferStructTypeWithContext, getPropertyName, lookupStructType, getFieldIndex, abiOutputKind, } from './inference.js';
export function processVariableDeclaration(decl, ctx, saucer) {
    if (decl.kind === 'var') {
        throw new Error('var is not supported, use const or let');
    }
    return decl.declarations.reduce((acc, declarator) => {
        if (!declarator.init) {
            throw new Error('const declarations must be initialized');
        }
        if (declarator.id.type === 'ArrayPattern') {
            return processDestructuringDeclaration(declarator.id, declarator.init, ctx, acc);
        }
        if (declarator.id.type !== 'Identifier') {
            throw new Error(`not implemented: ${declarator.id.type}`);
        }
        return storeExpression(declarator.id.name, declarator.init, ctx, acc);
    }, saucer);
}
/**
 * `const [price, tick] = pool.slot0()` — ONE external call whose RAW returndata
 * lands in a hidden heap temp, then per bound element
 * `STORE(name, INDEX(ABI_DECODE(count, READ(temp), specs), i))`.
 *
 * The tuple descriptor is freshly derived by ABI_DECODE at every use and never
 * stored: a decoded tuple does not survive a variable round-trip on the deployed
 * (immutable) v1 engines — INDEX then faults with SauceInvalidOperationArgs —
 * while raw heap bytes round-trip fine (the same shape the catch parameter uses).
 * The in-engine re-decode per element is negligible next to the ~2.6K-gas
 * staticcall it replaces; on the v12 EVM target, elementary-static components
 * skip even that via a zero-copy `CAST_BE(SLICE(temp, k*32 + (32-N), N))` word
 * extraction (see the fast-path notes below).
 */
function processDestructuringDeclaration(pattern, init, ctx, saucer) {
    // Fail with a destructuring-specific message on svm: the generic binding
    // error suggests contract.call(...), which cannot be destructured either.
    assertCapability(ctx, 'array destructuring', pattern);
    if (init.type === 'CallExpression' && resolveCatchChain(init)) {
        throw new Error('cannot destructure a .catch() chain — a catch handler cannot capture call outputs; destructure the bare call instead');
    }
    const target = resolveContractCallTarget(init, ctx);
    if (!target) {
        throw new Error('array destructuring requires a contract method call initializer, e.g. const [a, b] = Pool.at(addr).slot0()');
    }
    const label = `${target.contract.name}.${target.methodName}()`;
    const outputs = target.method.outputs ?? [];
    if (outputs.length === 0) {
        throw new Error(`cannot destructure ${label}: it returns no outputs`);
    }
    if (pattern.elements.length > outputs.length) {
        throw new Error(`cannot destructure ${outputs.length} output(s) of ${label} into ${pattern.elements.length} element(s)`);
    }
    const bindings = [];
    pattern.elements.forEach((element, index) => {
        if (!element)
            return; // hole (`const [, tick] = …`) — skip this output
        if (element.type === 'RestElement') {
            throw new Error('not implemented: rest element in array destructuring');
        }
        if (element.type !== 'Identifier') {
            throw new Error(`not implemented: ${element.type} in array destructuring`);
        }
        const output = outputs[index];
        if (output.type === 'tuple') {
            throw new Error(`cannot destructure output ${index}${output.name ? ` ('${output.name}')` : ''} of ${label}: ` +
                `a nested tuple cannot be stored in a variable — leave a hole and read its fields via chained ` +
                `indexing (…${target.methodName}(…)[${index}][j])`);
        }
        bindings.push({ name: element.name, index });
    });
    // Derived once for the whole tuple (throws on unsupported ABI output types
    // exactly like a normally-decoded call would), regardless of which lowering
    // each binding takes — so unsupported outputs are rejected identically.
    const typeSpecs = abiDecodeTypeSpecs(outputs);
    // v12 EVM fast path precondition: every component must occupy exactly ONE
    // 32-byte head word for `index * 32` to address word k. Elementary statics and
    // dynamic components (bytes/string/T[]/tuple[] — one offset word) all do; an
    // ALL-STATIC nested tuple is INLINED in the head (multiple words) and shifts
    // everything after it, so any 'tuple' output (bindable ones are already
    // rejected above — this guards holes over them) disables the fast path for
    // the whole statement. Gate is target === 'v12' exactly: 'svm' is also a v12
    // dialect (ctx.isV12) but its SLICE/CAST_BE handlers are unvalidated ports —
    // it keeps the portable decode lowering.
    const headWordsKnown = outputs.every((output) => output.type !== 'tuple');
    const fastPath = ctx.target === 'v12' && headWordsKnown;
    // The one external call. Emitted even when every element is a hole — the call
    // may have side effects. `#tmpN` cannot collide with a parsed identifier.
    const temp = ctx.freshTemp('dynamic');
    let result = saucer.store(temp, emitRawContractCall(target, ctx), 'dynamic');
    for (const { name, index } of bindings) {
        const output = outputs[index];
        // The compiler has no block scope for if-bodies, so a destructured name
        // that already exists resolves to the EXISTING variable — and store() uses
        // ITS kind, silently discarding the component's. For a dynamic component
        // landing in a scalar slot that drops the heap descriptor (the exact fault
        // class this lowering exists to avoid), so reject the mismatch instead of
        // miscompiling. A matching kind reassigns, like a plain const would.
        const existing = ctx.getVar(name);
        const kind = abiOutputKind(output);
        if (existing && !existing.isParam && existing.kind !== kind) {
            throw new Error(`cannot destructure output ${index}${output.name ? ` ('${output.name}')` : ''} of ${label} into ` +
                `existing ${existing.kind} variable '${name}' (needs a ${kind} slot) — use a fresh name`);
        }
        const width = fastPath ? elementaryStaticWidth(output) : undefined;
        // v12, elementary-static component: zero-copy word extraction. SLICE on the
        // raw-returndata descriptor is pointer arithmetic (no copy) and CAST_BE
        // right-aligns the low N bytes of head word k — bit-identical to what the
        // engine's ABI_DECODE ad_scalar mask produces (including negative signed
        // intN: the byte-precise slice performs the masking geometrically), without
        // re-materializing the whole decoded tuple per element.
        const value = width
            ? ctx.newSaucer().castBe(ctx
                .newSaucer()
                .slice(ctx.newSaucer().read(temp), ctx.newSaucer().int(BigInt(index * 32 + (32 - width))), ctx.newSaucer().int(BigInt(width))))
            : ctx
                .newSaucer()
                .index(ctx.newSaucer().abiDecode(outputs.length, ctx.newSaucer().read(temp), typeSpecs), ctx.newSaucer().int(BigInt(index)));
        result = result.store(name, value, kind, destructuredElementType(output));
        // A destructured element is a single decoded component, never a raw
        // multi-output word — clear any stale tag on a reused name.
        const bound = ctx.getVar(name);
        if (bound)
            bound.multiOutputCall = undefined;
    }
    return result;
}
/**
 * Byte width of an elementary static ABI component (uintN/intN/address/bool), or
 * undefined for anything else. Uses the decode spec map as the source of truth:
 * elementary statics resolve to a single BYTE_1..BYTE_32 spec whose offset from
 * BYTE_1 is the width; bytes/string/arrays resolve to other/longer specs.
 * (bytesN and fixed-size arrays never reach this — abiDecodeTypeSpecs already
 * rejects them for the whole statement.)
 */
function elementaryStaticWidth(output) {
    const spec = abiDecodeTypeSpecs([output]);
    if (spec.length !== 1 || spec[0] < OPS.BYTE_1 || spec[0] > OPS.BYTE_32)
        return undefined;
    return spec[0] - OPS.BYTE_1 + 1;
}
/**
 * Element type for a destructured array component, so later `name[i]` reads infer
 * the right kind. Only the top level is resolved; deeper nesting stays dynamic
 * (safe — heap values round-trip).
 */
function destructuredElementType(output) {
    if (!output.type.endsWith('[]'))
        return undefined;
    const inner = output.type.slice(0, -2);
    if (inner.endsWith(']') || inner === 'tuple' || inner === 'bytes' || inner === 'string') {
        return { kind: 'dynamic' };
    }
    return { kind: 'scalar' };
}
export function processIfStatement(stmt, ctx, saucer) {
    // Conditional compilation: when folding is enabled and the test folds to a known
    // boolean, emit ONLY the taken branch (and recurse into an `else if` chain). This
    // mirrors collectCalls() EXACTLY (same evalConstBool prune, nothing else), so the
    // CALL targets the emitter emits == the set treeshake walks — every emitted call
    // therefore targets a registered function.
    if (ctx.foldEnabled) {
        const taken = evalConstBool(stmt.test, ctx);
        if (taken === true)
            return saucer.join(processBlock(stmt.consequent, ctx));
        if (taken === false) {
            if (!stmt.alternate)
                return saucer;
            return stmt.alternate.type === 'IfStatement'
                ? processIfStatement(stmt.alternate, ctx, saucer)
                : saucer.join(processBlock(stmt.alternate, ctx));
        }
    }
    const condition = processExpression(stmt.test, ctx);
    const thenBody = processBlock(stmt.consequent, ctx);
    if (!stmt.alternate) {
        return saucer.if(condition).then(thenBody);
    }
    const elseBody = stmt.alternate.type === 'IfStatement'
        ? processIfStatement(stmt.alternate, ctx, ctx.newSaucer())
        : processBlock(stmt.alternate, ctx);
    return saucer.if(condition).then(thenBody).else(elseBody);
}
export function processBlock(node, ctx) {
    if (node.type === 'BlockStatement') {
        return node.body.reduce((saucer, stmt) => processStatement(stmt, ctx, saucer), ctx.newSaucer());
    }
    return processStatement(node, ctx, ctx.newSaucer());
}
export function processForStatement(stmt, ctx, saucer) {
    ctx.pushScope();
    const init = stmt.init
        ? stmt.init.type === 'VariableDeclaration'
            ? processVariableDeclaration(stmt.init, ctx, ctx.newSaucer())
            : processMutation(stmt.init, ctx, ctx.newSaucer())
        : undefined;
    const condition = stmt.test ? processExpression(stmt.test, ctx) : undefined;
    ctx.pushLoop();
    const body = processBlock(stmt.body, ctx);
    const update = stmt.update ? processMutation(stmt.update, ctx, ctx.newSaucer()) : undefined;
    ctx.popLoop();
    ctx.popScope();
    return saucer.for(init, condition, update).loop(body);
}
export function processWhileStatement(stmt, ctx, saucer) {
    const condition = processExpression(stmt.test, ctx);
    ctx.pushLoop();
    const body = processBlock(stmt.body, ctx);
    ctx.popLoop();
    return saucer.while(condition).loop(body);
}
export function storeExpression(name, expr, ctx, saucer) {
    switch (expr.type) {
        case 'ConditionalExpression':
            return processTernaryStore(name, expr, ctx, saucer);
        case 'UpdateExpression':
            return processUpdateStore(name, expr, ctx, saucer);
        default: {
            const value = processExpression(expr, ctx);
            const kind = singleDynamicAbiOutputKind(expr, ctx) ?? inferKindWithContext(expr, ctx);
            rejectV1ScalarToDynamicReassignment(name, kind, ctx);
            const result = saucer.store(name, value, kind, inferElementTypeWithContext(expr, ctx), inferStructTypeWithContext(expr, ctx));
            // Track whether the variable now holds an immutable packed array literal, so
            // a later `name[i] = x` can be rejected before it reverts on the engine.
            const variable = ctx.getVar(name);
            if (variable) {
                variable.immutablePacked = isImmutablePackedArray(value._bytes);
                // Metadata only (bytes above are untouched): on v1, remember that the
                // variable was assigned a multi-output call result INTO A SCALAR SLOT —
                // a later indexed read of it would fault INDEX at runtime, so it is
                // rejected at compile time (processIndexAccess) with a pointer at
                // destructuring. A DYNAMIC-kind destination is exempt: the heap
                // round-trip preserves the decoded tuple on v1 (same mechanism as the
                // new-Array dynamic-kind fix — runtime-verified), so `let s = [0, 0];
                // s = pool.slot0(); s[1]` keeps working. Cleared on any other
                // assignment so a reassigned variable indexes normally again; an
                // Identifier initializer PROPAGATES the source tag (`const t = s`
                // copies the descriptor-less word, so `t[k]` faults exactly like
                // `s[k]`). Known over-approximation: the tag is flow-insensitive — a
                // store inside an if-branch taints reads on the untaken path (the
                // sibling clear on the other branch restores it in the else-form).
                // Known holes (pre-existing fault class, still compile): a
                // single-multi-output-branch ternary, and passing the tagged word into
                // a helper function.
                variable.multiOutputCall = multiOutputCallOutputs(expr, ctx, variable);
            }
            ctx.consumePendingContractBinding(name);
            return result;
        }
    }
}
// The ABI outputs to tag `variable` with after storing `expr` into it, or
// undefined (clear). Only a SCALAR destination is ever tagged — see the comment
// at the call site in storeExpression.
function multiOutputCallOutputs(expr, ctx, variable) {
    if (ctx.isV12 || variable.kind !== 'scalar')
        return undefined;
    if (expr.type === 'Identifier') {
        return ctx.getVar(expr.name)?.multiOutputCall;
    }
    if (expr.type !== 'CallExpression' || resolveCatchChain(expr))
        return undefined;
    // Pure probe — resolveContractCallTarget emits nothing (addr is lazy).
    const target = resolveContractCallTarget(expr, ctx);
    return target && (target.method.outputs?.length ?? 0) > 1 ? target.method.outputs : undefined;
}
/**
 * A direct external contract-method call with a SINGLE, non-destructured dynamic ABI
 * output stored straight into a variable (`let xs = List.at(addr).list();` where
 * `list()` returns e.g. `uint256[]`) — a THIRD instance of the return-kind
 * under-classification bug family (see CLAUDE.md's "Same-file user-function
 * return-kind inference" note for the first two): `inferKindWithContext`'s
 * CallExpression case only special-cases a SAME-FILE user function's own analyzed
 * return kind; a direct contract-method call falls through to the ctx-free
 * `inferKind`, whose generic CallExpression case has no notion of a contract call at
 * all and defaults to 'scalar' — dropping the descriptor on v1 exactly like the
 * already-fixed shapes (a later indexed read/write faults SauceInvalidOperationArgs).
 *
 * Returns undefined (never 'scalar') so a caller composes it as an override ONLY when
 * the call resolves to a genuinely single dynamic output — anything else (no
 * resolvable target, multi-output, a resolvable-but-scalar output, a `.catch()`
 * chain — mirroring `multiOutputCallOutputs`'s own exclusion just above) falls
 * through unchanged to the existing `inferKindWithContext`/`inferKind` chain.
 */
function singleDynamicAbiOutputKind(expr, ctx) {
    if (expr.type !== 'CallExpression' || resolveCatchChain(expr))
        return undefined;
    const target = resolveContractCallTarget(expr, ctx);
    const outputs = target?.method.outputs;
    if (!outputs || outputs.length !== 1)
        return undefined;
    return abiOutputKind(outputs[0]) === 'dynamic' ? 'dynamic' : undefined;
}
/**
 * v1 cannot re-class an ALREADY-declared slot: `Saucer.store` (saucer.ts) always
 * uses the EXISTING variable's OWN tracked kind once `ctx.getVar(name)` finds one,
 * silently ignoring whatever `kind` THIS store computes — so assigning a
 * provably-dynamic value into a variable first declared scalar (`let x = 5n; x =
 * arr;`, or the analogous `if (cond) { x = arr; }`) would drop the value's
 * TUPLE/heap descriptor at runtime (a later indexed read/write faults
 * `SauceInvalidOperationArgs`) rather than fail loudly at compile time. Reject it
 * here instead, mirroring this file's other "can't repair it, so refuse it"
 * guards (`processMemberAssignment`'s `multiOutputCall`/`immutablePacked` checks
 * just below). v12/svm are unaffected and therefore exempt: `V12Saucer.store`
 * derives the real storage kind straight from `value.isDynamic`, never from an
 * existing variable's stale tag, so no descriptor is ever at risk there — see
 * CLAUDE.md's "Same-file user-function return-kind inference" note.
 */
function rejectV1ScalarToDynamicReassignment(name, kind, ctx) {
    const existing = ctx.getVar(name);
    if (!ctx.isV12 && existing && existing.kind === 'scalar' && kind === 'dynamic') {
        throw new Error(`cannot assign a dynamic value to '${name}': it was first declared as a scalar variable and the v1 ` +
            `engine cannot re-class a slot after declaration — give '${name}' a dynamic value (e.g. an array or a ` +
            `dynamic contract-call result) on its FIRST assignment instead`);
    }
}
function processTernaryStore(name, expr, ctx, saucer) {
    // Conditional compilation (mirrors processIfStatement / collectCalls): a const-known
    // test stores ONLY the taken side, so a guarded handler call in the untaken side is
    // never emitted (and treeshake then drops it).
    if (ctx.foldEnabled) {
        const taken = evalConstBool(expr.test, ctx);
        if (taken !== undefined)
            return storeExpression(name, taken ? expr.consequent : expr.alternate, ctx, saucer);
    }
    const condition = processExpression(expr.test, ctx);
    const consequent = processExpression(expr.consequent, ctx);
    const alternate = processExpression(expr.alternate, ctx);
    // A ternary stored directly (first declaration OR a plain reassignment) needs the
    // SAME dynamic-kind PROMOTION the sibling return-kind/aliasing/single-output fixes
    // already apply elsewhere in this bug family (see CLAUDE.md's "Same-file
    // user-function return-kind inference" note): v1's scalar (WRITE_VALUE) slot
    // storage silently drops a dynamic value's TUPLE/heap descriptor, so EITHER branch
    // resolving dynamic must promote the WHOLE variable to dynamic storage — the sound
    // direction (storing a scalar in a HEAP slot round-trips fine — the same rule the
    // mixed-return-function analysis in return-kind.ts already relies on), never a
    // mis-classification the other way. This must live HERE, not in
    // `inferKindWithContext`: `storeExpression`'s switch routes a `ConditionalExpression`
    // to THIS function directly, bypassing `inferKindWithContext` entirely — a case
    // added there would simply never be consulted for a ternary declaration/assignment.
    //
    // ADVERSARIAL-AUDIT FIX (this branch): each branch ALSO tries `singleDynamicAbiOutputKind`
    // first, exactly mirroring the plain (non-ternary) store path a few lines above
    // (`storeExpression`'s default branch: `singleDynamicAbiOutputKind(expr, ctx) ??
    // inferKindWithContext(expr, ctx)`). `inferKindWithContext` alone has NO notion of a direct
    // external contract call (`Contract.at(addr).method()`) with a single dynamic ABI output —
    // only a same-file user function's own analyzed return kind — so a ternary branch that is
    // itself such a call (`let x = cond ? List.at(addr).list() : 0n;` where `list()` returns
    // `uint256[]`) was always classified 'scalar' here, even though the IDENTICAL call shape
    // outside a ternary already correctly infers 'dynamic'. Confirmed via real EVM execution:
    // this compiled cleanly and reverted `SauceInvalidOperationArgs(0x97)` (INDEX) on the caller's
    // indexed read whenever the dynamic branch was taken — see
    // `integration-test/dynamic-kind-sweep.test.ts`'s "ternary branchKind" describe block.
    const consequentKind = singleDynamicAbiOutputKind(expr.consequent, ctx) ?? inferKindWithContext(expr.consequent, ctx);
    const alternateKind = singleDynamicAbiOutputKind(expr.alternate, ctx) ?? inferKindWithContext(expr.alternate, ctx);
    const branchKind = consequentKind === 'dynamic' || alternateKind === 'dynamic' ? 'dynamic' : 'scalar';
    // v1 can only apply that promotion on a FIRST declaration (Saucer.store lets the
    // passed kind decide when `ctx.getVar(name)` finds nothing yet) — a REASSIGNMENT of
    // an already-scalar variable can't be repaired the same way (see
    // `rejectV1ScalarToDynamicReassignment`'s own doc comment), so reject it instead of
    // silently miscompiling. v12/svm are unaffected (V12Saucer.store derives the real
    // kind from value.isDynamic itself, ignoring this parameter either way).
    rejectV1ScalarToDynamicReassignment(name, branchKind, ctx);
    const thenStore = ctx.newSaucer().store(name, consequent, branchKind);
    const elseStore = ctx.newSaucer().store(name, alternate, branchKind);
    // Recompute (don't leave stale): the variable is immutable-packed only if a
    // branch actually stores a packed array literal — clear it otherwise so a later
    // `name[i] = x` isn't wrongly rejected.
    const variable = ctx.getVar(name);
    if (variable) {
        variable.immutablePacked = isImmutablePackedArray(consequent._bytes) || isImmutablePackedArray(alternate._bytes);
        // Same recompute for the multi-output tag: a ternary reassignment must not
        // leave a stale tag from an earlier `s = pool.slot0()` (that rejected
        // previously-working programs). Tag only when BOTH branches are multi-output
        // calls into a scalar slot — then the indexed read faults on every path
        // (the guard's contract). A single multi-output branch stays untagged: the
        // other path may be perfectly indexable, and rejecting it would break
        // working code (documented hole — that branch still faults at runtime).
        const thenOutputs = multiOutputCallOutputs(expr.consequent, ctx, variable);
        const elseOutputs = multiOutputCallOutputs(expr.alternate, ctx, variable);
        variable.multiOutputCall = thenOutputs && elseOutputs ? thenOutputs : undefined;
    }
    return saucer.if(condition).then(thenStore).else(elseStore);
}
function processUpdateStore(name, expr, ctx, saucer) {
    if (expr.argument.type !== 'Identifier') {
        throw new Error(`not implemented: update on ${expr.argument.type}`);
    }
    const target = expr.argument.name;
    const s = ctx.newSaucer();
    const incremented = expr.operator === '++' ? s.add(s.read(target), s.int(1n)) : s.sub(s.read(target), s.int(1n));
    const assign = (saucer) => saucer.store(name, ctx.newSaucer().read(target));
    const update = (saucer) => saucer.store(target, incremented);
    const result = expr.prefix ? assign(update(saucer)) : update(assign(saucer));
    // An increment result is always a scalar, never a packed literal — clear any
    // stale flag from a prior array-literal assignment to `name`, and the
    // multi-output tag with it (the variable no longer holds a call result; a
    // later `name[k]` is the generic index-a-number fault, not this guard's).
    const variable = ctx.getVar(name);
    if (variable) {
        variable.immutablePacked = false;
        variable.multiOutputCall = undefined;
    }
    return result;
}
export function processMutation(expr, ctx, saucer) {
    switch (expr.type) {
        case 'UpdateExpression':
            return processUpdateMutation(expr, ctx, saucer);
        case 'AssignmentExpression':
            return processAssignmentMutation(expr, ctx, saucer);
        case 'CallExpression': {
            // Side-effect function calls (e.g. emit) can be used as statements. The
            // result is discarded, so drop it — on v12 a value-returning call would
            // otherwise leak onto the stack (dropIfUnused is a no-op on v1).
            return saucer.join(processExpression(expr, ctx).dropIfUnused());
        }
        default:
            throw new Error(`not implemented: ${expr.type} as statement`);
    }
}
function processUpdateMutation(expr, ctx, saucer) {
    if (expr.argument.type !== 'Identifier') {
        throw new Error(`not implemented: update on ${expr.argument.type}`);
    }
    const name = expr.argument.name;
    const s = ctx.newSaucer();
    const value = expr.operator === '++' ? s.add(s.read(name), s.int(1n)) : s.sub(s.read(name), s.int(1n));
    return saucer.store(name, value);
}
function processAssignmentMutation(expr, ctx, saucer) {
    if (expr.left.type === 'MemberExpression') {
        return processMemberAssignment(expr.left, expr, ctx, saucer);
    }
    if (expr.left.type !== 'Identifier') {
        throw new Error(`not implemented: assignment to ${expr.left.type}`);
    }
    const name = expr.left.name;
    if (expr.operator === '=')
        return storeExpression(name, expr.right, ctx, saucer);
    const s = ctx.newSaucer();
    const value = applyBinaryOp(s, expr.operator.slice(0, -1), s.read(name), processExpression(expr.right, ctx));
    return saucer.store(name, value);
}
// Element/field assignment: `arr[i] = x`, `obj.field = x` and their compound forms.
// Lowers to STORE(name, SET_INDEX(readArr, index, value)) (the saucer's read/store
// pick slot-memory vs stack-param access per target).
function processMemberAssignment(member, expr, ctx, saucer) {
    if (member.object.type !== 'Identifier') {
        throw new Error(`not implemented: assignment to ${member.object.type} member`);
    }
    const name = member.object.name;
    const target = ctx.getVar(name);
    if (!target)
        throw new Error(`undefined variable: ${name}`);
    // Same hazard as the indexed read (processIndexAccess): the stored value lost
    // its tuple descriptor on v1, so SET_INDEX faults at runtime — reject early.
    if (target.multiOutputCall) {
        throw new Error(`cannot assign to a component of '${name}': a multi-output call result stored in a variable loses its ` +
            `tuple on the v1 engine — destructure the call instead: const [a, b] = …`);
    }
    // A static packed array literal is immutable — the engine reverts SET_INDEX on
    // it. Reject element assignment at compile time and point at the mutable path.
    if (target.immutablePacked) {
        throw new Error(`cannot assign to an element of '${name}': array literals are immutable (packed); ` +
            `create a mutable array with new Array(n) instead`);
    }
    // Simple assignment: the index feeds only the SET_INDEX write, so there is no
    // reuse hazard — compute it once and store.
    if (expr.operator === '=') {
        const index = resolveMemberIndex(member, ctx);
        return saucer.store(name, ctx.newSaucer().setIndex(ctx.newSaucer().read(name), index, processExpression(expr.right, ctx)));
    }
    // Compound assignment (`+=`, `-=`, …): the index feeds BOTH the INDEX read and
    // the SET_INDEX write. A builder node emits its bytecode wherever it is reused,
    // so a side-effecting computed index (`arr[f()] += 1`) would execute twice.
    // Hoist a non-pure computed index into a scratch local so it runs exactly once.
    const op = expr.operator.slice(0, -1);
    if (member.computed && !isPureIndex(member.property)) {
        const tmp = ctx.freshTemp();
        const withIndex = saucer.store(tmp, processExpression(member.property, ctx));
        const current = ctx.newSaucer().index(ctx.newSaucer().read(name), ctx.newSaucer().read(tmp));
        const value = applyBinaryOp(ctx.newSaucer(), op, current, processExpression(expr.right, ctx));
        return withIndex.store(name, ctx.newSaucer().setIndex(ctx.newSaucer().read(name), ctx.newSaucer().read(tmp), value));
    }
    // Pure computed index (identifier / literal / arithmetic) or struct field: the
    // index is side-effect-free and idempotent, so reusing the node is safe and
    // keeps the common-case bytecode minimal.
    const readArr = ctx.newSaucer().read(name);
    const index = resolveMemberIndex(member, ctx);
    const current = ctx.newSaucer().index(readArr, index);
    const value = applyBinaryOp(ctx.newSaucer(), op, current, processExpression(expr.right, ctx));
    return saucer.store(name, ctx.newSaucer().setIndex(readArr, index, value));
}
// Whether an index expression is safe to emit more than once: no observable side
// effects and idempotent. Conservative — only literals, variable reads and pure
// arithmetic of those qualify; calls, `new`, member reads and anything unknown
// fall through to false and get hoisted into a temp.
function isPureIndex(node) {
    switch (node.type) {
        case 'Literal':
        case 'Identifier':
            return true;
        case 'BinaryExpression':
            return isPureIndex(node.left) && isPureIndex(node.right);
        default:
            return false;
    }
}
// The index for a member assignment: computed `arr[i]` → the property expression;
// field `obj.field` → the field's slot looked up from the object's known shape.
function resolveMemberIndex(member, ctx) {
    if (member.computed)
        return processExpression(member.property, ctx);
    const field = getPropertyName(member);
    if (!field)
        throw new Error('unsupported member assignment target');
    const structType = lookupStructType(member, ctx);
    if (!structType)
        throw new Error(`property '${field}' assignment not supported, use array indexing arr[i]`);
    return ctx.newSaucer().int(BigInt(getFieldIndex(structType, field)));
}
