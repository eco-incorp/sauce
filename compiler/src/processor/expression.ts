import type {
  Expression,
  Literal,
  UnaryExpression,
  BinaryExpression,
  LogicalExpression,
  CallExpression,
  MemberExpression,
  NewExpression,
  ArrowFunctionExpression,
  Statement,
  TaggedTemplateExpression,
  TemplateElement,
  ObjectExpression,
  ArrayExpression,
  Property,
} from 'acorn';
import { OPS } from '../saucer/index.js';
import type { SaucerLike } from '../saucer/index.js';
import type { AbiParameter, ContractInfo, MethodInfo } from '../contracts.js';
import { hexToBytes } from '../contracts.js';
import type { CompilerContext, VariableKind } from '../context.js';
import { processExpression } from './index.js';
import { processBlock } from './statement.js';
import {
  resolveStaticMethod,
  resolveInstanceMethod,
  getPropertyName,
  getPropertyKey,
  lookupStructType,
  getFieldIndex,
  inferKindWithContext,
} from './inference.js';
import { processUint8Array } from './collection.js';
import { GLOBALS, GLOBAL_FUNCTIONS } from '../globals.js';
import { compile } from '../index.js';
import { assertCapability } from '../capabilities.js';

export function processLiteral(literal: Literal, saucer: SaucerLike): SaucerLike {
  switch (typeof literal.value) {
    case 'number':
      if (!Number.isInteger(literal.value)) {
        throw new Error('floating point numbers are not supported');
      }

      return saucer.int(BigInt(literal.raw ?? literal.value));
    case 'bigint':
      return saucer.int(literal.value);
    case 'boolean':
      return saucer.int(literal.value ? 1n : 0n);
    case 'string':
      return saucer.string(literal.value);
    default:
      throw new Error(`not implemented: ${typeof literal.value} literal`);
  }
}

export function literalToInt(literal: Literal): bigint {
  switch (typeof literal.value) {
    case 'number':
      if (!Number.isInteger(literal.value)) {
        throw new Error('floating point numbers are not supported');
      }

      return BigInt(literal.raw ?? literal.value);
    case 'bigint':
      return literal.value;
    case 'boolean':
      return literal.value ? 1n : 0n;
    default:
      throw new Error(`not implemented: ${typeof literal.value} literal`);
  }
}

export function isLiteralZero(expr: Expression): boolean {
  if (expr.type !== 'Literal') return false;

  const lit = expr as Literal;

  return lit.value === 0 || lit.value === 0n;
}

export function processUnaryExpression(expr: UnaryExpression, ctx: CompilerContext, saucer: SaucerLike): SaucerLike {
  switch (expr.operator) {
    case '!':
      return saucer.not(processExpression(expr.argument as Expression, ctx));
    case '-': {
      if (expr.argument.type !== 'Literal') throw new Error(`not implemented: unary - on ${expr.argument.type}`);

      return saucer.int(-literalToInt(expr.argument as Literal));
    }
    case '~':
      return saucer.bitNot(processExpression(expr.argument as Expression, ctx));
    default:
      throw new Error(`not implemented: unary ${expr.operator}`);
  }
}

export function applyBinaryOp(saucer: SaucerLike, op: string, left: SaucerLike, right: SaucerLike): SaucerLike {
  switch (op) {
    case '+':
      return saucer.add(left, right);
    case '-':
      return saucer.sub(left, right);
    case '*':
      return saucer.mul(left, right);
    case '/':
      return saucer.div(left, right);
    case '%':
      return saucer.mod(left, right);
    case '**':
      return saucer.exp(left, right);
    case '&':
      return saucer.bitAnd(left, right);
    case '|':
      return saucer.bitOr(left, right);
    case '^':
      return saucer.bitXor(left, right);
    case '<<':
      return saucer.shl(left, right);
    case '>>':
      return saucer.shr(left, right);
    default:
      throw new Error(`not implemented: operator ${op}`);
  }
}

export function processBinaryExpression(expr: BinaryExpression, ctx: CompilerContext, saucer: SaucerLike): SaucerLike {
  const left = processExpression(expr.left as Expression, ctx);
  const right = processExpression(expr.right as Expression, ctx);

  switch (expr.operator) {
    case '===':
      return isLiteralZero(expr.right) ? saucer.isZero(left) : saucer.eq(left, right);
    case '!==':
      return isLiteralZero(expr.right) ? saucer.isNotZero(left) : saucer.neq(left, right);
    case '>':
      return saucer.gt(left, right);
    case '<':
      return saucer.lt(left, right);
    case '>=':
      return saucer.gte(left, right);
    case '<=':
      return saucer.lte(left, right);
    case '>>>':
      throw new Error('use >> instead of >>>');
    case '==':
      throw new Error('use === instead of ==');
    case '!=':
      throw new Error('use !== instead of !=');
    default:
      return applyBinaryOp(saucer, expr.operator, left, right);
  }
}

