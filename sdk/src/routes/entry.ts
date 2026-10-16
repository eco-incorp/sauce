/**
 * A program's `main(...)` parameters on the route path: reading its signature, and encoding the
 * values a caller passes for it.
 *
 * The SDK's passes parse SauceScript with its annotations (`parse.ts`), so a typed `main` reaches
 * the compiler exactly as written; this only reads it.
 *
 * ENTRY ARGUMENTS. A value for a parameter arrives at run time, appended to the program, ABI-v1:
 * `abi.encode` of the parameters in order, no selector, except that a tuple parameter is always
 * behind an offset (`encodeAbiEntry`). `encodeEntryArguments` checks each value against the type the
 * program declares and encodes it. Only annotations are types here: a parameter without one is a
 * `Uint256`, as the compiler reads it.
 */
import { address as svmAddress, getAddressEncoder, isAddress as isSvmKey } from "@solana/kit";
import {
  bytesToBigInt,
  bytesToHex,
  concatBytes,
  concatHex,
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  isAddress,
  isHex,
  numberToHex,
  size,
  sliceHex,
  type Hex,
} from "viem";

import type { AstNode } from "./ast-walk.js";
import { parseSauce } from "./parse.js";
import { blankLiterals } from "./rs-compile.js";
import type { CompiledSauceProgram } from "./sauce-route.js";

/** One of `main`'s runtime parameters, as the program declares it. */
export interface EntryParam {
  readonly name: string;
  /** The declared type as written (`Address`, `Uint256[]`, `{ amount: Uint256 }`); `Uint256` when
   *  the parameter has no annotation. */
  readonly type: string;
}

/** A value for an entry parameter: a scalar as a bigint, safe-integer number or integer string, an
 *  address as hex, a `bool` as a boolean, `bytes` as a `Uint8Array` or hex, an array as an array,
 *  and a tuple as an array of its fields in order or an object naming them. */
export type EntryValue =
  | bigint
  | number
  | boolean
  | string
  | Uint8Array
  | readonly EntryValue[]
  | { readonly [field: string]: EntryValue };

/** What `encodeEntryArguments` reads of a compiled program. */
type ProgramEntry = Pick<CompiledSauceProgram, "entryParams">;

// ---------------------------------------------------------------------------------------------
// Finding `main`'s signature
// ---------------------------------------------------------------------------------------------

interface MainSignature {
  /** Index of the `(` opening the parameter list, and of the `)` closing it. */
  readonly open: number;
  readonly close: number;
  /** Where the return annotation (`: Type`, from the colon) ends; `close + 1` when there is none. */
  readonly returnEnd: number;
}

const MAIN = /(^|[^.\w$])function\s+main\s*\(/;

/** The end of the type starting at `from` in blanked `code`: at the body's `{` or end of input. */
function endOfType(code: string, from: number): number {
  let depth = 0;
  let started = false;
  for (let i = from; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === "{" && depth === 0 && started) return i;
    if (ch === "<" || ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === ">" || ch === "}" || ch === "]" || ch === ")") depth--;
    if (!/\s/.test(ch)) started = true;
  }

  return code.length;
}

function locateMain(source: string): MainSignature | undefined {
  const code = blankLiterals(source);
  const found = MAIN.exec(code);
  if (found === null) return undefined;

  return signatureAt(code, found.index + found[0].length - 1);
}

/** The signature whose parameter list opens at `open` in blanked `code`. */
function signatureAt(code: string, open: number): MainSignature | undefined {
  let depth = 0;
  let close = -1;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0) return undefined;
  const colon = /^\s*:/.exec(code.slice(close + 1));
  let returnEnd = colon === null ? close + 1 : endOfType(code, close + 1 + colon[0].length);
  // The annotation ends with its type, not with the space before the body's brace.
  while (returnEnd > close + 1 && /\s/.test(code[returnEnd - 1]!)) returnEnd--;

  return { open, close, returnEnd };
}

/** `text` split at its top-level commas (or other `separators`) — not those inside `<>`, `{}`, `[]`
 *  or `()`. */
function splitTopLevel(text: string, separators = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "<" || ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === ">" || ch === "}" || ch === "]" || ch === ")") depth--;
    else if (separators.includes(ch) && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));

  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** A parameter's name and declared type text (undefined when it has no annotation). */
