import type { ArrayExpression, NewExpression, CallExpression, ObjectExpression } from 'acorn';
import type { SaucerLike } from '../saucer/index.js';
import type { CompilerContext } from '../context.js';
export declare const processArrayExpression: (expr: ArrayExpression, ctx: CompilerContext, saucer: SaucerLike, forcedWidth?: number) => SaucerLike;
export declare const processObjectExpression: (expr: ObjectExpression, ctx: CompilerContext, saucer: SaucerLike) => SaucerLike;
export declare const processUint8Array: (expr: NewExpression | CallExpression, saucer: SaucerLike) => SaucerLike;
//# sourceMappingURL=collection.d.ts.map