import type {
  Expression,
  Literal,
  CallExpression,
  MemberExpression,
  ArrayExpression,
  ObjectExpression,
  Property,
} from 'acorn';
import type { CompilerContext, VariableKind, ElementType, StructType } from '../context.js';
import type { AbiParameter } from '../contracts.js';
import { GLOBALS } from '../globals.js';

const DYNAMIC_METHODS = ['concat', 'slice'];

export const resolveStaticMethod = (expr: CallExpression): [string, string] | undefined => {
  if (expr.callee.type !== 'MemberExpression') return;

  const member = expr.callee as MemberExpression;

  if (member.object.type !== 'Identifier' || member.property.type !== 'Identifier') return;

  const object = (member.object as { name: string }).name;

  return object in GLOBALS ? [object, (member.property as { name: string }).name] : undefined;
};

export const resolveInstanceMethod = (expr: CallExpression): { method: string; object: Expression } | undefined => {
  if (expr.callee.type !== 'MemberExpression') return;

  const member = expr.callee as MemberExpression;

  if (member.computed || member.property.type !== 'Identifier') return;

  return { method: (member.property as { name: string }).name, object: member.object as Expression };
};

const isDynamicMethod = (expr: CallExpression): boolean => {
  const instance = resolveInstanceMethod(expr);

  return instance !== undefined && DYNAMIC_METHODS.includes(instance.method);
};

const inferGlobalCallKind = (expr: CallExpression): VariableKind | undefined => {
  const method = resolveStaticMethod(expr);

  return method ? GLOBALS[method[0]]?.[method[1]]?.kind : undefined;
};

const isGlobalProperty = (object: string, property: string): boolean => {
  const entry = GLOBALS[object]?.[property];

  return entry?.compile.length === 1;
};

export const inferKind = (expr: Expression): VariableKind => {
  switch (expr.type) {
    case 'Literal':
      return typeof (expr as Literal).value === 'string' ? 'dynamic' : 'scalar';
    case 'ArrayExpression':
    case 'ObjectExpression':
    case 'TaggedTemplateExpression':
      return 'dynamic';
    case 'NewExpression':
      // Both supported forms — `new Array(n)` (TUPLE descriptor) and `new Uint8Array(...)`
      // (heap bytes) — are dynamic/heap-stored. Scalar (WRITE_VALUE) storage would drop
      // the descriptor, breaking `let a = new Array(n); a[i]` round-trips.
      return 'dynamic';
    case 'CallExpression':
      return (
        inferGlobalCallKind(expr as CallExpression) ?? (isDynamicMethod(expr as CallExpression) ? 'dynamic' : 'scalar')
      );
    default:
      return 'scalar';
  }
};

export const inferElementType = (expr: ArrayExpression): ElementType => {
  const first = expr.elements[0];

  if (!first || first.type === 'SpreadElement') return { kind: 'scalar' };

  const kind = inferKind(first as Expression);
  const element = first.type === 'ArrayExpression' ? inferElementType(first as ArrayExpression) : undefined;
  const structType = first.type === 'ObjectExpression' ? extractStructType(first as ObjectExpression) : undefined;

  return { kind, element, structType };
};

export const lookupIndexedElementType = (expr: MemberExpression, ctx: CompilerContext): ElementType | undefined =>
  expr.computed && expr.object.type === 'Identifier'
    ? ctx.getVar((expr.object as { name: string }).name)?.elementType
    : undefined;

export const getPropertyName = (expr: MemberExpression): string | undefined =>
  !expr.computed && expr.property.type === 'Identifier' ? (expr.property as { name: string }).name : undefined;

export const getPropertyKey = (prop: Property): string => {
  if (prop.key.type === 'Identifier') return (prop.key as { name: string }).name;

  if (prop.key.type === 'Literal') return String((prop.key as Literal).value);

  throw new Error('object keys must be identifiers or literals');
};

export const extractSortedProperties = (expr: ObjectExpression): { key: string; value: Expression }[] => {
  const props = expr.properties.map((prop) => {
    if (prop.type !== 'Property') throw new Error('spread properties are not supported');

    const p = prop as Property;
    const key = getPropertyKey(p);
    const value = p.shorthand ? ({ type: 'Identifier', name: key } as Expression) : (p.value as Expression);

    return { key, value };
  });

  return props.sort((a, b) => a.key.localeCompare(b.key));
};

export const extractStructType = (expr: ObjectExpression): StructType => {
  const sorted = extractSortedProperties(expr);
  const fields = sorted.map((p) => p.key);
  const fieldStructTypes = sorted.map((p) =>
    p.value.type === 'ObjectExpression' ? extractStructType(p.value as ObjectExpression) : undefined,
  );
  const hasNestedStruct = fieldStructTypes.some((t) => t !== undefined);

  return hasNestedStruct ? { fields, fieldStructTypes } : { fields };
};

export const lookupStructType = (expr: MemberExpression, ctx: CompilerContext): StructType | undefined =>
  getExprStructType(expr.object as Expression, ctx);

export const getFieldIndex = (structType: StructType, field: string): number => {
  const index = structType.fields.indexOf(field);

  if (index === -1) throw new Error(`unknown field '${field}'`);

  return index;
};

export const getExprStructType = (expr: Expression, ctx: CompilerContext): StructType | undefined => {
  if (expr.type === 'Identifier') {
    return ctx.getVar((expr as { name: string }).name)?.structType;
  }

  if (expr.type === 'MemberExpression') {
    const member = expr as MemberExpression;

    if (member.computed || member.property.type !== 'Identifier') return;

    const parentStructType = getExprStructType(member.object as Expression, ctx);

    if (!parentStructType) return;

    const field = (member.property as { name: string }).name;
    const fieldIndex = parentStructType.fields.indexOf(field);

    if (fieldIndex === -1) return;

    return parentStructType.fieldStructTypes?.[fieldIndex];
  }

  return;
};