function splitParam(param: string): { name: string; type?: string } {
  const colon = param.indexOf(":");

  return colon < 0
    ? { name: param.trim() }
    : { name: param.slice(0, colon).trim(), type: param.slice(colon + 1).trim() };
}

/** `main`'s signature as a source writes it (`mainSignature`). */
export interface MainSignatureText {
  /** Indices of the `(` opening the parameter list and the `)` closing it. */
  readonly open: number;
  readonly close: number;
  /** The parameter list's text, and the return annotation's (`: Type`, or empty). */
  readonly params: string;
  readonly returns: string;
  /** The parameters' names, in order. */
  readonly names: string[];
  /** Whether `main` returns a value: a non-`void` annotation or, with none, a `return <value>`. */
  readonly returnsValue: boolean;
}

/**
 * Whether the body whose `{` is at `brace` in blanked `code` returns a value: a `return` with an
 * operand, outside any arrow function's own block (an intent's closure) inside it.
 */
function bodyReturnsValue(code: string, brace: number): boolean {
  const token = /=>\s*\{|[{}]|(?<![.\w$])return\b(?!\s*[;}])/g;
  token.lastIndex = brace;
  let depth = 0;
  const arrows: number[] = [];
  for (let found = token.exec(code); found !== null; found = token.exec(code)) {
    const text = found[0];
    if (text === "}") {
      if (arrows.at(-1) === depth) arrows.pop();
      if (--depth === 0) return false;
    } else if (text.endsWith("{")) {
      depth++;
      if (text.startsWith("=>")) arrows.push(depth);
    } else if (arrows.length === 0) {
      return true;
    }
  }

  return false;
}

/** `main`'s signature as `source` writes it; `undefined` with no `main`. */
export function mainSignature(source: string): MainSignatureText | undefined {
  const main = locateMain(source);
  if (main === undefined) return undefined;
  const params = source.slice(main.open + 1, main.close);
  const returns = source.slice(main.close + 1, main.returnEnd);
  const code = blankLiterals(source);
  const brace = code.indexOf("{", main.returnEnd);

  return {
    open: main.open,
    close: main.close,
    params,
    returns,
    names: splitTopLevel(params).map((param) => splitParam(param).name),
    returnsValue:
      returns.trim() === ""
        ? brace >= 0 && bodyReturnsValue(code, brace)
        : !/^:\s*void$/.test(returns.trim()),
  };
}

/**
 * `main`'s parameters as `source` declares them — every one, `Account` slots included. A record
 * type named by an `interface` the file declares is spelled out inline (`{ amount: Uint256 }`),
 * since that is what a value for it is encoded against.
 */
export function mainParams(source: string): EntryParam[] {
  const main = locateMain(source);
  if (main === undefined) return [];
  const params = splitTopLevel(source.slice(main.open + 1, main.close)).map(splitParam);
  const records = params.some((param) => param.type !== undefined) ? interfaces(source) : new Map();

  return params.map(({ name, type }) => ({
    name,
    type: type === undefined ? "Uint256" : inlineRecords(type, records),
  }));
}

/**
 * The type `main` declares it returns (`Address`, `Uint256[]`, `{ out: Uint256 }`), with a record an
 * `interface` names spelled out inline as `mainParams` does — `undefined` when `main` declares none
 * or `void`, or there is no `main`.
 */
export function mainReturnType(source: string): string | undefined {
  const main = locateMain(source);
  if (main === undefined) return undefined;
  const annotation = source
    .slice(main.close + 1, main.returnEnd)
    .replace(/^\s*:/, "")
    .trim();
  if (annotation === "" || annotation === "void") return undefined;

  return inlineRecords(annotation, interfaces(source));
}

