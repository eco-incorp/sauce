import { OPS } from '../saucer/index.js';
import { processExpression } from './index.js';
import { extractSortedProperties, extractStructType } from './inference.js';
const assertValidArrayElement = (el) => {
    if (!el)
        throw new Error('sparse arrays are not supported');
    if (el.type === 'SpreadElement')
        throw new Error('spread elements in arrays are not supported');
    return el;
};
const assertConsistentStructFields = (elements) => {
    const objects = elements.filter((el) => el.type === 'ObjectExpression');
    if (objects.length === 0)
        return;
    const getFields = (obj) => extractStructType(obj).fields.join(',');
    const firstFields = getFields(objects[0]);
    const mismatch = objects.find((obj) => getFields(obj) !== firstFields);
    if (mismatch)
        throw new Error('array elements must have consistent struct fields');
};
// A NESTED array literal (`[[1n, 2n], [3n, 4n]]`) compiles and executes correctly
// on v1 (direct, aliased, or returned from a helper — elementType/kind inference
// already handles it), but on v12/svm the engine-v12/svm runtimes have no
// nested-ARRAY encoding yet: every one of the same shapes fails there (an empty
// revert on v12, InvalidInstructionData on svm) — a pre-existing engine-side
// feature gap, not a kind-inference bug (a FLAT literal, and a nested structure
// built with `new Array(n)`, both work fine on v12/svm). Reject it at compile
// time on those targets instead of letting it fail opaquely at runtime.
const assertNoNestedArrayLiteral = (elements, ctx) => {
    if (!ctx.isV12)
        return;
    if (elements.some((el) => el.type === 'ArrayExpression')) {
        throw new Error(`nested array literals (e.g. [[1, 2], [3, 4]]) are not supported on target '${ctx.target}' — the ` +
            `engine-v12 runtime has no nested-ARRAY encoding yet (a v1-only capability today); build the nested ` +
            `structure with new Array(n) instead (e.g. \`let outer = new Array(2); outer[0] = inner;\`), which is ` +
            `supported on every target`);
    }
};
export const processArrayExpression = (expr, ctx, saucer, forcedWidth) => {
    const elements = expr.elements.map(assertValidArrayElement);
    assertConsistentStructFields(elements);
    assertNoNestedArrayLiteral(elements, ctx);
    return saucer.array(elements.map((el) => processExpression(el, ctx)), forcedWidth);
};
// An object-literal field whose PROCESSED value is a BARE read of an EXISTING
// dynamic-kind variable (`inner`, a `new Array(n)` TUPLE local; an aliased dynamic
// local; a single-dynamic-ABI-output contract-call result stored in a variable; …).
// `saucer.tuple()` (`encodeTuple`, saucer/tuple.ts) just concatenates each element's raw
// bytes verbatim with no ABI-style boxing at all — unlike `processArrayExpression`/
// `encodeArray`, which at least REJECTS a mismatched static/dynamic element mix outright (see
// `assertConsistentStructFields`/array.ts's own `allStatic`/`allDynamic` check), an object
// literal had NO equivalent guard whatsoever. Confirmed via real execution on BOTH v1 (anvil +
// deployed Sauce.sol) AND v12 (the real Huff runtime, engine-v12/test/V12-execparity): reading
// the field back afterward silently returns a raw internal heap-descriptor/pointer artifact —
// not the real data, not any recognizable ABI encoding, and not even the SAME wrong value
// shape as the (separately fixed) `new Array(n)`-TUPLE-return leak, so there is no salvageable
// meaning to hand back to a caller. A DIRECTLY-CONSTRUCTED dynamic value at the property
// position — a string/array literal, a `.concat()`/`.slice()` call, a NESTED object literal
// (recursed into, not flagged here — `processExpression` routes it back through this same
// function, so a nested dynamic-variable-read violation is still caught, just one level down)
// — is NOT rejected: all confirmed via the SAME real-execution proof to round-trip correctly
// on both targets, since each allocates its OWN FRESH dynamic value at that exact point rather
// than re-embedding an EXISTING heap descriptor from elsewhere.
//
// A bare dynamic-variable READ_HEAP is always EXACTLY 2 bytes on EITHER encoding
// direction — `[READ_HEAP, slot]` — since a slot index is always a single byte
// (`context.ts`'s own "slot indices are 1 byte" invariant): v1's prefix `Saucer.read()`
// (`encodeHeapRead`, saucer/memory.ts) emits precisely those 2 bytes, and so does
// v12/svm's postfix `V12Saucer.read()` (saucer/saucer-v12.ts). The `_bytes.length === 2`
// check below matters ONLY on the postfix targets: a scalar-PRODUCING postfix operator
// applied directly to a dynamic base (`arr.length`, `keccak256(arr)` — both route through
// `V12Saucer.unary()`) APPENDS its own opcode AFTER the base's bytes
// (`concat(this._bytes, operand._bytes, [op])`), so the base's READ_HEAP is still the
// LEADING byte even though the overall expression (`isDynamic: false`) is a genuine
// scalar — e.g. `arr.length` emits `[READ_HEAP, slot, LENGTH]` (3 bytes), which the
// bytes[0]-only check wrongly rejected as a false positive on v12/svm. On v1's PREFIX
// encoding this can never happen at all (an outer operator's opcode is always the FIRST
// byte — `arr.length` there emits `[LENGTH, READ_HEAP, slot]`, bytes[0] === LENGTH), so
// requiring `length === 2` is a no-op on v1: it only ever narrows what was ALREADY
// exactly a bare 2-byte read, never excludes a shape v1 used to (correctly) reject.
const assertNoDynamicVariableObjectField = (properties, processed) => {
    properties.forEach((p, i) => {
        const bytes = processed[i]._bytes;
        if (bytes.length === 2 && bytes[0] === OPS.READ_HEAP) {
            throw new Error(`object literal field '${p.key}' reads an existing dynamic-kind variable (an array, a new Array(n) ` +
                `heap TUPLE, or another already-stored dynamic value) directly into a struct field — this is not ` +
                `supported (the field silently returns a raw internal heap-descriptor artifact instead of the real ` +
                `data, on both v1 and v12/svm); construct the dynamic value directly inline in the object literal ` +
                `instead (e.g. a string/array literal, or a fresh .concat()/.slice() call), or keep '${p.key}' in its ` +
                `own separate variable rather than nesting it inside an object literal`);
        }
    });
};
export const processObjectExpression = (expr, ctx, saucer) => {
    const sorted = extractSortedProperties(expr);
    const elements = sorted.map((p) => processExpression(p.value, ctx));
    assertNoDynamicVariableObjectField(sorted, elements);
    return saucer.tuple(elements);
};
const isValidByte = (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
const extractByteLiteral = (el) => {
    if (!el || el.type !== 'Literal')
        throw new Error('Uint8Array elements must be number literals');
    const lit = el;
    if (!isValidByte(lit.value))
        throw new Error('Uint8Array elements must be integers 0-255');
    return lit.value;
};
const extractUint8ArrayArg = (expr) => {
    if (expr.arguments.length !== 1)
        throw new Error('Uint8Array expects exactly 1 argument');
    const arg = expr.arguments[0];
    if (arg.type !== 'ArrayExpression')
        throw new Error('Uint8Array expects an array literal');
    return arg;
};
export const processUint8Array = (expr, saucer) => {
    const arrayExpr = extractUint8ArrayArg(expr);
    const bytes = new Uint8Array(arrayExpr.elements.map(extractByteLiteral));
    return saucer.bytes(bytes);
};
