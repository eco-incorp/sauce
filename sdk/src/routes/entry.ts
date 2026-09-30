/**
 * A program's `main(...)` parameters on the route path: letting the SDK's passes compile a typed
 * signature, reading it back, and encoding the values a caller passes for it.
 *
 * TYPED `main`. The token, protocol and intent passes parse the program with acorn, which has no
 * TypeScript: `function main(token: Address, amounts: Uint256[])` does not parse. So the signature's
 * annotations are LIFTED before those passes — the parameter list reduced to its names, the return
 * type dropped — and put back after them, before the compiler sees the source. The passes never
 * touch `main`'s signature, and `restore` checks they did not. A signature with no annotation is
 * left exactly as written, so every untyped program compiles to the bytes it always did.
 *
 * ENTRY ARGUMENTS. A value for a parameter arrives at run time, appended to the program: ABI-v1
 * (`abi.encode` of the parameters in order, no selector) by default, compact-v1 under `compactArgs`.
 * `encodeEntryArguments` checks each value against the type the program declares and encodes it in
 * the encoding the program was compiled for. Only annotations are types here: a parameter without
 * one is a `Uint256`, as `rs-compile.ts#ensureTypedMainParams` declares it.
 */
import {
  bytesToHex,
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  isAddress,
  isHex,
  type Hex,
} from "viem";

import { encodeCompactArguments, type CompactValue } from "../compact-arguments.js";
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
type ProgramEntry = Pick<CompiledSauceProgram, "entryEncoding" | "entrySchema" | "entryParams">;

// ---------------------------------------------------------------------------------------------
// Finding, lifting and restoring `main`'s signature
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
  const open = found.index + found[0].length - 1;
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

/** `text` split at its top-level commas — not those inside `<>`, `{}`, `[]` or `()`. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "<" || ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === ">" || ch === "}" || ch === "]" || ch === ")") depth--;
    else if (ch === "," && depth === 0) {
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

export interface LiftedSignature {
  /** The source with `main`'s annotations removed, for the acorn-based passes. */
  readonly source: string;
  /** Puts the annotations back into what those passes made of `source`. */
  readonly restore: (rewritten: string) => string;
}

/**
 * `source` with `main`'s parameter and return annotations lifted out, and how to put them back.
 * A `main` with none is returned as it is, with a `restore` that changes nothing.
 */
export function liftMainSignature(source: string): LiftedSignature {
  const main = locateMain(source);
  const params = main === undefined ? "" : source.slice(main.open + 1, main.close);
  const returns = main === undefined ? "" : source.slice(main.close + 1, main.returnEnd);
  if (main === undefined || (!params.includes(":") && returns === "")) {
    return { source, restore: (rewritten) => rewritten };
  }
  const names = splitTopLevel(params)
    .map((param) => splitParam(param).name)
    .join(", ");
  const lifted = `${source.slice(0, main.open + 1)}${names})${source.slice(main.returnEnd)}`;

  return {
    source: lifted,
    restore: (rewritten) => {
      const after = locateMain(rewritten);
      if (after === undefined || rewritten.slice(after.open + 1, after.close) !== names) {
        throw new Error(
          "compileSauceRoute: main's parameters changed while the SDK rewrote the program, so its " +
            "type annotations cannot be put back",
        );
      }

      return `${rewritten.slice(0, after.open + 1)}${params})${returns}${rewritten.slice(after.close + 1)}`;
    },
  };
}

/** `main`'s parameters as `source` declares them — every one, `Account` slots included. */
export function mainParams(source: string): EntryParam[] {
  const main = locateMain(source);
  if (main === undefined) return [];

  return splitTopLevel(source.slice(main.open + 1, main.close)).map((param) => {
    const { name, type } = splitParam(param);

    return { name, type: type ?? "Uint256" };
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
      fields: splitTopLevel(type.slice(1, -1)).map((field) => {
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

/** Normalized for both encoders: scalars as bigint, addresses and bytes as hex, tuples as arrays. */
type Normalized = bigint | boolean | string | Uint8Array | Normalized[];

function normalize(type: EntryType, value: EntryValue, at: string, compact: boolean): Normalized {
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
      if (value instanceof Uint8Array) return compact ? value : bytesToHex(value);
      return typeof value === "string" && isHex(value) && value.length % 2 === 0
        ? compact
          ? hexToBytes(value as Hex)
          : value
        : fail("bytes: a Uint8Array or even-length 0x-prefixed hex");
    case "string":
      return typeof value === "string"
        ? compact
          ? new TextEncoder().encode(value)
          : value
        : fail("a string");
    case "array":
      return Array.isArray(value)
        ? value.map((item, index) => normalize(type.of, item, `${at}[${index}]`, compact))
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
          normalize(field.type, value[index]!, `${at}.${field.name}`, compact),
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
        normalize(field.type, record[field.name]!, `${at}.${field.name}`, compact),
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

/**
 * The encoded entry arguments for `program`: `values` checked against `main`'s declared parameters,
 * in their order, and encoded as the program was compiled to read them. Append them to the program's
 * bytecode; that whole payload is the `program` of `Pot.cook(engine, program)`.
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
  const compact = program.entryEncoding === "compact-v1";
  const types = params.map((param) => parseEntryType(param.type));
  const normalized = params.map((param, index) =>
    normalize(
      types[index]!,
      values[index]!,
      `argument ${index + 1} (${param.name}: ${param.type})`,
      compact,
    ),
  );
  if (compact) {
    if (program.entrySchema === undefined) {
      throw new Error("encodeEntryArguments: a compact-v1 program carries its entrySchema");
    }

    return encodeCompactArguments(program.entrySchema, normalized as CompactValue);
  }
  if (params.length === 0) return new Uint8Array();

  return hexToBytes(
    encodeAbiParameters(
      types.map((type, index) => abiParam(type, params[index]!.name)) as never,
      types.map((type, index) => forAbi(type, normalized[index]!)) as never,
    ),
  );
}