/** Each `interface` the module declares, as the inline object type it names. */
function interfaces(source: string): ReadonlyMap<string, string> {
  const records = new Map<string, string>();
  for (const node of (parseSauce(source) as unknown as { body: AstNode[] }).body) {
    const declaration =
      node.type === "ExportNamedDeclaration" ? (node.declaration as AstNode | null) : node;
    if (declaration?.type !== "TSInterfaceDeclaration") continue;
    const members = (declaration.body as { body: AstNode[] }).body.map((member) => {
      const key = member.key as AstNode & { name: string };
      const annotation = (member.typeAnnotation as { typeAnnotation: AstNode }).typeAnnotation;

      return `${key.name}: ${source.slice(annotation.start, annotation.end)}`;
    });
    records.set((declaration.id as { name: string }).name, `{ ${members.join(", ")} }`);
  }

  return records;
}

/** `type` with every interface name in it replaced by its inline object type, recursively. */
function inlineRecords(type: string, records: ReadonlyMap<string, string>, depth = 0): string {
  if (records.size === 0 || depth > 16) return type;

  return type.replace(/[A-Za-z_$][\w$]*/g, (name) => {
    const record = records.get(name);

    return record === undefined ? name : inlineRecords(record, records, depth + 1);
  });
}

// ---------------------------------------------------------------------------------------------
// Declared types, and encoding values for them
// ---------------------------------------------------------------------------------------------

/** A declared entry type, parsed. */
export type EntryType =
  | { readonly kind: "uint" | "address" | "bool" | "bytes" | "string" | "account" }
  | { readonly kind: "array"; readonly of: EntryType }
  | { readonly kind: "tuple"; readonly fields: ReadonlyArray<{ name: string; type: EntryType }> };

const SCALARS: Readonly<Record<string, EntryType["kind"]>> = {
  Uint256: "uint",
  number: "uint",
  bigint: "uint",
  Address: "address",
  bool: "bool",
  boolean: "bool",
  bytes: "bytes",
  string: "string",
  Account: "account",
};

/** `text`, a SauceScript type — the types an entry parameter can declare. */
export function parseEntryType(text: string): EntryType {
  const type = text.trim();
  if (type.endsWith("[]")) return { kind: "array", of: parseEntryType(type.slice(0, -2)) };
  if (type.startsWith("{") && type.endsWith("}")) {
    return {
      kind: "tuple",
      // A record type's fields, separated by `,` or, as a TypeScript formatter writes them, `;`.
      fields: splitTopLevel(type.slice(1, -1), ",;").map((field) => {
        const { name, type: fieldType } = splitParam(field);
        if (fieldType === undefined)
          throw new TypeError(`the field '${name}' of ${type} has no type`);

        return { name, type: parseEntryType(fieldType) };
      }),
    };
  }
  const scalar = SCALARS[type.replace(/<[^]*>$/, "")];
  if (scalar === undefined) {
    throw new TypeError(
      `'${type}' is not a type an entry argument can be encoded for: Uint256, Address, Account, ` +
        "bool, bytes, string, T[] or an inline { field: T } tuple",
    );
  }

  return { kind: scalar } as EntryType;
}

type AbiParam = { name?: string; type: string; components?: AbiParam[] };

function abiParam(type: EntryType, name?: string): AbiParam {
  const named = name === undefined ? {} : { name };
  switch (type.kind) {
    case "uint":
      return { ...named, type: "uint256" };
    case "address":
    case "account":
      return { ...named, type: "address" };
    case "array": {
      const inner = abiParam(type.of);

      return { ...named, ...inner, type: `${inner.type}[]` };
    }
    case "tuple":
      return {
        ...named,
        type: "tuple",
        components: type.fields.map((field) => abiParam(field.type, field.name)),
      };
    default:
      return { ...named, type: type.kind };
  }
}

const shown = (value: unknown): string =>
  typeof value === "string"
    ? `'${value}'`
    : typeof value === "bigint"
      ? `${value}n`
      : value instanceof Uint8Array
        ? "a byte array"
        : (JSON.stringify(value) ?? String(value));

/** Normalized for the encoder: scalars as bigint, addresses and bytes as hex, tuples as arrays. */
type Normalized = bigint | boolean | string | Normalized[];