const processStaticMethod = (
  method: [string, string],
  expr: CallExpression,
  ctx: CompilerContext,
  saucer: SaucerLike,
): SaucerLike => {
  const [object, property] = method;
  const entry = GLOBALS[object]?.[property];

  if (!entry || entry.compile.length === 1) throw new Error(`not implemented: ${object}.${property}`);

  return (entry.compile as (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => SaucerLike)(
    saucer,
    expr.arguments as Expression[],
    (e: Expression) => processExpression(e, ctx),
  );
};

const BINDING_METHODS: Record<string, 'static' | 'delegate' | undefined> = {
  at: undefined, // auto-detect from ABI
  view: 'static', // force STATIC
  lib: 'delegate', // force DELEGATE
};

interface InlineChainInfo {
  contractName: string;
  bindMethod: string;
  addressExpr: Expression;
  methodName: string;
  args: Expression[];
}

function resolveInlineChain(expr: CallExpression): InlineChainInfo | undefined {
  if (expr.callee.type !== 'MemberExpression') return;

  const outerMember = expr.callee as MemberExpression;

  if (outerMember.property.type !== 'Identifier') return;

  const methodName = (outerMember.property as { name: string }).name;

  if (outerMember.object.type !== 'CallExpression') return;

  const innerCall = outerMember.object as CallExpression;

  if (innerCall.callee.type !== 'MemberExpression') return;

  const innerMember = innerCall.callee as MemberExpression;

  if (innerMember.object.type !== 'Identifier' || innerMember.property.type !== 'Identifier') return;

  const contractName = (innerMember.object as { name: string }).name;
  const bindMethod = (innerMember.property as { name: string }).name;

  if (!(bindMethod in BINDING_METHODS)) return;

  if (innerCall.arguments.length !== 1) return;

  return {
    contractName,
    bindMethod,
    addressExpr: innerCall.arguments[0] as Expression,
    methodName,
    args: expr.arguments as Expression[],
  };
}

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

export function resolveContractCallTarget(expr: Expression, ctx: CompilerContext): ContractCallTarget | undefined {
  if (expr.type !== 'CallExpression') return;

  const call = expr as CallExpression;

  const chain = resolveInlineChain(call);

  if (chain) {
    const contract = ctx.lookupContract(chain.contractName);

    // The .at()/.view()/.lib() chain shape is unambiguous — an unknown name is a
    // genuine error, and the normal call path reports it with this exact message
    // (so a probe caller surfaces nothing the emission wouldn't).
    if (!contract) throw new Error(`Unknown contract: ${chain.contractName}`);

    const method = contract.methods.get(chain.methodName);

    if (!method) throw new Error(`Unknown method "${chain.methodName}" on contract "${contract.name}"`);

    return {
      contract,
      methodName: chain.methodName,
      method,
      callTypeOverride: BINDING_METHODS[chain.bindMethod],
      addr: () => processExpression(chain.addressExpr, ctx),
      args: chain.args,
    };
  }

  if (call.callee.type !== 'MemberExpression') return;

  const member = call.callee as MemberExpression;

  if (member.object.type !== 'Identifier' || member.property.type !== 'Identifier') return;

  const objectName = (member.object as { name: string }).name;
  const bound = ctx.lookupBoundContract(objectName);

  if (!bound) return;

  const methodName = (member.property as { name: string }).name;
  const method = bound.contract.methods.get(methodName);

  if (!method) throw new Error(`Unknown method "${methodName}" on contract "${bound.contract.name}"`);

  return {
    contract: bound.contract,
    methodName,
    method,
    callTypeOverride: bound.callTypeOverride,
    addr: () => ctx.newSaucer().read(objectName),
    args: call.arguments as Expression[],
  };
}

/** Emit a resolved contract call WITHOUT output decoding — the raw returndata value. */
export function emitRawContractCall(target: ContractCallTarget, ctx: CompilerContext): SaucerLike {
  return processContractCall(
    target.contract,
    target.methodName,
    target.args,
    ctx,
    ctx.newSaucer(),
    target.addr(),
    target.callTypeOverride,
    true,
  );
}

// Object literals are stored internally with fields in alphabetical order (the
// canonical order used for `obj.field` reads). But a struct passed to a contract
// method must be ABI-encoded in the ABI's DECLARATION order. So at the call
// boundary we re-order an object-literal arg to match the ABI tuple components
// (recursively, including nested tuples and tuple[]), rather than emitting the
// internal alphabetical tuple. Non-object args (scalars, arrays, variables) fall
// through to normal processing.
function processAbiArg(arg: Expression, param: AbiParameter | undefined, ctx: CompilerContext): SaucerLike {
  if (param?.type === 'tuple' && arg.type === 'ObjectExpression') {
    return orderedStructTuple(arg as ObjectExpression, param.components ?? [], ctx);
  }

  if (param?.type === 'tuple[]' && arg.type === 'ArrayExpression') {
    const elementParam: AbiParameter = { type: 'tuple', components: param.components };
    const elements = (arg as ArrayExpression).elements.map((el) => {
      if (!el || el.type === 'SpreadElement') throw new Error('sparse/spread arrays are not supported');

      return processAbiArg(el as Expression, elementParam, ctx);
    });

    return ctx.newSaucer().array(elements);
  }

  return processExpression(arg, ctx);
}

/**
 * True iff an ABI parameter is fully STATIC — an elementary static type (uintN /
 * intN / address / bool / bytesN), a fixed-size array of statics, or a tuple all of
 * whose components are (recursively) static. Dynamic: bytes/string, any T[] (or
 * unsized), a fixed array of dynamics, or a tuple with any dynamic component.
 *
 * Used to decide whether a nested struct component can be FLATTENED into its parent
 * tuple at the ABI-encode boundary (see flattenStaticStructFields). For a fully
 * static struct the flat and nested ABI encodings are byte-identical (no offsets
 * either way), so flattening is transparent on the v1 engine — and it sidesteps a
 * v12 Huff ABI_ENCODE bug whose static-tuple inliner only scans ONE level deep: it
 * sees a nested TUPLE element (a static struct field, e.g. SwapParams.poolKey) as
 * "dynamic" and prepends a spurious head offset, shifting every field by one word
 * and corrupting the call (the v1 runtime recurses correctly). Emitting the static
 * fields flat keeps the descriptor a flat tuple of scalars, which both engines
 * encode identically and correctly. (Dynamic nested tuples are left nested — they
 * genuinely need offset encoding, which both engines handle.)
 */
function isStaticAbiParam(param: AbiParameter): boolean {
  const t = param.type;

  if (t === 'tuple') return (param.components ?? []).every(isStaticAbiParam);

  if (t.endsWith('[]')) return false; // dynamic-length array

  const fixedArray = /^(.*)\[(\d+)\]$/.exec(t);

  if (fixedArray) {
    // T[k]: static iff element type T is static.
    return isStaticAbiParam({ ...param, type: fixedArray[1] });
  }

  return t !== 'bytes' && t !== 'string';
}

/**
 * Build the ordered SaucerLike elements for a struct, flattening any fully-static
 * nested-tuple component into the parent (recursively) so the emitted descriptor is
 * a flat tuple of scalar leaves. See isStaticAbiParam for why.
 */
function flattenStaticStructFields(
  obj: ObjectExpression,
  components: AbiParameter[],
  ctx: CompilerContext,
): SaucerLike[] {
  const byName = new Map<string, Expression>();
  for (const prop of obj.properties) {
    if (prop.type !== 'Property') throw new Error('spread properties are not supported');

    const p = prop as Property;
    const key = getPropertyKey(p);
    byName.set(key, p.shorthand ? ({ type: 'Identifier', name: key } as Expression) : (p.value as Expression));
  }

  const out: SaucerLike[] = [];
  for (const component of components) {
    if (!component.name) throw new Error('ABI tuple components must be named to encode an object literal');

    const value = byName.get(component.name);

    if (!value) throw new Error(`missing struct field '${component.name}' in object literal`);

    // Flatten an all-static nested struct given as an object literal: splice its
    // (recursively flattened) fields into the parent instead of nesting a tuple.
    if (component.type === 'tuple' && value.type === 'ObjectExpression' && isStaticAbiParam(component)) {
      out.push(...flattenStaticStructFields(value as ObjectExpression, component.components ?? [], ctx));
      continue;
    }

    out.push(processAbiArg(value, component, ctx));
  }

  return out;
}

function orderedStructTuple(obj: ObjectExpression, components: AbiParameter[], ctx: CompilerContext): SaucerLike {
  return ctx.newSaucer().tuple(flattenStaticStructFields(obj, components, ctx));
}

function processContractCall(
  contract: ContractInfo,
  methodName: string,
  args: Expression[],
  ctx: CompilerContext,
  saucer: SaucerLike,
  addrSaucer: SaucerLike,
  callTypeOverride?: 'static' | 'delegate',
  skipOutput?: boolean,
): SaucerLike {
  // svm has no ABI-typed binding lowering yet (a binding would need per-method
  // account lists); every typed-binding shape (inline chain, .view()/.lib(),
  // variable-bound, standalone) funnels through here, so one guard covers them.
  assertCapability(ctx, 'contract bindings');

  const method = contract.methods.get(methodName);

  if (!method) {
    throw new Error(`Unknown method "${methodName}" on contract "${contract.name}"`);
  }

  if (args.length !== method.inputs.length) {
    throw new Error(`${contract.name}.${methodName}() expects ${method.inputs.length} argument(s), got ${args.length}`);
  }

  const s = ctx.newSaucer();
  const selectorBytes = hexToBytes(method.selector);

  const processedArgs = args.map((arg, i) => processAbiArg(arg, method.inputs[i], ctx));

  const calldata =
    processedArgs.length === 0
      ? s.bytes(selectorBytes)
      : s.concat([s.bytes(selectorBytes), s.abiEncode(s.tuple(processedArgs))]);

  const effectiveCallType =
    callTypeOverride ?? (method.stateMutability === 'view' || method.stateMutability === 'pure' ? 'static' : undefined);

  const outputSpecs = !skipOutput && method.outputs?.length ? abiDecodeTypeSpecs(method.outputs) : undefined;
  const output = outputSpecs ? { count: method.outputs!.length, typeSpecs: outputSpecs } : undefined;

  switch (effectiveCallType) {
    case 'static':
      return saucer.staticCall(addrSaucer, calldata, output);
    case 'delegate':
      return saucer.delegateCall(addrSaucer, calldata, output);
    default:
      return saucer.externalCall(addrSaucer, s.int(0n), calldata, output);
  }
}

interface CatchChainInfo {
  innerCall: CallExpression;
  handlerBody: Statement;
  paramName?: string;
}

export function resolveCatchChain(expr: CallExpression): CatchChainInfo | undefined {
  if (expr.callee.type !== 'MemberExpression') return;

  const member = expr.callee as MemberExpression;

  if (member.property.type !== 'Identifier' || (member.property as { name: string }).name !== 'catch') return;

  if (member.object.type !== 'CallExpression') return;

  if (expr.arguments.length !== 1) return;

  const handler = expr.arguments[0];

  if (handler.type !== 'ArrowFunctionExpression' && handler.type !== 'FunctionExpression') return;

  const fn = handler as ArrowFunctionExpression;

  if (fn.params.length > 1) {
    throw new Error('catch handler takes at most one parameter');
  }

  let paramName: string | undefined;

  if (fn.params.length === 1) {
    const param = fn.params[0];

    if (param.type !== 'Identifier') {
      throw new Error('catch parameter must be an identifier');
    }

    paramName = (param as { name: string }).name;
  }

  return {
    innerCall: member.object as CallExpression,
    handlerBody: fn.body as Statement,
    paramName,
  };
}

function declareCatchParam(paramName: string | undefined, ctx: CompilerContext): void {
  if (paramName && !ctx.getVar(paramName)) {
    ctx.setVar(paramName, 'dynamic');
  }
}

function buildCatchSaucer(
  callOnly: SaucerLike,
  handler: SaucerLike,
  paramName: string | undefined,
  ctx: CompilerContext,
  saucer: SaucerLike,
): SaucerLike {
  if (!paramName) {
    // No parameter — emit call directly with catch
    return saucer.join(callOnly).catch(handler);
  }

  // Wrap call with store: [prefix] WRITE_HEAP <e_slot> [CALL bytes] CATCH <skip> <handler>
  // store() handles slot tracking, the CALL result (dynamicResult) is captured into e
  return saucer.store(paramName, callOnly, 'dynamic').catch(handler);
}

function processCatchCall(info: CatchChainInfo, ctx: CompilerContext, saucer: SaucerLike): SaucerLike {
  const { innerCall, handlerBody, paramName } = info;

  // Declare catch parameter early so handler body can reference it
  declareCatchParam(paramName, ctx);

  // Process the inner contract call without output decoding (CATCH must follow CALL directly)
  const inlineChain = resolveInlineChain(innerCall);

  if (inlineChain) {
    const { contractName, bindMethod, addressExpr, methodName, args: chainArgs } = inlineChain;
    const contract = ctx.lookupContract(contractName);

    if (!contract) throw new Error(`Unknown contract: ${contractName}`);

    const addrSaucer = processExpression(addressExpr, ctx);
    // Build CALL with empty prefix so we get just the call bytes
    const callOnly = processContractCall(
      contract,
      methodName,
      chainArgs,
      ctx,
      ctx.newSaucer(),
      addrSaucer,
      BINDING_METHODS[bindMethod],
      true,
    );
    const handler = processBlock(handlerBody, ctx);

    return buildCatchSaucer(callOnly, handler, paramName, ctx, saucer);
  }

  // Variable-bound: token.transfer(to, amount).catch(() => { ... })
  const boundCatch = resolveVariableBoundCatch(innerCall, handlerBody, paramName, ctx, saucer);

  if (boundCatch) return boundCatch;

  // Raw call builtins: contract.call(addr, value, data).catch(() => { ... })
  const rawCallCatch = resolveRawCallCatch(innerCall, handlerBody, paramName, ctx, saucer);

  if (rawCallCatch) return rawCallCatch;

  throw new Error('.catch() can only be used on contract calls');
}

function resolveVariableBoundCatch(
  innerCall: CallExpression,
  handlerBody: Statement,
  paramName: string | undefined,
  ctx: CompilerContext,
  saucer: SaucerLike,
): SaucerLike | undefined {
  if (innerCall.callee.type !== 'MemberExpression') return;

  const member = innerCall.callee as MemberExpression;

  if (member.object.type !== 'Identifier' || member.property.type !== 'Identifier') return;

  const objectName = (member.object as { name: string }).name;
  const propertyName = (member.property as { name: string }).name;
  const bound = ctx.lookupBoundContract(objectName);

  if (!bound) return;

  const addrSaucer = ctx.newSaucer().read(objectName);
  const callOnly = processContractCall(
    bound.contract,
    propertyName,
    innerCall.arguments as Expression[],
    ctx,
    ctx.newSaucer(),
    addrSaucer,
    bound.callTypeOverride,
    true,
  );
  const handler = processBlock(handlerBody, ctx);

  return buildCatchSaucer(callOnly, handler, paramName, ctx, saucer);
}

const RAW_CALL_METHODS = new Set(['call', 'static', 'delegate']);

// Raw-call `.catch()` wrapping works on every target, including 'svm' — but there
// the engine's CATCH intercepts only PRE-FLIGHT CPI failures (unresolvable target/
// calldata/accounts operands); once invoke() launches, a failing callee aborts the
// whole transaction. Same emission, narrower runtime semantics.
function resolveRawCallCatch(
  innerCall: CallExpression,
  handlerBody: Statement,
  paramName: string | undefined,
  ctx: CompilerContext,
  saucer: SaucerLike,
): SaucerLike | undefined {
  if (innerCall.callee.type !== 'MemberExpression') return;

  const member = innerCall.callee as MemberExpression;

  if (member.object.type !== 'Identifier' || member.property.type !== 'Identifier') return;

  const objectName = (member.object as { name: string }).name;
  const propertyName = (member.property as { name: string }).name;

  if (objectName !== 'contract' || !RAW_CALL_METHODS.has(propertyName)) return;

  const entry = GLOBALS[objectName]?.[propertyName];

  if (!entry) return;

  const callOnly = (entry.compile as (s: SaucerLike, a: Expression[], p: (e: Expression) => SaucerLike) => SaucerLike)(
    ctx.newSaucer(),
    innerCall.arguments as Expression[],
    (e: Expression) => processExpression(e, ctx),
  );
  const handler = processBlock(handlerBody, ctx);

  return buildCatchSaucer(callOnly, handler, paramName, ctx, saucer);
}

function resolveVariableBoundCall(
  expr: CallExpression,
  ctx: CompilerContext,
  saucer: SaucerLike,
): SaucerLike | undefined {
  if (expr.callee.type !== 'MemberExpression') return;

  const member = expr.callee as MemberExpression;

  if (member.object.type !== 'Identifier' || member.property.type !== 'Identifier') return;

  const objectName = (member.object as { name: string }).name;
  const propertyName = (member.property as { name: string }).name;
  const bound = ctx.lookupBoundContract(objectName);

  if (!bound) return;

  const addrSaucer = ctx.newSaucer().read(objectName);

  return processContractCall(
    bound.contract,
    propertyName,
    expr.arguments as Expression[],
    ctx,
    saucer,
    addrSaucer,
    bound.callTypeOverride,
  );
}

function resolveStandaloneBinding(expr: CallExpression, ctx: CompilerContext): SaucerLike | undefined {
  if (expr.callee.type !== 'MemberExpression') return;

  const member = expr.callee as MemberExpression;

  if (member.object.type !== 'Identifier' || member.property.type !== 'Identifier') return;

  const objectName = (member.object as { name: string }).name;
  const propertyName = (member.property as { name: string }).name;

  if (!(propertyName in BINDING_METHODS)) return;

  const contract = ctx.lookupContract(objectName);

  if (!contract) return;

  if (expr.arguments.length !== 1) throw new Error(`${contract.name}.${propertyName}() requires exactly 1 argument`);

  ctx.setPendingContractBinding(contract.name, BINDING_METHODS[propertyName]);

  return processExpression(expr.arguments[0] as Expression, ctx);
}

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
export function matchStandaloneBindingShape(
  expr: Expression,
): { contractName: string; callTypeOverride?: 'static' | 'delegate' } | undefined {
  if (expr.type !== 'CallExpression') return undefined;

  const call = expr as CallExpression;

  if (call.callee.type !== 'MemberExpression') return undefined;

  const member = call.callee as MemberExpression;

  if (member.object.type !== 'Identifier' || member.property.type !== 'Identifier') return undefined;

  const propertyName = (member.property as { name: string }).name;

  if (!(propertyName in BINDING_METHODS)) return undefined;

  return { contractName: (member.object as { name: string }).name, callTypeOverride: BINDING_METHODS[propertyName] };
}

export const processCallExpression = (expr: CallExpression, ctx: CompilerContext, saucer: SaucerLike): SaucerLike => {
  // Pattern: .catch(handler) — ERC20.at(addr).transfer(to, amount).catch(() => { ... })
  const catchInfo = resolveCatchChain(expr);

  if (catchInfo) {
    return processCatchCall(catchInfo, ctx, saucer);
  }

  // Pattern A: Inline chain — ERC20.at(addr).transfer(to, amount)
  const inlineChain = resolveInlineChain(expr);

  if (inlineChain) {
    const { contractName, bindMethod, addressExpr, methodName, args: chainArgs } = inlineChain;
    const contract = ctx.lookupContract(contractName);

    if (!contract) throw new Error(`Unknown contract: ${contractName}`);

    const addrSaucer = processExpression(addressExpr, ctx);

    return processContractCall(contract, methodName, chainArgs, ctx, saucer, addrSaucer, BINDING_METHODS[bindMethod]);
  }

  const staticMethod = resolveStaticMethod(expr);

  if (staticMethod) return processStaticMethod(staticMethod, expr, ctx, saucer);

  // Pattern B: Variable-bound — token.transfer(to, amount)
  const variableBound = resolveVariableBoundCall(expr, ctx, saucer);

  if (variableBound) return variableBound;

  // Pattern C: Standalone binding — ERC20.at(addr) / ERC20.view(addr) / ERC20.lib(addr)
  const standaloneBinding = resolveStandaloneBinding(expr, ctx);

  if (standaloneBinding) return standaloneBinding;

  const instance = resolveInstanceMethod(expr);

  if (instance) return processInstanceMethod(instance, expr, ctx, saucer);

  if (expr.callee.type !== 'Identifier') {
    throw new Error(`not implemented: non identifier call expression`);
  }

  const ctxFn = GLOBAL_FUNCTIONS[expr.callee.name];

  if (ctxFn) {
    return (ctxFn.compile as (s: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => SaucerLike)(
      saucer,
      expr.arguments as Expression[],
      (e: Expression) => processExpression(e, ctx),
    );
  }

  const args = expr.arguments.map((arg) => processExpression(arg as Expression, ctx));

  return saucer.callFunction(expr.callee.name, args);
};

export function processLogicalExpression(
  expr: LogicalExpression,
  ctx: CompilerContext,
  saucer: SaucerLike,
): SaucerLike {
  const left = processExpression(expr.left, ctx);
  const right = processExpression(expr.right, ctx);

  switch (expr.operator) {
    case '&&':
      return saucer.and(left, right);
    case '||':
      return saucer.or(left, right);
    default:
      throw new Error(`not implemented: operator ${expr.operator}`);
  }
}

// Field access (e.g. `obj.name`) compiles to INDEX into a tuple.
// The INDEX result is dynamic data that must live on the heap, but we're in the
// middle of compiling an expression — we can't emit a WRITE_HEAP side-effect inline.
// So we defer a store to a temp variable and return a READ_HEAP of that temp.
const processFieldAccess = (
  expr: MemberExpression,
  field: string,
  ctx: CompilerContext,
  saucer: SaucerLike,
): SaucerLike => {
  const structType = lookupStructType(expr, ctx);

  if (!structType) throw new Error(`property '${field}' access not supported, use array indexing arr[i]`);

  return saucer.index(
    processExpression(expr.object as Expression, ctx),
    ctx.newSaucer().int(BigInt(getFieldIndex(structType, field))),
  );
};

// Compile-time rejection of `s[k]` where `s` was assigned a multi-output call
// result on v1 (Variable.multiOutputCall): the stored value lost its tuple
// descriptor in the round-trip, so the engine's INDEX is GUARANTEED to fault
// SauceInvalidOperationArgs at runtime. Destructuring never stores the
// descriptor and is the working replacement. (The store itself, and bare reads
// of the variable, stay exactly as they always compiled — see storeExpression.)
const assertIndexableVariable = (expr: MemberExpression, ctx: CompilerContext): void => {
  if (expr.object.type !== 'Identifier') return;

  const name = (expr.object as { name: string }).name;

  if (!ctx.getVar(name)?.multiOutputCall) return;

  throw new Error(
    `cannot index '${name}': a multi-output call result stored in a variable loses its tuple on the v1 engine ` +
      `(INDEX faults at runtime) — destructure the call instead: const [a, b] = …`,
  );
};

const processIndexAccess = (expr: MemberExpression, ctx: CompilerContext, saucer: SaucerLike): SaucerLike => {
  assertIndexableVariable(expr, ctx);

  return saucer.index(
    processExpression(expr.object as Expression, ctx),
    processExpression(expr.property as Expression, ctx),
  );
};

export const processMemberExpression = (
  expr: MemberExpression,
  ctx: CompilerContext,
  saucer: SaucerLike,
): SaucerLike => {
  const property = getPropertyName(expr);

  if (property && expr.object.type === 'Identifier') {
    const entry = GLOBALS[(expr.object as { name: string }).name]?.[property];

    if (entry?.compile.length === 1) return (entry.compile as (s: SaucerLike) => SaucerLike)(saucer);
  }

  if (property === 'length') return saucer.length(processExpression(expr.object as Expression, ctx));

  if (property) return processFieldAccess(expr, property, ctx, saucer);

  return processIndexAccess(expr, ctx, saucer);
};

export const processNewExpression = (expr: NewExpression, ctx: CompilerContext, saucer: SaucerLike): SaucerLike => {
  if (expr.callee.type !== 'Identifier') throw new Error(`not implemented: new ${expr.callee.type}`);

  const name = (expr.callee as { name: string }).name;

  if (name === 'Array') {
    if (expr.arguments.length !== 1) throw new Error('new Array expects exactly 1 argument (length)');

    return saucer.newArray(processExpression(expr.arguments[0] as Expression, ctx));
  }

  if (name !== 'Uint8Array') throw new Error(`not implemented: new ${name}`);

  return processUint8Array(expr, saucer);
};

const processInstanceMethod = (
  instance: { method: string; object: Expression },
  expr: CallExpression,
  ctx: CompilerContext,
  saucer: SaucerLike,
): SaucerLike => {
  const receiver = processExpression(instance.object, ctx);

  switch (instance.method) {
    case 'concat': {
      const args = expr.arguments.map((a) => processExpression(a as Expression, ctx));

      return saucer.concat([receiver, ...args]);
    }
    case 'slice': {
      if (expr.arguments.length !== 2) throw new Error('.slice() expects exactly 2 arguments (start, end)');

      const start = processExpression(expr.arguments[0] as Expression, ctx);
      const end = processExpression(expr.arguments[1] as Expression, ctx);

      return saucer.slice(receiver, start, ctx.newSaucer().sub(end, start));
    }
    default:
      throw new Error(`not implemented: .${instance.method}()`);
  }
};

const ABI_TYPE_SPECS: Record<string, number> = {
  bool: OPS.BYTE_1,
  address: OPS.BYTE_20,
  bytes: OPS.BYTES,
  string: OPS.BYTES,
  ...Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`uint${(i + 1) * 8}`, OPS.BYTE_1 + i])),
  ...Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`int${(i + 1) * 8}`, OPS.BYTE_1 + i])),
};

