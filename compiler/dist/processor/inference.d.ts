import type { Expression, CallExpression, MemberExpression, ArrayExpression, ObjectExpression, Property } from 'acorn';
import type { CompilerContext, VariableKind, ElementType, StructType } from '../context.js';
import type { AbiParameter } from '../contracts.js';
export declare const resolveStaticMethod: (expr: CallExpression) => [string, string] | undefined;
export declare const resolveInstanceMethod: (expr: CallExpression) => {
    method: string;
    object: Expression;
} | undefined;
export declare const inferKind: (expr: Expression) => VariableKind;
export declare const inferElementType: (expr: ArrayExpression) => ElementType;
export declare const lookupIndexedElementType: (expr: MemberExpression, ctx: CompilerContext) => ElementType | undefined;
export declare const getPropertyName: (expr: MemberExpression) => string | undefined;
export declare const getPropertyKey: (prop: Property) => string;
export declare const extractSortedProperties: (expr: ObjectExpression) => {
    key: string;
    value: Expression;
}[];
export declare const extractStructType: (expr: ObjectExpression) => StructType;
export declare const lookupStructType: (expr: MemberExpression, ctx: CompilerContext) => StructType | undefined;
export declare const getFieldIndex: (structType: StructType, field: string) => number;
export declare const getExprStructType: (expr: Expression, ctx: CompilerContext) => StructType | undefined;
/**
 * Storage kind of one ABI output component once it is INDEXed out of a decoded
 * tuple: an elementary static (uintN/intN/address/bool/bytesN) is a scalar word;
 * bytes/string/arrays/tuples are heap values. Used by the multi-output-call
 * lowerings (destructuring, raw shape-B reads) to pick the store kind per element.
 */
export declare const abiOutputKind: (param: AbiParameter) => VariableKind;
export declare const inferKindWithContext: (expr: Expression, ctx: CompilerContext) => VariableKind;
export declare const inferElementTypeWithContext: (expr: Expression, ctx: CompilerContext) => ElementType | undefined;
export declare const inferStructTypeWithContext: (expr: Expression, ctx: CompilerContext) => StructType | undefined;
//# sourceMappingURL=inference.d.ts.map