function normalize(type: EntryType, value: EntryValue, at: string): Normalized {
  const fail = (what: string): never => {
    throw new TypeError(`${at}: ${shown(value)} is not ${what}`);
  };
  switch (type.kind) {
    case "uint": {
      const word =
        typeof value === "bigint"
          ? value
          : typeof value === "number" && Number.isSafeInteger(value)
            ? BigInt(value)
            : typeof value === "string" && /^(?:\d+|0x[0-9a-fA-F]+)$/.test(value)
              ? BigInt(value)
              : undefined;
      if (word === undefined || word < 0n || word >= 1n << 256n) {
        return fail("an unsigned integer below 2^256 (a bigint, a safe integer, or its digits)");
      }

      return word;
    }
    case "address":
    case "account":
      return typeof value === "string" && isAddress(value, { strict: false })
        ? getAddress(value)
        : fail("an address: 20 bytes of 0x-prefixed hex");
    case "bool":
      return typeof value === "boolean"
        ? value
        : value === "true" || value === "false"
          ? value === "true"
          : fail("a bool: true or false");
    case "bytes":
      if (value instanceof Uint8Array) return bytesToHex(value);
      return typeof value === "string" && isHex(value) && value.length % 2 === 0
        ? value
        : fail("bytes: a Uint8Array or even-length 0x-prefixed hex");
    case "string":
      return typeof value === "string" ? value : fail("a string");
    case "array":
      return Array.isArray(value)
        ? value.map((item, index) => normalize(type.of, item, `${at}[${index}]`))
        : fail("an array");
    case "tuple": {
      const { fields } = type;
      if (Array.isArray(value)) {
        if (value.length !== fields.length) {
          return fail(
            `a tuple of ${fields.length} fields (${fields.map((f) => f.name).join(", ")})`,
          );
        }

        return fields.map((field, index) =>
          normalize(field.type, value[index]!, `${at}.${field.name}`),
        );
      }
      if (value === null || typeof value !== "object" || value instanceof Uint8Array) {
        return fail("a tuple: an array of its fields in order, or an object naming them");
      }
      const record = value as { readonly [field: string]: EntryValue };
      const names = fields.map((field) => field.name);
      const unknown = Object.keys(record).filter((key) => !names.includes(key));
      const missing = names.filter((name) => !Object.hasOwn(record, name));
      if (unknown.length > 0 || missing.length > 0) {
        return fail(`a tuple with exactly the fields ${names.join(", ")}`);
      }

      return fields.map((field) =>
        normalize(field.type, record[field.name]!, `${at}.${field.name}`),
      );
    }
  }
}

/** A tuple normalized positionally, re-keyed by field name for viem's tuple encoding. */
function forAbi(type: EntryType, value: Normalized): unknown {
  if (type.kind === "array") return (value as Normalized[]).map((item) => forAbi(type.of, item));
  if (type.kind === "tuple") {
    return Object.fromEntries(
      type.fields.map((field, index) => [
        field.name,
        forAbi(field.type, (value as Normalized[])[index]!),
      ]),
    );
  }

  return value;
}

/** Whether a value of `type` has no fixed size, which ABI encoding puts behind an offset. */
function isDynamic(type: EntryType): boolean {
  if (type.kind === "tuple") return type.fields.some((field) => isDynamic(field.type));

  return type.kind === "bytes" || type.kind === "string" || type.kind === "array";
}

/** Whether `main` reads its parameter of `type` behind an offset word: a dynamic one, and a tuple
 *  of fixed-size fields too, which `abi.encode` would write inline. */
const behindOffset = (type: EntryType): boolean => type.kind === "tuple" || isDynamic(type);

const WORD = 32;

/**
 * ABI-v1 entry arguments: one head word per parameter — its value, or the offset of its encoding
 * after the heads — then those encodings in order.
 *
 * That is `abi.encode` of the parameters for every parameter but a tuple of fixed-size fields. The
 * compiler gives each of `main`'s parameters exactly one head word, so it reads such a tuple behind
 * an offset, where `abi.encode` writes its fields inline in the head. Inside a parameter the
 * encoding is `abi.encode`'s: a tuple of fixed-size fields nested in a tuple or an array is inline.
 */