function resolveAbiParamTypeSpec(param: AbiParameter): number[] {
  let { type, components } = param;

  if (type === 'tuple') {
    const inner = (components ?? []).flatMap(resolveAbiParamTypeSpec);

    return [OPS.TUPLE, (components ?? []).length, ...inner];
  }

  if (type === 'tuple[]') {
    const inner = (components ?? []).flatMap(resolveAbiParamTypeSpec);

    return [OPS.ARRAY, OPS.TUPLE, (components ?? []).length, ...inner];
  }

  const result = [];
  while (type.endsWith('[]')) {
    type = type.slice(0, -2);
    result.push(OPS.ARRAY);
  }

  const spec = ABI_TYPE_SPECS[type];

  if (!spec) throw new Error(`unknown ABI type: '${type}'`);

  result.push(spec);

  return result;
}

export function abiDecodeTypeSpecs(params: AbiParameter[]): number[] {
  return params.flatMap(resolveAbiParamTypeSpec);
}

// --- $ tagged template inline implementation ---

// Sentinel prefix for scalar placeholders (32-byte constants)
const SCALAR_SENTINEL_PREFIX = 0xdead5a0c01n;
// Sentinel prefix bytes for dynamic placeholders (8-byte arrays)
const DYNAMIC_SENTINEL_PREFIX = [0xde, 0xad, 0x5a, 0x0c, 0x02];