const isNestedStructFieldAccess = (expr: MemberExpression, ctx: CompilerContext): boolean => {
  if (expr.computed || expr.property.type !== 'Identifier') return false;

  const parentStructType = getExprStructType(expr.object as Expression, ctx);

  if (!parentStructType) return false;

  const field = (expr.property as { name: string }).name;
  const fieldIndex = parentStructType.fields.indexOf(field);

  return parentStructType.fieldStructTypes?.[fieldIndex] !== undefined;
};

/**
 * Storage kind of one ABI output component once it is INDEXed out of a decoded
 * tuple: an elementary static (uintN/intN/address/bool/bytesN) is a scalar word;
 * bytes/string/arrays/tuples are heap values. Used by the multi-output-call
 * lowerings (destructuring, raw shape-B reads) to pick the store kind per element.
 */
export const abiOutputKind = (param: AbiParameter): VariableKind =>
  param.type === 'bytes' || param.type === 'string' || param.type === 'tuple' || param.type.endsWith(']')
    ? 'dynamic'
    : 'scalar';

export const inferKindWithContext = (expr: Expression, ctx: CompilerContext): VariableKind => {
  // Plain aliasing of an existing variable (`let b = a;`): the source variable's OWN
  // tracked kind is the ground truth — the ctx-free `inferKind` has no notion of
  // variables at all and would otherwise always default an Identifier to 'scalar',
  // silently dropping a dynamic value's TUPLE/heap descriptor on the alias's own store.
  if (expr.type === 'Identifier') {
    return ctx.getVar((expr as { name: string }).name)?.kind ?? inferKind(expr);
  }

  // A call to a same-file, user-declared function: consult its analyzed return kind
  // (`analyzeFunctionReturnKinds`, processor/return-kind.ts — a fixpoint pre-pass run
  // once per compile, before either target's body-compilation begins) rather than the
  // ctx-free `inferKind`'s generic CallExpression case, which only recognizes specific
  // GLOBAL/builtin call shapes and has no way to know a same-file function's own return
  // shape. Absent an entry (an import/global/anything else `getFunctionReturnKind`
  // doesn't cover) falls through to the existing behavior below.
  if (expr.type === 'CallExpression') {
    const call = expr as CallExpression;

    if (call.callee.type === 'Identifier') {
      const returnKind = ctx.getFunctionReturnKind((call.callee as { name: string }).name);

      if (returnKind) return returnKind;
    }
  }

  if (expr.type !== 'MemberExpression') return inferKind(expr);

  const member = expr as MemberExpression;

  if (member.computed) return lookupIndexedElementType(member, ctx)?.kind ?? inferKind(expr);

  if (isNestedStructFieldAccess(member, ctx)) return 'dynamic';

  if (member.object.type === 'Identifier' && member.property.type === 'Identifier') {
    const object = (member.object as { name: string }).name;
    const property = (member.property as { name: string }).name;

    if (isGlobalProperty(object, property)) return GLOBALS[object][property].kind;
  }

  return 'scalar';
};

export const inferElementTypeWithContext = (expr: Expression, ctx: CompilerContext): ElementType | undefined => {
  if (expr.type === 'ArrayExpression') return inferElementType(expr as ArrayExpression);

  if (expr.type === 'MemberExpression') return lookupIndexedElementType(expr as MemberExpression, ctx)?.element;

  if (expr.type === 'CallExpression') return lookupReceiverElementType(expr as CallExpression, ctx);

  return;
};

const lookupReceiverVar = (expr: CallExpression, ctx: CompilerContext): ReturnType<CompilerContext['getVar']> => {
  const instance = resolveInstanceMethod(expr);

  if (!instance || !DYNAMIC_METHODS.includes(instance.method)) return;

  return instance.object.type === 'Identifier' ? ctx.getVar((instance.object as { name: string }).name) : undefined;
};

const lookupReceiverElementType = (expr: CallExpression, ctx: CompilerContext): ElementType | undefined =>
  lookupReceiverVar(expr, ctx)?.elementType;

const lookupReceiverStructType = (expr: CallExpression, ctx: CompilerContext): StructType | undefined =>
  lookupReceiverVar(expr, ctx)?.elementType?.structType;

const lookupStructTypeFromMember = (expr: MemberExpression, ctx: CompilerContext): StructType | undefined => {
  if (expr.computed || expr.property.type !== 'Identifier') return;

  const parentStructType = getExprStructType(expr.object as Expression, ctx);

  if (!parentStructType) return;

  const field = (expr.property as { name: string }).name;
  const fieldIndex = parentStructType.fields.indexOf(field);

  return parentStructType.fieldStructTypes?.[fieldIndex];
};

const lookupStructTypeFromIndex = (expr: MemberExpression, ctx: CompilerContext): StructType | undefined => {
  if (!expr.computed || expr.object.type !== 'Identifier') return;

  const variable = ctx.getVar((expr.object as { name: string }).name);

  return variable?.elementType?.structType;
};

export const inferStructTypeWithContext = (expr: Expression, ctx: CompilerContext): StructType | undefined => {
  if (expr.type === 'ObjectExpression') return extractStructType(expr as ObjectExpression);

  if (expr.type === 'MemberExpression') {
    const member = expr as MemberExpression;

    return member.computed ? lookupStructTypeFromIndex(member, ctx) : lookupStructTypeFromMember(member, ctx);
  }

  if (expr.type === 'CallExpression') return lookupReceiverStructType(expr as CallExpression, ctx);

  return;
};
