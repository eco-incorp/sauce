import type { Node } from 'acorn';
import type { CompilerContext } from '../context.js';
/** Pure compile-time value of an expression, or undefined if not statically known. */
export declare function evalConst(node: Node | null | undefined, ctx: CompilerContext): bigint | undefined;
/** Boolean view of a foldable condition: undefined if not statically known. */
export declare function evalConstBool(node: Node | null | undefined, ctx: CompilerContext): boolean | undefined;
//# sourceMappingURL=const-eval.d.ts.map