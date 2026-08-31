import type { Statement, VariableDeclaration, Expression, IfStatement, ForStatement, WhileStatement } from 'acorn';
import type { SaucerLike } from '../saucer/index.js';
import type { CompilerContext } from '../context.js';
export declare function processVariableDeclaration(decl: VariableDeclaration, ctx: CompilerContext, saucer: SaucerLike): SaucerLike;
export declare function processIfStatement(stmt: IfStatement, ctx: CompilerContext, saucer: SaucerLike): SaucerLike;
export declare function processBlock(node: Statement, ctx: CompilerContext): SaucerLike;
export declare function processForStatement(stmt: ForStatement, ctx: CompilerContext, saucer: SaucerLike): SaucerLike;
export declare function processWhileStatement(stmt: WhileStatement, ctx: CompilerContext, saucer: SaucerLike): SaucerLike;
export declare function storeExpression(name: string, expr: Expression, ctx: CompilerContext, saucer: SaucerLike): SaucerLike;
export declare function processMutation(expr: Expression, ctx: CompilerContext, saucer: SaucerLike): SaucerLike;
//# sourceMappingURL=statement.d.ts.map