function generateScalarSentinel(index: number): bigint {
  return (SCALAR_SENTINEL_PREFIX << 216n) | BigInt(index);
}

function generateDynamicSentinel(index: number): number[] {
  return [...DYNAMIC_SENTINEL_PREFIX, 0x00, 0x00, index];
}

function sentinelToSource(index: number, kind: VariableKind): string {
  if (kind === 'scalar') {
    const value = generateScalarSentinel(index);

    return `0x${value.toString(16).padStart(64, '0')}n`;
  }

  const bytes = generateDynamicSentinel(index);

  return `Uint8Array.from([${bytes.map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(', ')}])`;
}

function scalarSentinelPattern(index: number): Uint8Array {
  const value = generateScalarSentinel(index);
  const bytes = new Uint8Array(33);
  bytes[0] = OPS.BYTE_32;
  for (let i = 0; i < 32; i++) {
    bytes[1 + i] = Number((value >> BigInt((31 - i) * 8)) & 0xffn);
  }

  return bytes;
}

function dynamicSentinelPattern(index: number): Uint8Array {
  const sentinel = generateDynamicSentinel(index);

  return new Uint8Array([OPS.BYTES, sentinel.length, ...sentinel]);
}

function findPattern(haystack: Uint8Array, needle: Uint8Array): number {
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }

    if (match) return i;
  }

  return -1;
}

