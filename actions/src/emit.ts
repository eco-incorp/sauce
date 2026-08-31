/**
 * SauceScript source emission — the vocabulary `to-sauce.ts`, `to-quote.ts` and `megas-swap.ts`
 * share now that programs are generated as SOURCE and handed to the published Rust/wasm compiler.
 * The same idiom `sdk/src/deposit/templates.ts` and `sdk/src/token/svm.ts` already use: build
 * statement strings, hand them to one compile seam.
 *
 * Two compiler rules shape everything here, and both are why this module exists rather than each
 * generator formatting its own strings:
 *
 *   1. **A method call's receiver must be a plain identifier or another call.** `hex`…`.concat(x)`,
 *      `(a >> b).toBytesBe(4)` and `t.field.slice(0, 4)` are all rejected with "calling anything
 *      other than a plain function name is not supported in the M1 subset". So every byte literal
 *      is BOUND to a `const` before anything is called on it — that is what [`Fragment`] carries.
 *   2. **A module-scope binding holds one scalar.** A `bytes`/array/tuple initializer at module
 *      scope is rejected outright, so a selector const lives inside the function that uses it, and
 *      two actions of the same kind in one program need two distinct names — hence [`Emitter`].
 */

import { keccak256, toBytes } from 'viem';

/** A SauceScript expression. */
export type Expr = string;

/** A SauceScript statement, including its trailing `;`. */
export type Stmt = string;

/** Statements that must run first, plus the expression they leave available. */
export interface Fragment {
  readonly stmts: readonly Stmt[];
  readonly expr: Expr;
}

/** Allocates identifiers that are unique within one generated program. */
export interface Emitter {
  name(prefix: string): string;
}

export function newEmitter(): Emitter {
  let counter = 0;

  return { name: (prefix) => `${prefix}${counter++}` };
}

/** A ref name becomes an identifier in the emitted source, so it has to be spellable as one. */
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * The local that carries a `saveOutputAs`/`amountRef` slot. Prefixed so a caller-chosen name can
 * never collide with a generated temporary or shadow one of the six reserved namespace names
 * (`abi`, `crypto`, `ctx`, `Math`, `evm`, `svm`).
 */
export function slotVar(ref: string): string {
  if (!IDENTIFIER_RE.test(ref)) {
    throw new Error(
      `action chaining slot '${ref}' must be a valid identifier — it becomes a local variable in the emitted SauceScript`,
    );
  }

  return `v_${ref}`;
}

export function formatBigint(value: bigint): Expr {
  return `${value.toString()}n`;
}

/** A `hex` literal. Bind it before calling anything on it — see this module's header. */
export function bytesLiteral(bytes: Uint8Array): Expr {
  return `hex\`${Buffer.from(bytes).toString('hex')}\``;
}

/** A tuple literal. Fields are positional; the names are a mnemonic the ABI encoder ignores. */
export function tupleLiteral(fields: readonly Expr[]): Expr {
  return `{ ${fields.map((field, i) => `f${i}: ${field}`).join(', ')} }`;
}

export function arrayLiteral(elements: readonly Expr[]): Expr {
  return `[${elements.join(', ')}]`;
}

/**
 * `abi.encode` of an argument list, always wrapped in one tuple.
 *
 * The wrap is load-bearing, not cosmetic: a LONE tuple argument passes through `abi.encode`
 * unwrapped, which drops the outer head offset a signature like
 * `exactInput((bytes,address,uint256,uint256))` requires. Wrapping reproduces the retired builder's
 * `abiEncode(tuple(args))` for every arity, and is byte-identical to `encodeAbiParameters` for a
 * static lone tuple too (a static field carries no offset either way) — verified against viem for
 * all seven distinct calldata shapes these generators emit.
 */
export function encodeArgs(args: readonly Expr[]): Expr {
  return `abi.encode(${tupleLiteral(args)})`;
}

/** The 4-byte selector of a Solidity function signature. */
export function selector(sig: string): Uint8Array {
  return hexToBytes(keccak256(toBytes(sig)).slice(0, 10));
}

export function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(body.substring(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

/** Bind `bytes` to a fresh `const` and yield its name. */
export function bindBytes(emit: Emitter, prefix: string, bytes: Uint8Array): Fragment {
  const name = emit.name(prefix);

  return { stmts: [`const ${name} = ${bytesLiteral(bytes)};`], expr: name };
}

/** Bind `expr` to a fresh `const` and yield its name. */
export function bindConst(emit: Emitter, prefix: string, expr: Expr): Fragment {
  const name = emit.name(prefix);

  return { stmts: [`const ${name} = ${expr};`], expr: name };
}

/**
 * Calldata for `sig`: a bound selector const, concatenated with the ABI-encoded arguments. Calldata
 * assembled from pre-encoded blobs instead (UniV4's two-level router input, `balancerV2BatchSwap`'s
 * placeholder splice) uses [`concatCalldata`] over the bound selector directly.
 */
export function calldata(emit: Emitter, sig: string, args: readonly Expr[]): Fragment {
  const sel = bindBytes(emit, 'sel', selector(sig));
  if (args.length === 0) return sel;

  return { stmts: sel.stmts, expr: `${sel.expr}.concat(${encodeArgs(args)})` };
}

/** `sel.concat(part, part, …)` — for calldata assembled from pre-encoded blobs. */
export function concatCalldata(sel: Expr, parts: readonly Expr[]): Expr {
  return parts.length === 0 ? sel : `${sel}.concat(${parts.join(', ')})`;
}

/**
 * A single `uint256` read out of a call's return data.
 *
 * The return data is bound first. That is not tidiness: a projection re-evaluates the object it
 * embeds, so `abi.decode(evm.call(…), ["Uint256"])[0]` would issue the call twice.
 */
export function decodeUint256(emit: Emitter, callExpr: Expr): Fragment {
  const ret = bindConst(emit, 'ret', callExpr);

  return { stmts: ret.stmts, expr: `abi.decode(${ret.expr}, ["Uint256"])[0]` };
}

/**
 * Indent a statement list into a function body. Every LINE of a multi-line entry is indented, not
 * just its first — an entry may itself be a nested block (a dispatcher branch), and indenting only
 * the first line leaves the rest hanging at the outer level.
 */
export function indent(stmts: readonly Stmt[], depth = 1): string {
  const pad = '  '.repeat(depth);

  return stmts
    .map((stmt) => stmt.split('\n').map((line) => (line === '' ? line : `${pad}${line}`)).join('\n'))
    .join('\n');
}

/** A `function <name>(<params>): <returnType> { … }` declaration. */
export function fn(name: string, params: readonly string[], returnType: string, body: readonly Stmt[]): string {
  return `function ${name}(${params.join(', ')}): ${returnType} {\n${indent(body)}\n}`;
}