function encodeAbiEntry(
  abi: readonly AbiParam[],
  types: readonly EntryType[],
  values: readonly unknown[],
): Hex {
  const heads: Hex[] = [];
  const tails: Hex[] = [];
  let next = WORD * types.length;
  types.forEach((type, index) => {
    const encoded = encodeAbiParameters([abi[index]!] as never, [values[index]] as never);
    if (!behindOffset(type)) {
      heads.push(encoded);

      return;
    }
    // A dynamic value's encoding opens with its own offset word; a fixed-size tuple's is its fields.
    const tail = isDynamic(type) ? sliceHex(encoded, WORD) : encoded;
    heads.push(numberToHex(next, { size: WORD }));
    tails.push(tail);
    next += size(tail);
  });

  return concatHex([...heads, ...tails]);
}

/** `encodeAbiEntry` read back, as leniently as viem reads; the caller re-encodes what this returns
 *  to hold `encoded` to the one canonical form. */
function decodeAbiEntry(
  abi: readonly AbiParam[],
  types: readonly EntryType[],
  encoded: Uint8Array,
): unknown[] {
  if (encoded.length < WORD * types.length) {
    throw new RangeError(
      `decodeEntryArguments: ${encoded.length} bytes are not the canonical encoding of main's ` +
        `arguments (its ${types.length} parameters take at least ${WORD * types.length})`,
    );
  }

  return types.map((type, index) => {
    const head = encoded.subarray(WORD * index, WORD * (index + 1));
    if (!behindOffset(type)) return decodeAbiParameters([abi[index]!] as never, head)[0];
    const tail = encoded.subarray(Number(bytesToBigInt(head)));
    // viem reads a dynamic value through an offset word of its own, so it is given one.
    const read = isDynamic(type)
      ? concatBytes([hexToBytes(numberToHex(WORD, { size: WORD })), tail])
      : tail;

    return decodeAbiParameters([abi[index]!] as never, read)[0];
  });
}

/**
 * One of `main`'s arguments as the single word a compile-time value is: an unsigned integer or an
 * address as a bigint, a `bool` as a boolean. `undefined` for a parameter of any other type (bytes,
 * a string, an array, a record, an `Account`), which no one word holds. Throws, naming `at`, on a
 * value that is not of the declared type, as `encodeEntryArguments` does.
 */
export function entryConstant(
  type: string,
  value: EntryValue,
  at: string,
): bigint | boolean | undefined {
  const parsed = parseEntryType(type);
  if (parsed.kind !== "uint" && parsed.kind !== "address" && parsed.kind !== "bool") {
    return undefined;
  }
  // A Solana key, in base58: an account an intent to Solana names, bound as the 32-byte word
  // that is its key there. Never an address on an EVM chain, whose 20 bytes are hex.
  if (parsed.kind === "address" && typeof value === "string" && isSvmKey(value)) {
    return BigInt(bytesToHex(new Uint8Array(getAddressEncoder().encode(svmAddress(value)))));
  }
  const normalized = normalize(parsed, value, at);

  return typeof normalized === "string" ? BigInt(normalized) : (normalized as bigint | boolean);
}

/** {@link bindEntryArguments}'s result. */
export interface BoundEntryArguments {
  /** The source with `main`'s parameter list blanked: each of its characters a space, so every
   *  position after it is the source's own. */
  readonly source: string;
  /** Each parameter's value, by its name: the compile-time value the compiler reads it as. */
  readonly constants: Readonly<Record<string, bigint | boolean>>;
  /** The parameters declared `Address`. */
  readonly addresses: readonly string[];
}

/**
 * `source` with `main`'s arguments bound into it as constants: `main(amount: Uint256)` given
 * `[1000000n]` compiles as if its body read `amount` as `1000000`. How a wallet publishes the
 * intents a file opens from values known before anything runs, so they come out fixed. Each must be
 * one word: an unsigned integer, an address or a `bool`.
 *
 * Throws a `RangeError` for a source whose `main` declares no parameters, or a wrong count, and a
 * `TypeError` naming the parameter for a value of the wrong type or a parameter no one word holds.
 */