function splitBySentinels(bytecodes: Uint8Array, kinds: VariableKind[]): Uint8Array[] {
  const segments: Uint8Array[] = [];
  let remaining = bytecodes;

  for (let i = 0; i < kinds.length; i++) {
    const needle = kinds[i] === 'scalar' ? scalarSentinelPattern(i) : dynamicSentinelPattern(i);
    const pos = findPattern(remaining, needle);

    if (pos === -1) {
      throw new Error(`$\`...\`: could not find placeholder ${i} in compiled bytecodes`);
    }

    segments.push(remaining.slice(0, pos));
    remaining = remaining.slice(pos + needle.length);
  }

  segments.push(remaining);

  return segments;
}

function encodeScalarAsBytecode(expr: SaucerLike, ctx: CompilerContext): SaucerLike {
  // Produces [BYTE_32][32 bytes of value] at runtime via:
  // CONCAT(BYTES([0x20]), ABI_ENCODE(TUPLE(1, expr)))
  return ctx
    .newSaucer()
    .concat([
      ctx.newSaucer().bytes(new Uint8Array([OPS.BYTE_32])),
      ctx.newSaucer().abiEncode(ctx.newSaucer().tuple([expr])),
    ]);
}

function encodeDynamicAsBytecode(expr: SaucerLike, ctx: CompilerContext): SaucerLike {
  // Produces [BYTES_2][len_hi][len_lo][data...] at runtime via:
  // CONCAT(BYTES([0x91]), SLICE(ABI_ENCODE(TUPLE(1, LENGTH(expr))), 30, 2), expr)
  const lengthSaucer = ctx.newSaucer().length(expr);
  const lengthEncoded = ctx.newSaucer().abiEncode(ctx.newSaucer().tuple([lengthSaucer]));
  const length2Bytes = ctx.newSaucer().slice(lengthEncoded, ctx.newSaucer().int(30n), ctx.newSaucer().int(2n));

  return ctx.newSaucer().concat([ctx.newSaucer().bytes(new Uint8Array([OPS.BYTES_2])), length2Bytes, expr]);
}

