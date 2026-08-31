import type { Node, Statement, Expression } from 'acorn';
import type { SaucerLike } from '../saucer/index.js';
import { CompilerContext } from '../context.js';
export declare function processNode(node: Node, ctx: CompilerContext): SaucerLike[];
export declare function eachChild(node: Node, visit: (child: Node) => void): void;
export declare function processStatement(stmt: Statement, ctx: CompilerContext, saucer: SaucerLike): SaucerLike;
export declare function processExpression(expr: Expression, ctx: CompilerContext): SaucerLike;
//# sourceMappingURL=index.d.ts.map