export function bindEntryArguments(
  source: string,
  values: readonly EntryValue[],
): BoundEntryArguments {
  const signature = locateMain(source);
  const params = mainParams(source);
  if (signature === undefined || params.length === 0) {
    throw new RangeError("the program declares no `main` with parameters to bind arguments to");
  }
  const shape = params.map((param) => `${param.name}: ${param.type}`).join(", ");
  if (values.length !== params.length) {
    throw new RangeError(
      `main(${shape}) takes ${params.length} argument${params.length === 1 ? "" : "s"}, got ` +
        `${values.length}`,
    );
  }
  const constants: Record<string, bigint | boolean> = {};
  const addresses: string[] = [];
  params.forEach((param, index) => {
    const at = `argument ${index + 1} (${param.name}: ${param.type})`;
    const value = entryConstant(param.type, values[index]!, at);
    if (value === undefined) {
      throw new TypeError(
        `${at}: only one word binds as a constant: an unsigned integer, an address or a bool`,
      );
    }
    constants[param.name] = value;
    if (parseEntryType(param.type).kind === "address") addresses.push(param.name);
  });
  const list = source.slice(signature.open + 1, signature.close);

  return {
    source:
      source.slice(0, signature.open + 1) +
      list.replace(/[^\r\n]/g, " ") +
      source.slice(signature.close),
    constants,
    addresses,
  };
}

/**
 * The encoded entry arguments for `program`: `values` checked against `main`'s declared parameters,
 * in their order, and encoded ABI-v1. Append them to the program's bytecode; that whole payload is
 * the `program` of `Pot.cook(engine, program)`.
 *
 * Throws, naming the parameter and what it takes, on a wrong count or a value that is not of the
 * declared type.
 */
export function encodeEntryArguments(
  program: ProgramEntry,
  values: readonly EntryValue[],
): Uint8Array {
  const params = program.entryParams;
  if (values.length !== params.length) {
    const signature = params.map((param) => `${param.name}: ${param.type}`).join(", ");
    throw new RangeError(
      `main takes ${params.length} argument${params.length === 1 ? "" : "s"} (${signature}), got ${values.length}`,
    );
  }
  const types = params.map((param) => parseEntryType(param.type));
  const normalized = params.map((param, index) =>
    normalize(
      types[index]!,
      values[index]!,
      `argument ${index + 1} (${param.name}: ${param.type})`,
    ),
  );
  if (params.length === 0) return new Uint8Array();

  return hexToBytes(
    encodeAbiEntry(
      types.map((type, index) => abiParam(type, params[index]!.name)),
      types,
      types.map((type, index) => forAbi(type, normalized[index]!)),
    ),
  );
}

/** A decoded value in the shape `encodeEntryArguments` takes back: scalars as bigints, addresses
 *  checksummed, `bytes` as hex, tuples as objects naming their fields. */
function typed(type: EntryType, value: unknown): EntryValue {
  switch (type.kind) {
    case "uint":
      return value as bigint;
    case "address":
    case "account":
      return getAddress(value as string);
    case "bool":
      return value as boolean;
    case "bytes":
      return value as Hex;
    case "string":
      return value as string;
    case "array":
      return (value as readonly unknown[]).map((item) => typed(type.of, item));
    case "tuple":
      return Object.fromEntries(
        type.fields.map((field) => [
          field.name,
          typed(field.type, (value as Record<string, unknown>)[field.name]),
        ]),
      );
  }
}

/**
 * The strict inverse of `encodeEntryArguments`: `main`'s arguments read back from the bytes a cook
 * appended to `program`'s bytecode, one value per declared parameter. Throws when `encoded` is not
 * exactly the encoding `encodeEntryArguments` produces for the values it decodes to — a truncated,
 * padded or otherwise non-canonical tail — so a decoded value is the only one those bytes carry.
 */
export function decodeEntryArguments(program: ProgramEntry, encoded: Uint8Array): EntryValue[] {
  const params = program.entryParams;
  const types = params.map((param) => parseEntryType(param.type));
  const raw = decodeAbiEntry(
    types.map((type, index) => abiParam(type, params[index]!.name)),
    types,
    encoded,
  );
  const values = types.map((type, index) => typed(type, raw[index]));
  const again = encodeEntryArguments(program, values);
  if (again.length !== encoded.length || again.some((byte, index) => byte !== encoded[index])) {
    throw new RangeError(
      `decodeEntryArguments: ${encoded.length} bytes are not the canonical encoding of main's ` +
        `arguments (they re-encode to ${again.length} bytes)`,
    );
  }

  return values;
}