export function processTaggedTemplateExpression(
  expr: TaggedTemplateExpression,
  ctx: CompilerContext,
  saucer: SaucerLike,
): SaucerLike {
  // Verify tag is $
  if (expr.tag.type !== 'Identifier' || (expr.tag as { name: string }).name !== '$') {
    throw new Error('tagged template expressions must use $`...`');
  }

  const quasis = expr.quasi.quasis as TemplateElement[];
  const expressions = expr.quasi.expressions as Expression[];

  // No expressions — compile as a static program and return bytes
  if (expressions.length === 0) {
    const source = quasis.map((q) => q.value.cooked ?? q.value.raw).join('');
    const wrappedSource = /function\s+main\s*\(/.test(source) ? source : `function main() { ${source} }`;
    const { bytecode } = compile(wrappedSource, {
      baseDirs: ctx.resolvedBaseDirs,
      contracts: ctx.contractsConfig,
      target: ctx.target,
    });

    return saucer.join(ctx.newSaucer().bytes(bytecode[0]));
  }

  // Determine kind of each interpolation expression
  const kinds = expressions.map((e) => inferKindWithContext(e, ctx));

  // Build inner source by joining quasis with sentinel literal values
  let innerSource = '';
  for (let i = 0; i < quasis.length; i++) {
    innerSource += quasis[i].value.cooked ?? quasis[i].value.raw;

    if (i < expressions.length) {
      innerSource += sentinelToSource(i, kinds[i]);
    }
  }

  // Wrap in function main() if needed
  const wrappedSource = /function\s+main\s*\(/.test(innerSource) ? innerSource : `function main() { ${innerSource} }`;

  // Compile inner source — contracts from outer scope are available.
  // Thread the enclosing target so the inner $-fragment matches the outer
  // program's bytecode format (defaults to v1 otherwise, which breaks v12).
  const { bytecode } = compile(wrappedSource, {
    baseDirs: ctx.resolvedBaseDirs,
    contracts: ctx.contractsConfig,
    target: ctx.target,
  });
  const innerBytes = bytecode[0];

  // Split bytecodes at sentinel positions
  const segments = splitBySentinels(innerBytes, kinds);

  // Process outer expressions in the outer context
  const outerExprs = expressions.map((e) => processExpression(e, ctx));

  // Build CONCAT: interleave static segments with encoded outer expressions
  const concatParts: SaucerLike[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].length > 0) {
      concatParts.push(ctx.newSaucer().bytes(segments[i]));
    }

    if (i < outerExprs.length) {
      concatParts.push(
        kinds[i] === 'scalar'
          ? encodeScalarAsBytecode(outerExprs[i], ctx)
          : encodeDynamicAsBytecode(outerExprs[i], ctx),
      );
    }
  }

  // Single segment, no CONCAT needed
  if (concatParts.length === 1) {
    return saucer.join(concatParts[0]);
  }

  return saucer.concat(concatParts);
}
