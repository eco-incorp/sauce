import type { Node, Expression, Literal } from 'acorn';
import type { CompilerContext } from '../context.js';

// ── Compile-time constant evaluation (conditional compilation) ──
//
// A PURE evaluator: it returns a bigint (or undefined when the value can't be
// known at compile time) and emits NO bytecode and has NO side effects. It is
// consulted ONLY at the if/ternary fold sites (statement.ts) and the reachability
// walk (processor/index.ts collectCalls) — never on the runtime expression path —
// so emitter bytecode for genuine runtime expressions is unchanged. Identifiers
// resolve against ctx's compile-time constant environment (defines + top-level
// const), so an unknown name yields undefined (treated as a runtime value).

/** Pure compile-time value of an expression, or undefined if not statically known. */
export function evalConst(node: Node | null | undefined, ctx: CompilerContext): bigint | undefined {
  if (!node) return undefined;

  switch (node.type) {
    case 'Literal':
      return literalToBigint(node as unknown as Literal);
    case 'Identifier':
      return ctx.getConstant((node as unknown as { name: string }).name);
    case 'UnaryExpression':
      return evalUnary(node as Node & { operator: string; argument: Expression }, ctx);
    case 'LogicalExpression':
      return evalLogical(node as Node & { operator: string; left: Expression; right: Expression }, ctx);
    case 'BinaryExpression':
      return evalBinary(node as Node & { operator: string; left: Expression; right: Expression }, ctx);
    default:
      return undefined;
  }
}

/** Boolean view of a foldable condition: undefined if not statically known. */
export function evalConstBool(node: Node | null | undefined, ctx: CompilerContext): boolean | undefined {
  const v = evalConst(node, ctx);

  return v === undefined ? undefined : v !== 0n;
}

function literalToBigint(literal: Literal): bigint | undefined {
  const { value, raw } = literal;

  if (typeof value === 'bigint') return value;

  if (typeof value === 'boolean') return value ? 1n : 0n;

  // Only integer numeric literals fold; a non-integer can't be a uint256 constant. Parse the
  // literal's own SOURCE text (acorn's `raw`), never `value` — acorn itself already lossily
  // rounds a suffix-less integer literal beyond Number.MAX_SAFE_INTEGER through a JS float at
  // PARSE time (e.g. `0xffff...000000` in the real ecoswap `HIGH` mask), so `value` here can
  // already be the WRONG number before this function ever runs. Mirrors
  // `processor/expression.ts`'s `processLiteral`/`literalToInt`, which uses this exact
  // `raw`-first pattern for the runtime-value emission path already.
  if (typeof value === 'number' && Number.isInteger(value)) {
    try {
      return BigInt(raw ?? value);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function evalUnary(node: { operator: string; argument: Expression }, ctx: CompilerContext): bigint | undefined {
  const v = evalConst(node.argument, ctx);

  if (v === undefined) return undefined;

  switch (node.operator) {
    case '!':
      return v === 0n ? 1n : 0n;
    case '-':
      return -v;
    case '+':
      return v;
    case '~':
      return ~v;
    default:
      return undefined;
  }
}

function evalLogical(
  node: { operator: string; left: Expression; right: Expression },
  ctx: CompilerContext,
): bigint | undefined {
  const left = evalConst(node.left, ctx);

  // Short-circuit: a known-falsy left collapses `&&`, a known-truthy left collapses
  // `||` — even when the right side is a non-constant runtime expression. The other
  // cases need both sides known.
  if (node.operator === '&&') {
    if (left !== undefined && left === 0n) return 0n;

    const right = evalConst(node.right, ctx);

    if (left === undefined || right === undefined) return undefined;

    return left !== 0n && right !== 0n ? 1n : 0n;
  }

  if (node.operator === '||') {
    if (left !== undefined && left !== 0n) return 1n;

    const right = evalConst(node.right, ctx);

    if (left === undefined || right === undefined) return undefined;

    return left !== 0n || right !== 0n ? 1n : 0n;
  }

  return undefined;
}

function evalBinary(
  node: { operator: string; left: Expression; right: Expression },
  ctx: CompilerContext,
): bigint | undefined {
  const a = evalConst(node.left, ctx);
  const b = evalConst(node.right, ctx);

  if (a === undefined || b === undefined) return undefined;

  switch (node.operator) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0n ? undefined : a / b; // div-by-zero is not a compile-time value
    case '%':
      return b === 0n ? undefined : a % b;
    case '**':
      return b < 0n ? undefined : a ** b; // negative exponent is not a uint256 constant
    case '===':
    case '==':
      return a === b ? 1n : 0n;
    case '!==':
    case '!=':
      return a !== b ? 1n : 0n;
    case '<':
      return a < b ? 1n : 0n;
    case '<=':
      return a <= b ? 1n : 0n;
    case '>':
      return a > b ? 1n : 0n;
    case '>=':
      return a >= b ? 1n : 0n;
    case '&':
      return a & b;
    case '|':
      return a | b;
    case '^':
      return a ^ b;
    case '<<':
      return a << b;
    case '>>':
      return a >> b;
    default:
      return undefined;
  }
}
