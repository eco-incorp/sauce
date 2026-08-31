import type { Expression, Literal, UnaryExpression, BinaryExpression, LogicalExpression, CallExpression, MemberExpression, NewExpression, Statement, TaggedTemplateExpression } from 'acorn';
import type { SaucerLike } from '../saucer/index.js';
import type { AbiParameter, ContractInfo, MethodInfo } from '../contracts.js';
import type { CompilerContext } from '../context.js';
export declare function processLiteral(literal: Literal, saucer: SaucerLike): SaucerLike;
export declare function literalToInt(literal: Literal): bigint;
export declare function isLiteralZero(expr: Expression): boolean;
export declare function processUnaryExpression(expr: UnaryExpression, ctx: CompilerContext, saucer: SaucerLike): SaucerLike;
export declare function applyBinaryOp(saucer: SaucerLike, op: string, left: SaucerLike, right: SaucerLike): SaucerLike;
export declare function processBinaryExpression(expr: BinaryExpression, ctx: CompilerContext, saucer: SaucerLike): SaucerLike;
/**
 * A contract-method call resolved WITHOUT emitting anything — the two typed
 * shapes (inline `X.at(a).m(...)` chain, variable-bound `pool.m(...)`) plus the
 * method's ABI, with the address emission deferred behind `addr()`. Lets the
 * multi-output lowerings (array destructuring, raw shape-B stores) inspect
 * `method.outputs` cheaply and only emit the call when they take the statement.
 */
export interface ContractCallTarget {
    contract: ContractInfo;
    methodName: string;
    method: MethodInfo;
    callTypeOverride?: 'static' | 'delegate';
    addr: () => SaucerLike;
    args: Expression[];
}
export declare function resolveContractCallTarget(expr: Expression, ctx: CompilerContext): ContractCallTarget | undefined;
/** Emit a resolved contract call WITHOUT output decoding — the raw returndata value. */
export declare function emitRawContractCall(target: ContractCallTarget, ctx: CompilerContext): SaucerLike;
interface CatchChainInfo {
    innerCall: CallExpression;
    handlerBody: Statement;
    paramName?: string;
}
export declare function resolveCatchChain(expr: CallExpression): CatchChainInfo | undefined;
/**
 * Shape-only match for a standalone contract binding (`Contract.at(addr)` / `.view(addr)` /
 * `.lib(addr)`) — the SAME shape `resolveStandaloneBinding` above recognizes, but without
 * touching `ctx` at all (no `setPendingContractBinding`, no argument emission). Exists purely
 * so `analyzeFunctionReturnKinds`'s fixpoint pre-pass (`processor/return-kind.ts`) can track a
 * `let pool = Contract.at(addr);` declaration's contract binding INSIDE its own, pass-local
 * bookkeeping — that pass runs against the bare module-level `ctx` strictly BEFORE any function
 * body is actually compiled, so it must never call the real, side-effecting
 * `setPendingContractBinding`/`consumePendingContractBinding` pair (that would corrupt the
 * `ctx.boundContracts` state the REAL compile pass depends on afterward). The caller looks the
 * contract name up via `ctx.lookupContract` itself (read-only, always safe).
 */
export declare function matchStandaloneBindingShape(expr: Expression): {
    contractName: string;
    callTypeOverride?: 'static' | 'delegate';
} | undefined;
export declare const processCallExpression: (expr: CallExpression, ctx: CompilerContext, saucer: SaucerLike) => SaucerLike;
export declare function processLogicalExpression(expr: LogicalExpression, ctx: CompilerContext, saucer: SaucerLike): SaucerLike;
export declare const processMemberExpression: (expr: MemberExpression, ctx: CompilerContext, saucer: SaucerLike) => SaucerLike;
export declare const processNewExpression: (expr: NewExpression, ctx: CompilerContext, saucer: SaucerLike) => SaucerLike;
export declare function abiDecodeTypeSpecs(params: AbiParameter[]): number[];
export declare function processTaggedTemplateExpression(expr: TaggedTemplateExpression, ctx: CompilerContext, saucer: SaucerLike): SaucerLike;
export {};
//# sourceMappingURL=expression.d.ts.map